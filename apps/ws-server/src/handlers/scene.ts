import { z } from 'zod';
import type { DriplElement, MovedElement } from '@dripl/common';
import type { Handler } from './types';
import { broadcast, send } from '../broadcast';
import { markRoomDirty, scheduleSave, MAX_ELEMENTS_PER_SCENE } from '../rooms';
import { publishToRoom } from '../redis';
import { commitLocalSceneCommand } from '../sceneCommit';
import {
  acceptMovedElements,
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
    commitLocalSceneCommand(
      ctx.room,
      { type: 'add_element', element: msg.element as DriplElement },
      {
        kind: 'local',
        roomId: ctx.roomId,
        userId: ctx.userId,
        ws: ctx.ws,
        rejectReadOnlyMutation: ctx.rejectReadOnlyMutation,
      }
    );
  },
};

export const updateElementHandler: Handler<typeof updateElementSchema, UpdateElement> = {
  type: 'update_element',
  schema: updateElementSchema,
  apply(msg, ctx) {
    if (ctx.rejectReadOnlyMutation()) return;
    commitLocalSceneCommand(
      ctx.room,
      { type: 'update_element', element: msg.element as DriplElement },
      {
        kind: 'local',
        roomId: ctx.roomId,
        userId: ctx.userId,
        ws: ctx.ws,
        rejectReadOnlyMutation: ctx.rejectReadOnlyMutation,
      }
    );
  },
};

export const deleteElementHandler: Handler<typeof deleteElementSchema, DeleteElement> = {
  type: 'delete_element',
  schema: deleteElementSchema,
  apply(msg, ctx) {
    if (ctx.rejectReadOnlyMutation()) return;
    commitLocalSceneCommand(
      ctx.room,
      { type: 'delete_element', elementId: msg.elementId },
      {
        kind: 'local',
        roomId: ctx.roomId,
        userId: ctx.userId,
        ws: ctx.ws,
        rejectReadOnlyMutation: ctx.rejectReadOnlyMutation,
      }
    );
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
    const acceptedMoved: MovedElement[] = [];

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

    // Move-only entries carry no new ids, so they skip the capacity
    // pre-check; each resolves against the room copy through the same
    // tombstone→freshness funnel as a full record.
    if (msg.moved && Array.isArray(msg.moved)) {
      acceptedMoved.push(...acceptMovedElements(room, msg.moved));
    }

    if (
      acceptedAdded.length > 0 ||
      acceptedUpdated.length > 0 ||
      acceptedDeleted.length > 0 ||
      acceptedMoved.length > 0
    ) {
      const filteredDelta: Record<string, unknown> = { type: 'scene-delta' };
      if (acceptedAdded.length > 0) filteredDelta.added = acceptedAdded;
      if (acceptedUpdated.length > 0) filteredDelta.updated = acceptedUpdated;
      if (acceptedDeleted.length > 0) filteredDelta.deleted = acceptedDeleted;
      if (acceptedMoved.length > 0) filteredDelta.moved = acceptedMoved;

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
