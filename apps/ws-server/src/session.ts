import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { pickUserColor } from '@dripl/common';
import { logger } from './logger';
import { send, broadcast, roomUsersPayload, roomCursorsPayload } from './broadcast';
import {
  rooms,
  roomLastEmptyAt,
  userToRoomMap,
  wsToRoomMap,
  getOrCreateRoom,
  loadRoomElements,
  persistRoom,
} from './rooms';
import { subscribeToRoom, isRedisAvailable } from './redis';
import { acquireRoom } from './roomOwnership';
import { authorizeRoomAccess, authorizeShareRoomAccess, type RoomAccess } from './roomAccess';
import type { UserConnection, RoomState } from './types';
import type { WsTicketPrincipal } from './auth';
import type { WsMessage } from './validation';
import type { HandlerCtx } from './handlers/types';

type JoinMessage = Extract<WsMessage, { type: 'join' | 'join_room' }>;

// Upper bound on database access checks from the per-message path. Exported
// (through `index.ts`) for tests; production keeps the 15s sweep as the
// revocation enforcer.
export const ACCESS_RECHECK_THROTTLE_MS = Number(process.env.ACCESS_RECHECK_THROTTLE_MS) || 30_000;

const DENIED: RoomAccess = { allowed: false, canEdit: false };

/**
 * The per-socket session: which room this connection is joined to, under what
 * identity, and with what access. Extracted from `index.ts`'s `onConnection`
 * closure, where join, leave and the access-revalidation thunks used to live
 * as nested functions over four mutable `let`s — the part of the connection
 * lifecycle that mutates state, as opposed to the wiring (ticket handshake,
 * early-message buffering, the serialized queue) that only arranges it.
 *
 * The state stays private to the factory; `index.ts` reads it through the
 * getters and drives it through the methods, so nothing outside can observe a
 * half-applied join.
 */
export interface ConnectionSession {
  /** Room this socket is joined to; null before a join and after a leave. */
  readonly roomId: string | null;
  /** User identity established at join (real id, or a generated guest id). */
  readonly userId: string | null;
  /** Refuse a mutation when the joined share is view-only. True when refused. */
  rejectReadOnlyMutation(): boolean;
  /** The joined room plus the joining user's id, or null when not joined. */
  joined(): { room: RoomState; userId: string } | null;
  /** Build the handler context handed to every extracted message handler. */
  handlerCtx(room: RoomState, userId: string): HandlerCtx;
  /** Fresh database access check; closes the socket 4003 when access is gone. */
  revalidate(): Promise<boolean>;
  /** Throttled steady-state mutation gate; the 15 s sweep bounds staleness. */
  refresh(): Promise<boolean>;
  /** Authorize, claim room ownership, load the scene, register, send the sync. */
  join(message: JoinMessage): Promise<void>;
  /** Leave the current room, persisting once when the room empties. */
  leave(): Promise<void>;
}

/**
 * Build the session for one authenticated socket. `onFanOut` is how the join
 * subscribes the room to Redis fan-out: the apply-and-broadcast closure lives
 * in `index.ts` (`handleRedisMessage`), so the session names it as a
 * dependency rather than importing the composition root.
 */
export function createConnectionSession(opts: {
  ws: WebSocket;
  principal: WsTicketPrincipal;
  /** Set when the ticket proved a signed-in user; null for share/guest. */
  authUserId: string | null;
  onFanOut(roomId: string, payload: unknown): void;
}): ConnectionSession {
  const { ws, principal, authUserId, onFanOut } = opts;

  let roomId: string | null = null;
  let userId: string | null = null;
  let roomAccess: RoomAccess = DENIED;
  // Timestamp of the last database access check for this connection. The
  // per-message path used to revalidate against the database on every
  // mutation — an active editor emits ~20 scene-deltas/sec, each costing 1-2
  // Prisma queries. Revocation is still enforced within 15s by the
  // authorization sweep (which always hits the database), so the hot path
  // only needs a throttled steady-state check.
  let lastAccessCheckAt = 0;

  const rejectReadOnlyMutation = (): boolean => {
    if (roomAccess.canEdit) return false;
    send(ws, { type: 'error', message: 'You have view-only access to this room' });
    return true;
  };

  // Every delegated handler needs the same context shape; the user fallback
  // mirrors what the inline cases synthesized before extraction.
  const handlerCtx = (room: RoomState, id: string): HandlerCtx => ({
    ws,
    user: room.users.get(id) ?? {
      userId: id,
      displayName: 'Unknown',
      color: '#000000',
      ws,
      isAlive: true,
    },
    userId: id,
    roomId: room.roomId,
    room,
    logger,
    rejectReadOnlyMutation,
  });

  const revalidate = async (): Promise<boolean> => {
    if (!roomId) return true;
    const access =
      principal.kind === 'share'
        ? await authorizeShareRoomAccess(
            principal.fileId,
            roomId,
            principal.permission,
            principal.token
          )
        : await authorizeRoomAccess(principal.userId, roomId);
    roomAccess = access;
    if (!access.allowed) {
      send(ws, { type: 'error', message: 'Room access has been revoked' });
      ws.close(4003, 'Room access revoked');
      return false;
    }
    return true;
  };

  const refresh = async (): Promise<boolean> => {
    // Throttled steady-state check: trust the join-time decision between
    // revalidations. The sweep revalidates every connection every 15s with a
    // fresh database read, so a revoked share or removed member is still
    // cut off within that window.
    if (Date.now() - lastAccessCheckAt >= ACCESS_RECHECK_THROTTLE_MS) {
      if (!(await revalidate())) return false;
      lastAccessCheckAt = Date.now();
    }
    if (!roomAccess.canEdit) {
      send(ws, { type: 'error', message: 'You have view-only access to this room' });
      return false;
    }
    return true;
  };

  const joined = (): { room: RoomState; userId: string } | null => {
    if (!roomId || !userId) return null;
    const room = rooms.get(roomId);
    if (!room) return null;
    return { room, userId };
  };

  async function join(message: JoinMessage): Promise<void> {
    const target = message.roomId;
    if (roomId && roomId !== target) {
      send(ws, {
        type: 'error',
        message: 'Leave the current room before joining another room',
      });
      return;
    }
    if (roomId === target) return;
    const access =
      principal.kind === 'share'
        ? await authorizeShareRoomAccess(
            principal.fileId,
            target,
            principal.permission,
            principal.token
          )
        : await authorizeRoomAccess(principal.userId, target);
    if (!access.allowed) {
      send(ws, { type: 'error', message: 'You do not have access to this room' });
      ws.close(4003, 'Room access denied');
      return;
    }
    roomAccess = access;
    lastAccessCheckAt = Date.now();

    // Claim the room before it is loaded, not after. Every step below
    // this line — reading the scene, admitting mutations, writing
    // Postgres — mutates state that another instance could be mutating
    // too, so ownership has to be settled first. A refusal here happens
    // after the access check and before any RoomState exists, so a
    // non-owner never loads a scene it must not serve.
    //
    // Cost: one Redis round-trip per *join*, never per mutation, and
    // never on the single-instance path where ownership is disabled.
    const ownership = await acquireRoom(target);
    if (ownership === 'foreign') {
      send(ws, {
        type: 'error',
        code: 'room_served_by_another_instance',
        message: 'This room is currently served by another server. Please reconnect.',
      });
      logger.warn({ event: 'ws_room_ownership_rejected', roomId: target });
      ws.close(4010, 'Room served by another instance');
      return;
    }

    const room = getOrCreateRoom(target);

    if (!room.loadedFromDb) {
      if (!room.loadingPromise) {
        room.loadingPromise = loadRoomElements(target);
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

    const id = authUserId ?? `guest:${randomUUID()}`;
    const displayName = requestedName || `User-${id.slice(0, 4)}`;
    const color = requestedColor || pickUserColor();

    if (room.users.has(id)) {
      send(ws, {
        type: 'error',
        message: 'This account is already connected in another tab',
      });
      ws.close(4009, 'Duplicate connection');
      return;
    }

    roomId = target;
    userId = id;
    wsToRoomMap.set(ws, target);
    userToRoomMap.set(id, target);

    const connection: UserConnection = {
      userId: id,
      displayName,
      color,
      ws,
      isAlive: true,
      revalidate,
    };
    room.users.set(id, connection);
    (ws as WebSocket & { __user?: UserConnection }).__user = connection;

    send(ws, {
      type: 'sync_room_state',
      roomId: target,
      elements: Array.from(room.elements.values()),
      users: roomUsersPayload(room),
      cursors: roomCursorsPayload(room),
      yourUserId: id,
      readOnly: !roomAccess.canEdit,
      timestamp: Date.now(),
      // Monotonic per-room mutation counter. Additive: old clients
      // ignore it. Future version-heartbeat / resync work can compare
      // this against the last version a client acknowledged to detect
      // a gap without a full scene transfer.
      sceneVersion: room.mutationVersion,
      // Wire protocol epoch. All scene mutations now fan out as
      // scene-delta; receivers keep their legacy branches for
      // mid-deploy tabs, but nothing new is emitted in the old
      // shapes. Bumped only for wire-incompatible changes, never
      // silently: old clients get read-only treatment or explicit
      // rejection per the collaboration decision, not quiet drift.
      protocolEpoch: 2,
    });

    broadcast(
      room,
      {
        type: 'user-join',
        roomId: target,
        userId: id,
        userName: displayName,
        displayName,
        color,
        timestamp: Date.now(),
      },
      id
    );

    if (isRedisAvailable()) {
      subscribeToRoom(target, payload => onFanOut(target, payload));
    }
  }

  async function leave(): Promise<void> {
    if (!roomId || !userId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    room.users.delete(userId);
    room.cursors.delete(userId);
    wsToRoomMap.delete(ws);
    if (userToRoomMap.get(userId) === roomId) {
      userToRoomMap.delete(userId);
    }

    broadcast(room, {
      type: 'user-leave',
      roomId,
      userId,
      timestamp: Date.now(),
    });

    if (room.users.size === 0) {
      // Single guarded write on the way out. persistRoom owns the
      // dirty/saving/version guard; a 'busy' outcome means the
      // periodic tick owns an in-flight write and will finish it.
      // Unlike the old inline version this also clears dirty on a
      // clean success, so the empty-room GC below does not pay for a
      // second write of identical content.
      void persistRoom(roomId).then(outcome => {
        if (outcome === 'failed') {
          logger.error({ event: 'leave_save_failure', roomId });
        }
      });
      roomLastEmptyAt.set(roomId, Date.now());
    }

    roomId = null;
    userId = null;
    roomAccess = DENIED;
  }

  return {
    get roomId() {
      return roomId;
    },
    get userId() {
      return userId;
    },
    rejectReadOnlyMutation,
    joined,
    handlerCtx,
    revalidate,
    refresh,
    join,
    leave,
  };
}
