import { WebSocket } from 'ws';

const RATE_LIMIT_WINDOW_MS = 1_000;
const RATE_LIMIT_MAX_MESSAGES = 30;

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

const wsToUserMap = new Map<WebSocket, string>();
const buckets = new Map<string, TokenBucket>();

let ratelimit: any = null;
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

// Try to init Redis at module load (non-blocking)
initRedis();

function checkInMemoryRateLimit(identity: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(identity);

  if (!bucket || now - bucket.lastRefill >= RATE_LIMIT_WINDOW_MS) {
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
  const identity = wsToUserMap.get(ws);
  wsToUserMap.delete(ws);
  if (identity) buckets.delete(identity);
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
