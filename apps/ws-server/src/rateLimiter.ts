import { WebSocket } from 'ws';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '1 s'),
  prefix: 'dripl:ws:ratelimit',
});

const wsToUserMap = new Map<WebSocket, string>();

export function setRateLimitIdentity(ws: WebSocket, userId: string): void {
  wsToUserMap.set(ws, userId);
}

export function removeRateLimitIdentity(ws: WebSocket): void {
  wsToUserMap.delete(ws);
}

export async function checkRateLimit(ws: WebSocket): Promise<boolean> {
  const identity = wsToUserMap.get(ws) ?? 'anonymous';
  const { success } = await ratelimit.limit(identity);
  return success;
}

export const RATE_LIMIT_WINDOW_MS = 1_000;
export const RATE_LIMIT_MAX_MESSAGES = 30;
