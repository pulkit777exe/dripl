import { z } from 'zod';
import type { Handler } from './types.js';
import { broadcast } from '../broadcast.js';

const cursorMoveSnakeSchema = z.object({
  type: z.literal('cursor_move'),
  x: z.number(),
  y: z.number(),
  userName: z.string().optional(),
  color: z.string().optional(),
});

const cursorMoveKebabSchema = z.object({
  type: z.literal('cursor-move'),
  x: z.number(),
  y: z.number(),
  userName: z.string().optional(),
  displayName: z.string().optional(),
  color: z.string().optional(),
});

const schema = z.union([cursorMoveSnakeSchema, cursorMoveKebabSchema]);

type CursorMove = z.infer<typeof schema>;

export const cursorMoveHandler: Handler<typeof schema, CursorMove> = {
  type: 'cursor_move',
  schema,
  apply(msg, ctx) {
    ctx.room.cursors.set(ctx.userId, { x: msg.x, y: msg.y });

    const user = ctx.room.users.get(ctx.userId);
    const displayName = msg.type === 'cursor-move' ? msg.displayName : msg.userName;
    const resolvedName = displayName ?? user?.displayName ?? 'Unknown';
    const resolvedColor = msg.color ?? user?.color ?? '#000000';

    if (ctx.room.yjs) {
      ctx.room.yjs.awareness.setLocalStateField('cursor', { x: msg.x, y: msg.y });
      ctx.room.yjs.awareness.setLocalStateField('user', {
        id: ctx.userId,
        name: resolvedName,
        color: resolvedColor,
      });
    }

    broadcast(
      ctx.room,
      {
        type: 'cursor_move',
        roomId: ctx.roomId,
        userId: ctx.userId,
        x: msg.x,
        y: msg.y,
        userName: resolvedName,
        displayName: resolvedName,
        color: resolvedColor,
        timestamp: Date.now(),
      },
      ctx.userId
    );
  },
};
