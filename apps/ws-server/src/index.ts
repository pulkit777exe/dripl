import { WebSocketServer, WebSocket } from "ws";
import { createServer, IncomingMessage } from "http";
import { DriplElement } from "@dripl/common";
import { v4 as uuidv4 } from "uuid";
import jwt from "jsonwebtoken";
import prisma from "@dripl/db";

const JWT_SECRET = process.env.JWT_SECRET || "secret-key";

interface User {
  userId: string;
  userName: string;
  color: string;
  ws: WebSocket;
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

const server = createServer();
const wss = new WebSocketServer({ server });

const rooms = new Map<string, Room>();

// Debounced saves to database
const saveTimeouts = new Map<string, NodeJS.Timeout>();
const SAVE_DEBOUNCE_MS = 2000;

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
    }, SAVE_DEBOUNCE_MS)
  );
}

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

function broadcastToRoom(
  roomId: string,
  message: unknown,
  excludeUserId?: string
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

// Verify JWT token from connection URL
function verifyToken(req: IncomingMessage): { userId: string } | null {
  try {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const token = url.searchParams.get("token");

    if (!token) {
      console.log("Connection rejected: No token provided");
      return null;
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    return decoded;
  } catch (error) {
    console.log("Connection rejected: Invalid token", error);
    return null;
  }
}

// Extract roomId from connection URL
function extractRoomId(req: IncomingMessage): string | null {
  try {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    return url.searchParams.get("roomId");
  } catch {
    return null;
  }
}

wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
  const authResult = verifyToken(req);
  const roomIdFromUrl = extractRoomId(req);
  const authenticatedUserId = authResult?.userId || null;

  let currentUserId: string | null = null;
  let currentRoomId: string | null = null;

  console.log(
    `New WebSocket connection${authenticatedUserId ? ` (authenticated: ${authenticatedUserId})` : " (anonymous)"}`
  );

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case "join_room": {
          const { roomId, userName } = message;
          const userId = authenticatedUserId || `anon_${uuidv4()}`;
          const color = generateUserColor();

          currentUserId = userId;
          currentRoomId = roomId;

          const room = getOrCreateRoom(roomId);

          if (room.elements.length === 0) {
            try {
              const dbRoom = await prisma.canvasRoom.findUnique({
                where: { slug: roomId },
              });

              if (dbRoom && dbRoom.content) {
                room.elements = JSON.parse(dbRoom.content as string) || [];
                console.log(
                  `Loaded ${room.elements.length} elements from database for room ${roomId}`
                );
              }
            } catch (error) {
              console.error("Failed to load room from database:", error);
            }
          }

          const user: User = {
            userId,
            userName: userName || `User ${room.users.size + 1}`,
            color,
            ws,
          };
          room.users.set(userId, user);

          console.log(
            `User ${user.userName} (${userId}) joined room ${roomId}`
          );

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
              ([uid, cursor]) => ({
                userId: uid,
                ...cursor,
              })
            ),
            yourUserId: userId,
          };
          ws.send(JSON.stringify(syncMessage));

          const joinMessage = {
            type: "user_join",
            userId,
            userName: user.userName,
            color,
            timestamp: Date.now(),
            roomId,
          };
          broadcastToRoom(roomId, joinMessage, userId);
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
              broadcastToRoom(currentRoomId, leaveMessage);

              if (room.users.size === 0) {
                rooms.delete(currentRoomId);
                console.log(
                  `Room ${currentRoomId} removed from memory (empty)`
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
              broadcastToRoom(
                currentRoomId,
                message,
                currentUserId || undefined
              );
              scheduleDatabaseSave(currentRoomId, room.elements);
            }
          }
          break;
        }

        case "update_element": {
          if (currentRoomId) {
            const room = rooms.get(currentRoomId);
            if (room) {
              const index = room.elements.findIndex(
                (e) => e.id === message.element.id
              );
              if (index !== -1) {
                room.elements[index] = message.element;
              }
              broadcastToRoom(
                currentRoomId,
                message,
                currentUserId || undefined
              );
              scheduleDatabaseSave(currentRoomId, room.elements);
            }
          }
          break;
        }

        case "delete_element": {
          if (currentRoomId) {
            const room = rooms.get(currentRoomId);
            if (room) {
              room.elements = room.elements.filter(
                (e) => e.id !== message.elementId
              );
              broadcastToRoom(
                currentRoomId,
                message,
                currentUserId || undefined
              );
              scheduleDatabaseSave(currentRoomId, room.elements);
            }
          }
          break;
        }

        case "cursor_move": {
          if (currentRoomId && currentUserId) {
            const room = rooms.get(currentRoomId);
            if (room) {
              room.cursors.set(currentUserId, { x: message.x, y: message.y });
              broadcastToRoom(
                currentRoomId,
                {
                  ...message,
                  userId: currentUserId,
                },
                currentUserId
              );
            }
          }
          break;
        }

        default:
          console.log("Unknown message type:", message.type);
      }
    } catch (error) {
      console.error("Failed to parse message:", error);
    }
  });

  ws.on("close", () => {
    if (currentRoomId && currentUserId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        room.users.delete(currentUserId);
        room.cursors.delete(currentUserId);
        console.log(
          `User ${currentUserId} disconnected from room ${currentRoomId}`
        );

        const leaveMessage = {
          type: "user_leave",
          userId: currentUserId,
          timestamp: Date.now(),
          roomId: currentRoomId,
        };
        broadcastToRoom(currentRoomId, leaveMessage);

        if (room.users.size === 0) {
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

const PORT = process.env.WS_PORT || 3001;
server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down...");

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

  await prisma.$disconnect();
  process.exit(0);
});