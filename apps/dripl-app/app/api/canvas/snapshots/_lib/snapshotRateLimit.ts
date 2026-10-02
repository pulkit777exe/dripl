import type { NextRequest } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const MAX_REQUESTS_PER_MINUTE = 30;
const WINDOW_MS = 60_000;
const MAX_LOCAL_WINDOWS = 10_000;

interface LocalWindow {
  count: number;
  resetAt: number;
}

const localWindows = new Map<string, LocalWindow>();
/** `undefined` means "not resolved yet"; `null` means "no distributed provider". */
let distributedLimiter: Ratelimit | null | undefined;

/**
 * The per-IP key, unchanged from the in-memory limiter this replaces.
 *
 * Forwarded-IP headers are only honoured behind a trusted proxy. Without
 * `TRUST_PROXY=true` every caller shares the single `anonymous` bucket, which
 * is the safe direction: a spoofed `x-forwarded-for` must not buy an attacker a
 * fresh quota, and an untrusted deployment getting one shared bucket is a
 * performance problem rather than a security one.
 */
function requestKey(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  return process.env.TRUST_PROXY === 'true'
    ? forwarded?.split(',')[0]?.trim() || realIp || 'anonymous'
    : 'anonymous';
}

function getDistributedLimiter(): Ratelimit | null {
  if (distributedLimiter !== undefined) return distributedLimiter;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    distributedLimiter = null;
    return null;
  }

  try {
    distributedLimiter = new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(MAX_REQUESTS_PER_MINUTE, '60 s'),
      prefix: 'dripl:snapshot:ratelimit:v1',
    });
  } catch {
    distributedLimiter = null;
  }
  return distributedLimiter;
}

/**
 * Best-effort per-process fallback: fixed window, 30 requests per key per
 * minute, bounded at 10 000 keys.
 *
 * This is a local floor, not the shipped limit. When `UPSTASH_REDIS_REST_URL`
 * and `UPSTASH_REDIS_REST_TOKEN` are set (see docker-compose.yml and CI) the
 * window above is authoritative and is shared by every app instance; when they
 * are not — a laptop, a bare `next start` — the limit resets on every restart
 * and counts only the traffic this process happens to see. This matches
 * `apps/http-server/src/lib/rateLimiter.ts` and the AI route's fallback, so
 * the app is not the only component with a per-process limiter.
 */
function allowLocally(key: string): boolean {
  const now = Date.now();
  const current = localWindows.get(key);
  if (!current || current.resetAt <= now) {
    if (localWindows.size >= MAX_LOCAL_WINDOWS) {
      for (const [candidate, window] of localWindows) {
        if (window.resetAt <= now) localWindows.delete(candidate);
      }
      // Still full: evict oldest so a long-running process cannot grow without
      // bound on attacker-controlled keys.
      while (localWindows.size >= MAX_LOCAL_WINDOWS) {
        const oldest = localWindows.keys().next().value;
        if (oldest === undefined) break;
        localWindows.delete(oldest);
      }
    }
    localWindows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (current.count >= MAX_REQUESTS_PER_MINUTE) return false;
  current.count += 1;
  return true;
}

/**
 * Consume one unit of the caller's quota. Shared across instances when
 * Upstash is configured; process-local and best-effort otherwise.
 *
 * A failing distributed provider falls back to the local window rather than
 * rejecting: the alternative is that a Redis blip 429s every share link in the
 * product. Unlike the AI route, there is no spend to protect here, so failing
 * open into a bounded local limit is the better trade.
 */
export async function allowSnapshotRequest(request: NextRequest): Promise<boolean> {
  const key = requestKey(request);
  const limiter = getDistributedLimiter();
  if (limiter) {
    try {
      const result = await limiter.limit(`snapshot:${key}`);
      return result.success;
    } catch {
      // Fall through to the local window.
    }
  }
  return allowLocally(key);
}

/** Drop the cached provider and local windows. Test-only. */
export function clearSnapshotRateLimitState(): void {
  localWindows.clear();
  distributedLimiter = undefined;
}
