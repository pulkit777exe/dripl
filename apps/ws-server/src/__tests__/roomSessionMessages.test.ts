/**
 * The room-scoped messages the socket suite never sent, and the guards that
 * apply to messages sent before a room exists.
 *
 * Two distinct properties:
 *
 *   1. Messages with no room are dropped, not applied against some other room.
 *      `currentRoomId` is the only thing that scopes a mutation, and every
 *      handler in the switch re-checks it; a handler that forgot would write a
 *      stranger's element into an arbitrary room's authoritative scene.
 *   2. Element locks and follow state are room-wide in this design (ADR-002),
 *      so the dispatch of `element-lock`, `element-unlock`,
 *      `element-lock-heartbeat`, `viewport-update`, `follow-user`, and
 *      `unfollow-user` is protocol surface, not plumbing.
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

let server: import('node:http').Server;
let stopForTests: () => Promise<void>;
let port: number;
let roomState: typeof import('../rooms');

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

describe('room-scoped messages', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RUN_WS_INTEGRATION', 'true');
    vi.stubEnv('DATABASE_URL', 'postgres://test:test@127.0.0.1:5432/test');
    vi.stubEnv('INTERNAL_SECRET', 'ws-session-internal');
    vi.stubEnv('HTTP_SERVER_URL', 'http://127.0.0.1:3999');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('WS_PORT', '0');
    vi.stubEnv('PORT', '0');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.resetModules();

    const module = await import('../index');
    server = module.server;
    stopForTests = module.stopForTests;
    roomState = await import('../rooms');
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

  describe('before any room is joined', () => {
    // A mutation sent on an authenticated socket that has not joined must be
    // dropped. `rooms.size` is the strongest form of that assertion: a handler
    // that forgot its `currentRoomId` guard would have to invent a room to write
    // into, and an invented room is an authoritative copy of a room nobody here
    // owns.
    const mutations = [
      { type: 'add_element', element: rect('no-room-add') },
      { type: 'update_element', element: rect('no-room-add', 2) },
      { type: 'delete_element', elementId: 'no-room-del' },
      { type: 'scene-update', subtype: 'update', elements: [rect('no-room-scene')] },
      { type: 'scene-delta', added: [rect('no-room-delta')] },
      { type: 'element-update', element: rect('no-room-eu') },
      { type: 'element-lock', elementId: 'no-room-lock' },
      { type: 'element-unlock', elementId: 'no-room-lock' },
      { type: 'element-lock-heartbeat', elementId: 'no-room-lock' },
    ];

    it('applies nothing and creates no room for any mutation sent before a join', async () => {
      const client = await open('no-room-user');
      const seen: Message[] = [];
      client.on('message', raw => {
        seen.push(JSON.parse(raw.toString()) as Message);
      });

      for (const message of mutations) client.send(JSON.stringify(message));

      await new Promise(resolve => setTimeout(resolve, 300));
      expect(roomState.rooms.size).toBe(0);
      expect(roomState.userToRoomMap.size).toBe(0);
      expect(client.readyState).toBe(WebSocket.OPEN);

      // Each one is answered with the *read-only* error rather than silence.
      // Pinned because it is wrong in a way that matters to a client: a
      // reconnecting tab that optimistically replays a queued mutation before
      // its `join` is answered is told it has lost write access, which reads as
      // a revoked share rather than as a message sent too early. See the task
      // report — `refreshRoomAccess` reaches its `canEdit` branch with
      // `currentRoomAccess` still at its initial `{allowed: false}` because
      // `revalidateRoomAccess` short-circuits on `!currentRoomId`.
      expect(seen).toHaveLength(mutations.length);
      for (const message of seen) {
        expect(message).toEqual({
          type: 'error',
          message: 'You have view-only access to this room',
        });
      }

      client.close();
    });

    it('answers the room-scoped non-mutations with complete silence', async () => {
      // Cursors, viewports, follow state, and leave are not gated by the
      // read-only check, so they take the `!currentRoomId` early return with no
      // reply at all. A reply here would be noise the client has to interpret.
      const client = await open('no-room-quiet');
      const seen: Message[] = [];
      client.on('message', raw => {
        seen.push(JSON.parse(raw.toString()) as Message);
      });

      for (const message of [
        { type: 'cursor_move', x: 1, y: 2 },
        { type: 'cursor-move', x: 1, y: 2 },
        { type: 'viewport-update', panX: 0, panY: 0, zoom: 1 },
        { type: 'follow-user', targetUserId: 'someone' },
        { type: 'unfollow-user' },
        { type: 'leave' },
        { type: 'leave_room' },
      ]) {
        client.send(JSON.stringify(message));
      }

      await new Promise(resolve => setTimeout(resolve, 300));
      expect(seen).toEqual([]);
      expect(roomState.rooms.size).toBe(0);

      client.close();
    });
  });

  describe('element locks', () => {
    it('takes, refreshes, and releases a lock for the room', async () => {
      const owner = await open('lock-owner');
      const peer = await open('lock-peer');
      await join(owner, 'lock-room');
      await join(peer, 'lock-room');

      const taken = waitFor(peer, message => message.type === 'element-lock');
      owner.send(JSON.stringify({ type: 'element-lock', elementId: 'el-1' }));
      expect((await taken).elementId).toBe('el-1');

      // The heartbeat deliberately broadcasts nothing: it is a liveness ping on
      // a lock the peers were already told about. Refresh and unlock are relayed.
      // The stored timestamp is rewound first so the assertion is on the
      // dispatch happening, not on two `Date.now()` calls landing in different
      // milliseconds.
      const room = roomState.rooms.get('lock-room');
      if (!room) throw new Error('room missing');
      const held = room.elementLocks.get('el-1');
      if (!held) throw new Error('lock was never taken');
      held.lastHeartbeat = 1;
      owner.send(JSON.stringify({ type: 'element-lock-heartbeat', elementId: 'el-1' }));
      await vi.waitFor(() => {
        expect(room.elementLocks.get('el-1')?.lastHeartbeat).toBeGreaterThan(1);
      });

      const released = waitFor(peer, message => message.type === 'element-unlock');
      owner.send(JSON.stringify({ type: 'element-unlock', elementId: 'el-1' }));
      expect((await released).elementId).toBe('el-1');
      expect(room.elementLocks.size).toBe(0);

      owner.close();
      peer.close();
    });

    it('refuses a lock another user already holds and tells the loser', async () => {
      const first = await open('lock-first');
      const second = await open('lock-second');
      await join(first, 'lock-contested');
      await join(second, 'lock-contested');

      first.send(JSON.stringify({ type: 'element-lock', elementId: 'shared-el' }));
      await new Promise(resolve => setTimeout(resolve, 100));

      const refusal = waitFor(second, message => message.type === 'error');
      second.send(JSON.stringify({ type: 'element-lock', elementId: 'shared-el' }));
      await expect(refusal).resolves.toBeDefined();
      expect(roomState.rooms.get('lock-contested')?.elementLocks.get('shared-el')?.userId).toBe(
        'lock-first'
      );

      first.close();
      second.close();
    });

    it('does not release a lock held by someone else', async () => {
      const first = await open('unlock-first');
      const second = await open('unlock-second');
      await join(first, 'unlock-room');
      await join(second, 'unlock-room');

      first.send(JSON.stringify({ type: 'element-lock', elementId: 'held' }));
      await new Promise(resolve => setTimeout(resolve, 100));
      second.send(JSON.stringify({ type: 'element-unlock', elementId: 'held' }));
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(roomState.rooms.get('unlock-room')?.elementLocks.get('held')?.userId).toBe(
        'unlock-first'
      );

      first.close();
      second.close();
    });
  });

  describe('viewport and follow', () => {
    it('records a viewport without relaying it to anyone', async () => {
      // Viewport state is per-user and used to drive "jump to where they are
      // looking"; it is not scene state and must not be persisted or broadcast.
      const owner = await open('viewport-user');
      const peer = await open('viewport-peer');
      await join(owner, 'viewport-room');
      await join(peer, 'viewport-room');
      const room = roomState.rooms.get('viewport-room');
      if (!room) throw new Error('room missing');

      owner.send(JSON.stringify({ type: 'viewport-update', panX: 12, panY: 34, zoom: 2 }));
      await vi.waitFor(() => {
        expect(room.viewports.get('viewport-user')).toEqual({ panX: 12, panY: 34, zoom: 2 });
      });
      expect(room.dirty).toBe(false);

      owner.close();
      peer.close();
    });

    it('records a follow and clears it on unfollow', async () => {
      const leader = await open('follow-leader');
      const follower = await open('follower-user');
      await join(leader, 'follow-room');
      await join(follower, 'follow-room');
      const room = roomState.rooms.get('follow-room');
      if (!room) throw new Error('room missing');

      follower.send(JSON.stringify({ type: 'follow-user', targetUserId: 'follow-leader' }));
      await vi.waitFor(() => {
        expect(room.following.get('follower-user')).toBe('follow-leader');
      });

      follower.send(JSON.stringify({ type: 'unfollow-user' }));
      await vi.waitFor(() => {
        expect(room.following.has('follower-user')).toBe(false);
      });

      leader.close();
      follower.close();
    });

    it('drops a follow when the leader disconnects', async () => {
      // Otherwise the follower keeps chasing a userId nobody holds, and every
      // viewport mirror resolves to a departed socket.
      const leader = await open('follow-exit-leader');
      const follower = await open('follow-exit-follower');
      await join(leader, 'follow-exit-room');
      await join(follower, 'follow-exit-room');
      const room = roomState.rooms.get('follow-exit-room');
      if (!room) throw new Error('room missing');

      follower.send(JSON.stringify({ type: 'follow-user', targetUserId: 'follow-exit-leader' }));
      await vi.waitFor(() => {
        expect(room.following.get('follow-exit-follower')).toBe('follow-exit-leader');
      });

      leader.close();
      await vi.waitFor(() => {
        expect(room.following.has('follow-exit-follower')).toBe(false);
      });

      follower.close();
    });
  });
});
