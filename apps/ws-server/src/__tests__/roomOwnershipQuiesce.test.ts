/**
 * The two paths that only exist when Redis fan-out and room ownership are
 * live: what happens to a room when its lease is lost, and what this process
 * does with a mutation another instance published.
 *
 * Both are in `index.ts` behind `onRoomOwnershipLost(...)` and
 * `subscribeToRoom(...)`, so neither was reachable from any existing test.
 *
 * The quiesce path is the one that matters most. ADR-002 says the local
 * `RoomState` is dropped **without persisting**: a lapsed owner writing is
 * precisely how two instances produce a scene neither of them would have
 * produced alone. So the decisive assertion in the first test is that no
 * database write was attempted at all.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

const acquireRoomLease = vi.fn(async () => 'acquired' as const);
const renewRoomLease = vi.fn(async () => 'renewed' as const);
const releaseRoomLease = vi.fn(async () => 'released' as const);
const subscribeToRoom = vi.fn<(roomId: string, handler: (message: unknown) => void) => void>();
const unsubscribeFromRoom = vi.fn();

vi.mock('../redis', () => ({
  acquireRoomLease,
  renewRoomLease,
  releaseRoomLease,
  isRedisAvailable: () => true,
  subscribeToRoom,
  unsubscribeFromRoom,
  publishToRoom: vi.fn(async () => undefined),
}));

const validateTicket = vi.fn(async (ticket: string) => ({ kind: 'user' as const, userId: ticket }));
vi.mock('../auth', async importOriginal => {
  const actual = await importOriginal<typeof import('../auth')>();
  return { ...actual, validateTicket };
});

type Message = Record<string, unknown>;

let server: import('node:http').Server;
let stopForTests: () => Promise<void>;
let port: number;
let roomState: typeof import('../rooms');
let ownership: typeof import('../roomOwnership');
let redisModule: typeof import('../redis');

function open(ticket: string): Promise<WebSocket> {
  const client = new WebSocket(`ws://127.0.0.1:${port}/?ticket=${ticket}`, {
    headers: { Origin: 'http://localhost:3000' },
  });
  return once(client, 'open').then(() => client);
}

function waitFor(
  client: WebSocket,
  predicate: (message: Message) => boolean,
  timeoutMs = 3_000
): Promise<Message> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('message', onMessage);
      reject(new Error('timed out waiting for a message'));
    }, timeoutMs);
    const onMessage = (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as Message;
      if (!predicate(message)) return;
      clearTimeout(timer);
      client.off('message', onMessage);
      resolve(message);
    };
    client.on('message', onMessage);
  });
}

async function join(client: WebSocket, roomId: string): Promise<Message> {
  const sync = waitFor(client, message => message.type === 'sync_room_state');
  client.send(JSON.stringify({ type: 'join', roomId, displayName: 'A', color: '#123456' }));
  return sync;
}

const rect = (id: string, version = 1) => ({
  id,
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  version,
  versionNonce: version,
});

/** The handler `index.ts` registered for a room's fan-out channel. */
function fanOutHandlerFor(roomId: string): (message: unknown) => void {
  const call = subscribeToRoom.mock.calls.find(entry => entry[0] === roomId);
  if (!call) throw new Error(`no fan-out subscription was registered for ${roomId}`);
  return call[1];
}

describe('room ownership quiesce and cross-instance fan-out', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RUN_WS_INTEGRATION', 'true');
    vi.stubEnv('DATABASE_URL', 'postgres://test:test@127.0.0.1:5432/test');
    vi.stubEnv('INTERNAL_SECRET', 'ws-quiesce-internal');
    vi.stubEnv('HTTP_SERVER_URL', 'http://127.0.0.1:3999');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('WS_PORT', '0');
    vi.stubEnv('PORT', '0');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    // Ownership on, and read from the environment at module load.
    vi.stubEnv('WS_ROOM_OWNERSHIP', 'on');
    vi.stubEnv('WS_ROOM_LEASE_RENEW_MS', '60000');
    vi.resetModules();

    const module = await import('../index');
    server = module.server;
    stopForTests = module.stopForTests;
    // Re-read the mock handles off the modules the server actually imported:
    // `vi.resetModules()` re-creates them, and a stale reference asserts
    // against nothing.
    roomState = await import('../rooms');
    ownership = await import('../roomOwnership');
    redisModule = await import('../redis');
    if (!server.listening) await once(server, 'listening');
    port = (server.address() as AddressInfo).port;

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

  beforeEach(() => {
    vi.mocked(redisModule.acquireRoomLease).mockResolvedValue('acquired');
    vi.mocked(redisModule.renewRoomLease).mockResolvedValue('renewed');
    vi.mocked(redisModule.releaseRoomLease).mockResolvedValue('released');
  });

  describe('losing a lease', () => {
    it('closes the socket with 4010 and drops the room without persisting it', async () => {
      const client = await open('quiesce-owner');
      await join(client, 'quiesce-room');
      const room = roomState.rooms.get('quiesce-room');
      if (!room) throw new Error('room was never created');

      // A pending, unpersisted edit plus the per-connection state that dies
      // with the room. The element is deliberately never written to the row.
      client.send(JSON.stringify({ type: 'add_element', element: rect('unsaved') }));
      await vi.waitFor(() => expect(room.elements.has('unsaved')).toBe(true));
      room.elementLocks.set('lock-1', { userId: 'quiesce-owner', lastHeartbeat: Date.now() });
      room.viewports.set('quiesce-owner', { panX: 1, panY: 2, zoom: 1 });
      room.following.set('quiesce-owner', 'someone');
      expect(room.dirty).toBe(true);
      expect(roomState.saveTimeouts.has('quiesce-room')).toBe(true);

      // A peer proved it still holds the room: the renewal CAS is rejected.
      vi.mocked(redisModule.renewRoomLease).mockResolvedValue('lost');
      dbMock.file.updateManyAndReturn.mockClear();
      dbMock.canvasRoom.updateManyAndReturn.mockClear();

      const closed = new Promise<number>(resolve => client.once('close', resolve));
      await ownership.renewAllLeases();

      expect(await closed).toBe(4010);
      // The decisive assertion: a superseded owner must not write. Even the
      // fenced write could still clobber in the race window, and "mostly safe"
      // is the whole problem ADR-002 exists to remove.
      expect(dbMock.file.updateManyAndReturn).not.toHaveBeenCalled();
      expect(dbMock.canvasRoom.updateManyAndReturn).not.toHaveBeenCalled();
      // The room and every per-connection structure in it are gone, not merely
      // detached: a leftover cursor map or lock set would be served to whoever
      // joins next.
      expect(roomState.rooms.has('quiesce-room')).toBe(false);
      expect(room.users.size).toBe(0);
      expect(room.cursors.size).toBe(0);
      expect(room.elementLocks.size).toBe(0);
      expect(room.viewports.size).toBe(0);
      expect(room.following.size).toBe(0);
      // And the pending debounce was cancelled, so it cannot fire against a
      // room that no longer exists.
      expect(roomState.saveTimeouts.has('quiesce-room')).toBe(false);
      // The lease is gone locally and its channel released, so the next join
      // goes through a fresh `SET NX` rather than trusting this instance.
      expect(ownership.ownsRoom('quiesce-room')).toBe(false);
      expect(unsubscribeFromRoom).toHaveBeenCalledWith('quiesce-room');
    });

    it('does not throw when the lease is lost for a room that was never served', async () => {
      // `acquireRoom` can be called for a room that never reached a `RoomState`
      // (the client disconnected mid-join). The quiesce path has to tolerate
      // that: it runs from a lease-renewal sweep, where a throw is an
      // unhandled rejection and process death.
      await expect(ownership.acquireRoom('never-materialised')).resolves.toBe('owner');
      expect(roomState.rooms.has('never-materialised')).toBe(false);

      vi.mocked(redisModule.renewRoomLease).mockResolvedValue('lost');
      await expect(ownership.renewAllLeases()).resolves.toBeUndefined();
      expect(ownership.ownsRoom('never-materialised')).toBe(false);
    });
  });

  describe('cross-instance fan-out', () => {
    it('applies a peer mutation to local state before relaying it to local clients', async () => {
      // This is the property the whole `applyRemoteSceneMessage`-then-broadcast
      // order exists for. Relaying without applying would leave this replica
      // holding a stale authoritative scene, and its *next* join response or
      // next save would resurrect the older copy over the peer's.
      const local = await open('fanout-local');
      const peer = await open('fanout-peer');
      await join(local, 'fanout-room');
      await join(peer, 'fanout-room');

      const relayed = waitFor(peer, message => message.type === 'scene-delta');
      fanOutHandlerFor('fanout-room')({
        type: 'scene-delta',
        added: [rect('from-peer')],
        instanceId: 'other-instance',
      });

      await expect(relayed).resolves.toMatchObject({ added: [{ id: 'from-peer' }] });
      expect(roomState.rooms.get('fanout-room')?.elements.has('from-peer')).toBe(true);
      // And the applied mutation is now dirty, so this replica will persist it.
      expect(roomState.rooms.get('fanout-room')?.dirty).toBe(true);

      local.close();
      peer.close();
    });

    it('does not relay a peer mutation that changed nothing here', async () => {
      // A no-op still costs every connected client a merge pass, and marking the
      // room dirty on one schedules a fenced Postgres write. A stale remote
      // delta — the normal case while two instances still overlap — must be a
      // complete no-op.
      const local = await open('noop-local');
      const peer = await open('noop-peer');
      await join(local, 'noop-room');
      await join(peer, 'noop-room');
      // Establish a newer local copy so the peer's version loses the fence.
      local.send(JSON.stringify({ type: 'add_element', element: rect('contested', 9) }));
      await vi.waitFor(() =>
        expect(roomState.rooms.get('noop-room')?.elements.has('contested')).toBe(true)
      );
      const room = roomState.rooms.get('noop-room');
      if (!room) throw new Error('room missing');
      room.dirty = false;

      const relayed = waitFor(peer, message => message.type === 'scene-delta', 500);
      fanOutHandlerFor('noop-room')({
        type: 'scene-delta',
        updated: [rect('contested', 2)],
        instanceId: 'other-instance',
      });

      await expect(relayed).rejects.toThrow(/timed out/);
      expect(room.elements.get('contested')?.version).toBe(9);
      expect(room.dirty).toBe(false);

      local.close();
      peer.close();
    });

    it('relays a peer cursor without marking the room dirty', async () => {
      // Cursor traffic is the highest-frequency thing on this channel (~30/s
      // per user). Treating it as a scene change would put a fenced Postgres
      // write behind every cursor frame.
      const local = await open('cursor-local');
      const peer = await open('cursor-peer');
      await join(local, 'cursor-room');
      await join(peer, 'cursor-room');
      const room = roomState.rooms.get('cursor-room');
      if (!room) throw new Error('room missing');
      room.dirty = false;

      const relayed = waitFor(peer, message => message.type === 'cursor_move');
      fanOutHandlerFor('cursor-room')({
        type: 'cursor_move',
        x: 11,
        y: 22,
        userId: 'someone-else',
        instanceId: 'other-instance',
      });

      await expect(relayed).resolves.toMatchObject({ x: 11, y: 22 });
      expect(room.dirty).toBe(false);

      local.close();
      peer.close();
    });

    it('ignores a payload for a room whose state this process no longer holds', async () => {
      // The pattern subscription is process-wide while `RoomState` is per-room
      // and short-lived, so a payload for a room this instance has already
      // given up arrives with a registered handler but no room. Applying it
      // would materialise an authoritative copy for a room nobody here owns —
      // the exact condition ownership exists to prevent.
      const local = await open('stale-local');
      const peer = await open('stale-peer');
      await join(local, 'stale-room');
      await join(peer, 'stale-room');
      const handler = fanOutHandlerFor('stale-room');
      roomState.rooms.delete('stale-room');

      const relayed = waitFor(peer, message => message.type === 'scene-delta', 500);
      handler({ type: 'scene-delta', added: [rect('ghost')], instanceId: 'other-instance' });

      await expect(relayed).rejects.toThrow(/timed out/);
      expect(roomState.rooms.has('stale-room')).toBe(false);

      local.close();
      peer.close();
    });

    it('ignores peer message types it does not relay', async () => {
      const local = await open('ignored-local');
      const peer = await open('ignored-peer');
      await join(local, 'ignored-room');
      await join(peer, 'ignored-room');
      const room = roomState.rooms.get('ignored-room');
      if (!room) throw new Error('room missing');
      room.dirty = false;

      const relayed = waitFor(peer, message => message.type === 'user-join', 500);
      fanOutHandlerFor('ignored-room')({
        type: 'user-join',
        roomId: 'ignored-room',
        userId: 'someone-else',
        instanceId: 'other-instance',
      });

      await expect(relayed).rejects.toThrow(/timed out/);
      expect(room.dirty).toBe(false);

      local.close();
      peer.close();
    });

    it('subscribes once per room at join time', async () => {
      const client = await open('subscriber');
      await join(client, 'subscriber-room');
      const calls = subscribeToRoom.mock.calls.filter(entry => entry[0] === 'subscriber-room');
      expect(calls).toHaveLength(1);
      client.close();
    });
  });

  // Last, and deliberately: this closes the process's sockets for the rest of
  // the file, so anything after it would fail to connect rather than fail on
  // its own assertion.
  describe('shutdown', () => {
    it('drops every lease and every index before the process exits', async () => {
      // Ordering matters and is only observable here: releasing the lease
      // before the final save pass would let a peer take the room and reload it
      // from Postgres while this process still held unsaved edits.
      const client = await open('shutdown-owner');
      await join(client, 'shutdown-room');
      expect(ownership.ownsRoom('shutdown-room')).toBe(true);

      await stopForTests?.();

      expect(ownership.ownsRoom('shutdown-room')).toBe(false);
      expect(vi.mocked(redisModule.releaseRoomLease)).toHaveBeenCalledWith(
        'dripl:room-owner:shutdown-room',
        expect.any(String)
      );
      expect(roomState.rooms.size).toBe(0);
      expect(roomState.wsToRoomMap.size).toBe(0);
      expect(roomState.userToRoomMap.size).toBe(0);
      expect(roomState.saveTimeouts.size).toBe(0);
    });
  });
});
