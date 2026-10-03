/**
 * The `if (!room) break;` guard that every room-scoped case in the dispatch
 * switch repeats.
 *
 * This branch is unreachable through the ordinary "never joined" path: a
 * mutation with no room is stopped earlier by `refreshRoomAccess` (which reads
 * `canEdit` off a still-unset `currentRoomAccess`), and a cursor or viewport with
 * no room takes the `!currentRoomId` guard. So the only way here is a connection
 * that *does* have `currentRoomId` and `currentUserId` set while the room has
 * disappeared from `rooms` — which happens for real, twice:
 *
 *   - the empty-room GC in `runPeriodicSave` deletes a room and returns its
 *     lease;
 *   - `handleRoomOwnershipLost` deletes the room after closing the sockets, and
 *     the close handshake is asynchronous, so a message already in flight
 *     arrives after the deletion.
 *
 * The consequence of the guard being wrong is not a crash — it is a handler
 * writing into a room that no longer exists in this process, or (worse) into
 * whichever room a stale id later resolves to. Every case is checked here
 * because each has its own copy of the guard, and a copy that drifts is
 * invisible.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';

const dbMock = {
  initializeDb: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
  $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]),
  file: {
    findFirst: vi.fn(),
    findUnique: vi.fn().mockResolvedValue(null),
    updateManyAndReturn: vi.fn().mockResolvedValue([{ updatedAt: new Date() }]),
  },
  canvasRoom: {
    findUnique: vi.fn().mockResolvedValue(null),
    updateManyAndReturn: vi.fn().mockResolvedValue([{ updatedAt: new Date() }]),
  },
};

vi.mock('@dripl/db', () => ({ db: dbMock, initializeDb: dbMock.initializeDb }));

vi.mock('../redis', () => ({
  acquireRoomLease: vi.fn(async () => 'acquired' as const),
  renewRoomLease: vi.fn(async () => 'renewed' as const),
  releaseRoomLease: vi.fn(async () => 'released' as const),
  isRedisAvailable: () => false,
  subscribeToRoom: vi.fn(),
  unsubscribeFromRoom: vi.fn(),
  publishToRoom: vi.fn(async () => undefined),
}));

const validateTicket = vi.fn(async (ticket: string) => ({ kind: 'user' as const, userId: ticket }));
vi.mock('../auth', async importOriginal => {
  const actual = await importOriginal<typeof import('../auth')>();
  return { ...actual, validateTicket };
});

type Message = Record<string, unknown>;

/** Every room-scoped case, with a payload each handler will accept if reached. */
const roomScopedMessages: unknown[] = [
  { type: 'add_element', element: rect('stale-1') },
  { type: 'update_element', element: rect('stale-1', 2) },
  { type: 'delete_element', elementId: 'stale-1' },
  { type: 'scene-update', subtype: 'update', elements: [rect('stale-1')] },
  { type: 'scene-delta', added: [rect('stale-1')] },
  { type: 'element-update', element: rect('stale-1') },
  { type: 'cursor_move', x: 4, y: 5 },
  { type: 'cursor-move', x: 4, y: 5 },
  { type: 'element-lock', elementId: 'stale-1' },
  { type: 'element-unlock', elementId: 'stale-1' },
  { type: 'element-lock-heartbeat', elementId: 'stale-1' },
  { type: 'viewport-update', panX: 1, panY: 2, zoom: 1 },
  { type: 'follow-user', targetUserId: 'someone' },
  { type: 'unfollow-user' },
  { type: 'leave' },
  { type: 'leave_room' },
];

function rect(id: string, version = 1) {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version,
    versionNonce: version,
  };
}

describe('a connection whose room no longer exists', () => {
  let stopForTests: () => Promise<void>;
  let port: number;
  let roomState: typeof import('../rooms');

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RUN_WS_INTEGRATION', 'true');
    vi.stubEnv('DATABASE_URL', 'postgres://test:test@127.0.0.1:5432/test');
    vi.stubEnv('INTERNAL_SECRET', 'ws-stale-guard-internal');
    vi.stubEnv('HTTP_SERVER_URL', 'http://127.0.0.1:3999');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('WS_PORT', '0');
    vi.stubEnv('PORT', '0');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    // Long enough that the pre-existing access decision stands, so the messages
    // below are governed by the `!room` guard rather than by a re-check.
    vi.stubEnv('ACCESS_RECHECK_THROTTLE_MS', '600000');
    vi.resetModules();

    const module = await import('../index');
    stopForTests = module.stopForTests;
    roomState = await import('../rooms');
    if (!module.server.listening) await once(module.server, 'listening');
    port = (module.server.address() as AddressInfo).port;

    dbMock.file.findFirst.mockImplementation(async (args: unknown) => {
      const id = (args as { where: { id: string } }).where.id;
      return {
        userId: id,
        teamId: null,
        sharedWith: [],
        team: { members: [{ userId: id }] },
        sharePermission: null,
        shareExpiresAt: null,
      };
    });
  }, 30_000);

  afterAll(async () => {
    await stopForTests?.();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('drops every room-scoped message without recreating the room', async () => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/?ticket=stale-room`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    await once(client, 'open');
    const replies: Message[] = [];
    client.on('message', raw => replies.push(JSON.parse(raw.toString()) as Message));

    const sync = new Promise<Message>(resolve => {
      const onMessage = (raw: Buffer) => {
        const message = JSON.parse(raw.toString()) as Message;
        if (message.type !== 'sync_room_state') return;
        client.off('message', onMessage);
        resolve(message);
      };
      client.on('message', onMessage);
    });
    client.send(JSON.stringify({ type: 'join', roomId: 'stale-room', displayName: 'A' }));
    expect((await sync).roomId).toBe('stale-room');
    replies.length = 0;

    // The room is collected or handed over while the socket is still open. The
    // connection's own `currentRoomId`/`currentUserId` are unchanged, so this is
    // exactly the window where the `!room` guard is the only thing standing
    // between a message and a handler running against a room that is not here.
    roomState.rooms.delete('stale-room');
    dbMock.file.updateManyAndReturn.mockClear();
    dbMock.canvasRoom.updateManyAndReturn.mockClear();

    for (const message of roomScopedMessages) client.send(JSON.stringify(message));
    await new Promise(resolve => setTimeout(resolve, 400));

    // Nothing was written: a handler that skipped the guard would create a fresh
    // RoomState and persist a scene for a room this process no longer owns.
    expect(roomState.rooms.has('stale-room')).toBe(false);
    expect(dbMock.file.updateManyAndReturn).not.toHaveBeenCalled();
    expect(dbMock.canvasRoom.updateManyAndReturn).not.toHaveBeenCalled();
    // The reverse indexes are untouched too — a leave that ran would have
    // cleared the mapping, and a mutation that ran would have left it pointing
    // at nothing.
    expect(roomState.userToRoomMap.get('stale-room')).toBe('stale-room');
    expect(client.readyState).toBe(WebSocket.OPEN);
    // Nothing at all came back for any of them, including the mutations, which
    // are the ones that would answer with a capacity or fence error if a handler
    // had run.
    expect(replies).toEqual([]);

    // Note the recovery limit, which is a real consequence and not tested here:
    // this connection cannot rejoin the room it was in, because `join` for the
    // same `currentRoomId` is a silent no-op. A client whose room was collected
    // or handed over therefore has to reconnect to get a fresh sync — which is
    // exactly what `handleRoomOwnershipLost` does for it (close 4010) and what
    // the empty-room GC leaves to the heartbeat (terminate, so the client
    // reconnects). Both are covered in their own suites.

    client.close();
  });
});
