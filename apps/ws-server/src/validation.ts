import { z } from 'zod';
import {
  DriplElementSchema as driplElementSchema,
  MAX_MESSAGE_BYTES,
  MAX_SCENE_ELEMENTS,
} from '@dripl/common';

const colorSchema = z.string().regex(/^#[0-9a-f]{3,8}$/i, 'Invalid color');

// Element wire format is owned by @dripl/common. A previous revision kept a
// second, looser copy of this union here; the two drifted (roughness 10 vs 2,
// image src with no protocol check vs ImageSourceSchema, unbounded
// angle/strokeWidth vs bounded) while only the inner strict parse in
// toDriplElement actually protected storage. One schema now.

export const joinRoomSchema = z.object({
  type: z.literal('join_room'),
  roomId: z.string().min(1).max(100),
  userName: z.string().min(1).max(50).optional(),
});

export const joinSchema = z.object({
  type: z.literal('join'),
  roomId: z.string().min(1).max(100),
  userId: z.string().max(100).optional(),
  displayName: z.string().min(1).max(50).optional(),
  color: colorSchema.optional(),
});

export const addElementSchema = z.object({
  type: z.literal('add_element'),
  element: driplElementSchema,
});

export const updateElementSchema = z.object({
  type: z.literal('update_element'),
  element: driplElementSchema,
});

export const deleteElementSchema = z.object({
  type: z.literal('delete_element'),
  elementId: z.string().min(1).max(100),
});

export const cursorMoveSchema = z.object({
  type: z.literal('cursor_move'),
  x: z.number().finite().min(-100000).max(100000),
  y: z.number().finite().min(-100000).max(100000),
  userName: z.string().optional(),
  color: colorSchema.optional(),
});

export const cursorMoveKebabSchema = z.object({
  type: z.literal('cursor-move'),
  x: z.number().finite().min(-100000).max(100000),
  y: z.number().finite().min(-100000).max(100000),
  userName: z.string().optional(),
  displayName: z.string().optional(),
  color: colorSchema.optional(),
});

export const elementUpdateSchema = z.object({
  type: z.literal('element-update'),
  elements: z.array(driplElementSchema).max(100).optional(),
  element: driplElementSchema.optional(),
});

export const sceneUpdateSchema = z.object({
  type: z.literal('scene-update'),
  subtype: z.enum(['init', 'update']),
  elements: z.array(driplElementSchema).max(MAX_SCENE_ELEMENTS),
  clientMsgId: z.string().min(1).max(100).optional(),
});

export const sceneDeltaSchema = z.object({
  type: z.literal('scene-delta'),
  added: z.array(driplElementSchema).max(1000).optional(),
  updated: z.array(driplElementSchema).max(1000).optional(),
  deleted: z.array(z.string()).max(1000).optional(),
  clientMsgId: z.string().min(1).max(100).optional(),
});

export const leaveRoomSchema = z.object({ type: z.literal('leave_room') });
export const leaveSchema = z.object({ type: z.literal('leave') });
export const pingSchema = z.object({ type: z.literal('ping') });
export const elementLockSchema = z.object({
  type: z.literal('element-lock'),
  elementId: z.string().min(1).max(100),
});
export const elementUnlockSchema = z.object({
  type: z.literal('element-unlock'),
  elementId: z.string().min(1).max(100),
});
export const elementLockHeartbeatSchema = z.object({
  type: z.literal('element-lock-heartbeat'),
  elementId: z.string().min(1).max(100),
});
export const viewportUpdateSchema = z.object({
  type: z.literal('viewport-update'),
  panX: z.number().finite().min(-1000000).max(1000000),
  panY: z.number().finite().min(-1000000).max(1000000),
  zoom: z.number().finite().min(0.01).max(100),
});
export const followUserSchema = z.object({
  type: z.literal('follow-user'),
  targetUserId: z.string().min(1).max(100),
});
export const unfollowUserSchema = z.object({ type: z.literal('unfollow-user') });

export const messageSchema = z.discriminatedUnion('type', [
  joinRoomSchema,
  joinSchema,
  addElementSchema,
  updateElementSchema,
  deleteElementSchema,
  cursorMoveSchema,
  cursorMoveKebabSchema,
  elementUpdateSchema,
  sceneUpdateSchema,
  sceneDeltaSchema,
  leaveRoomSchema,
  leaveSchema,
  pingSchema,
  elementLockSchema,
  elementUnlockSchema,
  elementLockHeartbeatSchema,
  viewportUpdateSchema,
  followUserSchema,
  unfollowUserSchema,
]);

export type WsMessage = z.infer<typeof messageSchema>;

export function validateMessageSize(raw: string): { valid: boolean; error?: string } {
  const byteSize = Buffer.byteLength(raw, 'utf8');
  if (byteSize > MAX_MESSAGE_BYTES) {
    return {
      valid: false,
      error: `Message too large (${byteSize} bytes, max ${MAX_MESSAGE_BYTES})`,
    };
  }
  return { valid: true };
}
