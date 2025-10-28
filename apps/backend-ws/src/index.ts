import { WebSocket, WebSocketServer } from 'ws';
import jwt from "jsonwebtoken";
import { prismaClient } from "@repo/db";

const PORT = parseInt(process.env.WS_PORT || "8080", 10);
const wss = new WebSocketServer({ port: PORT });
const JWT_SECRET = process.env.JWT_SECRET!;

wss.on('error', (err: any) => {
  if (err && (err.code === 'EADDRINUSE' || err.errno === -98)) {
    console.error(`WebSocket port ${PORT} is already in use. Set WS_PORT to a free port or stop the other process.`);
  } else {
    console.error("WebSocket server error:", err);
  }
  process.exit(1);
});

interface User {
  ws: WebSocket;
  rooms: Set<string>;
  userId: string;
  userName: string;
  lastSeen: Date;
}

interface RoomState {
  users: Set<string>;
  canvasData: {
    shapes: any[];
    viewport: { x: number; y: number; zoom: number };
  };
  lastUpdated: Date;
}

const users: Map<string, User> = new Map();
const rooms: Map<string, RoomState> = new Map();

function checkUser(token: string): { userId: string; userName: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (!decoded || typeof decoded === "string" || !decoded.userId) {
      return null;
    }
    return {
      userId: String(decoded.userId),
      userName: decoded.name || "Anonymous"
    };
  } catch(e) {
    return null;
  }
}

function broadcastToRoom(roomId: string, message: any, excludeUserId?: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.users.forEach((userId) => {
    if (userId !== excludeUserId) {
      const user = users.get(userId);
      if (user && user.ws.readyState === WebSocket.OPEN) {
        try {
          user.ws.send(JSON.stringify(message));
        } catch (error) {
          console.error("Failed to send message to user:", userId, error);
        }
      }
    }
  });
}

function getUserCount(roomId: string): number {
  const room = rooms.get(roomId);
  return room ? room.users.size : 0;
}

function joinRoom(userId: string, roomId: string) {
  const user = users.get(userId);
  if (!user) return;

  if (!user.rooms.has(roomId)) {
    user.rooms.add(roomId);
  }

  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      users: new Set(),
      canvasData: {
        shapes: [],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      lastUpdated: new Date()
    });
  }

  const room = rooms.get(roomId)!;
  room.users.add(userId);

  broadcastToRoom(roomId, {
    type: "user_joined",
    userId,
    userName: user.userName,
    userCount: room.users.size
  }, userId);

  user.ws.send(JSON.stringify({
    type: "room_state",
    roomId,
    canvasData: room.canvasData,
    users: Array.from(room.users).map(id => {
      const u = users.get(id);
      return u ? { id: u.userId, name: u.userName } : null;
    }).filter(Boolean)
  }));
}

function leaveRoom(userId: string, roomId: string) {
  const user = users.get(userId);
  if (!user) return;

  user.rooms.delete(roomId);

  const room = rooms.get(roomId);
  if (room) {
    room.users.delete(userId);

    broadcastToRoom(roomId, {
      type: "user_left",
      userId,
      userName: user.userName,
      userCount: room.users.size
    }, userId);

    if (room.users.size === 0) {
      rooms.delete(roomId);
    }
  }
}

wss.on('connection', function connection(ws, request) {
  const url = request.url;
  if (!url) return;
  
  const queryParams = new URLSearchParams(url.split('?')[1]);
  const token = queryParams.get('token') || "";
  const userInfo = checkUser(token);

  if (!userInfo) {
    ws.close();
    return;
  }

  const { userId, userName } = userInfo;
  
  users.set(userId, {
    ws,
    rooms: new Set(),
    userId,
    userName,
    lastSeen: new Date()
  });

  console.log(`User ${userName} (${userId}) connected`);

  ws.on('message', async function message(data) {
    let parsedData: any;
    try {
      parsedData = JSON.parse(data.toString());
    } catch (e) {
      console.error("Invalid JSON", e);
      return;
    }

    const type = parsedData?.type;
    const roomId = String(parsedData?.roomId || "");
    if (!type || !roomId) return;

    const user = users.get(userId);
    if (!user) return;

    user.lastSeen = new Date();

    switch (type) {
      case "join_room": {
        joinRoom(userId, roomId);
        break;
      }

      case "leave_room": {
        leaveRoom(userId, roomId);
        break;
      }

      case "chat": {
        try {
          const roomIdNum = Number(roomId);
          if (Number.isFinite(roomIdNum)) {
            await prismaClient.chat.create({
              data: {
                userId: userId,
                roomId: roomIdNum,
                message: String(parsedData.message || ""),
              }
            });
          }
        } catch (e) {
          console.error("Failed to persist chat", e);
        }
        broadcastToRoom(roomId, {
          type: "chat",
          message: parsedData.message,
          roomId,
          userId,
          userName: user.userName,
          timestamp: new Date().toISOString()
        }, userId);
        break;
      }

      case "shape_added":
      case "shape_removed":
      case "shape_updated": {
        const room = rooms.get(roomId);
        if (room) {
          room.lastUpdated = new Date();
          
          if (type === "shape_added") {
            room.canvasData.shapes.push(parsedData.data);
          } else if (type === "shape_removed") {
            room.canvasData.shapes = room.canvasData.shapes.filter(
              (shape: any) => shape.id !== parsedData.data.id
            );
          } else if (type === "shape_updated") {
            const index = room.canvasData.shapes.findIndex(
              (shape: any) => shape.id === parsedData.data.id
            );
            if (index !== -1) {
              room.canvasData.shapes[index] = parsedData.data;
            }
          }
        }
        
        broadcastToRoom(roomId, parsedData, userId);
        break;
      }

      case "state_sync": {
        const room = rooms.get(roomId);
        if (room && parsedData.data) {
          room.canvasData = parsedData.data;
          room.lastUpdated = new Date();
        }
        
        broadcastToRoom(roomId, parsedData, userId);
        break;
      }

      case "cursor_move": {
        broadcastToRoom(roomId, {
          ...parsedData,
          userId,
          userName: user.userName
        }, userId);
        break;
      }

      case "ping": {
        ws.send(JSON.stringify({
          type: "pong",
          timestamp: new Date().toISOString()
        }));
        break;
      }
    }
  });

  ws.on('close', () => {
    const user = users.get(userId);
    if (user) {
      user.rooms.forEach(roomId => {
        leaveRoom(userId, roomId);
      });
      
      users.delete(userId);
      console.log(`User ${userName} (${userId}) disconnected`);
    }
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for user ${userId}:`, error);
  });
});

console.log(`WebSocket server running on ws://localhost:${PORT}`);