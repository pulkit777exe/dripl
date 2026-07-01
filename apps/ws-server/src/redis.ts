import { Redis } from '@upstash/redis';
import { logger } from './index';

let redis: Redis | null = null;

const INSTANCE_ID = Math.random().toString(36).slice(2, 10);
const roomHandlers = new Map<string, (message: unknown) => void>();
let initialized = false;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return null;
  }
  redis = new Redis({ url, token });
  return redis;
}

function initSubscription(): void {
  if (initialized) return;
  const client = getRedis();
  if (!client) return;
  initialized = true;

  try {
    const sub = client.psubscribe('dripl:room:*');
    sub.on('pmessage', (data: { pattern: string; channel: string; message: unknown }) => {
      try {
        const roomId = String(data.channel).replace('dripl:room:', '');
        const payload = typeof data.message === 'string' ? JSON.parse(data.message) : data.message;
        if (payload.instanceId === INSTANCE_ID) return;
        const handler = roomHandlers.get(roomId);
        if (handler) handler(payload);
      } catch (err) {
        logger.error({ event: 'redis_message_parse_error', error: err instanceof Error ? err.message : String(err) });
      }
    });
    logger.info({ event: 'redis_pattern_subscribed', pattern: 'dripl:room:*' });
  } catch (err) {
    logger.error({ event: 'redis_subscribe_failed', error: err instanceof Error ? err.message : String(err) });
  }
}

export function subscribeToRoom(roomId: string, handler: (message: unknown) => void): void {
  initSubscription();
  roomHandlers.set(roomId, handler);
}

export function unsubscribeFromRoom(roomId: string): void {
  roomHandlers.delete(roomId);
}

export async function publishToRoom(roomId: string, payload: object): Promise<void> {
  const client = getRedis();
  if (!client) return;
  try {
    await client.publish(`dripl:room:${roomId}`, {
      ...payload,
      instanceId: INSTANCE_ID,
      timestamp: Date.now(),
    });
  } catch (err) {
    logger.error({ event: 'redis_publish_failed', roomId, error: err instanceof Error ? err.message : String(err) });
  }
}

export function isRedisAvailable(): boolean {
  return getRedis() !== null;
}
