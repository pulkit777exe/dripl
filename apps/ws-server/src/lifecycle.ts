import * as Sentry from '@sentry/node';
import { WebSocket } from 'ws';
import { db } from '@dripl/db';
import type { DriplElement } from '@dripl/common';
import {
  rooms,
  roomLastEmptyAt,
  userToRoomMap,
  wsToRoomMap,
  MAX_EMPTY_ROOM_TTL_MS,
  persistRoom,
  scheduleSave,
  parseStoredElements,
} from './rooms';
import { sweepExpiredTombstones } from './tombstones';
import { broadcast } from './broadcast';
import { isRedisAvailable, unsubscribeFromRoom } from './redis';
import { logger } from './logger';
import type { UserConnection } from './types';

export const LOCK_HEARTBEAT_TIMEOUT_MS = 10_000;

/**
 * Single-pass sweep bodies, extracted verbatim from `index.ts`. Each tick is
 * exported so the interval logic in this file is the only untested part; the
 * bodies below run against the real store with a mocked `@dripl/db` in
 * `src/__tests__/lifecycle.test.ts`.
 */
export function runHeartbeatTick(clients: Iterable<WebSocket>): void {
  for (const ws of clients) {
    const user = (ws as WebSocket & { __user?: UserConnection }).__user;
    if (!user) continue;
    if (!user.isAlive) {
      const roomId = wsToRoomMap.get(ws);
      if (roomId) {
        const room = rooms.get(roomId);
        if (room) {
          const ownsRegistration = room.users.get(user.userId)?.ws === ws;
          if (ownsRegistration) {
            broadcast(room, {
              type: 'user-leave',
              roomId,
              userId: user.userId,
              timestamp: Date.now(),
            });
            room.users.delete(user.userId);
            room.cursors.delete(user.userId);
            scheduleSave(roomId);
            if (room.users.size === 0) {
              roomLastEmptyAt.set(roomId, Date.now());
            }
          }
        }
      }
      wsToRoomMap.delete(ws);
      if (roomId && userToRoomMap.get(user.userId) === roomId) {
        userToRoomMap.delete(user.userId);
      }
      ws.terminate();
      continue;
    }
    user.isAlive = false;
    ws.ping();
  }
}

export function runAuthorizationSweep(): void {
  const checks: Promise<void>[] = [];
  for (const room of rooms.values()) {
    for (const user of new Set(room.users.values())) {
      if (!user.revalidate) continue;
      checks.push(
        user
          .revalidate()
          .catch(error => {
            logger.error({ event: 'ws_authorization_refresh_failed', roomId: room.roomId, error });
            return false;
          })
          .then(allowed => {
            if (!allowed && user.ws.readyState === WebSocket.OPEN) {
              user.ws.close(4003, 'Room access revoked');
            }
          })
      );
    }
  }
  void Promise.allSettled(checks);
}

export async function runPeriodicSave(): Promise<void> {
  const activeRooms = Array.from(rooms.entries());
  const now = Date.now();
  const savePromises: Promise<{ roomId: string; success: boolean }>[] = [];
  const expiredRoomIds = new Set<string>();

  for (const [roomId, room] of activeRooms) {
    // Delete markers expire after 24h; the 15s tick is plenty frequent
    // enough that no dedicated interval is needed.
    sweepExpiredTombstones(room, now);
    if (room.users.size > 0) {
      roomLastEmptyAt.delete(roomId);
      if (!room.saving && room.dirty) {
        savePromises.push(
          persistRoom(roomId).then(outcome => ({
            roomId,
            success: outcome === 'saved',
          }))
        );
      }
    } else {
      const emptySince = roomLastEmptyAt.get(roomId);
      if (!emptySince) {
        roomLastEmptyAt.set(roomId, now);
        continue;
      }
      if (now - emptySince > MAX_EMPTY_ROOM_TTL_MS) {
        if (!room.saving && room.dirty) {
          savePromises.push(
            persistRoom(roomId).then(outcome => ({
              roomId,
              success: outcome === 'saved',
            }))
          );
        }
        // Defer GC until any final save has completed. If the save fails or a
        // new mutation arrives, the room remains available for a later retry.
        expiredRoomIds.add(roomId);
      }
    }
  }

  if (savePromises.length > 0) {
    const results = await Promise.allSettled(savePromises);
    for (const result of results) {
      if (result.status === 'fulfilled' && !result.value.success) {
        logger.error({ event: 'periodic_save_failure', roomId: result.value.roomId });
      }
    }
  }

  for (const roomId of expiredRoomIds) {
    const room = rooms.get(roomId);
    if (!room || room.users.size > 0 || room.saving || room.dirty) continue;
    rooms.delete(roomId);
    roomLastEmptyAt.delete(roomId);
    if (isRedisAvailable()) {
      unsubscribeFromRoom(roomId);
    }
  }
}

export function runLockSweep(now = Date.now()): void {
  for (const [, room] of rooms) {
    if (room.elementLocks.size === 0) continue;
    const expiredLocks: string[] = [];
    for (const [elementId, lock] of room.elementLocks) {
      if (now - lock.lastHeartbeat > LOCK_HEARTBEAT_TIMEOUT_MS) {
        expiredLocks.push(elementId);
      }
    }
    for (const elementId of expiredLocks) {
      const lock = room.elementLocks.get(elementId);
      room.elementLocks.delete(elementId);
      if (lock) {
        broadcast(room, {
          type: 'element-unlock',
          elementId,
          userId: lock.userId,
        });
      }
    }
  }
}

export async function runReconciliation(): Promise<void> {
  for (const [roomId, room] of rooms) {
    if (room.users.size === 0) continue;
    if (room.saving) continue;
    // A clean room's memory matches the last successful write (dirty is only
    // cleared when mutationVersion is unchanged after a write), so there is
    // nothing to diverge from: skip the per-minute DB read. Only dirty rooms
    // — writes in flight, failed, or conflicted — pay for verification.
    if (!room.dirty) continue;

    try {
      let dbContent: string | null = null;

      if (room.recordType === 'canvasRoom') {
        const dbRoom = await db.canvasRoom.findUnique({
          where: { slug: roomId },
          select: { content: true },
        });
        dbContent = dbRoom?.content ?? null;
      } else {
        const dbFile = await db.file.findUnique({
          where: { id: roomId },
          select: { content: true },
        });
        dbContent = dbFile?.content ?? null;
      }

      if (dbContent === null) continue;

      const dbParsed = parseStoredElements(dbContent);
      const dbIds = new Set(dbParsed.map((e: DriplElement) => e.id));
      const memIds = new Set(room.elements.keys());

      const addedInMem = [...memIds].filter(id => !dbIds.has(id));
      const addedInDb = [...dbIds].filter(id => !memIds.has(id));

      if (addedInMem.length > 0 || addedInDb.length > 0) {
        logger.warn({
          event: 'state_divergence',
          roomId,
          memCount: memIds.size,
          dbCount: dbIds.size,
          onlyInMem: addedInMem.length,
          onlyInDb: addedInDb.length,
        });
        const outcome = await persistRoom(roomId);
        if (outcome === 'failed') {
          logger.error({ event: 'reconciliation_save_failure', roomId });
        }
      }
    } catch (err) {
      logger.error({ event: 'reconciliation_check_error', roomId, err });
      Sentry.captureException(err);
    }
  }
}
