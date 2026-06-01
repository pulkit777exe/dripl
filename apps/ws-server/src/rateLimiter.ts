import { WebSocket } from 'ws';

export const RATE_LIMIT_WINDOW_MS = 1_000;
export const RATE_LIMIT_MAX_MESSAGES = 30;

const userMessageCounts = new Map<WebSocket, { count: number; resetAt: number }>();

export function checkRateLimit(ws: WebSocket): boolean {
  const now = Date.now();
  const rateInfo = userMessageCounts.get(ws);
  if (rateInfo && rateInfo.resetAt > now) {
    rateInfo.count += 1;
    if (rateInfo.count > RATE_LIMIT_MAX_MESSAGES) {
      return false;
    }
  } else {
    userMessageCounts.set(ws, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  }
  return true;
}

export function startRateLimitCleanup(): NodeJS.Timeout {
  return setInterval(() => {
    const now = Date.now();
    for (const [key, info] of userMessageCounts.entries()) {
      if (info.resetAt < now) {
        userMessageCounts.delete(key);
      }
    }
  }, 60_000);
}
