import { z } from 'zod';
import type { Handler } from './types';
import { broadcast } from '../broadcast';
import { cursorMoveSchema, cursorMoveKebabSchema } from '../validation';

// No local schema copy: the message already passed `messageSchema` in the
// dispatch prologue, and these are the same bounded schemas it was validated
// against. A third, looser copy here could never reject anything the first
// pass accepted — it was pure redundancy.
const schema = z.union([cursorMoveSchema, cursorMoveKebabSchema]);

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
