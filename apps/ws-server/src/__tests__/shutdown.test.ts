/**
 * `shutdown()` — the last chance to persist.
 *
 * Every in-memory `RoomState` in this process dies when it exits, so the
 * shutdown sequence is the difference between "a user lost their last two
 * seconds of edits" and "a user lost their session". Nothing else in the suite
 * reaches it: it is wired to `SIGINT`/`SIGTERM` only, and both the module
 * import and the socket-level suites call `stopForTests()` instead.
 *
 * The property that matters is the *order*: save first, release the lease
 * second. Releasing first lets a peer acquire the room and reload it from
 * Postgres — a scene that does not contain this process's last edits — while
 * this process is still writing.
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
    findUnique: vi.fn(),
    updateManyAndReturn: vi.fn(),
  },
  canvasRoom: {
    findUnique: vi.fn().mockResolvedValue(null),
    updateManyAndReturn: vi.fn(),
  },
};

vi.mock('@dripl/db', () => ({ db: dbMock, initializeDb: dbMock.initializeDb }));

const acquireRoomLease = vi.fn(async () => 'acquired' as const);
const renewRoomLease = vi.fn(async () => 'renewed' as const);
const releaseRoomLease = vi.fn(async () => 'released' as const);

vi.mock('../redis', () => ({
  acquireRoomLease,
  renewRoomLease,
  releaseRoomLease,
  isRedisAvailable: () => true,
  subscribeToRoom: vi.fn(),
  unsubscribeFromRoom: vi.fn(),
  publishToRoom: vi.fn(async () => undefined),
}));

const validateTicket = vi.fn(async (ticket: string) => ({ kind: 'user' as const, userId: ticket }));
vi.mock('../auth', async importOriginal => {
  const actual = await importOriginal<typeof import('../auth')>();
  return { ...actual, validateTicket };
});

describe('shutdown', () => {
  let server: import('node:http').Server;
  let port: number;
  let redis: typeof import('../redis');
  let exit: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RUN_WS_INTEGRATION', 'true');
    vi.stubEnv('DATABASE_URL', 'postgres://test:test@127.0.0.1:5432/test');
    vi.stubEnv('INTERNAL_SECRET', 'ws-shutdown-internal');
    vi.stubEnv('HTTP_SERVER_URL', 'http://127.0.0.1:3999');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('WS_PORT', '0');
    vi.stubEnv('PORT', '0');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.stubEnv('WS_ROOM_OWNERSHIP', 'on');
    vi.stubEnv('WS_ROOM_LEASE_RENEW_MS', '60000');
    vi.resetModules();

    const module = await import('../index');
    server = module.server;
    redis = await import('../redis');
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
    // The room loads from a real row, so it carries the record identity and the
    // `updatedAt` fence a save needs. Every write then fails — the fence is lost
    // and the merge retry loses again — which is the case that must not be
    // reported as a clean shutdown.
    dbMock.file.findUnique.mockResolvedValue({
      content: JSON.stringify({ elements: [] }),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    dbMock.canvasRoom.findUnique.mockResolvedValue(null);
    dbMock.file.updateManyAndReturn.mockResolvedValue([]);

    // `process.exit` is the last statement of `shutdown()`; replacing it lets
    // the sequence run to completion and be observed instead of killing the
    // test worker.
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  }, 30_000);

  afterAll(async () => {
    exit.mockRestore();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  // One test, and it is the only one: `shutdown()` sets `shuttingDown` for the
  // life of the module and a second import after `vi.resetModules()` would
  // leave two `SIGTERM` listeners racing over one process.
  it('attempts the final save before releasing the lease, and exits non-zero when it fails', async () => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/?ticket=shutdown-owner`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    await once(client, 'open');

    const sync = new Promise<Record<string, unknown>>(resolve => {
      client.on('message', raw => {
        const message = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (message.type === 'sync_room_state') resolve(message);
      });
    });
    client.send(JSON.stringify({ type: 'join', roomId: 'shutdown-room', displayName: 'A' }));
    await sync;

    // An edit that has not reached the database: the debounce is 2s and the
    // shutdown happens first.
    const applied = new Promise<void>(resolve => {
      client.on('message', raw => {
        if ((JSON.parse(raw.toString()) as { type?: string }).type === 'pong') resolve();
      });
    });
    client.send(
      JSON.stringify({
        type: 'add_element',
        element: {
          id: 'unsaved-on-exit',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          version: 1,
          versionNonce: 1,
        },
      })
    );
    client.send(JSON.stringify({ type: 'ping' }));
    await applied;

    dbMock.file.updateManyAndReturn.mockClear();
    dbMock.canvasRoom.updateManyAndReturn.mockClear();

    const closed = new Promise<number>(resolve => client.once('close', resolve));
    // Not a real signal: `process.on('SIGTERM', ...)` is invoked directly, which
    // is the same listener a supervisor would reach.
    process.emit('SIGTERM');

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalled();
    });
    expect(await closed).toBe(1001);

    // The room was written to before the lease went back: a peer that takes the
    // room over immediately must find this process's last edit already there.
    expect(dbMock.file.updateManyAndReturn).toHaveBeenCalled();
    const writeOrder = vi.mocked(dbMock.file.updateManyAndReturn).mock.invocationCallOrder[0] ?? 0;
    const releaseOrder =
      vi.mocked(redis.releaseRoomLease).mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER;
    expect(writeOrder).toBeLessThan(releaseOrder);
    expect(redis.releaseRoomLease).toHaveBeenCalledWith(
      'dripl:room-owner:shutdown-room',
      expect.any(String)
    );
    // A save that failed is not a clean exit: the supervisor has to see a
    // non-zero code, or the loss is invisible.
    expect(exit).toHaveBeenCalledWith(1);
    expect(dbMock.$disconnect).toHaveBeenCalled();
  });
});
