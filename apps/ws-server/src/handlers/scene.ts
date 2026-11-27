import { z } from 'zod';
import type { DriplElement, MovedElement } from '@dripl/common';
import type { Handler } from './types';
import { commitLocalSceneCommand } from '../sceneCommit';
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
    const clientMsgId =
      'clientMsgId' in msg ? (msg as { clientMsgId?: string }).clientMsgId : undefined;
    commitLocalSceneCommand(
      ctx.room,
      {
        type: 'scene-update',
        elements: Array.isArray(msg.elements) ? (msg.elements as DriplElement[]) : [],
        clientMsgId,
      },
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

export const sceneDeltaHandler: Handler<typeof sceneDeltaSchema, SceneDelta> = {
  type: 'scene-delta',
  schema: sceneDeltaSchema,
  apply(msg, ctx) {
    if (ctx.rejectReadOnlyMutation()) return;
    const clientMsgId =
      'clientMsgId' in msg ? (msg as { clientMsgId?: string }).clientMsgId : undefined;
    commitLocalSceneCommand(
      ctx.room,
      {
        type: 'scene-delta',
        added: Array.isArray(msg.added) ? (msg.added as DriplElement[]) : undefined,
        updated: Array.isArray(msg.updated) ? (msg.updated as DriplElement[]) : undefined,
        deleted: Array.isArray(msg.deleted) ? (msg.deleted as string[]) : undefined,
        moved: Array.isArray(msg.moved) ? (msg.moved as MovedElement[]) : undefined,
        clientMsgId,
      },
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

export const elementUpdateHandler: Handler<typeof elementUpdateSchema, ElementUpdate> = {
  type: 'element-update',
  schema: elementUpdateSchema,
  apply(msg, ctx) {
    if (ctx.rejectReadOnlyMutation()) return;
    commitLocalSceneCommand(
      ctx.room,
      {
        type: 'element-update',
        elements: Array.isArray(msg.elements)
          ? (msg.elements as DriplElement[])
          : undefined,
        element: msg.element as DriplElement | undefined,
      },
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
