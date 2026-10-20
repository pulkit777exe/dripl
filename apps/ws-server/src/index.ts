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

import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { DriplElement } from '@dripl/common';
import { MAX_MESSAGE_BYTES } from '@dripl/common';
import { initializeDb, db } from '@dripl/db';
import { messageSchema, validateMessageSize } from './validation';
import type { UserConnection } from './types';
import { resolveTicketFromUrl, validateTicket } from './auth';
import { createConnectionSession, ACCESS_RECHECK_THROTTLE_MS } from './session';
export { ACCESS_RECHECK_THROTTLE_MS };
import { send, broadcast } from './broadcast';
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
  awaitSettledPersist,
  type PersistOutcome,
} from './rooms';
import { checkRateLimit, setRateLimitIdentity, removeRateLimitIdentity } from './rateLimiter';
import { isRedisAvailable, unsubscribeFromRoom } from './redis';
import { onRoomOwnershipLost, releaseAllRooms } from './roomOwnership';
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

/**
 * We were serving a room and the ownership lease is gone: it expired during a
 * Redis partition, or a peer proved it still holds the room. Another instance
 * is the authority for this room now, so the only safe move is to stop — not to
 * save, not to keep editing, not to answer the next join from memory.
 *
 * The local `RoomState` is dropped **without persisting**. The fenced Postgres
 * write would still reject a clobber in most cases, but "most cases" is the
 * whole problem: a lapsed owner writing is precisely how two instances produce
 * a scene neither of them would have produced alone. Anything not yet
 * persisted is lost, which is bounded by the save debounce/period and is the
 * same loss a restart already had.
 *
 * Clients are closed with 4010 (retryable elsewhere) rather than left on a
 * frozen room: a socket whose messages now resolve to a room that no longer
 * exists would look alive and silently accept nothing.
 */
function handleRoomOwnershipLost(roomId: string): void {
  const room = rooms.get(roomId);
  // Close first, then drop state: `ws.close` runs the connection's close
  // handler asynchronously, and that handler still expects the room to exist.
  for (const client of wss.clients) {
    if (wsToRoomMap.get(client) === roomId) client.close(4010, 'Room moved to another instance');
  }
  if (!room) {
    roomLastEmptyAt.delete(roomId);
    return;
  }
  for (const user of room.users.values()) {
    send(user.ws, {
      type: 'error',
      code: 'room_ownership_lost',
      message: 'This room moved to another server. Reconnect to continue editing.',
    });
  }
  room.users.clear();
  room.cursors.clear();
  room.elementLocks.clear();
  room.viewports.clear();
  room.following.clear();
  rooms.delete(roomId);
  roomLastEmptyAt.delete(roomId);
  const pendingSave = saveTimeouts.get(roomId);
  if (pendingSave) clearTimeout(pendingSave);
  saveTimeouts.delete(roomId);
  if (isRedisAvailable()) {
    unsubscribeFromRoom(roomId);
  }
  logger.warn({ event: 'ws_room_quiesced', roomId });
}

onRoomOwnershipLost(handleRoomOwnershipLost);

const configuredWsPort = Number(process.env.PORT ?? env.WS_PORT);
const WS_PORT =
  Number.isInteger(configuredWsPort) && configuredWsPort >= 0 ? configuredWsPort : 3001;
const HEARTBEAT_INTERVAL_MS = 30_000;
const PERIODIC_SAVE_INTERVAL_MS = Number(process.env.PERIODIC_SAVE_INTERVAL_MS) || 15_000;
let shuttingDown = false;

export const server = createServer(async (req, res) => {
  // Liveness, deliberately distinct from the readiness probe below. It answers
  // exactly one question — is this event loop still turning — and performs no
  // I/O, so it cannot fail for a reason that restarting the process would fix.
  // `/health` is the opposite: it is a *readiness* probe, because it requires
  // Postgres and answers 503 when the database is unreachable. Pointing a
  // process supervisor's restart policy at `/health` conflates the two, and for
  // this server the difference is data loss rather than latency: every room is
  // authoritative in memory (ADR-002), so a restart triggered by a transient
  // Postgres blip discards unsaved edits and drops every connected client.
  if (req.url === '/live') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), ts: Date.now() }));
  } else if (req.url === '/health') {
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

// `http.Server` is an EventEmitter too, and `listen` reports a bind failure
// (`EADDRINUSE`, `EACCES`) by emitting `'error'`. Unhandled, that is a fatal
// uncaught exception — the correct outcome, but reported as a bare Node stack
// dump with no service name and no `event`, so a port clash on deploy is
// indistinguishable from a crash loop. Listening for it and exiting explicitly
// keeps the crash behaviour identical (exit code 1) and makes the reason
// greppable. This is also the only error on this process that is *allowed* to
// be fatal: nothing about it is survivable.
server.on('error', err => {
  logger.error({ event: 'ws_http_server_error', err });
  process.exit(1);
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

// `EventEmitter` throws on an `'error'` event that has no listener, and `ws`
// emits `'error'` on a socket for ordinary transport-level failures — most
// importantly `receiverOnError` / `senderOnError`, which fire for a frame the
// client sent that the receiver could not parse (an invalid-UTF8 text frame,
// a malformed compressed frame) and for a failed outbound deflate. With no
// listener that is not a per-connection failure, it is an uncaught exception:
// one packet from one client killed the process and discarded every in-memory
// `RoomState` in it. Verified against ws@8.22.0 with the options above — a
// single masked text frame of `[0xff,0xfe,0xfd]` prints
// "Emitted 'error' event on WebSocket instance" and exits the process before
// any ticket is ever validated.
//
// So: log the transport error, let `ws` run its own close handshake (it already
// does, immediately after emitting), and never let it reach the process-level
// throw. `warn`, not `error`, and no Sentry — these are operational events
// caused by a peer, not faults in this process.
//
// The server-level listener is precautionary: ws@8.22.0 does not currently
// emit `'error'` on `WebSocketServer` at all, but the event is part of its
// declared surface and an unhandled one would be fatal here too.
wss.on('error', err => {
  logger.error({ event: 'ws_server_error', err });
});

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  ws.on('error', err => {
    logger.warn({
      event: 'ws_socket_error',
      code: (err as { code?: unknown }).code,
      error: err instanceof Error ? err.message : String(err),
    });
  });
  // `ws` is an EventEmitter and does not await listeners, so an `async` one
  // that rejects becomes an unhandled rejection — which Node turns into the
  // same fatal uncaught exception as above (an emitter only routes a rejected
  // listener to `'error'` when it was constructed with
  // `{ captureRejections: true }`, and `ws` does not). Registering a
  // synchronous listener and floating the work keeps that failure mode inside
  // `handleConnection`, which owns its own catch.
  void handleConnection(ws, req);
});

async function handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
  try {
    await onConnection(ws, req);
  } catch (err) {
    logger.error({ event: 'ws_connection_setup_failed', err });
    Sentry.captureException(err);
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(1011, 'Connection setup failed');
    }
  }
}

async function onConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
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

  // The per-socket session owns room membership, identity and access: join,
  // leave and the revalidation thunks live in `session.ts`, and this function
  // keeps only the wiring around them.
  const session = createConnectionSession({
    ws,
    principal,
    authUserId,
    onFanOut: handleRedisMessage,
  });

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
      if (ROOM_MUTATION_TYPES.has(message.type) && !(await session.refresh())) {
        return;
      }

      switch (message.type) {
        case 'join_room':
        case 'join': {
          await session.join(message);
          break;
        }

        case 'leave_room':
        case 'leave': {
          await session.leave();
          break;
        }

        case 'add_element': {
          const joined = session.joined();
          if (!joined) break;
          await addElementHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }

        case 'update_element': {
          const joined = session.joined();
          if (!joined) break;
          await updateElementHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }

        case 'delete_element': {
          const joined = session.joined();
          if (!joined) break;
          await deleteElementHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }

        case 'scene-update': {
          const joined = session.joined();
          if (!joined) break;
          await sceneUpdateHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }

        case 'scene-delta': {
          const joined = session.joined();
          if (!joined) break;
          await sceneDeltaHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }

        case 'element-update': {
          const joined = session.joined();
          if (!joined) break;
          await elementUpdateHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }

        case 'cursor_move':
        case 'cursor-move': {
          const joined = session.joined();
          if (!joined) break;

          // Already validated against these same schemas by the dispatch
          // prologue's messageSchema pass; parsing again would double the
          // cost of the highest-frequency message on the socket.
          await cursorMoveHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }

        case 'element-lock': {
          const joined = session.joined();
          if (!joined) break;
          if (session.rejectReadOnlyMutation()) break;
          await elementLockHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }

        case 'element-unlock': {
          const joined = session.joined();
          if (!joined) break;
          await elementUnlockHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }

        case 'element-lock-heartbeat': {
          const joined = session.joined();
          if (!joined) break;
          await elementLockHeartbeatHandler.apply(
            message,
            session.handlerCtx(joined.room, joined.userId)
          );
          break;
        }

        case 'ping': {
          send(ws, { type: 'pong', timestamp: Date.now() });
          break;
        }

        case 'viewport-update': {
          const joined = session.joined();
          if (!joined) break;
          await viewportUpdateHandler.apply(
            message,
            session.handlerCtx(joined.room, joined.userId)
          );
          break;
        }

        case 'follow-user': {
          const joined = session.joined();
          if (!joined) break;
          await followUserHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }

        case 'unfollow-user': {
          const joined = session.joined();
          if (!joined) break;
          await unfollowUserHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
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
    const joined = session.joined();
    if (!joined) return;
    const { room, userId } = joined;

    const registeredConnection = room.users.get(userId);
    const ownsRegistration = registeredConnection?.ws === ws;
    if (ownsRegistration) {
      room.users.delete(userId);
      room.cursors.delete(userId);
      room.following.delete(userId);
      room.viewports.delete(userId);
      // Remove this user as a leader from anyone following them
      for (const [followerId, leaderId] of room.following) {
        if (leaderId === userId) {
          room.following.delete(followerId);
        }
      }
    }
    wsToRoomMap.delete(ws);
    if (ownsRegistration && userToRoomMap.get(userId) === room.roomId) {
      userToRoomMap.delete(userId);
    }

    if (ownsRegistration) {
      broadcast(room, {
        type: 'user-leave',
        roomId: room.roomId,
        userId,
        timestamp: Date.now(),
      });

      if (room.users.size === 0) {
        roomLastEmptyAt.set(room.roomId, Date.now());
      }
    }
  });
}

// Every sweep is `unref()`ed, so none of them is a reason for the process to
// stay alive on its own. That is safe in production because a *listening*
// `http.Server` is a ref'd handle: once `listen()` below succeeds, the process
// lives for exactly as long as it is serving, and these timers simply ride
// along. It matters on the import path — this module is the composition root,
// and the `NODE_ENV === 'test'` guard at the bottom skips `listen()` but not
// these. Before, importing `index.ts` without calling `stopForTests()` left
// four ref'd timers behind and the process never exited; the five integration
// suites that `await import('../index')` depended entirely on their `afterAll`
// to clear them. `unref()` is what makes "import the server" a side-effect-free
// operation rather than one that silently changes the event loop's lifetime.
const heartbeat = setInterval(() => {
  runHeartbeatTick(wss.clients);
}, HEARTBEAT_INTERVAL_MS);
heartbeat.unref();

const AUTHORIZATION_SWEEP_INTERVAL_MS = 15_000;
const authorizationSweep = setInterval(() => {
  runAuthorizationSweep();
}, AUTHORIZATION_SWEEP_INTERVAL_MS);
authorizationSweep.unref();

const periodicSave = setInterval(() => {
  void runPeriodicSave();
}, PERIODIC_SAVE_INTERVAL_MS);
periodicSave.unref();

const LOCK_SWEEP_INTERVAL_MS = 5_000;

const lockSweep = setInterval(() => {
  runLockSweep();
}, LOCK_SWEEP_INTERVAL_MS);
lockSweep.unref();

const RECONCILIATION_INTERVAL_MS = 60_000;

const reconciliation = setInterval(() => {
  void runReconciliation();
}, RECONCILIATION_INTERVAL_MS);
reconciliation.unref();

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

  // Save rooms with pending debounced saves. awaitSettledPersist waits out
  // an in-flight periodic write instead of double-writing alongside it,
  // and skips already-clean rooms (stale timeouts) without a write.
  const settleOutcome = (roomId: string, outcome: PersistOutcome): void => {
    if (outcome !== 'saved' && outcome !== 'clean') {
      saveFailed = true;
      logger.error({ event: 'shutdown_save_failure', roomId });
    }
  };
  for (const [roomId, timeout] of saveTimeouts.entries()) {
    clearTimeout(timeout);
    const room = rooms.get(roomId);
    if (room) {
      savedRoomIds.add(roomId);
      savePromises.push(
        awaitSettledPersist(roomId).then(outcome => settleOutcome(roomId, outcome))
      );
    }
  }

  // Also save any dirty rooms not already queued — including ones whose
  // periodic write is still in flight (previously skipped without waiting,
  // risking exit before the write completed).
  for (const [roomId, room] of rooms.entries()) {
    if (!savedRoomIds.has(roomId) && room.dirty) {
      savePromises.push(
        awaitSettledPersist(roomId).then(outcome => settleOutcome(roomId, outcome))
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
  // Only after the save pass: releasing first would let a peer take the room
  // and reload it from Postgres while this process still had unsaved edits.
  // `process.exit` follows immediately, so this is best-effort by construction —
  // which is fine, because lease expiry alone is sufficient for a handover.
  await releaseAllRooms();
  await db.$disconnect();
  // The one record that this exit was deliberate: without it a graceful
  // SIGTERM drain is indistinguishable from a crash in the log. Best-effort
  // by construction (`process.exit` follows), like everything above.
  logger.info({ event: 'ws_server_shutdown', saveFailed });
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
  // Leases too: a suite that restarts the server in-process would otherwise
  // leave a live lease (and its renewal timer) pointing at the old run.
  await releaseAllRooms();
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
  // `start()` swallows its one expected failure (no database) by exiting, but a
  // throw from `server.listen` below would surface as a bare unhandled
  // rejection with nothing in the log. Route both to the logger and fail the
  // boot explicitly rather than leaving a process that serves nothing.
  start()
    .then(() => {
      server.listen(WS_PORT, () => {
        logger.info({ event: 'websocket_server_started', port: WS_PORT });
      });
    })
    .catch((err: unknown) => {
      logger.error({ event: 'websocket_server_start_failed', err });
      process.exit(1);
    });
}
