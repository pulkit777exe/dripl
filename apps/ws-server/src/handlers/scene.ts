import { z } from 'zod';
import type { DriplElement } from '@dripl/common';
import { shouldAcceptElement } from '@dripl/common/reconciliation';
import type { Handler } from './types';
import { broadcast, send } from '../broadcast';
import { markRoomDirty, scheduleSave, MAX_ELEMENTS_PER_SCENE } from '../rooms';
import { publishToRoom } from '../redis';
import {
  acceptValidated,
  wouldExceedSceneCapacity,
  noteClientMsgId,
  sceneCapacityMessage,
} from '../sceneMutation';
import { deleteWithTombstone, isSupersededByTombstone } from '../tombstones';
import {
  addElementSchema,
  updateElementSchema,
  deleteElementSchema,
  sceneUpdateSchema,
  sceneDeltaSchema,
  elementUpdateSchema,
} from '../validation';

type AddElement = z.infer<typeof addElementSchema>;
type UpdateElement = z.infer<typeof updateElementSchema>;
type DeleteElement = z.infer<typeof deleteElementSchema>;
type SceneUpdate = z.infer<typeof sceneUpdateSchema>;
type SceneDelta = z.infer<typeof sceneDeltaSchema>;
type ElementUpdate = z.infer<typeof elementUpdateSchema>;

export const addElementHandler: Handler<typeof addElementSchema, AddElement> = {
  type: 'add_element',
  schema: addElementSchema,
  apply(msg, ctx) {
    if (ctx.rejectReadOnlyMutation()) return;
    const room = ctx.room;
    // msg.element already passed messageSchema (this same schema) in the
    // dispatch prologue, so re-parsing would only burn CPU on the hot path.
    // The cast bridges the pre-existing DriplElementSchema-output vs
    // DriplElement drift — the same cast toDriplElement performed — and
    // unvalidated input (Redis fan-out) never reaches this handler.
    const element = msg.element as DriplElement;
    const existing = room.elements.get(element.id);
    if (!existing && room.elements.size >= MAX_ELEMENTS_PER_SCENE) {
      send(ctx.ws, {
        type: 'error',
        message: `Scene is at capacity (${MAX_ELEMENTS_PER_SCENE} elements max)`,
      });
      return;
    }
    // Tombstone fence: a delete beats concurrent stale writes. Without this,
    // an edit made against the pre-delete state resurrects the element.
    if (isSupersededByTombstone(room, element)) return;
    if (existing && !shouldAcceptElement(element, existing)) return;
    room.elements.set(element.id, element);
    broadcast(room, msg, ctx.userId ?? undefined);
    markRoomDirty(ctx.roomId);
    scheduleSave(ctx.roomId);
    publishToRoom(ctx.roomId, msg);
  },
};

export const updateElementHandler: Handler<typeof updateElementSchema, UpdateElement> = {
  type: 'update_element',
  schema: updateElementSchema,
  apply(msg, ctx) {
    if (ctx.rejectReadOnlyMutation()) return;
    const room = ctx.room;
    const element = msg.element as DriplElement;
    const existing = room.elements.get(element.id);
    if (!existing && room.elements.size >= MAX_ELEMENTS_PER_SCENE) {
      send(ctx.ws, {
        type: 'error',
        message: `Scene is at capacity (${MAX_ELEMENTS_PER_SCENE} elements max)`,
      });
      return;
    }
    if (isSupersededByTombstone(room, element)) return;
    if (existing && !shouldAcceptElement(element, existing)) return;
    room.elements.set(element.id, element);
    broadcast(room, msg, ctx.userId ?? undefined);
    markRoomDirty(ctx.roomId);
    scheduleSave(ctx.roomId);
    publishToRoom(ctx.roomId, msg);
  },
};

export const deleteElementHandler: Handler<typeof deleteElementSchema, DeleteElement> = {
  type: 'delete_element',
  schema: deleteElementSchema,
  apply(msg, ctx) {
    if (ctx.rejectReadOnlyMutation()) return;
    const room = ctx.room;
    // Versioned delete: concurrent stale edits lose to the tombstone instead
    // of resurrecting the element on this and every other replica.
    const deleted = deleteWithTombstone(room, msg.elementId);
    if (!deleted) return;
    broadcast(room, msg, ctx.userId ?? undefined);
    markRoomDirty(ctx.roomId);
    scheduleSave(ctx.roomId);
    publishToRoom(ctx.roomId, msg);
  },
};

export const sceneUpdateHandler: Handler<typeof sceneUpdateSchema, SceneUpdate> = {
  type: 'scene-update',
  schema: sceneUpdateSchema,
  apply(msg, ctx) {
    if (ctx.rejectReadOnlyMutation()) return;
    const room = ctx.room;
    if (!Array.isArray(msg.elements)) return;
    if (
      msg.elements.length > MAX_ELEMENTS_PER_SCENE ||
      wouldExceedSceneCapacity(room, msg.elements)
    ) {
      send(ctx.ws, {
        type: 'error',
        message: sceneCapacityMessage(),
      });
      return;
    }

    // Dedup check
    const sceneUpdateMsgId =
      'clientMsgId' in msg ? (msg as { clientMsgId?: string }).clientMsgId : undefined;
    if (noteClientMsgId(room, sceneUpdateMsgId)) {
      send(ctx.ws, { type: 'pong', timestamp: Date.now() });
      return;
    }

    const acceptedElements: DriplElement[] = [];
    acceptValidated(room, msg.elements as DriplElement[], acceptedElements);

    // `init` is an initial snapshot, not an implicit delete-all
    // instruction. A newly connected client can legitimately have an
    // incomplete/local scene; deleting IDs absent from that payload
    // would erase the room before the first collaboration update.
    // Destructive replacement is an explicit operation and is not
    // accepted through this transport message.
    if (acceptedElements.length > 0) {
      const filteredUpdate = {
        type: 'scene-update' as const,
        subtype: msg.subtype,
        elements: acceptedElements,
      };
      broadcast(room, filteredUpdate, ctx.userId ?? undefined);
      markRoomDirty(ctx.roomId);
      scheduleSave(ctx.roomId);
      publishToRoom(ctx.roomId, filteredUpdate);
    }
  },
};

export const sceneDeltaHandler: Handler<typeof sceneDeltaSchema, SceneDelta> = {
  type: 'scene-delta',
  schema: sceneDeltaSchema,
  apply(msg, ctx) {
    if (ctx.rejectReadOnlyMutation()) return;
    const room = ctx.room;

    // Dedup check
    const clientMsgId =
      'clientMsgId' in msg ? (msg as { clientMsgId?: string }).clientMsgId : undefined;
    if (noteClientMsgId(room, clientMsgId)) {
      // Already processed, ack silently
      send(ctx.ws, { type: 'pong', timestamp: Date.now() });
      return;
    }

    const acceptedAdded: DriplElement[] = [];
    const acceptedUpdated: DriplElement[] = [];
    const acceptedDeleted: string[] = [];

    const prospectiveElements = [
      ...(Array.isArray(msg.added) ? msg.added : []),
      ...(Array.isArray(msg.updated) ? msg.updated : []),
    ];
    if (wouldExceedSceneCapacity(room, prospectiveElements)) {
      send(ctx.ws, {
        type: 'error',
        message: sceneCapacityMessage(),
      });
      return;
    }

    if (msg.added && Array.isArray(msg.added)) {
      acceptValidated(room, msg.added as DriplElement[], acceptedAdded);
    }

    if (msg.updated && Array.isArray(msg.updated)) {
      acceptValidated(room, msg.updated as DriplElement[], acceptedUpdated);
    }

    if (msg.deleted && Array.isArray(msg.deleted)) {
      for (const id of msg.deleted) {
        if (deleteWithTombstone(room, id)) acceptedDeleted.push(id);
      }
    }

    if (acceptedAdded.length > 0 || acceptedUpdated.length > 0 || acceptedDeleted.length > 0) {
      const filteredDelta: Record<string, unknown> = { type: 'scene-delta' };
      if (acceptedAdded.length > 0) filteredDelta.added = acceptedAdded;
      if (acceptedUpdated.length > 0) filteredDelta.updated = acceptedUpdated;
      if (acceptedDeleted.length > 0) filteredDelta.deleted = acceptedDeleted;

      broadcast(room, filteredDelta, ctx.userId ?? undefined);
      markRoomDirty(ctx.roomId);
      scheduleSave(ctx.roomId);
      publishToRoom(ctx.roomId, filteredDelta);
    }
  },
};

export const elementUpdateHandler: Handler<typeof elementUpdateSchema, ElementUpdate> = {
  type: 'element-update',
  schema: elementUpdateSchema,
  apply(msg, ctx) {
    if (ctx.rejectReadOnlyMutation()) return;
    const room = ctx.room;

    let acceptedCount = 0;
    const filteredElementUpdate: Record<string, unknown> = { type: 'element-update' };

    if (Array.isArray(msg.elements)) {
      if (wouldExceedSceneCapacity(room, msg.elements)) {
        send(ctx.ws, {
          type: 'error',
          message: sceneCapacityMessage(),
        });
        return;
      }
      const accepted: DriplElement[] = [];
      acceptValidated(room, msg.elements as DriplElement[], accepted);
      acceptedCount = accepted.length;
      if (acceptedCount > 0) filteredElementUpdate.elements = accepted;
      if (accepted.length > 0) {
        broadcast(room, { type: 'element-update', elements: accepted }, ctx.userId ?? undefined);
      }
    } else {
      const rawElement = msg.element as DriplElement | undefined;
      if (!rawElement) return;
      const element = rawElement;
      const existing = room.elements.get(element.id);
      if (!existing && room.elements.size >= MAX_ELEMENTS_PER_SCENE) {
        send(ctx.ws, {
          type: 'error',
          message: `Scene is at capacity (${MAX_ELEMENTS_PER_SCENE} elements max)`,
        });
        return;
      }
      if (isSupersededByTombstone(room, element)) {
        return;
      }
      if (existing && !shouldAcceptElement(element, existing)) {
        return;
      }
      room.elements.set(element.id, element);
      acceptedCount = 1;
      filteredElementUpdate.element = element;
      broadcast(room, { type: 'element-update', element }, ctx.userId ?? undefined);
    }

    if (acceptedCount > 0) {
      markRoomDirty(ctx.roomId);
      scheduleSave(ctx.roomId);
      publishToRoom(ctx.roomId, filteredElementUpdate);
    }
  },
};
