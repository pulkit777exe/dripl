import { WebSocket } from 'ws';

const RATE_LIMIT_WINDOW_MS = 1_000;
const RATE_LIMIT_MAX_MESSAGES = 30;

import type { Ratelimit } from '@upstash/ratelimit';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

const wsToUserMap = new Map<WebSocket, string>();
const buckets = new Map<string, TokenBucket>();

let ratelimit: Ratelimit | null = null;
let redisAvailable = false;

async function initRedis() {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return;

    const { Redis } = await import('@upstash/redis');
    const { Ratelimit } = await import('@upstash/ratelimit');

    const redis = new Redis({ url, token });
    ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(RATE_LIMIT_MAX_MESSAGES, '1 s'),
      prefix: 'dripl:ws:ratelimit',
    });
    redisAvailable = true;
  } catch {
    redisAvailable = false;
  }
}

// Try to init Redis at module load (non-blocking). The entire body of
// `initRedis` is inside its own try/catch and only ever sets the two module
// flags, so it cannot reject — nothing here can produce an unhandled
// rejection, and the module must stay usable before any handler runs.
void initRedis();

const MAX_LOCAL_BUCKETS = 10_000;

function pruneBuckets(now: number): void {
  for (const [identity, bucket] of buckets) {
    if (now - bucket.lastRefill >= RATE_LIMIT_WINDOW_MS) buckets.delete(identity);
  }
  while (buckets.size >= MAX_LOCAL_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (!oldest) break;
    buckets.delete(oldest);
  }
}

function checkInMemoryRateLimit(identity: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(identity);

  if (!bucket || now - bucket.lastRefill >= RATE_LIMIT_WINDOW_MS) {
    pruneBuckets(now);
    buckets.set(identity, { tokens: RATE_LIMIT_MAX_MESSAGES - 1, lastRefill: now });
    return true;
  }

  if (bucket.tokens <= 0) return false;

  bucket.tokens--;
  return true;
}

export function setRateLimitIdentity(ws: WebSocket, userId: string): void {
  wsToUserMap.set(ws, userId);
}

export function removeRateLimitIdentity(ws: WebSocket): void {
  // Keep the bucket until its short window expires. Deleting it as soon as one
  // of several tabs disconnects would let that tab reset the user's limit.
  wsToUserMap.delete(ws);
}

export async function checkRateLimit(ws: WebSocket): Promise<boolean> {
  const identity = wsToUserMap.get(ws) ?? 'anonymous';

  if (redisAvailable && ratelimit) {
    try {
      const { success } = await ratelimit.limit(identity);
      return success;
    } catch {
      // Redis failed, fall back to in-memory
      return checkInMemoryRateLimit(identity);
    }
  }

  return checkInMemoryRateLimit(identity);
}

export { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_MESSAGES };
