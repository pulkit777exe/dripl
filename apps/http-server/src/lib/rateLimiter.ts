import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimiter {
  limit(identifier: string): Promise<RateLimitResult>;
}

interface MemoryWindow {
  count: number;
  resetAt: number;
}

/**
 * Create a rate limiter that uses Upstash when configured and a bounded
 * process-local window otherwise. Redis is an operational optimization, not a
 * reason for a single-instance development server to reject every request.
 */
export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  prefix: string;
}): RateLimiter {
  const memory = new Map<string, MemoryWindow>();
  let distributed: Ratelimit | null = null;

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (redisUrl && redisToken) {
    try {
      distributed = new Ratelimit({
        redis: new Redis({ url: redisUrl, token: redisToken }),
        limiter: Ratelimit.slidingWindow(options.limit, `${Math.ceil(options.windowMs / 1000)} s`),
        prefix: options.prefix,
      });
    } catch {
      distributed = null;
    }
  }

  const checkMemory = (identifier: string): RateLimitResult => {
    const now = Date.now();
    const current = memory.get(identifier);
    if (!current || current.resetAt <= now) {
      memory.set(identifier, { count: 1, resetAt: now + options.windowMs });
      return {
        success: true,
        remaining: Math.max(0, options.limit - 1),
        resetAt: now + options.windowMs,
      };
    }

    if (current.count >= options.limit) {
      return { success: false, remaining: 0, resetAt: current.resetAt };
    }

    current.count += 1;
    return {
      success: true,
      remaining: Math.max(0, options.limit - current.count),
      resetAt: current.resetAt,
    };
  };

  return {
    async limit(identifier: string): Promise<RateLimitResult> {
      if (distributed) {
        try {
          const result = await distributed.limit(identifier);
          return {
            success: result.success,
            remaining: result.remaining,
            resetAt: result.reset,
          };
        } catch {
          // Fall through to the local limiter if the remote provider fails.
        }
      }

      // Prevent unbounded identity retention in long-running single-process
      // deployments while keeping the hot path allocation-free.
      if (memory.size > 10_000) {
        for (const [key, window] of memory) {
          if (window.resetAt <= now()) memory.delete(key);
        }
        // If every key is still active, evict oldest entries rather than
        // allowing a long-running process-local fallback to grow without
        // bound. Distributed rate limiting remains the production default.
        while (memory.size >= 10_000) {
          const oldest = memory.keys().next().value;
          if (oldest === undefined) break;
          memory.delete(oldest);
        }
      }
      return checkMemory(identifier);
    },
  };
}

function now(): number {
  return Date.now();
}
