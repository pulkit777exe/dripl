/**
 * The five `setInterval` bodies in `index.ts`.
 *
 * Each tick is exported from `lifecycle.ts` and each body is tested there. What
 * nothing tested is the *wiring*: that the interval actually calls that sweep.
 * Those are four uncovered lines each holding a real failure mode — a sweep whose
 * interval was renamed, deleted, or pointed at the wrong function degrades
 * silently, and the symptom is a room that is never reaped, a revocation that
 * never lands, or a scene that is never reconciled. No other assertion in the
 * suite would notice.
 *
 * Only `setInterval`/`clearInterval` are faked. The intervals are created at
 * module import with hard-coded periods (30s heartbeat, 15s authorization,
 * 5s locks, 60s reconciliation), so faking is what keeps this a fast
 * deterministic test rather than a 60-second sleep. `setTimeout` stays real
 * because the save debounce and the `ws` internals depend on it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const lifecycleSpies = vi.hoisted(() => ({
  runHeartbeatTick: vi.fn(),
  runAuthorizationSweep: vi.fn(),
  runPeriodicSave: vi.fn(async () => undefined),
  runLockSweep: vi.fn(),
  runReconciliation: vi.fn(async () => undefined),
}));

vi.mock('../lifecycle', async importOriginal => {
  const actual = await importOriginal<typeof import('../lifecycle')>();
  return { ...actual, ...lifecycleSpies };
});

const dbMock = vi.hoisted(() => ({
  initializeDb: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
  $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]),
  file: {
    findFirst: vi.fn(),
    findUnique: vi.fn().mockResolvedValue(null),
    updateManyAndReturn: vi.fn(),
  },
  canvasRoom: { findUnique: vi.fn().mockResolvedValue(null), updateManyAndReturn: vi.fn() },
}));

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

const env: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/test',
  INTERNAL_SECRET: 'ws-intervals-internal',
  HTTP_SERVER_URL: 'http://127.0.0.1:3999',
  FRONTEND_URL: 'http://localhost:3000',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  WS_PORT: '0',
  PORT: '0',
  UPSTASH_REDIS_REST_URL: '',
  UPSTASH_REDIS_REST_TOKEN: '',
};

async function importServerWithFakeIntervals(): Promise<{
  wss: { clients: { size: number } };
  stopForTests: () => Promise<void>;
}> {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  // No `RUN_WS_INTEGRATION`, so `listen()` is skipped: this suite is about the
  // timers, and an unlistened server keeps the import free of socket churn.
  vi.resetModules();
  const module = await import('../index');
  return { wss: module.wss, stopForTests: module.stopForTests };
}

describe('interval wiring', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('runs the periodic save sweep on its interval', async () => {
    // The interval that actually persists rooms. If it stops, every edit lives
    // only in memory until someone disconnects, and a restart loses all of it.
    vi.stubEnv('PERIODIC_SAVE_INTERVAL_MS', '15000');
    const { stopForTests } = await importServerWithFakeIntervals();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(lifecycleSpies.runPeriodicSave).toHaveBeenCalled();

    await stopForTests();
  });

  it('honours a configured periodic save interval', async () => {
    // Read from the environment, so an operator can shorten it. Pinned because
    // the value is the "how long can a crash lose" number the architecture
    // documents, and a rename here would silently restore 15s.
    vi.stubEnv('PERIODIC_SAVE_INTERVAL_MS', '3000');
    await importServerWithFakeIntervals();

    await vi.advanceTimersByTimeAsync(2_999);
    expect(lifecycleSpies.runPeriodicSave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(lifecycleSpies.runPeriodicSave).toHaveBeenCalledTimes(1);
  });

  it('runs the lock sweep on its 5s interval', async () => {
    // Stale element locks are what make an element look permanently uneditable
    // to everyone else in the room, and this sweep is the only thing that
    // reclaims them.
    const { stopForTests } = await importServerWithFakeIntervals();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(lifecycleSpies.runLockSweep).toHaveBeenCalled();

    await stopForTests();
  });

  it('runs the authorization sweep on its 15s interval', async () => {
    // The enforcer for revocation. The per-message path is throttled to a 30s
    // steady-state check, so this interval is what actually guarantees a revoked
    // share or a removed member is cut off within its documented window.
    const { stopForTests } = await importServerWithFakeIntervals();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(lifecycleSpies.runAuthorizationSweep).toHaveBeenCalled();

    await stopForTests();
  });

  it('runs the heartbeat sweep with the live client set', async () => {
    // The heartbeat is the only thing that terminates sockets whose peer stopped
    // answering. It must receive `wss.clients` — the live client set — because
    // that is the only place a socket nobody is answering to is visible; passing
    // anything else would reap nothing or reap the wrong thing.
    const { wss, stopForTests } = await importServerWithFakeIntervals();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(lifecycleSpies.runHeartbeatTick).toHaveBeenCalledTimes(1);
    const arg = lifecycleSpies.runHeartbeatTick.mock.calls[0]?.[0];
    expect(arg).toBe(wss.clients);

    await stopForTests();
  });

  it('runs the reconciliation sweep on its 60s interval', async () => {
    // The only thing that repairs a room whose writes kept failing. Without it a
    // diverged scene stays diverged silently, in memory only.
    const { stopForTests } = await importServerWithFakeIntervals();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(lifecycleSpies.runReconciliation).toHaveBeenCalled();

    await stopForTests();
  });

  it('repeats every sweep on its interval rather than firing once', async () => {
    // A sweep registered with a one-shot would pass every "was it called" check
    // and then never run again. Three periods is enough to distinguish the two.
    const { stopForTests } = await importServerWithFakeIntervals();

    await vi.advanceTimersByTimeAsync(15_000 * 3);

    expect(lifecycleSpies.runPeriodicSave).toHaveBeenCalledTimes(3);
    expect(lifecycleSpies.runLockSweep).toHaveBeenCalledTimes(9);
    expect(lifecycleSpies.runAuthorizationSweep).toHaveBeenCalledTimes(3);

    await stopForTests();
  });

  it('stops every sweep when the server is stopped', async () => {
    // Shutdown must clear the intervals before the final save pass; a surviving
    // heartbeat would `terminate()` the clients the shutdown is trying to close
    // gracefully, turning a clean close into a reset.
    const { stopForTests } = await importServerWithFakeIntervals();
    await vi.advanceTimersByTimeAsync(30_000);
    vi.clearAllMocks();

    await stopForTests();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(lifecycleSpies.runHeartbeatTick).not.toHaveBeenCalled();
    expect(lifecycleSpies.runPeriodicSave).not.toHaveBeenCalled();
    expect(lifecycleSpies.runLockSweep).not.toHaveBeenCalled();
    expect(lifecycleSpies.runAuthorizationSweep).not.toHaveBeenCalled();
    expect(lifecycleSpies.runReconciliation).not.toHaveBeenCalled();
  });

  it('creates exactly five intervals, and no more', async () => {
    // The five sweeps, and nothing else. A stray sixth interval would be a timer
    // nobody can account for at shutdown, and `clearInterval` in `shutdown` and
    // `stopForTests` enumerates these five explicitly — an unnamed sixth would
    // survive both.
    await importServerWithFakeIntervals();
    expect(vi.getTimerCount()).toBe(5);
  });
});
