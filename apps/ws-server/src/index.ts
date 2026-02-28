import { WebSocketServer, WebSocket } from "ws";
import { createServer, IncomingMessage } from "http";
import { DriplElement } from "@dripl/common";
import { v4 as uuidv4 } from "uuid";
import jwt from "jsonwebtoken";
import prisma from "@dripl/db";
import {
  initRedis,
  publishToRoom,
  subscribeToRoom,
  unsubscribeFromRoom,
  cacheRoomState,
  getCachedRoomState,
  closeRedis,
  SERVER_ID,
} from "./redis.js";
import { messageSchema } from "./validation.js";

const JWT_SECRET = process.env.JWT_SECRET || "secret-key";
const HEARTBEAT_INTERVAL = 30000;

interface User {
  userId: string;
  userName: string;
  color: string;
  ws: WebSocket;
  isAlive: boolean;
}

interface Cursor {
  x: number;
  y: number;
}

interface Room {
  id: string;
  elements: DriplElement[];
  users: Map<string, User>;
  cursors: Map<string, Cursor>;
}

const MAX_CONNECTIONS_PER_IP = 10;
const RATE_LIMIT_WINDOW_MS = 1000;
const MAX_MESSAGES_PER_WINDOW = 50;

const ipConnectionCounts = new Map<string, number>();
const messageRateLimits = new WeakMap<
  WebSocket,
  { count: number; windowStart: number }
>();

const server = createServer();
const wss = new WebSocketServer({ server, maxPayload: 1024 * 1024 }); // 1MB limit

const rooms = new Map<string, Room>();

const saveTimeouts = new Map<string, NodeJS.Timeout>();
const SAVE_DEBOUNCE_MS = 2000;
const CACHE_DEBOUNCE_MS = 500;
const cacheTimeouts = new Map<string, NodeJS.Timeout>();

let redisAvailable = false;

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function scheduleDatabaseSave(roomSlug: string, elements: DriplElement[]) {
  if (saveTimeouts.has(roomSlug)) {
    clearTimeout(saveTimeouts.get(roomSlug)!);
  }

  saveTimeouts.set(
    roomSlug,
    setTimeout(async () => {
      try {
        await prisma.canvasRoom.update({
          where: { slug: roomSlug },
          data: {
            content: JSON.stringify(elements),
            updatedAt: new Date(),
          },
        });
        console.log(`✓ Saved room ${roomSlug} to database`);
      } catch (error) {
        console.error("Database save error:", error);
      }
      saveTimeouts.delete(roomSlug);
    }, SAVE_DEBOUNCE_MS),
  );
}

function scheduleRedisCache(roomSlug: string, elements: DriplElement[]) {
  if (!redisAvailable) return;

  if (cacheTimeouts.has(roomSlug)) {
    clearTimeout(cacheTimeouts.get(roomSlug)!);
  }

  cacheTimeouts.set(
    roomSlug,
    setTimeout(async () => {
      await cacheRoomState(roomSlug, elements);
      cacheTimeouts.delete(roomSlug);
    }, CACHE_DEBOUNCE_MS),
  );
}

// ---------------------------------------------------------------------------
// Room helpers
// ---------------------------------------------------------------------------

function generateUserColor(): string {
  const colors = [
    "#FF6B6B",
    "#4ECDC4",
    "#45B7D1",
    "#FFA07A",
    "#98D8C8",
    "#F7DC6F",
    "#BB8FCE",
    "#85C1E2",
  ];
  return colors[Math.floor(Math.random() * colors.length)]!;
}

function getOrCreateRoom(roomId: string): Room {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      elements: [],
      users: new Map(),
      cursors: new Map(),
    });
  }
  return rooms.get(roomId)!;
}

/**
 * Broadcast a message to all **local** WebSocket connections in a room,
 * optionally excluding a specific user.
 */
function broadcastToLocalClients(
  roomId: string,
  message: unknown,
  excludeUserId?: string,
) {
  const room = rooms.get(roomId);
  if (!room) return;

  const messageStr = JSON.stringify(message);
  room.users.forEach((user) => {
    if (
      user.userId !== excludeUserId &&
      user.ws.readyState === WebSocket.OPEN
    ) {
      user.ws.send(messageStr);
    }
  });
}

/**
 * Broadcast a message to all clients in a room, using Redis Pub/Sub when
 * available so that clients connected to other server instances also receive
 * the update.  Local clients on *this* instance are notified directly; the
 * Redis subscriber handler takes care of clients on *other* instances.
 */
async function broadcastToRoom(
  roomId: string,
  message: unknown,
  excludeUserId?: string,
) {
  // Always deliver to local clients immediately (low latency).
  broadcastToLocalClients(roomId, message, excludeUserId);

  // Publish to Redis so other server instances can relay to their clients.
  if (redisAvailable) {
    await publishToRoom(roomId, "broadcast", {
      message,
      excludeUserId,
    });
  }
}

// ---------------------------------------------------------------------------
// Redis subscription handler — receives messages published by OTHER instances
// ---------------------------------------------------------------------------

function handleRedisRoomMessage(type: string, payload: unknown) {
  if (type !== "broadcast") return;

  const { message, excludeUserId } = payload as {
    message: Record<string, unknown>;
    excludeUserId?: string;
  };

  const roomId = message.roomId as string | undefined;
  if (!roomId) return;

  // Deliver to all local clients (the sender already excluded themselves via
  // excludeUserId, but that user lives on the *other* instance – we don't
  // have that WebSocket here, so we can safely broadcast to everyone local).
  broadcastToLocalClients(roomId, message);
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function verifyToken(req: IncomingMessage): { userId: string } | null {
  try {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const token = url.searchParams.get("token");

    if (!token) {
      return null;
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    return decoded;
  } catch (error) {
    console.log("Connection check: Invalid token", error);
    return null;
  }
}

function extractRoomId(req: IncomingMessage): string | null {
  try {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    return url.searchParams.get("roomId");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Heartbeat — detect stale connections
// ---------------------------------------------------------------------------

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    const user = (ws as any).__user as User | undefined;
    if (user && !user.isAlive) {
      ws.terminate();
      return;
    }
    if (user) {
      user.isAlive = false;
    }
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

// ---------------------------------------------------------------------------
// WebSocket connection handler
// ---------------------------------------------------------------------------

wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
  const ip = req.socket.remoteAddress || "unknown";
  const currentCount = ipConnectionCounts.get(ip) || 0;

  if (currentCount >= MAX_CONNECTIONS_PER_IP) {
    console.log(`Connection rejected: Rate limit exceeded for IP ${ip}`);
    ws.close(1008, "Rate limit exceeded");
    return;
  }

  ipConnectionCounts.set(ip, currentCount + 1);

  const authResult = verifyToken(req);
  const roomIdFromUrl = extractRoomId(req);
  const authenticatedUserId = authResult?.userId || null;

  let currentUserId: string | null = null;
  let currentRoomId: string | null = null;

  console.log(
    `New WebSocket connection from ${ip}${authenticatedUserId ? ` (authenticated: ${authenticatedUserId})` : " (anonymous)"}`,
  );

  // Respond to pongs for heartbeat
  ws.on("pong", () => {
    const user = (ws as any).__user as User | undefined;
    if (user) user.isAlive = true;
  });

  ws.on("message", async (data) => {
    // Rate Limiting Logic
    const now = Date.now();
    const rateLimitData = messageRateLimits.get(ws) || {
      count: 0,
      windowStart: now,
    };

    if (now - rateLimitData.windowStart > RATE_LIMIT_WINDOW_MS) {
      // Reset window
      rateLimitData.count = 1;
      rateLimitData.windowStart = now;
    } else {
      rateLimitData.count++;
      if (rateLimitData.count > MAX_MESSAGES_PER_WINDOW) {
        if (rateLimitData.count === MAX_MESSAGES_PER_WINDOW + 1) {
          console.warn(`Rate limit exceeded for user ${currentUserId || ip}`);
          ws.send(
            JSON.stringify({ type: "error", message: "Rate limit exceeded" }),
          );
        }
        return; // Drop message
      }
    }
    messageRateLimits.set(ws, rateLimitData);

    try {
      const rawMessage = JSON.parse(data.toString());
      const validation = messageSchema.safeParse(rawMessage);

      if (!validation.success) {
        return;
      }

      const message = validation.data;

      switch (message.type) {
        case "join_room": {
          const { roomId, userName } = message;
          const userId = authenticatedUserId || `anon_${uuidv4()}`;
          const color = generateUserColor();

          currentUserId = userId;
          currentRoomId = roomId;

          const room = getOrCreateRoom(roomId);

          // L1: In-memory → L2: Redis cache → L3: Database
          if (room.elements.length === 0) {
            let loaded = false;

            // Try Redis cache first (fast)
            if (redisAvailable) {
              const cached = await getCachedRoomState(roomId);
              if (cached && cached.length > 0) {
                room.elements = cached;
                loaded = true;
                console.log(
                  `Loaded ${room.elements.length} elements from Redis cache for room ${roomId}`,
                );
              }
            }

            // Fall back to database
            if (!loaded) {
              try {
                const dbRoom = await prisma.canvasRoom.findUnique({
                  where: { slug: roomId },
                });

                if (dbRoom && dbRoom.content) {
                  room.elements = JSON.parse(dbRoom.content as string) || [];
                  console.log(
                    `Loaded ${room.elements.length} elements from database for room ${roomId}`,
                  );

                  // Warm the Redis cache
                  if (redisAvailable && room.elements.length > 0) {
                    await cacheRoomState(roomId, room.elements);
                  }
                }
              } catch (error) {
                console.error("Failed to load room from database:", error);
              }
            }
          }

          // Subscribe to Redis channel for this room (first user on this instance)
          if (redisAvailable && room.users.size === 0) {
            await subscribeToRoom(roomId, handleRedisRoomMessage);
          }

          const user: User = {
            userId,
            userName: userName || `User ${room.users.size + 1}`,
            color,
            ws,
            isAlive: true,
          };
          room.users.set(userId, user);
          (ws as any).__user = user;

          console.log(
            `User ${user.userName} (${userId}) joined room ${roomId}`,
          );

          // Send full state to the joining user
          const syncMessage = {
            type: "sync_room_state",
            userId: "server",
            timestamp: Date.now(),
            roomId,
            elements: room.elements,
            users: Array.from(room.users.values()).map((u) => ({
              userId: u.userId,
              userName: u.userName,
              color: u.color,
            })),
            cursors: Array.from(room.cursors.entries()).map(
              ([uid, cursor]) => {
                const user = room.users.get(uid);
                return {
                  userId: uid,
                  ...cursor,
                  userName: user?.userName ?? "Unknown",
                  color: user?.color ?? "#000000",
                };
              },
            ),
            yourUserId: userId,
          };
          ws.send(JSON.stringify(syncMessage));

          // Notify others
          const joinMessage = {
            type: "user_join",
            userId,
            userName: user.userName,
            color,
            timestamp: Date.now(),
            roomId,
          };
          await broadcastToRoom(roomId, joinMessage, userId);
          break;
        }

        case "leave_room": {
          if (currentRoomId && currentUserId) {
            const room = rooms.get(currentRoomId);
            if (room) {
              room.users.delete(currentUserId);
              room.cursors.delete(currentUserId);

              const leaveMessage = {
                type: "user_leave",
                userId: currentUserId,
                timestamp: Date.now(),
                roomId: currentRoomId,
              };
              await broadcastToRoom(currentRoomId, leaveMessage);

              if (room.users.size === 0) {
                // No more local users — unsubscribe from Redis & clean up
                if (redisAvailable) {
                  await unsubscribeFromRoom(currentRoomId);
                }
                rooms.delete(currentRoomId);
                console.log(
                  `Room ${currentRoomId} removed from memory (empty)`,
                );
              }
            }
          }
          currentRoomId = null;
          currentUserId = null;
          break;
        }

        case "add_element": {
          if (currentRoomId) {
            const room = rooms.get(currentRoomId);
            if (room) {
              room.elements.push(message.element);
              await broadcastToRoom(
                currentRoomId,
                message,
                currentUserId || undefined,
              );
              scheduleDatabaseSave(currentRoomId, room.elements);
              scheduleRedisCache(currentRoomId, room.elements);
            }
          }
          break;
        }

        case "update_element": {
          if (currentRoomId) {
            const room = rooms.get(currentRoomId);
            if (room) {
              const index = room.elements.findIndex(
                (e) => e.id === message.element.id,
              );
              if (index !== -1) {
                room.elements[index] = message.element;
              }
              await broadcastToRoom(
                currentRoomId,
                message,
                currentUserId || undefined,
              );
              scheduleDatabaseSave(currentRoomId, room.elements);
              scheduleRedisCache(currentRoomId, room.elements);
            }
          }
          break;
        }

        case "delete_element": {
          if (currentRoomId) {
            const room = rooms.get(currentRoomId);
            if (room) {
              room.elements = room.elements.filter(
                (e) => e.id !== message.elementId,
              );
              await broadcastToRoom(
                currentRoomId,
                message,
                currentUserId || undefined,
              );
              scheduleDatabaseSave(currentRoomId, room.elements);
              scheduleRedisCache(currentRoomId, room.elements);
            }
          }
          break;
        }

        case "cursor_move": {
          if (currentRoomId && currentUserId) {
            const room = rooms.get(currentRoomId);
            if (room) {
              room.cursors.set(currentUserId, { x: message.x, y: message.y });
              const user = room.users.get(currentUserId);
              await broadcastToRoom(
                currentRoomId,
                {
                  ...message,
                  userId: currentUserId,
                  userName: message.userName ?? user?.userName ?? "Unknown",
                  color: message.color ?? user?.color ?? "#000000",
                },
                currentUserId,
              );
            }
          }
          break;
        }

        default:
          const _exhaustiveCheck: never = message;
          console.log("Unknown message type:", _exhaustiveCheck);
      }
    } catch (error) {
      console.error("Failed to parse message:", error);
    }
  });

  ws.on("close", async () => {
    // Decrement connection count
    const count = ipConnectionCounts.get(ip) || 0;
    if (count > 0) {
      ipConnectionCounts.set(ip, count - 1);
    }

    if (currentRoomId && currentUserId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        room.users.delete(currentUserId);
        room.cursors.delete(currentUserId);
        console.log(
          `User ${currentUserId} disconnected from room ${currentRoomId}`,
        );

        const leaveMessage = {
          type: "user_leave",
          userId: currentUserId,
          timestamp: Date.now(),
          roomId: currentRoomId,
        };
        await broadcastToRoom(currentRoomId, leaveMessage);

        if (room.users.size === 0) {
          if (redisAvailable) {
            await unsubscribeFromRoom(currentRoomId);
          }
          rooms.delete(currentRoomId);
          console.log(`Room ${currentRoomId} removed from memory (empty)`);
        }
      }
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function start() {
  // Attempt Redis connection — if it fails, the server works in
  // single-instance mode with in-memory-only broadcasting.
  redisAvailable = await initRedis();

  if (redisAvailable) {
    console.log("✓ Multi-instance mode: Redis Pub/Sub enabled");
  } else {
    console.log("⚠ Single-instance mode: Redis not available");
  }

  const PORT = process.env.WS_PORT || 3001;
  server.listen(PORT, () => {
    console.log(`WebSocket server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function gracefulShutdown() {
  console.log("Shutting down...");

  clearInterval(heartbeatInterval);

  // Save all rooms to database
  for (const [roomId, room] of rooms) {
    if (room.elements.length > 0) {
      try {
        await prisma.canvasRoom.update({
          where: { slug: roomId },
          data: {
            content: JSON.stringify(room.elements),
            updatedAt: new Date(),
          },
        });
        console.log(`Saved room ${roomId} before shutdown`);
      } catch (error) {
        console.error(`Failed to save room ${roomId}:`, error);
      }
    }
  }

  await closeRedis();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
