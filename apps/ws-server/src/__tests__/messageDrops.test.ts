/**
 * The per-message drop paths in the dispatch prologue, exercised over a real
 * socket where possible and directly where not.
 *
 * Each of these drops a message *silently* or answers with a specific code, and
 * each exists because the alternative is worse:
 *
 *  - an oversized frame is refused by `ws` at the transport layer, and by
 *    `validateMessageSize` at the application layer. The first is what a peer
 *    actually hits; the second is what bounds a *compressed* frame that inflates
 *    past the limit after decompression.
 *  - `revalidateRoomAccess` returning true is the path every healthy connection
 *    takes on every throttled re-check, and it is the branch that keeps the
 *    steady state open.
 *  - a pong handler is what stops the heartbeat from reaping a socket whose peer
 *    is answering perfectly well.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
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

const validateTicket = vi.fn(async (ticket: string) => ({ kind: 'user' as const, userId: ticket }));
vi.mock('../auth', async importOriginal => {
  const actual = await importOriginal<typeof import('../auth')>();
  return { ...actual, validateTicket };
});

type Message = Record<string, unknown>;

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

describe('message drops and liveness', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RUN_WS_INTEGRATION', 'true');
    vi.stubEnv('DATABASE_URL', 'postgres://test:test@127.0.0.1:5432/test');
    vi.stubEnv('INTERNAL_SECRET', 'ws-drops-internal');
    vi.stubEnv('HTTP_SERVER_URL', 'http://127.0.0.1:3999');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('WS_PORT', '0');
    vi.stubEnv('PORT', '0');
    // Tiny, so the very next mutation pays for a fresh authorization read.
    vi.stubEnv('ACCESS_RECHECK_THROTTLE_MS', '1');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
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

  describe('the application-level size bound', () => {
    it('refuses a payload the transport let through', async () => {
      // `ws` is configured with `maxPayload: MAX_MESSAGE_BYTES`, so a peer
      // normally cannot get past it with a plain frame. The application check
      // exists for the case the transport cannot see: a frame whose *stored*
      // length is at the limit but whose text, once decoded, is not — and as a
      // second line of defence for a future `maxPayload` change. The refusal is
      // an explicit error, not a silent drop, so a client sending a legitimate
      // large-but-legal payload learns why.
      //
      // What is reachable here is `validateMessageSize` itself, so this asserts
      // the boundary exactly: one byte over is refused, exactly at the limit is
      // accepted. The error names the limit the client hit.
      const { validateMessageSize } = await import('../validation');
      expect(validateMessageSize('x'.repeat(MAX_MESSAGE_BYTES)).valid).toBe(true);
      const refused = validateMessageSize('x'.repeat(MAX_MESSAGE_BYTES + 1));
      expect(refused.valid).toBe(false);
      expect(refused.error).toBe(
        `Message too large (${MAX_MESSAGE_BYTES + 1} bytes, max ${MAX_MESSAGE_BYTES})`
      );
      // And a realistic legal payload is accepted, so the bound is on size and
      // not on content.
      expect(validateMessageSize(JSON.stringify({ type: 'ping' })).valid).toBe(true);
    });
  });

  describe('the allowed re-check', () => {
    it('keeps a healthy editor connected across repeated revalidations', async () => {
      // The `return true` arm of `revalidateRoomAccess`. Every healthy
      // connection takes it on every throttled re-check, and it is the branch
      // whose regression is silent: a `false` here would close every editor in
      // the deployment every throttle window, and only after the room had
      // already been entered.
      const client = await open('recheck-ok');
      const sync = waitFor(client, message => message.type === 'sync_room_state');
      client.send(JSON.stringify({ type: 'join', roomId: 'recheck-room', displayName: 'A' }));
      await sync;
      let closed: number | undefined;
      client.on('close', code => {
        closed = code;
      });

      dbMock.file.findFirst.mockClear();
      for (let i = 0; i < 4; i++) {
        // Past the throttle, so each mutation re-reads the database.
        await new Promise(resolve => setTimeout(resolve, 5));
        const pong = waitFor(client, message => message.type === 'pong');
        client.send(
          JSON.stringify({
            type: 'add_element',
            element: {
              id: `recheck-${i}`,
              type: 'rectangle',
              x: i,
              y: 0,
              width: 10,
              height: 10,
              version: 1,
              versionNonce: 1,
            },
          })
        );
        client.send(JSON.stringify({ type: 'ping' }));
        await pong;
      }

      // Every mutation landed and the connection was never closed.
      expect(roomState.rooms.get('recheck-room')?.elements.size).toBe(4);
      expect(closed).toBeUndefined();
      expect(client.readyState).toBe(WebSocket.OPEN);
      // And each one really did re-read: this is the arm under test, not the
      // throttled one.
      expect(dbMock.file.findFirst.mock.calls.length).toBeGreaterThanOrEqual(4);

      client.close();
    });
  });

  describe('liveness', () => {
    it('recovers a socket that answers the heartbeat ping', async () => {
      // The pong listener is what keeps a live connection out of the heartbeat's
      // reap path, and the reap is a `terminate()` — every unsaved edit in that
      // room lost with it. The ping is a real one from `runHeartbeatTick` and the
      // pong is a real one from the client, because the regression that matters
      // is "the listener is gone and nothing notices until the next reap".
      //
      // Driving the tick directly rather than waiting 30s is deliberate: the tick
      // body is the unit under test in `lifecycle.test.ts`, and what is untested
      // is that this socket's pong reaches *this* user record.
      const client = await open('liveness');
      const sync = waitFor(client, message => message.type === 'sync_room_state');
      client.send(JSON.stringify({ type: 'join', roomId: 'liveness-room', displayName: 'A' }));
      await sync;

      const { runHeartbeatTick } = await import('../lifecycle');
      const { wss } = await import('../index');
      const room = roomState.rooms.get('liveness-room');
      if (!room) throw new Error('room missing');
      const user = room.users.get('liveness');
      if (!user) throw new Error('user not registered');

      // One tick: the socket is alive, so it is marked dead and pinged.
      runHeartbeatTick(wss.clients);
      expect(user.isAlive).toBe(false);
      expect(room.users.get('liveness')).toBe(user);
      expect(client.readyState).toBe(WebSocket.OPEN);

      // The client answers automatically. The pong handler is what flips the
      // flag back, and it reads the connection off the socket, so it only works
      // if the registration and the listener are for the same socket.
      await vi.waitFor(() => {
        expect(user.isAlive).toBe(true);
      });

      // A second tick must therefore also mark-and-ping rather than reap. If the
      // pong listener had been removed, this is the tick that would terminate
      // the connection and discard the room.
      runHeartbeatTick(wss.clients);
      expect(user.isAlive).toBe(false);
      await vi.waitFor(() => {
        expect(user.isAlive).toBe(true);
      });
      expect(client.readyState).toBe(WebSocket.OPEN);
      expect(room.users.get('liveness')).toBe(user);

      client.close();
    });
  });
});
