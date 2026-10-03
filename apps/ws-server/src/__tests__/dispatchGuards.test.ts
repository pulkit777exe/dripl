/**
 * Dispatch-prologue and socket guards in `index.ts` — the code between a frame
 * arriving and a handler running.
 *
 * These are the checks that keep one peer's frame from doing damage to the
 * authoritative room: the origin check on the upgrade, the size bound, the
 * binary refusal, the schema gate, the per-connection queue bound, and the
 * "one room per socket" rule. None of them is reachable by asserting on the
 * success path, and every one of them failing open is a data problem rather
 * than a UX one.
 *
 * Redis is mocked out entirely (`isRedisAvailable: false`), which is the
 * documented single-instance deployment: ownership disabled, no fan-out, no
 * network. Ownership and the fan-out path are proved separately in
 * `roomOwnershipQuiesce.test.ts`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { validateMessageSize } from '../validation';
import { MAX_MESSAGE_BYTES } from '@dripl/common';

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

// Typed to return the *user* principal because that is what almost every case
// needs; the share cases below widen it, and the module under test accepts both,
// so the widening is a property of the mock's return type, not of the code.
type MockedPrincipal =
  | { kind: 'user'; userId: string }
  | { kind: 'share'; fileId: string; token: string; permission: 'view' | 'edit' }
  | null;
const validateTicket = vi.fn(async (ticket: string): Promise<{ kind: 'user'; userId: string }> => ({
  kind: 'user',
  userId: ticket,
}));
vi.mock('../auth', async importOriginal => {
  const actual = await importOriginal<typeof import('../auth')>();
  return { ...actual, validateTicket };
});

type Message = Record<string, unknown>;

let server: import('node:http').Server;
let stopForTests: () => Promise<void>;
let port: number;
let roomState: typeof import('../rooms');

function open(port: number, ticket: string, origin = 'http://localhost:3000'): Promise<WebSocket> {
  const client = new WebSocket(`ws://127.0.0.1:${port}/?ticket=${ticket}`, {
    headers: { Origin: origin },
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

function waitForClose(client: WebSocket, timeoutMs = 5_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for close')), timeoutMs);
    client.once('close', code => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

/** Every message the socket ever received, for "nothing was sent" assertions. */
function recordMessages(client: WebSocket): Message[] {
  const seen: Message[] = [];
  client.on('message', raw => {
    try {
      seen.push(JSON.parse(raw.toString()) as Message);
    } catch {
      // non-JSON frame: nothing this suite asserts on
    }
  });
  return seen;
}

async function join(client: WebSocket, roomId: string, displayName = 'A'): Promise<Message> {
  const sync = waitFor(client, message => message.type === 'sync_room_state');
  client.send(JSON.stringify({ type: 'join', roomId, displayName, color: '#123456' }));
  return sync;
}

const rect = (id: string) => ({
  id,
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  version: 1,
  versionNonce: 1,
});

describe('dispatch prologue', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RUN_WS_INTEGRATION', 'true');
    vi.stubEnv('DATABASE_URL', 'postgres://test:test@127.0.0.1:5432/test');
    vi.stubEnv('INTERNAL_SECRET', 'ws-guards-internal');
    vi.stubEnv('HTTP_SERVER_URL', 'http://127.0.0.1:3999');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('WS_PORT', '0');
    vi.stubEnv('PORT', '0');
    // Blank the Upstash pair *before* the import: `env.ts` runs dotenv over the
    // repo `.env`, which carries real credentials, and `rateLimiter` would then
    // build a live network limiter on the hottest path.
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

  beforeEach(() => {
    dbMock.file.findFirst.mockClear();
  });

  describe('HTTP surface', () => {
    // `/live` and `/health` are not interchangeable here, and the difference is
    // data loss rather than latency: this process is the authoritative writer
    // for every live room, so a restart discards all of them. See the routes in
    // `index.ts` and `render.yaml`.

    it('answers readiness 503 — not 200 — when Postgres is unreachable', async () => {
      dbMock.$queryRaw.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      // A 200 here would route traffic to an instance that cannot persist, and
      // a supervisor polling readiness would never notice the database is gone.
      expect(response.status).toBe(503);
      expect((await response.json()) as Message).toMatchObject({ status: 'error' });
    });

    it('answers readiness 200 once the database answers', async () => {
      dbMock.$queryRaw.mockResolvedValueOnce([{ ok: 1 }]);
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      expect(response.status).toBe(200);
      expect((await response.json()) as Message).toMatchObject({ status: 'ok' });
    });

    it('reports room, connection, and user counts on /metrics', async () => {
      const client = await open(port, 'metrics-user');
      await join(client, 'metrics-room');

      const metrics = (await (await fetch(`http://127.0.0.1:${port}/metrics`)).json()) as Message;
      // The two-instance proof reads `activeRooms` off /metrics to assert a
      // refused join created no RoomState, so this number is a load-bearing
      // diagnostic, not decoration.
      expect(metrics.activeRooms).toBeGreaterThanOrEqual(1);
      expect(metrics.activeConnections).toBeGreaterThanOrEqual(1);
      expect(metrics.totalUsers).toBeGreaterThanOrEqual(1);
      expect(typeof metrics.uptime).toBe('number');

      client.close();
    });

    it('404s every other path', async () => {
      const response = await fetch(`http://127.0.0.1:${port}/nope`);
      expect(response.status).toBe(404);
    });
  });

  describe('upgrade origin check', () => {
    it('refuses an upgrade with no Origin header', async () => {
      // The origin check is the only thing standing between a public
      // WebSocket endpoint and a cross-site connection: a browser attaches
      // Origin to every WS handshake and cannot be talked out of it.
      const client = new WebSocket(`ws://127.0.0.1:${port}/?ticket=guards-origin`);
      const error = await once(client, 'error');
      expect((error[0] as Error).message).toContain('403');
    });

    it('refuses an upgrade from an origin that is not the frontend', async () => {
      const [error] = await once(
        new WebSocket(`ws://127.0.0.1:${port}/?ticket=guards-origin`, {
          headers: { Origin: 'http://evil.example' },
        }),
        'error'
      );
      expect((error as Error).message).toContain('403');
    });
  });

  describe('per-frame guards', () => {
    it('refuses a binary frame and leaves the connection usable', async () => {
      // Binary was the disabled Yjs transport. Sniffing a discriminator for a
      // protocol that no longer exists is worse than refusing: an accepted
      // binary frame has no parse, no fence, and no relay.
      const client = await open(port, 'binary-guard');
      const seen = recordMessages(client);
      await join(client, 'binary-room');

      const error = waitFor(client, message => message.type === 'error');
      client.send(Buffer.from(JSON.stringify({ type: 'ping' })), { binary: true });
      expect((await error).message).toMatch(/binary/i);

      // The socket is not poisoned by the refusal.
      const pong = waitFor(client, message => message.type === 'pong');
      client.send(JSON.stringify({ type: 'ping' }));
      await expect(pong).resolves.toBeDefined();
      expect(seen.some(message => message.type === 'sync_room_state')).toBe(true);

      client.close();
    });

    it('drops a frame that is not JSON without closing the socket', async () => {
      // A single bad frame must cost the frame, not the connection and every
      // in-memory RoomState behind it.
      const client = await open(port, 'garbage-guard');
      await join(client, 'garbage-room');

      client.send('this is not json');

      const pong = waitFor(client, message => message.type === 'pong');
      client.send(JSON.stringify({ type: 'ping' }));
      await expect(pong).resolves.toBeDefined();
      expect(client.readyState).toBe(WebSocket.OPEN);

      client.close();
    });

    it('drops a well-formed message the schema does not accept', async () => {
      // The schema is the only gate in front of every handler, and its element
      // bounds are what stop a client from writing an element the renderer
      // cannot draw (non-finite coordinates, unbounded zoom).
      const client = await open(port, 'schema-guard');
      const peer = await open(port, 'schema-guard-peer');
      await join(client, 'schema-room');
      await join(peer, 'schema-room');

      const relayedOnPeer = waitFor(peer, message => message.type === 'scene-delta');
      client.send(
        JSON.stringify({
          type: 'add_element',
          // A non-finite coordinate survives JSON only as null, which the
          // element schema rejects: an element the renderer cannot draw.
          element: { id: 'nan', type: 'rectangle', x: null, y: 0, width: 10, height: 10 },
        })
      );
      client.send(JSON.stringify({ type: 'scene-delta', added: [{ id: 'nan', type: 'nope' }] }));
      client.send(JSON.stringify({ type: 'element-update', element: { id: 'x' } }));
      client.send(JSON.stringify({ type: 'no-such-message' }));
      client.send(JSON.stringify({ type: 'viewport-update', panX: 0, panY: 0, zoom: 0 }));

      // Nothing relayed, and the peer is still there to have received it.
      await expect(relayedOnPeer).rejects.toThrow(/timed out/);
      expect(roomState.rooms.get('schema-room')?.elements.has('nan')).toBe(false);
      const pong = waitFor(peer, message => message.type === 'pong');
      peer.send(JSON.stringify({ type: 'ping' }));
      await expect(pong).resolves.toBeDefined();

      client.close();
      peer.close();
    });

    it('answers ping before any join, and after leaving', async () => {
      // Keepalive must not be gated on room membership: a client that was
      // denied access, or that has just left, still needs to prove liveness or
      // it is reaped by the heartbeat.
      const client = await open(port, 'ping-guard');
      const first = waitFor(client, message => message.type === 'pong');
      client.send(JSON.stringify({ type: 'ping' }));
      await expect(first).resolves.toBeDefined();

      await join(client, 'ping-guard-room');
      client.send(JSON.stringify({ type: 'leave' }));
      await new Promise(resolve => setTimeout(resolve, 50));

      const second = waitFor(client, message => message.type === 'pong');
      client.send(JSON.stringify({ type: 'ping' }));
      await expect(second).resolves.toBeDefined();

      client.close();
    });
  });

  describe('one room per socket', () => {
    it('refuses a join to a second room and keeps applying to the first', async () => {
      // The invariant: `wsToRoomMap` holds exactly one room per socket while a
      // connection can be a user of several. Letting the second join through
      // would apply a mutation to whichever room the map last named — another
      // room's authoritative scene, with this client's edit in it.
      const client = await open(port, 'switch-a');
      const peer = await open(port, 'switch-b');
      await join(client, 'switch-first');
      await join(peer, 'switch-first');

      const refusal = waitFor(client, message => message.type === 'error');
      client.send(JSON.stringify({ type: 'join', roomId: 'switch-second', displayName: 'A' }));
      expect((await refusal).message).toMatch(/leave the current room/i);

      // Still in the first room: the mutation lands there and is relayed.
      const relayed = waitFor(peer, message => message.type === 'scene-delta');
      client.send(JSON.stringify({ type: 'add_element', element: rect('switch-1') }));
      await expect(relayed).resolves.toBeDefined();
      expect(roomState.rooms.get('switch-first')?.elements.has('switch-1')).toBe(true);
      expect(roomState.rooms.has('switch-second')).toBe(false);

      client.close();
      peer.close();
    });

    it('answers a re-join to the same room with silence and no second registration', async () => {
      // A client whose reconnect raced (or whose tab retried) must not get a
      // second `sync_room_state`: that would reset a client's scene to a
      // snapshot taken mid-edit and discard its optimistic local state. The
      // documented answer is "ignore it" — one registration, one sync.
      const client = await open(port, 'rejoin');
      // Record before the first join: the assertion is about the *total* number
      // of syncs on this socket, so the recorder has to see the first one.
      const seen = recordMessages(client);
      const first = await join(client, 'rejoin-room');

      const secondSync = waitFor(client, message => message.type === 'sync_room_state', 400);
      client.send(JSON.stringify({ type: 'join', roomId: 'rejoin-room', displayName: 'A' }));
      await expect(secondSync).rejects.toThrow(/timed out/);

      expect(seen.filter(message => message.type === 'sync_room_state')).toHaveLength(1);
      expect(first.yourUserId).toBe('rejoin');
      expect(roomState.rooms.get('rejoin-room')?.users.size).toBe(1);

      client.close();
    });

    it('closes a second live socket for the same account in one room', async () => {
      // Two sockets, one user id, one room: the second registration would
      // displace the first from `room.users`, and the first socket's close
      // handler would then find it no longer owns the registration and skip
      // its cleanup — leaving the room with a ghost user and no tombstone-free
      // delete path.
      const first = await open(port, 'dup-account');
      await join(first, 'dup-room');
      const second = await open(port, 'dup-account');

      const closed = waitForClose(second);
      const refusal = waitFor(second, message => message.type === 'error');
      second.send(JSON.stringify({ type: 'join', roomId: 'dup-room', displayName: 'A' }));
      expect((await refusal).message).toMatch(/already connected/i);
      expect(await closed).toBe(4009);

      // The first socket's registration is untouched.
      expect(roomState.rooms.get('dup-room')?.users.size).toBe(1);
      const pong = waitFor(first, message => message.type === 'pong');
      first.send(JSON.stringify({ type: 'ping' }));
      await expect(pong).resolves.toBeDefined();

      first.close();
    });
  });

  describe('after leaving', () => {
    it('ignores mutations from a socket that left its room', async () => {
      const client = await open(port, 'leave-guard');
      const peer = await open(port, 'leave-guard-peer');
      await join(client, 'leave-room');
      await join(peer, 'leave-room');

      const left = waitFor(peer, message => message.type === 'user-leave');
      client.send(JSON.stringify({ type: 'leave' }));
      await expect(left).resolves.toBeDefined();

      const relayedOnPeer = waitFor(peer, message => message.type === 'scene-delta');
      client.send(JSON.stringify({ type: 'add_element', element: rect('after-leave') }));
      client.send(JSON.stringify({ type: 'delete_element', elementId: 'whatever' }));
      // Not relayed...
      await expect(relayedOnPeer).rejects.toThrow(/timed out/);
      // ...and not admitted. A post-leave write would resurrect an element into
      // a room this socket no longer belongs to.
      expect(roomState.rooms.get('leave-room')?.elements.has('after-leave')).toBe(false);
      expect(roomState.userToRoomMap.has('leave-guard')).toBe(false);

      client.close();
      peer.close();
    });

    it('lets the socket join another room after leaving', async () => {
      const client = await open(port, 'rejoin-after-leave');
      await join(client, 'leave-first');
      client.send(JSON.stringify({ type: 'leave' }));
      await new Promise(resolve => setTimeout(resolve, 50));

      const second = await join(client, 'leave-second');
      expect(second.roomId).toBe('leave-second');
      expect(roomState.rooms.get('leave-first')?.users.size).toBe(0);
      expect(roomState.rooms.get('leave-second')?.users.size).toBe(1);

      client.close();
    });
  });

  describe('access decisions', () => {
    it('closes a denied join with 4003 and creates no room', async () => {
      // No room, no scene, no tombstone map for a principal that was refused:
      // the refusal has to happen before the access result is believed.
      dbMock.file.findFirst.mockResolvedValueOnce(null);
      dbMock.canvasRoom.findUnique.mockResolvedValueOnce(null);
      const client = await open(port, 'denied-guard');
      const closed = waitForClose(client);
      client.send(JSON.stringify({ type: 'join', roomId: 'denied-room', displayName: 'A' }));
      expect(await closed).toBe(4003);
      expect(roomState.rooms.has('denied-room')).toBe(false);
    });

    it('treats a share principal as scoped to its own file', async () => {
      // A share token must not open a room that is not the file it was minted
      // for. `authorizeShareRoomAccess` compares the ids, so a mismatched join
      // is denied at the same 4003 as any other unauthorized room.
      (
        validateTicket as unknown as { mockResolvedValueOnce: (v: MockedPrincipal) => void }
      ).mockResolvedValueOnce({
        kind: 'share',
        fileId: 'share-file',
        token: 'tok',
        permission: 'edit',
      });
      const client = await open(port, 'share-principal');
      const closed = waitForClose(client);
      client.send(JSON.stringify({ type: 'join', roomId: 'some-other-file', displayName: 'A' }));
      expect(await closed).toBe(4003);
      expect(roomState.rooms.has('some-other-file')).toBe(false);
    });

    it('serves a view-only share principal but refuses its mutations', async () => {
      // Both halves of the share contract. A read-only principal that could
      // mutate would be the authz boundary failing open.
      dbMock.file.findFirst.mockResolvedValueOnce({
        userId: 'owner',
        teamId: null,
        sharedWith: [],
        team: null,
        shareToken: 'tok',
        sharePermission: 'view',
        shareExpiresAt: null,
      });
      (
        validateTicket as unknown as { mockResolvedValueOnce: (v: MockedPrincipal) => void }
      ).mockResolvedValueOnce({
        kind: 'share',
        fileId: 'view-file',
        token: 'tok',
        permission: 'view',
      });
      const client = await open(port, 'view-principal');
      const sync = waitFor(client, message => message.type === 'sync_room_state');
      client.send(JSON.stringify({ type: 'join', roomId: 'view-file', displayName: 'A' }));
      expect((await sync).readOnly).toBe(true);

      const refusal = waitFor(client, message => message.type === 'error');
      client.send(JSON.stringify({ type: 'add_element', element: rect('viewer-write') }));
      expect((await refusal).message).toMatch(/view-only/i);
      expect(roomState.rooms.get('view-file')?.elements.has('viewer-write')).toBe(false);

      client.close();
    });

    it('refuses a share whose stored permission no longer matches the token', async () => {
      // The share was revoked or downgraded server-side; the principal still
      // carries the old `permission`, and the check is on both sides of the
      // comparison.
      dbMock.file.findFirst.mockResolvedValueOnce({
        userId: 'owner',
        teamId: null,
        sharedWith: [],
        team: null,
        shareToken: 'tok',
        sharePermission: 'edit',
        shareExpiresAt: null,
      });
      (
        validateTicket as unknown as { mockResolvedValueOnce: (v: MockedPrincipal) => void }
      ).mockResolvedValueOnce({
        kind: 'share',
        fileId: 'escalated-file',
        token: 'tok',
        permission: 'view',
      });
      const client = await open(port, 'escalated-principal');
      const closed = waitForClose(client);
      client.send(JSON.stringify({ type: 'join', roomId: 'escalated-file', displayName: 'A' }));
      expect(await closed).toBe(4003);
    });

    it('refuses an expired share', async () => {
      dbMock.file.findFirst.mockResolvedValueOnce({
        userId: 'owner',
        teamId: null,
        sharedWith: [],
        team: null,
        shareToken: 'tok',
        sharePermission: 'edit',
        shareExpiresAt: new Date(Date.now() - 60_000),
      });
      (
        validateTicket as unknown as { mockResolvedValueOnce: (v: MockedPrincipal) => void }
      ).mockResolvedValueOnce({
        kind: 'share',
        fileId: 'expired-file',
        token: 'tok',
        permission: 'edit',
      });
      const client = await open(port, 'expired-principal');
      const closed = waitForClose(client);
      client.send(JSON.stringify({ type: 'join', roomId: 'expired-file', displayName: 'A' }));
      expect(await closed).toBe(4003);
    });

    it('refuses a share whose token was rotated', async () => {
      // Rotating a share token must invalidate outstanding principals. Matching
      // on `fileId` alone would let the old token keep working forever.
      dbMock.file.findFirst.mockResolvedValueOnce({
        userId: 'owner',
        teamId: null,
        sharedWith: [],
        team: null,
        // The row still carries the *new* token; the principal presents the old
        // one, so only an actual comparison can refuse this.
        shareToken: 'rotated-token',
        sharePermission: 'edit',
        shareExpiresAt: null,
      });
      (
        validateTicket as unknown as { mockResolvedValueOnce: (v: MockedPrincipal) => void }
      ).mockResolvedValueOnce({
        kind: 'share',
        fileId: 'rotated-file',
        token: 'stale-token',
        permission: 'edit',
      });
      const client = await open(port, 'rotated-principal');
      const closed = waitForClose(client);
      client.send(JSON.stringify({ type: 'join', roomId: 'rotated-file', displayName: 'A' }));
      expect(await closed).toBe(4003);
    });
  });

  describe('message size bound', () => {
    it('names the byte limit it enforces', () => {
      // `ws` also caps `maxPayload` at the same constant, so the
      // application-level check is a second line of defence rather than the
      // only one. Pinned because the constant and the message must agree: a
      // client that reads the error has to be told the same bound it hit.
      expect(validateMessageSize(JSON.stringify({ type: 'ping' })).valid).toBe(true);
      const oversized = validateMessageSize('x'.repeat(MAX_MESSAGE_BYTES + 1));
      expect(oversized.valid).toBe(false);
      expect(oversized.error).toContain(String(MAX_MESSAGE_BYTES));
    });
  });
});
