import Redis from "ioredis";
import type { DriplElement } from "@dripl/common";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const ROOM_STATE_TTL = 3600;

let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let redisClient: Redis | null = null;

interface RoomMessage {
  type: string;
  roomId: string;
  senderId: string;
  payload: unknown;
}

const SERVER_ID = crypto.randomUUID();

export async function initRedis(): Promise<boolean> {
  try {
    redisClient = new Redis(REDIS_URL, {
      retryStrategy: () => null,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    publisher = new Redis(REDIS_URL, {
      retryStrategy: () => null,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    subscriber = new Redis(REDIS_URL, {
      retryStrategy: () => null,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });

    // Suppress unhandled error events
    redisClient.on("error", () => {});
    publisher.on("error", () => {});
    subscriber.on("error", () => {});

    await redisClient.connect();
    await redisClient.ping();
    console.log("✓ Redis connected");
    return true;
  } catch (error) {
    console.warn(
      "Redis not available, running in single-instance mode:",
      (error as Error).message,
    );
    redisClient = null;
    publisher = null;
    subscriber = null;
    return false;
  }
}

export async function publishToRoom(
  roomId: string,
  type: string,
  payload: unknown,
): Promise<void> {
  if (!publisher) return;

  const message: RoomMessage = {
    type,
    roomId,
    senderId: SERVER_ID,
    payload,
  };

  try {
    await publisher.publish(`room:${roomId}`, JSON.stringify(message));
  } catch (error) {
    console.error("Redis publish error:", error);
  }
}

export async function subscribeToRoom(
  roomId: string,
  handler: (type: string, payload: unknown) => void,
): Promise<void> {
  if (!subscriber) return;

  const channel = `room:${roomId}`;

  subscriber.on("message", (ch: string, message: string) => {
    if (ch !== channel) return;

    try {
      const parsed: RoomMessage = JSON.parse(message);
      if (parsed.senderId === SERVER_ID) return;
      handler(parsed.type, parsed.payload);
    } catch (error) {
      console.error("Redis message parse error:", error);
    }
  });

  await subscriber.subscribe(channel);
}

export async function unsubscribeFromRoom(roomId: string): Promise<void> {
  if (!subscriber) return;
  await subscriber.unsubscribe(`room:${roomId}`);
}

export async function cacheRoomState(
  roomId: string,
  elements: DriplElement[],
): Promise<void> {
  if (!redisClient) return;

  try {
    await redisClient.setex(
      `room:state:${roomId}`,
      ROOM_STATE_TTL,
      JSON.stringify(elements),
    );
  } catch (error) {
    console.error("Redis cache error:", error);
  }
}

export async function getCachedRoomState(
  roomId: string,
): Promise<DriplElement[] | null> {
  if (!redisClient) return null;

  try {
    const cached = await redisClient.get(`room:state:${roomId}`);
    if (cached) {
      return JSON.parse(cached) as DriplElement[];
    }
  } catch (error) {
    console.error("Redis cache read error:", error);
  }

  return null;
}

export async function closeRedis(): Promise<void> {
  if (subscriber) await subscriber.quit();
  if (publisher) await publisher.quit();
  if (redisClient) await redisClient.quit();
}

export { SERVER_ID };
