import { randomUUID } from 'node:crypto';
import { env } from './env';

import * as Sentry from '@sentry/node';
import { logger } from './logger';
export { logger };

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
  });
}

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { DriplElement } from '@dripl/common';
import { pickUserColor, MAX_MESSAGE_BYTES } from '@dripl/common';
import { initializeDb, db } from '@dripl/db';
import { messageSchema, validateMessageSize } from './validation';
import type { RoomState, UserConnection } from './types';
import type { HandlerCtx } from './handlers/types';
import { resolveTicketFromUrl, validateTicket } from './auth';
import { send, broadcast, roomUsersPayload, roomCursorsPayload } from './broadcast';
import { cursorMoveHandler } from './handlers/cursorMove';
import {
  elementLockHandler,
  elementUnlockHandler,
  elementLockHeartbeatHandler,
} from './handlers/locks';
import { viewportUpdateHandler, followUserHandler, unfollowUserHandler } from './handlers/presence';
import {
  addElementHandler,
  updateElementHandler,
  deleteElementHandler,
  sceneUpdateHandler,
  sceneDeltaHandler,
  elementUpdateHandler,
} from './handlers/scene';
import {
  runHeartbeatTick,
  runAuthorizationSweep,
  runPeriodicSave,
  runLockSweep,
  runReconciliation,
} from './lifecycle';
import {
  rooms,
  saveTimeouts,
  roomLastEmptyAt,
  userToRoomMap,
  wsToRoomMap,
  getOrCreateRoom,
  loadRoomElements,
  saveRoomElements,
} from './rooms';
import { checkRateLimit, setRateLimitIdentity, removeRateLimitIdentity } from './rateLimiter';
import { subscribeToRoom, isRedisAvailable } from './redis';
import { authorizeRoomAccess, authorizeShareRoomAccess, type RoomAccess } from './roomAccess';
import { applyRemoteSceneMessage } from './sceneMutation';

const MAX_EARLY_BUFFER_BYTES = 1_000_000;
const MAX_SERIALIZED_QUEUE_BYTES = 2_000_000;

export async function start() {
  try {
    await initializeDb();
    logger.info({ event: 'db_connected' });
  } catch (err) {
    logger.error({ event: 'db_connection_failed', err });
    process.exit(1);
  }
}

const ROOM_MUTATION_TYPES = new Set([
  'add_element',
  'update_element',
  'delete_element',
  'element-update',
  'scene-update',
  'scene-delta',
  'element-lock',
  'element-unlock',
  'element-lock-heartbeat',
]);
// JSON scene snapshots/deltas are the wire protocol. A previous revision kept
// a dormant Yjs adapter behind YJS_WIRE_ENABLED=false; it gated only reads
// while the write path duplicated every element into a Y.Doc, so it was
// removed outright (2026-09-27) rather than left to rot. Reintroducing Yjs is
// a protocol project, not a flag flip — see
// docs/collaboration-crdt-e2ee-decision.md.

function handleRedisMessage(roomId: string, payload: unknown): void {
  const room = rooms.get(roomId);
  if (!room) return;

  const msg = payload as {
    type: string;
    elements?: DriplElement[];
    added?: DriplElement[];
    updated?: DriplElement[];
    deleted?: string[];
    elementId?: string;
    element?: DriplElement;
    x?: number;
    y?: number;
    userId?: string;
    userName?: string;
    displayName?: string;
    color?: string;
  };

  switch (msg.type) {
    case 'add_element':
    case 'update_element':
    case 'delete_element':
    case 'element-update':
    case 'scene-update':
    case 'scene-delta': {
      // Apply the remote mutation to this process's room before forwarding it.
      // Broadcasting without applying leaves replicas with stale state and can
      // make the next join/save resurrect an older scene.
      const changed = applyRemoteSceneMessage(room, msg as unknown as Record<string, unknown>);
      if (changed) broadcast(room, msg, undefined);
      break;
    }
    case 'cursor_move':
      broadcast(room, msg, undefined);
      break;
    default:
      break;
  }
}

const configuredWsPort = Number(process.env.PORT ?? env.WS_PORT);
const WS_PORT =
  Number.isInteger(configuredWsPort) && configuredWsPort >= 0 ? configuredWsPort : 3001;
const HEARTBEAT_INTERVAL_MS = 30_000;
const PERIODIC_SAVE_INTERVAL_MS = Number(process.env.PERIODIC_SAVE_INTERVAL_MS) || 15_000;
// Upper bound on database access checks from the per-message path. Exported
// for tests; production keeps the 15s sweep as the revocation enforcer.
export const ACCESS_RECHECK_THROTTLE_MS = Number(process.env.ACCESS_RECHECK_THROTTLE_MS) || 30_000;
let shuttingDown = false;

export const server = createServer(async (req, res) => {
  if (req.url === '/health') {
    try {
      await db.$queryRaw`SELECT 1`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          uptime: process.uptime(),
          memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          ts: Date.now(),
        })
      );
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: 'Database unreachable', ts: Date.now() }));
    }
  } else if (req.url === '/metrics') {
    let totalUsers = 0;
    for (const room of rooms.values()) {
      totalUsers += room.users.size;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        uptime: process.uptime(),
        activeRooms: rooms.size,
        activeConnections: wss.clients.size,
        totalUsers,
        memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      })
    );
  } else {
    res.writeHead(404);
    res.end();
  }
});

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

const ALLOWED_ORIGINS = [env.FRONTEND_URL, env.NEXT_PUBLIC_APP_URL, process.env.NEXT_PUBLIC_APP_URL]
  .flatMap(value => value?.split(',') ?? [])
  .map(normalizeOrigin)
  .filter((value): value is string => value !== null);

if (process.env.NODE_ENV !== 'production' && !ALLOWED_ORIGINS.includes('http://localhost:3000')) {
  ALLOWED_ORIGINS.push('http://localhost:3000');
}

export const wss = new WebSocketServer({
  server,
  maxPayload: MAX_MESSAGE_BYTES,
  verifyClient: (
    { origin }: { origin: string },
    cb: (result: boolean, code?: number, message?: string) => void
  ) => {
    if (!origin) {
      logger.warn({ event: 'ws_origin_rejected', reason: 'no_origin' });
      return cb(false, 403, 'Forbidden');
    }
    const allowed = ALLOWED_ORIGINS.some(o => origin === o);
    if (allowed) return cb(true);
    logger.warn({ event: 'ws_origin_rejected', origin });
    cb(false, 403, 'Forbidden');
  },
});

wss.on('connection', async (ws, req) => {
  if (shuttingDown) {
    ws.close(1012, 'Server restarting');
    return;
  }
  // The connection callback authenticates asynchronously. Buffer the small
  // burst a browser can send immediately after `open` so join/mutation packets
  // are not dropped before the validated handler is installed.
  const earlyMessages: Buffer[] = [];
  let earlyMessageBytes = 0;
  const onEarlyMessage = (raw: Buffer) => {
    if (
      earlyMessages.length >= 100 ||
      earlyMessageBytes + raw.byteLength > MAX_EARLY_BUFFER_BYTES
    ) {
      ws.close(4000, 'Message queue exceeded');
      return;
    }
    earlyMessageBytes += raw.byteLength;
    earlyMessages.push(raw);
  };
  ws.on('message', onEarlyMessage);

  const ticket = resolveTicketFromUrl(req.url, req.headers.host);
  if (!ticket) {
    ws.off('message', onEarlyMessage);
    ws.close(4001, 'Authentication required');
    logger.warn({ event: 'ws_auth_rejected', reason: 'no_ticket', url: req.url });
    return;
  }

  const ticketPrincipal = await validateTicket(ticket);

  if (!ticketPrincipal) {
    ws.off('message', onEarlyMessage);
    ws.close(4001, 'Authentication required');
    logger.warn({ event: 'ws_auth_rejected', reason: 'invalid_ticket' });
    return;
  }
  // Keep a non-null local for the nested serialized message handler; TypeScript
  // cannot preserve the outer closure's discriminated-union narrowing.
  const principal = ticketPrincipal;

  const authUserId = principal.kind === 'user' ? principal.userId : null;
  const rateLimitIdentity =
    principal.kind === 'user' ? principal.userId : `share:${principal.fileId}:${principal.token}`;
  setRateLimitIdentity(ws, rateLimitIdentity);

  let currentRoomId: string | null = null;
  let currentUserId: string | null = null;
  let currentRoomAccess: RoomAccess = { allowed: false, canEdit: false };
  // Timestamp of the last database access check for this connection. The
  // per-message path below used to revalidate against the database on every
  // mutation — an active editor emits ~20 scene-deltas/sec, each costing 1-2
  // Prisma queries. Revocation is still enforced within 15s by the
  // authorization sweep (which always hits the database), so the hot path
  // only needs a throttled steady-state check.
  let lastAccessCheckAt = 0;

  const rejectReadOnlyMutation = (): boolean => {
    if (currentRoomAccess.canEdit) return false;
    send(ws, { type: 'error', message: 'You have view-only access to this room' });
    return true;
  };

  // Every delegated handler needs the same context shape; the user fallback
  // mirrors what the inline cases synthesized before extraction.
  const toHandlerCtx = (room: RoomState, userId: string): HandlerCtx => ({
    ws,
    user: room.users.get(userId) ?? {
      userId,
      displayName: 'Unknown',
      color: '#000000',
      ws,
      isAlive: true,
    },
    userId,
    roomId: room.roomId,
    room,
    logger,
    rejectReadOnlyMutation,
  });

  const revalidateRoomAccess = async (): Promise<boolean> => {
    if (!currentRoomId) return true;
    const access =
      principal.kind === 'share'
        ? await authorizeShareRoomAccess(
            principal.fileId,
            currentRoomId,
            principal.permission,
            principal.token
          )
        : await authorizeRoomAccess(principal.userId, currentRoomId);
    currentRoomAccess = access;
    if (!access.allowed) {
      send(ws, { type: 'error', message: 'Room access has been revoked' });
      ws.close(4003, 'Room access revoked');
      return false;
    }
    return true;
  };

  const refreshRoomAccess = async (): Promise<boolean> => {
    // Throttled steady-state check: trust the join-time decision between
    // revalidations. The sweep revalidates every connection every 15s with a
    // fresh database read, so a revoked share or removed member is still
    // cut off within that window.
    if (Date.now() - lastAccessCheckAt >= ACCESS_RECHECK_THROTTLE_MS) {
      if (!(await revalidateRoomAccess())) return false;
      lastAccessCheckAt = Date.now();
    }
    if (!currentRoomAccess.canEdit) {
      send(ws, { type: 'error', message: 'You have view-only access to this room' });
      return false;
    }
    return true;
  };

  ws.on('pong', () => {
    const user = (ws as WebSocket & { __user?: UserConnection }).__user;
    if (user) user.isAlive = true;
  });

  async function handleMessage(raw: Buffer, isBinary = false): Promise<void> {
    if (shuttingDown) return;
    try {
      // Rate limit all messages including binary
      if (!(await checkRateLimit(ws))) {
        logger.warn({ event: 'rate_limit_exceeded' });
        ws.close(4000, 'Rate limit exceeded');
        return;
      }

      // Binary collaboration updates were only ever the disabled Yjs wire
      // protocol. Reject binary frames outright rather than sniffing a
      // discriminator for a protocol that no longer exists. NOTE: `ws`
      // delivers text frames as Buffer too, so the frame opcode (`isBinary`)
      // — not `instanceof Buffer` — is the discriminator. Checking
      // `instanceof` here would reject every message on the socket.
      if (isBinary) {
        send(ws, { type: 'error', message: 'Binary collaboration updates are not enabled' });
        return;
      }

      const messageStr = raw.toString();

      const sizeCheck = validateMessageSize(messageStr);
      if (!sizeCheck.valid) {
        send(ws, { type: 'error', message: sizeCheck.error! });
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(messageStr);
      } catch (err) {
        logger.debug({
          event: 'invalid_ws_message',
          reason: 'json_parse_error',
          error: String(err),
        });
        return;
      }

      const validation = messageSchema.safeParse(parsed);
      if (!validation.success) {
        return;
      }

      const message = validation.data;
      if (ROOM_MUTATION_TYPES.has(message.type) && !(await refreshRoomAccess())) {
        return;
      }

      switch (message.type) {
        case 'join_room':
        case 'join': {
          const roomId = message.roomId;
          if (currentRoomId && currentRoomId !== roomId) {
            send(ws, {
              type: 'error',
              message: 'Leave the current room before joining another room',
            });
            break;
          }
          if (currentRoomId === roomId) break;
          const access =
            principal.kind === 'share'
              ? await authorizeShareRoomAccess(
                  principal.fileId,
                  roomId,
                  principal.permission,
                  principal.token
                )
              : await authorizeRoomAccess(principal.userId, roomId);
          if (!access.allowed) {
            send(ws, { type: 'error', message: 'You do not have access to this room' });
            ws.close(4003, 'Room access denied');
            return;
          }
          currentRoomAccess = access;
          lastAccessCheckAt = Date.now();
          const room = getOrCreateRoom(roomId);

          if (!room.loadedFromDb) {
            if (!room.loadingPromise) {
              room.loadingPromise = loadRoomElements(roomId);
            }
            try {
              room.elements = await room.loadingPromise;
              room.loadedFromDb = true;
            } finally {
              room.loadingPromise = undefined;
            }
          }

          const requestedName = message.type === 'join' ? message.displayName : message.userName;
          const requestedColor = message.type === 'join' ? message.color : undefined;

          const userId = authUserId ?? `guest:${randomUUID()}`;
          const displayName = requestedName || `User-${userId.slice(0, 4)}`;
          const color = requestedColor || pickUserColor();

          if (room.users.has(userId)) {
            send(ws, {
              type: 'error',
              message: 'This account is already connected in another tab',
            });
            ws.close(4009, 'Duplicate connection');
            return;
          }

          currentRoomId = roomId;
          currentUserId = userId;
          wsToRoomMap.set(ws, roomId);
          userToRoomMap.set(userId, roomId);

          const connection: UserConnection = {
            userId,
            displayName,
            color,
            ws,
            isAlive: true,
            revalidate: revalidateRoomAccess,
          };
          room.users.set(userId, connection);
          (ws as WebSocket & { __user?: UserConnection }).__user = connection;

          send(ws, {
            type: 'sync_room_state',
            roomId,
            elements: Array.from(room.elements.values()),
            users: roomUsersPayload(room),
            cursors: roomCursorsPayload(room),
            yourUserId: userId,
            readOnly: !currentRoomAccess.canEdit,
            timestamp: Date.now(),
            // Monotonic per-room mutation counter. Additive: old clients
            // ignore it. Future version-heartbeat / resync work can compare
            // this against the last version a client acknowledged to detect
            // a gap without a full scene transfer.
            sceneVersion: room.mutationVersion,
          });

          broadcast(
            room,
            {
              type: 'user-join',
              roomId,
              userId,
              userName: displayName,
              displayName,
              color,
              timestamp: Date.now(),
            },
            userId
          );

          if (isRedisAvailable()) {
            subscribeToRoom(roomId, payload => handleRedisMessage(roomId, payload));
          }
          break;
        }

        case 'leave_room':
        case 'leave': {
          if (!currentRoomId || !currentUserId) break;
          const room = rooms.get(currentRoomId);
          if (!room) break;

          room.users.delete(currentUserId);
          room.cursors.delete(currentUserId);
          wsToRoomMap.delete(ws);
          if (userToRoomMap.get(currentUserId) === currentRoomId) {
            userToRoomMap.delete(currentUserId);
          }

          broadcast(room, {
            type: 'user-leave',
            roomId: currentRoomId,
            userId: currentUserId,
            timestamp: Date.now(),
          });

          if (room.users.size === 0) {
            if (room.dirty && !room.saving) {
              room.saving = true;
              saveRoomElements(currentRoomId, room.elements)
                .then(success => {
                  if (!success) {
                    logger.error({ event: 'leave_save_failure', roomId: currentRoomId });
                  }
                })
                .finally(() => {
                  room.saving = false;
                });
            }
            roomLastEmptyAt.set(currentRoomId, Date.now());
          }

          currentRoomId = null;
          currentUserId = null;
          currentRoomAccess = { allowed: false, canEdit: false };
          break;
        }

        case 'add_element': {
          if (!currentRoomId || !currentUserId) break;
          const room = rooms.get(currentRoomId);
          if (!room) break;
          await addElementHandler.apply(message, toHandlerCtx(room, currentUserId));
          break;
        }

        case 'update_element': {
          if (!currentRoomId || !currentUserId) break;
          const room = rooms.get(currentRoomId);
          if (!room) break;
          await updateElementHandler.apply(message, toHandlerCtx(room, currentUserId));
          break;
        }

        case 'delete_element': {
          if (!currentRoomId || !currentUserId) break;
          const room = rooms.get(currentRoomId);
          if (!room) break;
          await deleteElementHandler.apply(message, toHandlerCtx(room, currentUserId));
          break;
        }

        case 'scene-update': {
          if (!currentRoomId || !currentUserId) break;
          const room = rooms.get(currentRoomId);
          if (!room) break;
          await sceneUpdateHandler.apply(message, toHandlerCtx(room, currentUserId));
          break;
        }

        case 'scene-delta': {
          if (!currentRoomId || !currentUserId) break;
          const room = rooms.get(currentRoomId);
          if (!room) break;
          await sceneDeltaHandler.apply(message, toHandlerCtx(room, currentUserId));
          break;
        }

        case 'element-update': {
          if (!currentRoomId || !currentUserId) break;
          const room = rooms.get(currentRoomId);
          if (!room) break;
          await elementUpdateHandler.apply(message, toHandlerCtx(room, currentUserId));
          break;
        }

        case 'cursor_move':
        case 'cursor-move': {
          if (!currentRoomId || !currentUserId) break;
          const room = rooms.get(currentRoomId);
          if (!room) break;

          // Already validated against these same schemas by the dispatch
          // prologue's messageSchema pass; parsing again would double the
          // cost of the highest-frequency message on the socket.
          await cursorMoveHandler.apply(message, toHandlerCtx(room, currentUserId));
          break;
        }

        case 'element-lock': {
          if (!currentRoomId || !currentUserId) break;
          if (rejectReadOnlyMutation()) break;
          const room = rooms.get(currentRoomId);
          if (!room) break;
          await elementLockHandler.apply(message, toHandlerCtx(room, currentUserId));
          break;
        }

        case 'element-unlock': {
          if (!currentRoomId || !currentUserId) break;
          const room = rooms.get(currentRoomId);
          if (!room) break;
          await elementUnlockHandler.apply(message, toHandlerCtx(room, currentUserId));
          break;
        }

        case 'element-lock-heartbeat': {
          if (!currentRoomId || !currentUserId) break;
          const room = rooms.get(currentRoomId);
          if (!room) break;
          await elementLockHeartbeatHandler.apply(message, toHandlerCtx(room, currentUserId));
          break;
        }

        case 'ping': {
          send(ws, { type: 'pong', timestamp: Date.now() });
          break;
        }

        case 'viewport-update': {
          if (!currentRoomId || !currentUserId) break;
          const room = rooms.get(currentRoomId);
          if (!room) break;
          await viewportUpdateHandler.apply(message, toHandlerCtx(room, currentUserId));
          break;
        }

        case 'follow-user': {
          if (!currentRoomId || !currentUserId) break;
          const room = rooms.get(currentRoomId);
          if (!room) break;
          await followUserHandler.apply(message, toHandlerCtx(room, currentUserId));
          break;
        }

        case 'unfollow-user': {
          if (!currentRoomId || !currentUserId) break;
          const room = rooms.get(currentRoomId);
          if (!room) break;
          await unfollowUserHandler.apply(message, toHandlerCtx(room, currentUserId));
          break;
        }
      }
    } catch (err) {
      logger.error({ event: 'ws_message_handler_error', err });
      Sentry.captureException(err);
    }
  }

  // The ws EventEmitter does not await async listeners. Serialize messages per
  // connection so a burst cannot reorder a join, delta, and delete while a
  // room is being loaded or a remote Redis mutation is being applied.
  let messageQueue = Promise.resolve();
  let queuedMessages = 0;
  let queuedMessageBytes = 0;
  const MAX_QUEUED_MESSAGES = 100;
  ws.on('message', (raw: Buffer, isBinary: boolean) => {
    if (
      queuedMessages >= MAX_QUEUED_MESSAGES ||
      queuedMessageBytes + raw.byteLength > MAX_SERIALIZED_QUEUE_BYTES
    ) {
      ws.close(4000, 'Message queue exceeded');
      return;
    }
    queuedMessages += 1;
    queuedMessageBytes += raw.byteLength;
    messageQueue = messageQueue
      .then(() => handleMessage(raw, isBinary))
      .catch(err => {
        logger.error({ event: 'ws_message_queue_error', err });
        Sentry.captureException(err);
      })
      .finally(() => {
        queuedMessages -= 1;
        queuedMessageBytes -= raw.byteLength;
      });
  });

  ws.off('message', onEarlyMessage);
  for (const raw of earlyMessages.splice(0)) {
    ws.emit('message', raw);
  }

  ws.on('close', () => {
    removeRateLimitIdentity(ws);
    if (!currentRoomId || !currentUserId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    const registeredConnection = room.users.get(currentUserId);
    const ownsRegistration = registeredConnection?.ws === ws;
    if (ownsRegistration) {
      room.users.delete(currentUserId);
      room.cursors.delete(currentUserId);
      room.following.delete(currentUserId);
      room.viewports.delete(currentUserId);
      // Remove this user as a leader from anyone following them
      for (const [followerId, leaderId] of room.following) {
        if (leaderId === currentUserId) {
          room.following.delete(followerId);
        }
      }
    }
    wsToRoomMap.delete(ws);
    if (ownsRegistration && userToRoomMap.get(currentUserId) === currentRoomId) {
      userToRoomMap.delete(currentUserId);
    }

    if (ownsRegistration) {
      broadcast(room, {
        type: 'user-leave',
        roomId: currentRoomId,
        userId: currentUserId,
        timestamp: Date.now(),
      });

      if (room.users.size === 0) {
        roomLastEmptyAt.set(currentRoomId, Date.now());
      }
    }
  });
});

const heartbeat = setInterval(() => {
  runHeartbeatTick(wss.clients);
}, HEARTBEAT_INTERVAL_MS);

const AUTHORIZATION_SWEEP_INTERVAL_MS = 15_000;
const authorizationSweep = setInterval(() => {
  runAuthorizationSweep();
}, AUTHORIZATION_SWEEP_INTERVAL_MS);
authorizationSweep.unref();

const periodicSave = setInterval(() => {
  void runPeriodicSave();
}, PERIODIC_SAVE_INTERVAL_MS);

const LOCK_SWEEP_INTERVAL_MS = 5_000;

const lockSweep = setInterval(() => {
  runLockSweep();
}, LOCK_SWEEP_INTERVAL_MS);

const RECONCILIATION_INTERVAL_MS = 60_000;

const reconciliation = setInterval(() => {
  void runReconciliation();
}, RECONCILIATION_INTERVAL_MS);

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeat);
  clearInterval(periodicSave);
  clearInterval(lockSweep);
  clearInterval(reconciliation);
  clearInterval(authorizationSweep);

  // Stop accepting new HTTP/WebSocket work before the final persistence pass.
  const httpClosePromise = new Promise<void>(resolve => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });

  const savePromises: Promise<void>[] = [];
  const savedRoomIds = new Set<string>();
  let saveFailed = false;

  // Save rooms with pending debounced saves.
  for (const [roomId, timeout] of saveTimeouts.entries()) {
    clearTimeout(timeout);
    const room = rooms.get(roomId);
    if (room) {
      savedRoomIds.add(roomId);
      savePromises.push(
        saveRoomElements(roomId, room.elements).then(success => {
          if (!success) {
            saveFailed = true;
            logger.error({ event: 'shutdown_save_failure', roomId });
          }
        })
      );
    }
  }

  // Also save any dirty rooms not already queued, but do not overlap an
  // in-flight periodic save that is already responsible for the same room.
  for (const [roomId, room] of rooms.entries()) {
    if (!savedRoomIds.has(roomId) && room.dirty && !room.saving) {
      savePromises.push(
        saveRoomElements(roomId, room.elements).then(success => {
          if (!success) {
            saveFailed = true;
            logger.error({ event: 'shutdown_save_failure', roomId });
          }
        })
      );
    }
  }

  const SHUTDOWN_TIMEOUT_MS = 10_000;
  const timeout = new Promise<boolean>(resolve => {
    setTimeout(() => {
      logger.error({ event: 'shutdown_timeout' });
      resolve(false);
    }, SHUTDOWN_TIMEOUT_MS);
  });
  const savesCompleted = await Promise.race([Promise.all(savePromises).then(() => true), timeout]);
  if (!savesCompleted) saveFailed = true;

  // Closing clients after the save pass prevents new mutations from racing the
  // final snapshot. The close is bounded because a peer may not answer the
  // WebSocket close handshake.
  for (const client of wss.clients) client.close(1001, 'Server shutting down');
  await Promise.race([
    new Promise<void>(resolve => wss.close(() => resolve())),
    new Promise<void>(resolve => setTimeout(resolve, 2_000)),
  ]);
  await httpClosePromise;
  await db.$disconnect();
  process.exit(saveFailed ? 1 : 0);
}

export async function stopForTests(): Promise<void> {
  clearInterval(heartbeat);
  clearInterval(periodicSave);
  clearInterval(lockSweep);
  clearInterval(reconciliation);
  clearInterval(authorizationSweep);
  for (const client of wss.clients) client.terminate();
  await new Promise<void>(resolve => {
    if (!wss) {
      resolve();
      return;
    }
    wss.close(() => resolve());
  });
  if (server.listening) {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  rooms.clear();
  saveTimeouts.forEach(timeout => clearTimeout(timeout));
  saveTimeouts.clear();
  roomLastEmptyAt.clear();
  userToRoomMap.clear();
  // `wsToRoomMap` is keyed by socket, so a stale entry lets the heartbeat read
  // a roomId for a socket that has already been reaped.
  wsToRoomMap.clear();
  await db.$disconnect();
  shuttingDown = false;
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});

if (process.env.NODE_ENV !== 'test' || process.env.RUN_WS_INTEGRATION === 'true') {
  start().then(() => {
    server.listen(WS_PORT, () => {
      logger.info({ event: 'websocket_server_started', port: WS_PORT });
    });
  });
}
