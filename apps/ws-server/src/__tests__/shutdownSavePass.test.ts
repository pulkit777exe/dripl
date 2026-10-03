/**
 * `shutdown()`'s save pass, in detail.
 *
 * `shutdown.test.ts` proves the ordering that matters most — the final save is
 * attempted *before* the lease goes back. What is here is the rest of that
 * sequence, and specifically the rooms it has to notice without being told:
 *
 *   - a dirty room with **no pending debounce handle**. The debounce fires and
 *     deletes its own entry, so a room whose writes kept failing is dirty with
 *     nothing in `saveTimeouts`. If shutdown only iterated `saveTimeouts`, that
 *     room would be dropped on exit with its edits only in memory.
 *   - the 10s cap, which exists so a hung database cannot stall a deploy
 *     indefinitely — and which must report failure rather than report success.
 *
 * One shutdown per process, so this file runs the sequence once, on a
 * deliberately hung write, and asserts both properties from the single run.
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

const releaseRoomLease = vi.fn(async () => 'released' as const);

vi.mock('../redis', () => ({
  acquireRoomLease: vi.fn(async () => 'acquired' as const),
  renewRoomLease: vi.fn(async () => 'renewed' as const),
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

describe('the shutdown save pass', () => {
  let port: number;
  let roomState: typeof import('../rooms');
  let exit: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RUN_WS_INTEGRATION', 'true');
    vi.stubEnv('DATABASE_URL', 'postgres://test:test@127.0.0.1:5432/test');
    vi.stubEnv('INTERNAL_SECRET', 'ws-shutdown-pass-internal');
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
    roomState = await import('../rooms');
    const server = module.server;
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
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  }, 30_000);

  afterAll(() => {
    exit.mockRestore();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  // One test, and it must be the only one: `shutdown()` flips `shuttingDown` for
  // the life of the module and clears the intervals, so a second call is a no-op
  // and a second `vi.resetModules()` would leave two SIGTERM listeners racing.
  it('saves dirty rooms that have no pending debounce, and reports the 10s cap as failure', async () => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/?ticket=shutdown-pass`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    await once(client, 'open');

    const sync = new Promise<void>(resolve => {
      client.on('message', raw => {
        if ((JSON.parse(raw.toString()) as { type?: string }).type === 'sync_room_state') resolve();
      });
    });
    client.send(JSON.stringify({ type: 'join', roomId: 'pass-room', displayName: 'A' }));
    await sync;

    const applied = new Promise<void>(resolve => {
      client.on('message', raw => {
        if ((JSON.parse(raw.toString()) as { type?: string }).type === 'pong') resolve();
      });
    });
    client.send(JSON.stringify({ type: 'add_element', element: rect('unsaved') }));
    client.send(JSON.stringify({ type: 'ping' }));
    await applied;

    const room = roomState.rooms.get('pass-room');
    if (!room) throw new Error('room was never created');
    expect(room.dirty).toBe(true);

    // A second dirty room, on the same connection is not possible (one room per
    // socket), so it gets its own. Both are in the state a room is actually in
    // when its writes have been failing: still dirty, debounce handle already
    // deleted by the pass that failed. `shutdown` has to find them from `rooms`,
    // not from `saveTimeouts`.
    const second = new WebSocket(`ws://127.0.0.1:${port}/?ticket=shutdown-pass-2`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    await once(second, 'open');
    const secondSync = new Promise<void>(resolve => {
      second.on('message', raw => {
        if ((JSON.parse(raw.toString()) as { type?: string }).type === 'sync_room_state') resolve();
      });
    });
    second.send(JSON.stringify({ type: 'join', roomId: 'pass-room-2', displayName: 'B' }));
    await secondSync;
    const secondApplied = new Promise<void>(resolve => {
      second.on('message', raw => {
        if ((JSON.parse(raw.toString()) as { type?: string }).type === 'pong') resolve();
      });
    });
    second.send(JSON.stringify({ type: 'add_element', element: rect('unsaved-2') }));
    second.send(JSON.stringify({ type: 'ping' }));
    await secondApplied;

    roomState.saveTimeouts.delete('pass-room');
    roomState.saveTimeouts.delete('pass-room-2');
    expect(roomState.saveTimeouts.has('pass-room')).toBe(false);
    expect(roomState.saveTimeouts.has('pass-room-2')).toBe(false);

    // One room's write fails fast, the other's never settles. The fast failure is
    // what proves the per-room outcome is actually inspected — a shutdown that
    // ignored the resolved outcome would report the same exit code as one that
    // never looked, and would report success on a hang.
    dbMock.file.findUnique.mockResolvedValue({
      content: JSON.stringify({ elements: [] }),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    dbMock.file.updateManyAndReturn.mockImplementation(async (args: unknown) => {
      const id = (args as { where: { id: string } }).where.id;
      if (id === 'pass-room') {
        await new Promise(() => undefined);
        return [];
      }
      // Fence lost and the winning row gone: `persistRoom` reports 'failed'.
      return [];
    });

    const closed = new Promise<number>(resolve => client.once('close', resolve));
    const startedAt = Date.now();
    process.emit('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled(), { timeout: 20_000 });
    const elapsed = Date.now() - startedAt;

    // Both dirty rooms with no handle were attempted, and they are the *only*
    // writes: nothing here came from the debounce path.
    const writtenIds = vi
      .mocked(dbMock.file.updateManyAndReturn)
      .mock.calls.map(call => (call[0] as { where: { id: string } }).where.id);
    expect(writtenIds).toContain('pass-room');
    expect(writtenIds).toContain('pass-room-2');
    expect(await closed).toBe(1001);
    // The cap bounded the wait rather than letting a hung database stall the
    // deploy, and it was long enough to be the real 10s cap rather than the
    // writes happening to finish.
    expect(elapsed).toBeGreaterThanOrEqual(9_000);
    // A timeout is a failure, not a success: the edits were not saved, and the
    // supervisor has to see that.
    expect(exit).toHaveBeenCalledWith(1);
    // And the lease is still released, so a peer can take the room rather than
    // waiting out the full TTL on a process that is gone.
    expect(releaseRoomLease).toHaveBeenCalledWith('dripl:room-owner:pass-room', expect.any(String));
  }, 40_000);
});
