import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { DriplElement } from "@dripl/common";
import { v7 as uuidv7 } from "uuid";

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

function generateUserId(): string {
  const userId = uuidv7();
  return `user_${userId}`;
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

function broadcastToRoom(roomId: string, message: any, excludeUserId?: string) {
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

wss.on("connection", (ws) => {
  let currentUserId: string | null = null;
  let currentRoomId: string | null = null;

  console.log("New WebSocket connection");

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case "join_room": {
          const { roomId, userName } = message;
          const userId = generateUserId();
          const color = generateUserColor();

          currentUserId = userId;
          currentRoomId = roomId;

          const room = getOrCreateRoom(roomId);
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

          // Send current room state to new user
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

          // Broadcast user join to others in room
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

              // Clean up empty rooms
              if (room.users.size === 0) {
                rooms.delete(currentRoomId);
                console.log(`Room ${currentRoomId} deleted (empty)`);
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

        // Clean up empty rooms
        if (room.users.size === 0) {
          rooms.delete(currentRoomId);
          console.log(`Room ${currentRoomId} deleted (empty)`);
        }
      }
    }
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});
