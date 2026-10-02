import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';

/**
 * Socket-level proof for the ADR-002 ownership gate: a second instance must
 * not be able to serve a room another instance owns, and the refusal must
 * happen *before* the room is loaded — a non-owner that has already read the
 * scene has already taken on the responsibility it is being denied.
 */

const dbMock = {
  initializeDb: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
  $queryRaw: vi.fn(),
  file: {
    findFirst: vi.fn(),
    findUnique: vi.fn().mockResolvedValue(null),
    updateManyAndReturn: vi.fn(),
  },
  canvasRoom: {
    findUnique: vi.fn().mockResolvedValue(null),
    updateManyAndReturn: vi.fn(),
  },
};

vi.mock('@dripl/db', () => ({
  db: dbMock,
  initializeDb: dbMock.initializeDb,
}));

vi.mock('../auth', async importOriginal => {
  const actual = await importOriginal<typeof import('../auth')>();
  return {
    ...actual,
    validateTicket: vi.fn(async (ticket: string) => ({ kind: 'user' as const, userId: ticket })),
  };
});

const acquireRoomLease = vi.fn();
const isRedisAvailable = vi.fn(() => true);

vi.mock('../redis', () => ({
  acquireRoomLease,
  renewRoomLease: vi.fn(async () => 'renewed'),
  releaseRoomLease: vi.fn(async () => 'released'),
  isRedisAvailable,
  subscribeToRoom: vi.fn(),
  unsubscribeFromRoom: vi.fn(),
  publishToRoom: vi.fn(async () => undefined),
}));
function waitForMessage(
  client: WebSocket,
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs = 3_000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('message', onMessage);
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);
    const onMessage = (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (!predicate(message)) return;
      clearTimeout(timer);
      client.off('message', onMessage);
      resolve(message);
    };
    client.on('message', onMessage);
  });
}

function openClient(port: number, ticket: string): Promise<WebSocket> {
  const client = new WebSocket(`ws://127.0.0.1:${port}/?ticket=${ticket}`, {
    headers: { Origin: 'http://localhost:3000' },
  });
  return once(client, 'open').then(() => client);
}

describe('room ownership at the WebSocket boundary', () => {
  let server: import('node:http').Server;
  let stopForTests: () => Promise<void>;
  let rooms: Map<string, unknown>;
  let redis: typeof import('../redis');
  let port: number;

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RUN_WS_INTEGRATION', 'true');
    vi.stubEnv('DATABASE_URL', 'postgres://test:test@127.0.0.1:5432/test');
    vi.stubEnv('JWT_SECRET', 'ws-integration-secret');
    vi.stubEnv('INTERNAL_SECRET', 'ws-integration-internal-secret');
    vi.stubEnv('HTTP_SERVER_URL', 'http://127.0.0.1:3999');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('WS_PORT', '0');
    vi.stubEnv('PORT', '0');
    // Must be blanked *before* the import below: `env.ts` runs dotenv over the
    // repo `.env`, and that file carries real Upstash credentials. Without
    // this, `rateLimiter` builds a live Upstash limiter and every message waits
    // on the network. `config()` does not override already-set variables, so
    // the stub wins.
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.resetModules();

    const module = await import('../index');
    server = module.server;
    stopForTests = module.stopForTests;
    rooms = (await import('../rooms')).rooms;
    // Read the mock handles off the module the server actually imported, not
    // off the file-scope copies: `vi.resetModules()` re-creates the mocked
    // module, and asserting against a stale reference passes vacuously.
    redis = await import('../redis');
    if (!server.listening) await once(server, 'listening');
    port = (server.address() as AddressInfo).port;

    dbMock.file.findFirst.mockResolvedValue({
      userId: 'owner',
      teamId: null,
      sharedWith: [],
      team: null,
      sharePermission: null,
      shareExpiresAt: null,
    });
  });

  afterAll(async () => {
    await stopForTests?.();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    vi.mocked(redis.acquireRoomLease).mockResolvedValue('acquired');
  });

  it('refuses the join when a peer holds the lease, and never loads the room', async () => {
    vi.mocked(redis.acquireRoomLease).mockResolvedValue('held-elsewhere');
    const client = await openClient(port, 'owner');
    const closed = once(client, 'close');
    const error = waitForMessage(client, message => message.type === 'error');

    client.send(
      JSON.stringify({
        type: 'join',
        roomId: 'foreign-room',
        displayName: 'Owner',
        color: '#123456',
      })
    );

    await expect(error).resolves.toMatchObject({ code: 'room_served_by_another_instance' });
    const [closeCode] = (await closed) as [number];
    expect(closeCode).toBe(4010);
    // The decisive assertion: the room was never materialised, so this
    // instance holds no scene, no tombstones, and no locks for it.
    expect(rooms.has('foreign-room')).toBe(false);
  });

  it('serves the join when this instance holds the lease', async () => {
    const client = await openClient(port, 'owner');
    const sync = waitForMessage(client, message => message.type === 'sync_room_state');

    client.send(
      JSON.stringify({ type: 'join', roomId: 'owned-room', displayName: 'Owner', color: '#123456' })
    );

    await expect(sync).resolves.toMatchObject({ roomId: 'owned-room' });
    expect(redis.acquireRoomLease).toHaveBeenCalledWith(
      'dripl:room-owner:owned-room',
      expect.any(String),
      expect.any(Number)
    );
    expect(rooms.has('owned-room')).toBe(true);
  });

  it('still serves when Redis is unreachable — availability beats the failover risk', async () => {
    vi.mocked(redis.acquireRoomLease).mockResolvedValue('unavailable');
    const client = await openClient(port, 'owner');
    const sync = waitForMessage(client, message => message.type === 'sync_room_state');

    client.send(
      JSON.stringify({
        type: 'join',
        roomId: 'degraded-room',
        displayName: 'Owner',
        color: '#123456',
      })
    );

    await expect(sync).resolves.toMatchObject({ roomId: 'degraded-room' });
    expect(rooms.has('degraded-room')).toBe(true);
  });
});
