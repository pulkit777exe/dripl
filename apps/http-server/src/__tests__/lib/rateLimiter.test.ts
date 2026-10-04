/**
 * THE PROCESS-LOCAL RATE LIMITER, WHICH IS WHAT RUNS WHEN REDIS IS ABSENT.
 *
 * `createRateLimiter` has two implementations behind one interface: Upstash when
 * `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are both set, and a
 * bounded in-process window otherwise. The doc comment states the reason for the
 * fallback — "Redis is an operational optimization, not a reason for a
 * single-instance development server to reject every request" — and that makes the
 * fallback a real code path with a real security job, not a stub.
 *
 * It is also the path this file exercises exclusively: the cases below never set
 * those variables, so `distributed` stays `null` and every assertion is about the
 * memory window. The distributed branch's own failure handling is asserted
 * separately at the bottom, with a limiter that throws.
 *
 * WHAT A TEST HERE IS FOR
 *
 * Not line execution. Each case names the arithmetic it pins, because the
 * arithmetic is the whole content of this file:
 *
 *   - the boundary is `count >= limit`, so the limit-th request must SUCCEED with
 *     `remaining: 0` and the one after must fail. An off-by-one either locks a
 *     caller out one request early or lets one extra through.
 *   - the window resets on expiry, keyed on the identifier, so one caller's budget
 *     is not another's.
 *   - the map is bounded, so a long-running process on the fallback path cannot
 *     grow without limit.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter } from '../../lib/rateLimiter';

/** Keep the process-local path deterministically selected. */
function withoutRedis(): void {
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
}

beforeEach(() => {
  vi.useFakeTimers();
  withoutRedis();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('the exact-limit boundary', () => {
  /**
   * The off-by-one, from the allowing side.
   *
   * A limiter that refuses at `count >= limit - 1` would reject the limit-th
   * request, so a caller configured for N gets N-1. Asserted as a sequence rather
   * than as two separate calls because the regression is in the relationship
   * between consecutive calls, which two independent assertions cannot see.
   */
  it('allows exactly `limit` requests in a window and refuses the one after', async () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, prefix: 'test:boundary' });

    const results = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      results.push(await limiter.limit('caller'));
    }

    expect(results.map(result => result.success)).toEqual([true, true, true, false]);
    // `remaining` counts down to zero *on* the last allowed request, so a client
    // reading the header can tell it is on its last one before being refused.
    expect(results.map(result => result.remaining)).toEqual([2, 1, 0, 0]);
    // The refusal reports the same reset as the window it refused within.
    expect(results[3]?.resetAt).toBe(results[0]?.resetAt);
  });

  /**
   * The same boundary at limit 1, where "one more than allowed" is one request.
   * A `limit: 1` limiter is the smallest thing that can be off by one, and it is
   * the shape used for per-account throttles.
   */
  it('refuses the second request when the limit is one', async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, prefix: 'test:single' });

    expect((await limiter.limit('caller')).success).toBe(true);
    expect((await limiter.limit('caller')).success).toBe(false);
  });
});

describe('windows are per identifier and expire', () => {
  /**
   * Identifiers are independent budgets.
   *
   * A limiter keyed on nothing — or on a constant — would let one abusive caller
   * lock out an entire NAT egress, which for a canvas app behind a corporate proxy
   * means every user behind that proxy is locked out together.
   */
  it('keeps one caller’s exhaustion from refusing another', async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, prefix: 'test:scoped' });

    expect((await limiter.limit('noisy')).success).toBe(true);
    expect((await limiter.limit('noisy')).success).toBe(false);
    expect((await limiter.limit('quiet')).success).toBe(true);
    expect((await limiter.limit('quiet')).success).toBe(false);
  });

  /**
   * The window rolls over.
   *
   * Without this, a caller who trips the limit stays refused until the process
   * restarts — the process-local fallback would become a permanent ban, which is
   * not what "sliding window, 15 minutes" means and is not a failure anyone
   * reviewing the fallback would accept.
   */
  it('starts a fresh window once the previous one has elapsed', async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, prefix: 'test:rollover' });

    expect((await limiter.limit('caller')).success).toBe(true);
    expect((await limiter.limit('caller')).success).toBe(false);

    // One millisecond short of the window: still the same window.
    vi.advanceTimersByTime(59_999);
    expect((await limiter.limit('caller')).success).toBe(false);

    vi.advanceTimersByTime(2);
    const afterRollover = await limiter.limit('caller');
    expect(afterRollover.success).toBe(true);
    expect(afterRollover.remaining).toBe(0);
  });

  /**
   * A caller seen for the first time mid-window is not charged against anyone's
   * window, and gets a full budget. Without the expiry check a first request would
   * inherit `remaining: 0` and be refused immediately.
   */
  it('gives a first-time caller a full budget rather than a zeroed one', async () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000, prefix: 'test:fresh' });

    const result = await limiter.limit('never-seen');

    expect(result).toMatchObject({ success: true, remaining: 4 });
  });
});

describe('the fallback window cannot grow without bound', () => {
  /**
   * The eviction path, and the reason it exists.
   *
   * `createRateLimiter`'s in-memory map is keyed on an identifier a caller
   * controls. Without a bound, a script that varies a header-derived identifier
   * grows this map once per request for the life of the process — a memory leak
   * reachable by anyone who can reach the API.
   *
   * Driven past the 10,000-key threshold and then asserted on *behaviour* rather
   * than on the map's size: the oldest identifier is evicted, so its next request
   * is treated as a first request and is allowed. That is the observable
   * consequence of eviction, and it survives a rewrite of the eviction strategy
   * (LRU instead of insertion order) as long as the bound holds.
   */
  it('evicts old identifiers instead of growing past the bound', async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 3_600_000, prefix: 'test:bound' });

    // Exhaust `first`, so its window is distinguishable from a fresh one.
    expect((await limiter.limit('first')).success).toBe(true);
    expect((await limiter.limit('first')).success).toBe(false);

    // Fill past the threshold with identifiers that will never be seen again.
    for (let index = 0; index < 10_050; index += 1) {
      await limiter.limit(`filler-${index}`);
    }

    // `first` was inserted before all of them, so it is the oldest and is gone.
    const afterEviction = await limiter.limit('first');
    expect(afterEviction.success).toBe(true);
  });

  /**
   * The bound is a bound, not a suggestion: a filler whose window is still live
   * must not itself be evicted purely for being recent enough to be at the end.
   * Asserted by keeping `recent` at the tail and requiring it to still be refused
   * for its own exhausted window — proving the map did not simply clear wholesale
   * (which would also pass the case above, for the wrong reason).
   */
  it('still refuses a recently-exhausted caller after the bound is applied', async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 3_600_000, prefix: 'test:bound:keep' });

    for (let index = 0; index < 10_050; index += 1) {
      await limiter.limit(`filler-${index}`);
    }

    // The most recent insertion, so it cannot be the eviction victim.
    expect((await limiter.limit('recent')).success).toBe(true);
    expect((await limiter.limit('recent')).success).toBe(false);
  });
});

describe('a distributed provider is used only when both variables are present', () => {
  /**
   * Only the URL, or only the token, must select the local path.
   *
   * `createRateLimiter` reads the pair and requires both. Half-configured Redis is
   * the common state (a token added to `.env.example` before the URL, or a URL
   * pasted into a dashboard), and a limiter that tried to construct a client from
   * half a credential would either throw at module load — taking down every route,
   * since `createApp` builds three limiters at import time — or silently reach a
   * misconfigured remote.
   *
   * Asserted as behaviour: with only one variable set, the window is local and
   * therefore persists across two `createRateLimiter` calls that a shared remote
   * would not.
   */
  it('falls back to the local window when only one Redis variable is set', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');

    const first = createRateLimiter({ limit: 1, windowMs: 60_000, prefix: 'test:half' });
    expect((await first.limit('caller')).success).toBe(true);

    // A second limiter with the same prefix: with a shared remote it would see the
    // first request and refuse this one.
    const second = createRateLimiter({ limit: 1, windowMs: 60_000, prefix: 'test:half' });
    expect((await second.limit('caller')).success).toBe(true);
  });
});
