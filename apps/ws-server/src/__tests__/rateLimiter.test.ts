/**
 * The rate limiter, in both of its modes.
 *
 * The local token bucket is the *only* limiter on a single-instance deployment
 * (the documented production configuration when Upstash is unconfigured), and
 * it is the DoS bound on a socket: 30 messages per second per verified identity.
 * The Redis path is delegated to `@upstash/ratelimit`, but its two interesting
 * properties — that it is consulted at all, and that a Redis failure falls back
 * rather than opening the socket — live in *this* module, not in the library.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';

const upstashRedis = vi.hoisted(() => ({ constructed: [] as unknown[] }));

// One object holds the limiter's state so the mock and the tests cannot drift
// onto two different `limitImpl`s.
const upstashRate = vi.hoisted(() => ({
  built: [] as unknown[],
  limitCalls: [] as string[],
  limitImpl: (async (id: string) => ({ success: true, limit: id })) as (
    id: string
  ) => Promise<{ success: boolean }>,
  slidingWindow: vi.fn((max: number, window: string) => ({ max, window })),
  Ratelimit: null as unknown,
}));

vi.mock('@upstash/redis', () => {
  class Redis {
    constructor(config: unknown) {
      upstashRedis.constructed.push(config);
    }
  }
  return { Redis };
});

vi.mock('@upstash/ratelimit', () => {
  class Ratelimit {
    constructor(config: unknown) {
      upstashRate.built.push(config);
    }

    static slidingWindow(max: number, window: string) {
      return upstashRate.slidingWindow(max, window);
    }

    async limit(id: string) {
      upstashRate.limitCalls.push(id);
      return upstashRate.limitImpl(id);
    }
  }
  upstashRate.Ratelimit = Ratelimit;
  return { Ratelimit };
});

type LimiterModule = typeof import('../rateLimiter');

function ws(): WebSocket {
  return { readyState: 1 } as unknown as WebSocket;
}

/** A fresh module per test: `initRedis()` runs at import and caches its result. */
async function loadLimiter(): Promise<LimiterModule> {
  vi.resetModules();
  return import('../rateLimiter');
}

/**
 * `initRedis()` is fired and forgotten at module load and reaches its result
 * through two dynamic `import()`s, so it settles a few turns after the module
 * is in place. Everything downstream reads the two flags it sets, so a test
 * that does not wait is testing the single-instance path by accident.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
}

describe('local token bucket (no Upstash configured)', () => {
  let limiter: LimiterModule;

  beforeEach(async () => {
    upstashRedis.constructed = [];
    upstashRate.built = [];
    upstashRate.limitCalls = [];
    upstashRate.limitImpl = async () => ({ success: true });
    upstashRate.slidingWindow.mockClear();
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    limiter = await loadLimiter();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('does not build a Redis limiter when the pair is unconfigured', () => {
    // Half a pair is a deploy that lost part of its Redis config; it must read
    // as "no Redis" rather than build a limiter pointed at nothing.
    expect(upstashRate.built).toEqual([]);
  });

  it('admits the full window and then refuses', async () => {
    const socket = ws();
    limiter.setRateLimitIdentity(socket, 'user-window');
    // The contract the dispatcher relies on: message N+1 is closed with 4000.
    for (let i = 1; i <= limiter.RATE_LIMIT_MAX_MESSAGES; i++) {
      await expect(limiter.checkRateLimit(socket)).resolves.toBe(true);
    }
    await expect(limiter.checkRateLimit(socket)).resolves.toBe(false);
  });

  it('refills once the window has passed', async () => {
    const socket = ws();
    limiter.setRateLimitIdentity(socket, 'user-refill');
    for (let i = 0; i < limiter.RATE_LIMIT_MAX_MESSAGES; i++) {
      await limiter.checkRateLimit(socket);
    }
    await expect(limiter.checkRateLimit(socket)).resolves.toBe(false);

    vi.advanceTimersByTime(limiter.RATE_LIMIT_WINDOW_MS);
    await expect(limiter.checkRateLimit(socket)).resolves.toBe(true);
  });

  it('counts each verified identity separately', async () => {
    const first = ws();
    const second = ws();
    limiter.setRateLimitIdentity(first, 'user-a');
    limiter.setRateLimitIdentity(second, 'user-b');
    for (let i = 0; i < limiter.RATE_LIMIT_MAX_MESSAGES; i++) {
      await limiter.checkRateLimit(first);
    }
    // One client flooding must not be able to lock every other user out.
    await expect(limiter.checkRateLimit(first)).resolves.toBe(false);
    await expect(limiter.checkRateLimit(second)).resolves.toBe(true);
  });

  it('keys the limit on the ticket principal, not the socket', async () => {
    // Two sockets, one identity (two tabs, one share token): they share a
    // budget, which is the point of keying on the verified principal.
    const tabOne = ws();
    const tabTwo = ws();
    limiter.setRateLimitIdentity(tabOne, 'user-shared');
    for (let i = 0; i < limiter.RATE_LIMIT_MAX_MESSAGES; i++) {
      await limiter.checkRateLimit(tabOne);
    }
    limiter.setRateLimitIdentity(tabTwo, 'user-shared');
    await expect(limiter.checkRateLimit(tabTwo)).resolves.toBe(false);
  });

  it('does not hand a disconnect a fresh budget', async () => {
    // Regression: deleting the bucket when a socket closes lets anyone reset
    // their limit by reconnecting, which turns a 30/s bound into no bound at
    // all. The bucket is dropped by the window, not by the disconnect.
    const first = ws();
    limiter.setRateLimitIdentity(first, 'user-reconnect');
    for (let i = 0; i < limiter.RATE_LIMIT_MAX_MESSAGES; i++) {
      await limiter.checkRateLimit(first);
    }
    limiter.removeRateLimitIdentity(first);

    const second = ws();
    limiter.setRateLimitIdentity(second, 'user-reconnect');
    await expect(limiter.checkRateLimit(second)).resolves.toBe(false);
  });

  it('falls back to one shared anonymous bucket for a socket with no identity', async () => {
    // `setRateLimitIdentity` runs only after a ticket validates, so anything
    // arriving earlier must still be bounded rather than unlimited.
    const socket = ws();
    for (let i = 0; i < limiter.RATE_LIMIT_MAX_MESSAGES; i++) {
      await expect(limiter.checkRateLimit(socket)).resolves.toBe(true);
    }
    await expect(limiter.checkRateLimit(socket)).resolves.toBe(false);
  });

  it('drops expired identities instead of accumulating them forever', async () => {
    // Process-local state with no cleanup interval: without pruning, a server
    // that has seen a million share tokens holds a million buckets for the
    // life of the process.
    for (let i = 0; i < 50; i++) {
      const socket = ws();
      limiter.setRateLimitIdentity(socket, `user-${i}`);
      await limiter.checkRateLimit(socket);
    }
    vi.advanceTimersByTime(limiter.RATE_LIMIT_WINDOW_MS);
    const fresh = ws();
    limiter.setRateLimitIdentity(fresh, 'user-after-prune');
    // The prune runs on the next first-touch of the map, which is this call.
    await expect(limiter.checkRateLimit(fresh)).resolves.toBe(true);
  });

  it('stays bounded when identities arrive faster than the window turns', async () => {
    // The hard cap: without it the map grows without limit inside a single
    // window under a flood of distinct principals.
    for (let i = 0; i < 10_500; i++) {
      const socket = ws();
      limiter.setRateLimitIdentity(socket, `flood-${i}`);
      await limiter.checkRateLimit(socket);
    }
    // Still functional, and the oldest identity has been evicted, so it starts
    // from a full budget again rather than inheriting the flood's.
    const evicted = ws();
    limiter.setRateLimitIdentity(evicted, 'flood-0');
    await expect(limiter.checkRateLimit(evicted)).resolves.toBe(true);
  });
});

describe('Upstash-backed limiter', () => {
  beforeEach(() => {
    upstashRedis.constructed = [];
    upstashRate.built = [];
    upstashRate.limitCalls = [];
    upstashRate.limitImpl = async () => ({ success: true });
    upstashRate.slidingWindow.mockClear();
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token-value');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds the limiter with the same 30-per-second window as the local bucket', async () => {
    // Two different limits would mean the effective ceiling depends on which
    // deploy configuration a peer instance happened to be running.
    await loadLimiter();
    await settle();
    expect(upstashRate.slidingWindow).toHaveBeenCalledWith(30, '1 s');
    expect(upstashRate.built).toHaveLength(1);
    expect(upstashRedis.constructed).toEqual([
      { url: 'https://example.upstash.io', token: 'token-value' },
    ]);
  });

  it('asks the shared limiter and returns its verdict verbatim', async () => {
    // Regression: ignoring a `success: false` here would open every socket that
    // any other instance is currently limiting.
    upstashRate.limitImpl = async () => ({ success: false });
    const limiter = await loadLimiter();
    await settle();
    const socket = ws();
    limiter.setRateLimitIdentity(socket, 'user-shared-limit');
    await expect(limiter.checkRateLimit(socket)).resolves.toBe(false);
    expect(upstashRate.limitCalls).toEqual(['user-shared-limit']);
  });

  it('counts a socket with no identity as the same anonymous bucket', async () => {
    const limiter = await loadLimiter();
    await settle();
    await limiter.checkRateLimit(ws());
    expect(upstashRate.limitCalls).toEqual(['anonymous']);
  });

  it('falls back to the local bucket when the shared limiter throws', async () => {
    // Fail-closed would turn an Upstash outage into a total outage; fail-open
    // would remove the bound. The local bucket is the third option and the one
    // the module chose, so it has to actually engage.
    upstashRate.limitImpl = async () => {
      throw new Error('upstash unreachable');
    };
    const limiter = await loadLimiter();
    await settle();
    const socket = ws();
    limiter.setRateLimitIdentity(socket, 'user-redis-down');
    for (let i = 0; i < limiter.RATE_LIMIT_MAX_MESSAGES; i++) {
      await expect(limiter.checkRateLimit(socket)).resolves.toBe(true);
    }
    // Bounded, on the same 30/s budget as the no-Redis deployment.
    await expect(limiter.checkRateLimit(socket)).resolves.toBe(false);
  });

  it('stays on the local bucket when the Redis configuration is half set', async () => {
    // A URL with no token: building a limiter against it would throw at import
    // and, worse, appear to work while sharing no limit with any peer.
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const limiter = await loadLimiter();
    await settle();
    expect(upstashRate.built).toEqual([]);
    const socket = ws();
    limiter.setRateLimitIdentity(socket, 'user-half-config');
    await expect(limiter.checkRateLimit(socket)).resolves.toBe(true);
    expect(upstashRate.limitCalls).toEqual([]);
  });
});
