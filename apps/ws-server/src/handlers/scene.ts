import { z } from 'zod';
import type { DriplElement } from '@dripl/common';
import type { Handler } from './types';
import { broadcast, send } from '../broadcast';
import { markRoomDirty, scheduleSave, MAX_ELEMENTS_PER_SCENE } from '../rooms';
import { publishToRoom } from '../redis';
import {
  acceptSingleValidated,
  acceptValidated,
  wouldExceedSceneCapacity,
  noteClientMsgId,
  sceneCapacityMessage,
} from '../sceneMutation';
import { deleteWithTombstone } from '../tombstones';
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
    // Admission order (capacity → tombstone → freshness) lives in the
    // funnel; this handler only maps the outcome to wire effects.
    const element = msg.element as DriplElement;
    const admitted = acceptSingleValidated(room, element);
    if (admitted === 'capacity') {
      send(ctx.ws, { type: 'error', message: sceneCapacityMessage() });
      return;
    }
    if (admitted === 'rejected') return;
    // Uniform relay: every scene mutation fans out as scene-delta, so
    // receivers implement one merge path. An add is delta-added — exactly
    // what the client's add_element branch did with the verbatim relay.
    const delta = { type: 'scene-delta', added: [element] } as const;
    broadcast(room, delta, ctx.userId ?? undefined);
    markRoomDirty(ctx.roomId);
    scheduleSave(ctx.roomId);
    // Deliberately not awaited: local peers already have the delta, and the
    // dispatcher awaits this handler, so awaiting would serialise the room's
    // whole message budget behind one Redis REST round-trip per mutation.
    // `publishToRoom` cannot reject — it logs and resolves.
    void publishToRoom(ctx.roomId, delta);
  },
};

export const updateElementHandler: Handler<typeof updateElementSchema, UpdateElement> = {
  type: 'update_element',
  schema: updateElementSchema,
  apply(msg, ctx) {
    if (ctx.rejectReadOnlyMutation()) return;
    const room = ctx.room;
    const element = msg.element as DriplElement;
    const admitted = acceptSingleValidated(room, element);
    if (admitted === 'capacity') {
      send(ctx.ws, { type: 'error', message: sceneCapacityMessage() });
      return;
    }
    if (admitted === 'rejected') return;
    // Uniform relay (see addElementHandler): an update is delta-updated.
    const delta = { type: 'scene-delta', updated: [element] } as const;
    broadcast(room, delta, ctx.userId ?? undefined);
    markRoomDirty(ctx.roomId);
    scheduleSave(ctx.roomId);
    // Fire-and-forget cross-instance fan-out; see addElementHandler.
    void publishToRoom(ctx.roomId, delta);
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
    // Uniform relay: a delete is delta-deleted.
    const delta = { type: 'scene-delta', deleted: [msg.elementId] } as const;
    broadcast(room, delta, ctx.userId ?? undefined);
    markRoomDirty(ctx.roomId);
    scheduleSave(ctx.roomId);
    // Fire-and-forget cross-instance fan-out; see addElementHandler.
    void publishToRoom(ctx.roomId, delta);
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
      // Uniform relay: a scene-update batch fans out as delta-added, which
      // is exactly how receivers already merged scene-update relays.
      const filteredDelta = { type: 'scene-delta', added: acceptedElements } as const;
      broadcast(room, filteredDelta, ctx.userId ?? undefined);
      markRoomDirty(ctx.roomId);
      scheduleSave(ctx.roomId);
      // Fire-and-forget cross-instance fan-out; see addElementHandler.
      void publishToRoom(ctx.roomId, filteredDelta);
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
      // Fire-and-forget cross-instance fan-out; see addElementHandler.
      void publishToRoom(ctx.roomId, filteredDelta);
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
    // Uniform relay (see addElementHandler): batches and singletons fan out
    // as delta-updated, matching what the element-update receiver branch did.
    let filteredDelta: { type: 'scene-delta'; updated: DriplElement[] } | null = null;

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
      if (accepted.length > 0) {
        filteredDelta = { type: 'scene-delta', updated: accepted };
        broadcast(room, filteredDelta, ctx.userId ?? undefined);
      }
    } else {
      const rawElement = msg.element as DriplElement | undefined;
      if (!rawElement) return;
      const admitted = acceptSingleValidated(room, rawElement);
      if (admitted === 'capacity') {
        send(ctx.ws, { type: 'error', message: sceneCapacityMessage() });
        return;
      }
      if (admitted === 'rejected') return;
      const element = rawElement;
      acceptedCount = 1;
      filteredDelta = { type: 'scene-delta', updated: [element] };
      broadcast(room, filteredDelta, ctx.userId ?? undefined);
    }

    if (acceptedCount > 0) {
      markRoomDirty(ctx.roomId);
      scheduleSave(ctx.roomId);
      if (filteredDelta) {
        // Fire-and-forget cross-instance fan-out; see addElementHandler.
        void publishToRoom(ctx.roomId, filteredDelta);
      }
    }
  },
};
