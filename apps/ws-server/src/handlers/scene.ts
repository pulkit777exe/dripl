import { z } from 'zod';
import type { DriplElement } from '@dripl/common';
import { shouldAcceptElement } from '@dripl/common/reconciliation';
import type { Handler } from './types';
import { broadcast, send } from '../broadcast';
import { markRoomDirty, scheduleSave, MAX_ELEMENTS_PER_SCENE } from '../rooms';
import { publishToRoom } from '../redis';
import {
  toDriplElement,
  acceptAll,
  wouldExceedSceneCapacity,
  noteClientMsgId,
  sceneCapacityMessage,
} from '../sceneMutation';
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
    const existingElement = room.elements.get(msg.element.id);
    if (!existingElement && room.elements.size >= MAX_ELEMENTS_PER_SCENE) {
      send(ctx.ws, {
        type: 'error',
        message: `Scene is at capacity (${MAX_ELEMENTS_PER_SCENE} elements max)`,
      });
      return;
    }
    try {
      const element = toDriplElement(msg.element);
      const existing = room.elements.get(element.id);
      if (existing && !shouldAcceptElement(element, existing)) return;
      room.elements.set(element.id, element);
      broadcast(room, msg, ctx.userId ?? undefined);
      markRoomDirty(ctx.roomId);
      scheduleSave(ctx.roomId);
      publishToRoom(ctx.roomId, msg);
    } catch (err) {
      ctx.logger.debug({
        event: 'invalid_element',
        roomId: ctx.roomId,
        elementId: (msg.element as { id?: string })?.id,
        error: String(err),
      });
    }
  },
};

export const updateElementHandler: Handler<typeof updateElementSchema, UpdateElement> = {
  type: 'update_element',
  schema: updateElementSchema,
  apply(msg, ctx) {
    if (ctx.rejectReadOnlyMutation()) return;
    const room = ctx.room;
    try {
      const element = toDriplElement(msg.element);
      const existing = room.elements.get(element.id);
      if (!existing && room.elements.size >= MAX_ELEMENTS_PER_SCENE) {
        send(ctx.ws, {
          type: 'error',
          message: `Scene is at capacity (${MAX_ELEMENTS_PER_SCENE} elements max)`,
        });
        return;
      }
      if (existing && !shouldAcceptElement(element, existing)) return;
      room.elements.set(element.id, element);
      broadcast(room, msg, ctx.userId ?? undefined);
      markRoomDirty(ctx.roomId);
      scheduleSave(ctx.roomId);
      publishToRoom(ctx.roomId, msg);
    } catch (err) {
      ctx.logger.debug({
        event: 'invalid_element',
        roomId: ctx.roomId,
        elementId: (msg.element as { id?: string })?.id,
        error: String(err),
      });
    }
  },
};

export const deleteElementHandler: Handler<typeof deleteElementSchema, DeleteElement> = {
  type: 'delete_element',
  schema: deleteElementSchema,
  apply(msg, ctx) {
    if (ctx.rejectReadOnlyMutation()) return;
    const room = ctx.room;
    const deleted = room.elements.delete(msg.elementId);
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
    acceptAll(room, msg.elements, acceptedElements, (rawEl, err) => {
      ctx.logger.debug({
        event: 'invalid_element',
        roomId: ctx.roomId,
        elementId: (rawEl as { id?: string })?.id,
        error: String(err),
      });
    });

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
      acceptAll(room, msg.added, acceptedAdded, (rawEl, err) => {
        ctx.logger.debug({
          event: 'invalid_element',
          roomId: ctx.roomId,
          elementId: (rawEl as { id?: string })?.id,
          error: String(err),
        });
      });
    }

    if (msg.updated && Array.isArray(msg.updated)) {
      acceptAll(room, msg.updated, acceptedUpdated, (rawEl, err) => {
        ctx.logger.debug({
          event: 'invalid_element',
          roomId: ctx.roomId,
          elementId: (rawEl as { id?: string })?.id,
          error: String(err),
        });
      });
    }

    if (msg.deleted && Array.isArray(msg.deleted)) {
      for (const id of msg.deleted) {
        if (room.elements.delete(id)) acceptedDeleted.push(id);
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
      acceptAll(room, msg.elements, accepted, (rawEl, err) => {
        ctx.logger.debug({
          event: 'invalid_element',
          roomId: ctx.roomId,
          elementId: (rawEl as { id?: string })?.id,
          error: String(err),
        });
      });
      acceptedCount = accepted.length;
      if (acceptedCount > 0) filteredElementUpdate.elements = accepted;
      if (accepted.length > 0) {
        broadcast(room, { type: 'element-update', elements: accepted }, ctx.userId ?? undefined);
      }
    } else {
      const rawElement = msg.element;
      if (!rawElement) return;
      try {
        const element = toDriplElement(rawElement);
        const existing = room.elements.get(element.id);
        if (!existing && room.elements.size >= MAX_ELEMENTS_PER_SCENE) {
          send(ctx.ws, {
            type: 'error',
            message: `Scene is at capacity (${MAX_ELEMENTS_PER_SCENE} elements max)`,
          });
          return;
        }
        if (existing && !shouldAcceptElement(element, existing)) {
          return;
        }
        room.elements.set(element.id, element);
        acceptedCount = 1;
        filteredElementUpdate.element = element;
        broadcast(room, { type: 'element-update', element }, ctx.userId ?? undefined);
      } catch (err) {
        ctx.logger.debug({
          event: 'invalid_element',
          roomId: ctx.roomId,
          elementId: (rawElement as { id?: string })?.id,
          error: String(err),
        });
      }
    }

    if (acceptedCount > 0) {
      markRoomDirty(ctx.roomId);
      scheduleSave(ctx.roomId);
      publishToRoom(ctx.roomId, filteredElementUpdate);
    }
  },
};
