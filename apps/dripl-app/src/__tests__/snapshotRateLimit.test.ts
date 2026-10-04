import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * `_lib/snapshotRateLimit.ts` is the only thing between a client and the snapshot
 * table, and it has two completely different identity models behind one function:
 * a shared Upstash window when `UPSTASH_REDIS_REST_URL`/`_TOKEN` are set, and a
 * process-local window keyed by IP otherwise. The key derivation is the security
 * decision — an attacker who can choose their own key gets a fresh quota per
 * request — so both models are driven here directly rather than through a route.
 */

const { state } = vi.hoisted(() => ({
  state: {
    /** When false, `new Ratelimit(...)` throws, standing in for a broken provider. */
    constructionFails: false,
  },
}));

const limitMock = vi.fn();

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow() {
      return {};
    }

    constructor() {
      if (state.constructionFails) throw new Error('redis is misconfigured');
    }

    limit = limitMock;
  },
}));

vi.mock('@upstash/redis', () => ({ Redis: class {} }));

const UPSTASH_URL = 'https://redis.example.test';
const UPSTASH_TOKEN = 'redis-token';

/** The 30/minute budget the local window enforces. */
const LOCAL_BUDGET = 30;

function snapshotRequest(headers?: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost:3000/api/canvas/snapshots', {
    method: 'GET',
    headers: headers ?? {},
  });
}

function forwarded(ip: string): Record<string, string> {
  return { 'x-forwarded-for': ip };
}

describe('snapshot rate limiter', () => {
  let limiter: typeof import('@/app/api/canvas/snapshots/_lib/snapshotRateLimit');

  beforeEach(async () => {
    vi.clearAllMocks();
    limitMock.mockReset();
    state.constructionFails = false;
    vi.resetModules();
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    // Pinned so a test cannot cross a window boundary on a slow machine.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    limitMock.mockResolvedValue({ success: true, reset: Date.now() + 60_000 });
    limiter = await import('@/app/api/canvas/snapshots/_lib/snapshotRateLimit');
    limiter.clearSnapshotRateLimitState();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  /* ------------------------------------------------------------------ *
   * The local window
   * ------------------------------------------------------------------ */

  it('refuses the 31st request in a window and admits the caller again after it resets', async () => {
    const results: boolean[] = [];
    for (let i = 0; i < LOCAL_BUDGET; i += 1) {
      results.push(await limiter.allowSnapshotRequest(snapshotRequest()));
    }

    expect(results.every(Boolean)).toBe(true);
    expect(await limiter.allowSnapshotRequest(snapshotRequest())).toBe(false);
    // Regression: this is the assertion that a limiter which never resets cannot
    // pass. A user who trips the 30/minute window is locked out for the life of
    // the process — a restart is the only cure — and no test of the 31st call
    // alone would notice, because it looks identical to correct behaviour.

    vi.setSystemTime(new Date('2026-01-01T00:01:00.001Z'));
    expect(await limiter.allowSnapshotRequest(snapshotRequest())).toBe(true);
  });

  it('does not carry a spent count into the next window', async () => {
    for (let i = 0; i < LOCAL_BUDGET + 1; i += 1) {
      await limiter.allowSnapshotRequest(snapshotRequest());
    }

    vi.setSystemTime(new Date('2026-01-01T00:01:00.001Z'));
    const secondWindow: boolean[] = [];
    for (let i = 0; i < LOCAL_BUDGET; i += 1) {
      secondWindow.push(await limiter.allowSnapshotRequest(snapshotRequest()));
    }

    // Regression: the reset has to zero the counter, not just move the deadline.
    // Without `count = 1` on a fresh window the caller is refused again
    // immediately after the window rolls, which is indistinguishable from a
    // permanent lockout from the caller's side.
    expect(secondWindow.filter(Boolean)).toHaveLength(LOCAL_BUDGET);
  });

  /* ------------------------------------------------------------------ *
   * Key derivation — the security decision
   * ------------------------------------------------------------------ */

  it('ignores a spoofed forwarded IP unless the deployment trusts its proxy', async () => {
    for (let i = 0; i < LOCAL_BUDGET; i += 1) {
      expect(await limiter.allowSnapshotRequest(snapshotRequest(forwarded('198.51.100.1')))).toBe(
        true
      );
    }

    // A completely different claimed IP, and a different real-IP header too.
    const spoofed = await limiter.allowSnapshotRequest(
      snapshotRequest({ 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.9' })
    );

    // Regression: without `TRUST_PROXY=true` every caller shares one bucket
    // precisely so a spoofable header cannot buy a fresh quota. Honouring
    // `x-forwarded-for` unconditionally would make the limiter a no-op: an
    // attacker writes 30 requests per forged address forever.
    expect(spoofed).toBe(false);
  });

  it('gives independent buckets per forwarded IP behind a trusted proxy', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');

    for (let i = 0; i < LOCAL_BUDGET; i += 1) {
      await limiter.allowSnapshotRequest(snapshotRequest(forwarded('198.51.100.1')));
    }
    expect(await limiter.allowSnapshotRequest(snapshotRequest(forwarded('198.51.100.1')))).toBe(
      false
    );

    // Regression: the trusted-proxy path has to actually separate callers. If the
    // flag were ignored in this direction too, every deployment behind a real
    // proxy — which is all of them — would share a single 30/minute bucket for
    // the whole internet.
    expect(await limiter.allowSnapshotRequest(snapshotRequest(forwarded('198.51.100.2')))).toBe(
      true
    );
  });

  it('resolves the first forwarded hop, then x-real-ip, then a single anonymous bucket', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');

    // No `x-forwarded-for` at all: the key must come from `x-real-ip`.
    for (let i = 0; i < LOCAL_BUDGET; i += 1) {
      await limiter.allowSnapshotRequest(snapshotRequest({ 'x-real-ip': '198.51.100.5' }));
    }
    expect(
      await limiter.allowSnapshotRequest(snapshotRequest({ 'x-real-ip': '198.51.100.5' }))
    ).toBe(false);

    // A forwarded header whose first hop is blank must fall through to the same
    // `x-real-ip`, i.e. the *same* spent bucket, not a fresh one.
    expect(
      await limiter.allowSnapshotRequest(
        snapshotRequest({ 'x-forwarded-for': ' , 203.0.113.1', 'x-real-ip': '198.51.100.5' })
      )
    ).toBe(false);

    // And a request with no addressing headers at all lands in a bucket distinct
    // from every named IP.
    expect(await limiter.allowSnapshotRequest(snapshotRequest())).toBe(true);
    // Regression: the three-step fallback is what keeps a proxy that rewrites
    // `x-forwarded-for` from collapsing everyone into one bucket. Getting the
    // order wrong (trusting real-ip before the forwarded chain, or emitting a
    // per-request key when both headers are absent) reopens the shared-bucket
    // failure without looking like it.
  });

  /* ------------------------------------------------------------------ *
   * The shared limiter, when one is configured
   * ------------------------------------------------------------------ */

  it('lets the shared limiter answer without consulting the local window', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', UPSTASH_URL);
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', UPSTASH_TOKEN);

    const results: boolean[] = [];
    for (let i = 0; i < LOCAL_BUDGET + 10; i += 1) {
      results.push(await limiter.allowSnapshotRequest(snapshotRequest()));
    }

    expect(limitMock).toHaveBeenCalledTimes(LOCAL_BUDGET + 10);
    expect(limitMock).toHaveBeenCalledWith('snapshot:anonymous');
    // Regression: Upstash is authoritative when configured, and its answer has to
    // be final. If the local window were also charged — or consulted first — a
    // 41st legitimate request from one office would be refused on every app
    // instance at once, for a budget the shared limiter just approved.
    expect(results.every(Boolean)).toBe(true);
  });

  it('propagates a refusal from the shared limiter instead of falling back', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', UPSTASH_URL);
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', UPSTASH_TOKEN);
    limitMock.mockResolvedValue({ success: false, reset: Date.now() + 60_000 });

    expect(await limiter.allowSnapshotRequest(snapshotRequest())).toBe(false);
    // Regression: the shared quota is the product-wide limit. A fresh local
    // window would admit the request anyway, which on a Redis outage is fine but
    // on a *working* Redis is a per-instance bypass of the real limit.
  });

  it('falls back to the local window when the shared limiter throws', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', UPSTASH_URL);
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', UPSTASH_TOKEN);
    limitMock.mockRejectedValue(new Error('redis unreachable'));

    const results: boolean[] = [];
    for (let i = 0; i < LOCAL_BUDGET + 1; i += 1) {
      results.push(await limiter.allowSnapshotRequest(snapshotRequest()));
    }

    // Regression: the documented choice here is fail-open into a *bounded* local
    // window, not a blanket refusal — unlike the AI route, which has spend to
    // protect. Failing closed would 429 every share link in the product on a
    // Redis blip; the assertions also pin that the fallback is still bounded.
    expect(limitMock).toHaveBeenCalledTimes(LOCAL_BUDGET + 1);
    expect(results.filter(Boolean)).toHaveLength(LOCAL_BUDGET);
  });

  it('falls back to the local window when the shared limiter cannot be constructed', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', UPSTASH_URL);
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', UPSTASH_TOKEN);
    state.constructionFails = true;

    const results: boolean[] = [];
    for (let i = 0; i < LOCAL_BUDGET + 1; i += 1) {
      results.push(await limiter.allowSnapshotRequest(snapshotRequest()));
    }

    // Regression: `new Ratelimit(...)` throwing (bad credentials, unreachable
    // constructor) must leave the module in the local-window state, permanently
    // for this process. If the construction error escaped, every snapshot
    // request would 500 until the process restarted.
    expect(limitMock).not.toHaveBeenCalled();
    expect(results.filter(Boolean)).toHaveLength(LOCAL_BUDGET);
  });

  /* ------------------------------------------------------------------ *
   * Memory bound
   * ------------------------------------------------------------------ */

  it('evicts the oldest key rather than growing past 10 000 distinct keys', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');
    const OLDEST = '198.51.100.1';
    const NEWER = '198.51.100.2';

    // Spend the budget on two keys so that "evicted" is distinguishable from
    // "still limited": an evicted key comes back with a fresh window, a retained
    // one keeps answering `false`.
    for (const key of [OLDEST, NEWER]) {
      for (let i = 0; i < LOCAL_BUDGET; i += 1) {
        expect(await limiter.allowSnapshotRequest(snapshotRequest(forwarded(key)))).toBe(true);
      }
    }
    expect(await limiter.allowSnapshotRequest(snapshotRequest(forwarded(OLDEST)))).toBe(false);
    expect(await limiter.allowSnapshotRequest(snapshotRequest(forwarded(NEWER)))).toBe(false);

    // Fill to the cap with distinct keys. Insertion order is what "oldest" means
    // here, so these all land after OLDEST and NEWER.
    for (let i = 0; i < 9_998; i += 1) {
      expect(await limiter.allowSnapshotRequest(snapshotRequest(forwarded(`10.0.1.${i}`)))).toBe(
        true
      );
    }

    // One key past the cap: this call must evict rather than insert.
    expect(await limiter.allowSnapshotRequest(snapshotRequest(forwarded('10.0.2.1')))).toBe(true);

    // `NEWER` first: asking for an already-refused key is a pure read and does
    // not insert, so it is the only order in which "still retained" is observable
    // while the map is exactly at the cap.
    expect(await limiter.allowSnapshotRequest(snapshotRequest(forwarded(NEWER)))).toBe(false);
    expect(await limiter.allowSnapshotRequest(snapshotRequest(forwarded(OLDEST)))).toBe(true);
    // Regression: the Map is keyed by caller-supplied IP, so behind a trusted
    // proxy the key set is attacker-controlled. Without the eviction loop the
    // process grows one entry per forged address until it is OOM-killed — a
    // denial of service that costs the attacker nothing. Asserting the *oldest*
    // specifically (rather than just "it still works") also catches an
    // off-by-one that evicts the wrong entry.
  });
});
