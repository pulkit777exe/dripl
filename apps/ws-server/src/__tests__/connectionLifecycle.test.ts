/**
 * The connection lifecycle: the frames that arrive before, during, and after
 * authentication, and the ones that arrive faster than the server can answer.
 *
 * Three DoS/robustness bounds live here and each has a specific failure if it
 * leaks:
 *
 *   - the early-message buffer, for frames a browser sends immediately after
 *     `open`, before the ticket round-trip finishes;
 *   - the serialized queue, which exists because a burst cannot be allowed to
 *     reorder a join, a delta, and a delete while a room is loading;
 *   - the rate limit, which is the only per-identity ceiling on the socket.
 *
 * `ACCESS_RECHECK_THROTTLE_MS` is pinned to a small value so the per-message
 * authorization re-check is reachable without a 30-second wait; that re-check is
 * the only thing standing between a revoked share and an edit, given that the
 * steady-state path trusts the join-time decision.
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
let roomAccess: typeof import('../roomAccess');

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

function waitForClose(client: WebSocket, timeoutMs = 5_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for close')), timeoutMs);
    client.once('close', code => {
      clearTimeout(timer);
      resolve(code);
    });
  });
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

describe('connection lifecycle', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RUN_WS_INTEGRATION', 'true');
    vi.stubEnv('DATABASE_URL', 'postgres://test:test@127.0.0.1:5432/test');
    vi.stubEnv('INTERNAL_SECRET', 'ws-lifecycle-internal');
    vi.stubEnv('HTTP_SERVER_URL', 'http://127.0.0.1:3999');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('WS_PORT', '0');
    vi.stubEnv('PORT', '0');
    // Small enough that the second mutation on a connection is re-checked
    // against the database; read at module load.
    vi.stubEnv('ACCESS_RECHECK_THROTTLE_MS', '1');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.resetModules();

    const module = await import('../index');
    server = module.server;
    stopForTests = module.stopForTests;
    roomState = await import('../rooms');
    roomAccess = await import('../roomAccess');
    if (!server.listening) await once(server, 'listening');
    port = (server.address() as AddressInfo).port;
  }, 30_000);

  afterAll(async () => {
    await stopForTests?.();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    validateTicket.mockImplementation(async (ticket: string) => ({
      kind: 'user' as const,
      userId: ticket,
    }));
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
    dbMock.canvasRoom.findUnique.mockResolvedValue(null);
  });

  describe('frames that arrive before authentication finishes', () => {
    // A browser sends its join in the same tick as `open`, so the ticket
    // round-trip has not returned yet. Dropping those frames means every
    // reconnect silently rejoins an empty room.

    it('replays the buffered join once the ticket validates', async () => {
      let release: (() => void) | undefined;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      validateTicket.mockImplementationOnce(async (ticket: string) => {
        await gate;
        return { kind: 'user' as const, userId: ticket };
      });

      const client = await open('early-join');
      // Sent while the ticket is still outstanding. The wait below lets the frame
      // actually *arrive* inside that window; releasing the gate in the same tick
      // would let it land on the post-authentication queue instead and the
      // replay path would never run.
      client.send(JSON.stringify({ type: 'join', roomId: 'early-room', displayName: 'A' }));
      await new Promise(resolve => setTimeout(resolve, 100));
      release?.();

      const sync = await waitFor(client, message => message.type === 'sync_room_state');
      expect(sync.roomId).toBe('early-room');
      expect(roomState.rooms.get('early-room')?.users.size).toBe(1);

      client.close();
    });

    it('closes the socket when the pre-authentication buffer overflows', async () => {
      let release: (() => void) | undefined;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      let authFinished = false;
      validateTicket.mockImplementationOnce(async (ticket: string) => {
        await gate;
        authFinished = true;
        return { kind: 'user' as const, userId: ticket };
      });

      const client = await open('early-flood');
      const roomsBefore = roomState.rooms.size;
      // The close reason is the same 4000 the post-authentication queue bound
      // uses, so the discriminator is *when* it happened: `authFinished` is
      // captured at close time and must still be false, which can only be true if
      // the socket was closed from the pre-authentication buffer.
      const closed = waitForClose(client).then(code => ({
        code,
        authFinishedAtClose: authFinished,
      }));
      // The bound is 100 frames. Without it, a client could park an unbounded
      // number of frames on an unauthenticated socket.
      for (let i = 0; i < 150; i++) client.send(JSON.stringify({ type: 'ping', n: i }));
      await new Promise(resolve => setTimeout(resolve, 150));
      release?.();

      const { code, authFinishedAtClose } = await closed;
      expect(code).toBe(4000);
      expect(authFinishedAtClose).toBe(false);
      // The 100 frames that did fit in the buffer are dropped, not applied.
      expect(roomState.rooms.size).toBe(roomsBefore);
    });

    it('discards buffered frames when the ticket is rejected', async () => {
      // The dangerous shape: a join was parked in the pre-authentication buffer
      // and then the ticket is refused. Replaying the buffer anyway would admit
      // an unauthenticated client to a room.
      let release: (() => void) | undefined;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      validateTicket.mockImplementation(async () => {
        await gate;
        // A rejected redemption has no principal; the mocked signature is the
        // principal-returning one, so the null is asserted at the call site.
        return null as unknown as { kind: 'user'; userId: string };
      });

      const client = await open('early-rejected');
      const closed = waitForClose(client);
      client.send(JSON.stringify({ type: 'join', roomId: 'never-room', displayName: 'A' }));
      await new Promise(resolve => setTimeout(resolve, 100));
      release?.();

      expect(await closed).toBe(4001);
      expect(roomState.rooms.has('never-room')).toBe(false);
    });

    it('closes a socket that arrives with no ticket at all', async () => {
      const client = new WebSocket(`ws://127.0.0.1:${port}/`, {
        headers: { Origin: 'http://localhost:3000' },
      });
      // There is no anonymous room-join path in this protocol; an unauthenticated
      // socket must never reach a handler.
      expect(await waitForClose(client)).toBe(4001);
    });
  });

  describe('the per-connection message queue', () => {
    it('closes the socket rather than queueing without bound', async () => {
      const client = await open('queue-flood');
      const closed = waitForClose(client);
      // 150 frames in one burst, past the 100-message queue bound. Sending them
      // back-to-back is the point: the queue only builds when the handler has
      // not caught up, which is exactly the overload case.
      for (let i = 0; i < 150; i++) {
        client.send(
          JSON.stringify({
            type: 'add_element',
            element: { ...rect(`q-${i}`), x: i },
          })
        );
      }
      expect(await closed).toBe(4000);
    });
  });

  describe('rate limiting', () => {
    it('closes the socket after the identity exhausts its window', async () => {
      const client = await open('rate-limited');
      const closed = waitForClose(client);
      // Exactly one past the 30-message window. The pongs are counted rather
      // than awaited so the whole burst lands inside a single 1s window, which
      // is what makes the count deterministic.
      let pongs = 0;
      client.on('message', raw => {
        if ((JSON.parse(raw.toString()) as { type?: string }).type === 'pong') pongs += 1;
      });
      for (let i = 0; i < 31; i++) client.send(JSON.stringify({ type: 'ping' }));

      expect(await closed).toBe(4000);
      expect(pongs).toBe(30);
    });
  });

  describe('revocation on the hot path', () => {
    it('closes an editor whose access was revoked between mutations', async () => {
      // The steady-state path trusts the join-time decision between
      // revalidations. `ACCESS_RECHECK_THROTTLE_MS` is pinned to 1ms above so
      // the *second* mutation pays for a fresh database read — this is the
      // moment a revoked share has to stop an edit, and the only one before the
      // 15s sweep.
      const client = await open('revoked-mid-session');
      const sync = waitFor(client, message => message.type === 'sync_room_state');
      client.send(JSON.stringify({ type: 'join', roomId: 'revoke-room', displayName: 'A' }));
      expect((await sync).readOnly).toBe(false);

      // Access disappears: no file, no room, no membership.
      dbMock.file.findFirst.mockResolvedValue(null);
      dbMock.canvasRoom.findUnique.mockResolvedValue(null);

      // The throttle is inclusive, so a mutation processed in the same
      // millisecond as the join skips the re-check by design. Waiting past it
      // keeps this about the re-check rather than about millisecond timing.
      await new Promise(resolve => setTimeout(resolve, 20));

      const closed = waitForClose(client);
      const revocation = waitFor(client, message => message.type === 'error');
      client.send(JSON.stringify({ type: 'add_element', element: rect('after-revoke') }));

      expect((await revocation).message).toMatch(/revoked/i);
      expect(await closed).toBe(4003);
      expect(roomState.rooms.get('revoke-room')?.elements.has('after-revoke')).toBe(false);
    });
  });

  describe('an internal failure while establishing a connection', () => {
    it('leaves the socket open and room-less rather than closing it', async () => {
      // Pinned as-is because the behaviour is not what `handleConnection`'s
      // comment claims. The throw happens inside `handleMessage`, which owns a
      // catch of its own, so it never reaches the `ws.close(1011, ...)` that
      // `handleConnection` documents for "connection setup failed". The socket
      // survives and can retry.
      //
      // That is a defensible outcome — the alternative would be a transport
      // error masquerading as an authorization decision — but the 1011 close is
      // unreachable dead code for every failure raised by message handling,
      // including exactly this one. See the task report.
      const client = await open('setup-failure');
      dbMock.file.findFirst.mockImplementation(() => {
        throw new Error('prisma exploded');
      });

      client.send(JSON.stringify({ type: 'join', roomId: 'setup-room', displayName: 'A' }));
      await new Promise(resolve => setTimeout(resolve, 400));

      expect(roomState.rooms.has('setup-room')).toBe(false);
      expect(client.readyState).toBe(WebSocket.OPEN);
      // Nothing was admitted and nothing was registered for a room. Scoped to
      // this connection's own identity: other sockets in the file may still be
      // registered while their close handlers drain.
      expect(roomState.userToRoomMap.has('setup-failure')).toBe(false);
      expect(roomState.wsToRoomMap.has(client)).toBe(false);

      // The connection still works: an internal fault is recoverable, and the
      // client can re-issue the join once the database is back.
      const pong = waitFor(client, message => message.type === 'pong');
      client.send(JSON.stringify({ type: 'ping' }));
      await expect(pong).resolves.toBeDefined();

      client.close();
    });
  });

  describe('the authorize module seam', () => {
    it('is what the join path consults, so a denial is visible there', async () => {
      // Proves the dispatch really routes through `authorizeRoomAccess` rather
      // than an inline copy: spying on the module and denying produces the
      // 4003. If the join path ever grew its own copy, this would stop firing.
      const spy = vi
        .spyOn(roomAccess, 'authorizeRoomAccess')
        .mockResolvedValue({ allowed: false, canEdit: false });
      const client = await open('seam-denied');
      const closed = waitForClose(client);
      client.send(JSON.stringify({ type: 'join', roomId: 'seam-room', displayName: 'A' }));
      expect(await closed).toBe(4003);
      expect(roomState.rooms.has('seam-room')).toBe(false);
      spy.mockRestore();
    });
  });
});
