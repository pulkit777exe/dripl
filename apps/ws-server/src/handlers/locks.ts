import { z } from 'zod';
import type { Handler } from './types';
import { broadcast, send } from '../broadcast';
import { elementLockHeartbeatSchema, elementLockSchema, elementUnlockSchema } from '../validation';

type ElementLock = z.infer<typeof elementLockSchema>;
type ElementUnlock = z.infer<typeof elementUnlockSchema>;
type ElementLockHeartbeat = z.infer<typeof elementLockHeartbeatSchema>;

export const elementLockHandler: Handler<typeof elementLockSchema, ElementLock> = {
  type: 'element-lock',
  schema: elementLockSchema,
  apply(msg, ctx) {
    if (ctx.rejectReadOnlyMutation()) return;
    const existingLock = ctx.room.elementLocks.get(msg.elementId);
    if (existingLock && existingLock.userId !== ctx.userId) {
      send(ctx.ws, { type: 'error', message: 'Element is locked by another user' });
      return;
    }
    ctx.room.elementLocks.set(msg.elementId, {
      userId: ctx.userId,
      lastHeartbeat: Date.now(),
    });
    broadcast(
      ctx.room,
      {
        type: 'element-lock',
        elementId: msg.elementId,
        userId: ctx.userId,
      },
      ctx.userId
    );
  },
};

export const elementUnlockHandler: Handler<typeof elementUnlockSchema, ElementUnlock> = {
  type: 'element-unlock',
  schema: elementUnlockSchema,
  apply(msg, ctx) {
    const lock = ctx.room.elementLocks.get(msg.elementId);
    if (lock && lock.userId === ctx.userId) {
      ctx.room.elementLocks.delete(msg.elementId);
      broadcast(
        ctx.room,
        {
          type: 'element-unlock',
          elementId: msg.elementId,
          userId: ctx.userId,
        },
        ctx.userId
      );
    }
  },
};

export const elementLockHeartbeatHandler: Handler<
  typeof elementLockHeartbeatSchema,
  ElementLockHeartbeat
> = {
  type: 'element-lock-heartbeat',
  schema: elementLockHeartbeatSchema,
  apply(msg, ctx) {
    const lock = ctx.room.elementLocks.get(msg.elementId);
    if (lock && lock.userId === ctx.userId) {
      lock.lastHeartbeat = Date.now();
    }
  },
};
