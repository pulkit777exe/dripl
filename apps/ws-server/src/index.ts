import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
console.log('__dirname:', __dirname);
const envPath = path.resolve(__dirname, '../../../.env');
console.log('Loading env from:', envPath);
config({ path: envPath });
console.log('JWT_SECRET after dotenv:', process.env.JWT_SECRET ? 'present' : 'missing');

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import type { DriplElement } from '@dripl/common';
import { db } from '@dripl/db';
import { messageSchema } from './validation';

function toDriplElement(el: unknown): DriplElement {
  const e = el as DriplElement;
  if (
    !e.id ||
    !e.type ||
    typeof e.x !== 'number' ||
    typeof e.y !== 'number' ||
    typeof e.width !== 'number' ||
    typeof e.height !== 'number'
  ) {
    throw new Error('Invalid element structure');
  }
  return e;
}

const requiredEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const JWT_SECRET = requiredEnv('JWT_SECRET');
const WS_PORT = Number(process.env.WS_PORT || 3001);
const HEARTBEAT_INTERVAL_MS = 30_000;
const SAVE_DEBOUNCE_MS = 2_000;

interface UserConnection {
  userId: string;
  displayName: string;
  color: string;
  ws: WebSocket;
  isAlive: boolean;
}

interface Cursor {
  x: number;
  y: number;
}

interface RoomState {
  roomId: string;
  elements: DriplElement[];
  users: Map<string, UserConnection>;
  cursors: Map<string, Cursor>;
  loadedFromDb: boolean;
}

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        service: 'ws-server',
        version: process.env.npm_package_version || '0.0.0',
      })
    );
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ server, maxPayload: 1024 * 1024 });
const rooms = new Map<string, RoomState>();
const saveTimeouts = new Map<string, NodeJS.Timeout>();

function parseStoredElements(raw: string | null | undefined): DriplElement[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as DriplElement[];
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.elements)) {
        return record.elements as DriplElement[];
      }
    }
  } catch {
    return [];
  }
  return [];
}

function serializeElements(elements: DriplElement[]): string {
  return JSON.stringify({ elements });
}

function resolveTokenFromUrl(reqUrl: string | undefined, host: string | undefined): string | null {
  if (!reqUrl || !host) return null;
  try {
    const url = new URL(reqUrl, `http://${host}`);
    return url.searchParams.get('token');
  } catch {
    return null;
  }
}

function resolveUserFromToken(token: string | null): string | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId?: string };
    return decoded.userId ?? null;
  } catch {
    return null;
  }
}

function getOrCreateRoom(roomId: string): RoomState {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      roomId,
      elements: [],
      users: new Map(),
      cursors: new Map(),
      loadedFromDb: false,
    };
    rooms.set(roomId, room);
  }
  return room;
}

async function loadRoomElements(roomId: string): Promise<DriplElement[]> {
  const file = await db.file.findUnique({
    where: { id: roomId },
    select: { content: true },
  });
  if (file) {
    return parseStoredElements(file.content);
  }

  const canvasRoom = await db.canvasRoom.findUnique({
    where: { slug: roomId },
    select: { content: true },
  });
  if (canvasRoom) {
    return parseStoredElements(canvasRoom.content);
  }

  return [];
}

async function saveRoomElements(roomId: string, elements: DriplElement[]): Promise<void> {
  try {
    const fileUpdate = await db.file.updateMany({
      where: { id: roomId },
      data: {
        content: serializeElements(elements),
        updatedAt: new Date(),
      },
    });

    if (fileUpdate.count > 0) {
      return;
    }

    await db.canvasRoom.updateMany({
      where: { slug: roomId },
      data: {
        content: serializeElements(elements),
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error('Failed to save room', roomId, error);
  }
}

function scheduleSave(roomId: string, elements: DriplElement[]): void {
  const existing = saveTimeouts.get(roomId);
  if (existing) clearTimeout(existing);
  saveTimeouts.set(
    roomId,
    setTimeout(async () => {
      await saveRoomElements(roomId, elements);
      saveTimeouts.delete(roomId);
    }, SAVE_DEBOUNCE_MS)
  );
}

function roomUsersPayload(room: RoomState) {
  return Array.from(room.users.values()).map(user => ({
    userId: user.userId,
    userName: user.displayName,
    displayName: user.displayName,
    color: user.color,
  }));
}

function roomCursorsPayload(room: RoomState) {
  return Array.from(room.cursors.entries()).map(([userId, cursor]) => {
    const user = room.users.get(userId);
    return {
      userId,
      x: cursor.x,
      y: cursor.y,
      userName: user?.displayName ?? 'Unknown',
      displayName: user?.displayName ?? 'Unknown',
      color: user?.color ?? '#000000',
    };
  });
}

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function broadcast(room: RoomState, payload: unknown, exceptUserId?: string): void {
  const data = JSON.stringify(payload);
  room.users.forEach(user => {
    if (exceptUserId && user.userId === exceptUserId) return;
    if (user.ws.readyState !== WebSocket.OPEN) return;
    user.ws.send(data);
  });
}

function pickUserColor(): string {
  const colors = [
    '#ff6b6b',
    '#4ecdc4',
    '#45b7d1',
    '#ffa07a',
    '#98d8c8',
    '#f7dc6f',
    '#bb8fce',
    '#85c1e2',
  ];
  return colors[Math.floor(Math.random() * colors.length)] ?? '#45b7d1';
}

wss.on('connection', (ws, req) => {
  const authUserId = resolveUserFromToken(resolveTokenFromUrl(req.url, req.headers.host));

  let currentRoomId: string | null = null;
  let currentUserId: string | null = null;

  ws.on('pong', () => {
    const user = (ws as WebSocket & { __user?: UserConnection }).__user;
    if (user) user.isAlive = true;
  });

  ws.on('message', async (raw: any) => {
    const MAX_MESSAGE_SIZE = 10 * 1024 * 1024;
    const messageStr = raw.toString();
    if (messageStr.length > MAX_MESSAGE_SIZE) {
      console.warn(`[WS] Message too large: ${messageStr.length} bytes`);
      ws.close(1009, 'Message too large');
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(messageStr);
    } catch {
      return;
    }

    const validation = messageSchema.safeParse(parsed);
    if (!validation.success) {
      return;
    }

    const message = validation.data;

    switch (message.type) {
      case 'join_room':
      case 'join': {
        const roomId = message.roomId;
        const room = getOrCreateRoom(roomId);

        if (!room.loadedFromDb) {
          room.elements = await loadRoomElements(roomId);
          room.loadedFromDb = true;
        }

        const requestedUserId = message.type === 'join' ? message.userId : undefined;
        const requestedName = message.type === 'join' ? message.displayName : message.userName;
        const requestedColor = message.type === 'join' ? message.color : undefined;

        const userId = requestedUserId || authUserId || `anon_${uuidv4()}`;
        const displayName = requestedName || `User-${userId.slice(0, 4)}`;
        const color = requestedColor || pickUserColor();

        currentRoomId = roomId;
        currentUserId = userId;

        const connection: UserConnection = {
          userId,
          displayName,
          color,
          ws,
          isAlive: true,
        };
        room.users.set(userId, connection);
        (ws as WebSocket & { __user?: UserConnection }).__user = connection;

        const syncPayload = {
          type: 'sync_room_state',
          roomId,
          elements: room.elements,
          users: roomUsersPayload(room),
          cursors: roomCursorsPayload(room),
          yourUserId: userId,
          timestamp: Date.now(),
        };
        send(ws, syncPayload);

        const roomStatePayload = {
          type: 'room-state',
          roomId,
          elements: room.elements,
          users: roomUsersPayload(room),
          cursors: roomCursorsPayload(room),
          yourUserId: userId,
          timestamp: Date.now(),
        };
        send(ws, roomStatePayload);

        const joinPayload = {
          type: 'user_join',
          roomId,
          userId,
          userName: displayName,
          displayName,
          color,
          timestamp: Date.now(),
        };
        broadcast(room, joinPayload, userId);
        broadcast(
          room,
          {
            ...joinPayload,
            type: 'user-join',
          },
          userId
        );
        break;
      }

      case 'leave_room':
      case 'leave': {
        if (!currentRoomId || !currentUserId) break;
        const room = rooms.get(currentRoomId);
        if (!room) break;

        room.users.delete(currentUserId);
        room.cursors.delete(currentUserId);

        const leavePayload = {
          type: 'user_leave',
          roomId: currentRoomId,
          userId: currentUserId,
          timestamp: Date.now(),
        };
        broadcast(room, leavePayload);
        broadcast(room, { ...leavePayload, type: 'user-leave' });

        if (room.users.size === 0) {
          rooms.delete(currentRoomId);
        }

        currentRoomId = null;
        currentUserId = null;
        break;
      }

      case 'add_element': {
        if (!currentRoomId) break;
        const room = rooms.get(currentRoomId);
        if (!room) break;
        const element = toDriplElement(message.element);
        room.elements = room.elements.filter(el => el.id !== element.id);
        room.elements.push(element);
        broadcast(room, message, currentUserId ?? undefined);
        scheduleSave(currentRoomId, room.elements);
        break;
      }

      case 'update_element': {
        if (!currentRoomId) break;
        const room = rooms.get(currentRoomId);
        if (!room) break;
        const element = toDriplElement(message.element);
        room.elements = room.elements.map(e => (e.id === element.id ? element : e));
        broadcast(room, message, currentUserId ?? undefined);
        scheduleSave(currentRoomId, room.elements);
        break;
      }

      case 'delete_element': {
        if (!currentRoomId) break;
        const room = rooms.get(currentRoomId);
        if (!room) break;
        room.elements = room.elements.filter(element => element.id !== message.elementId);
        broadcast(room, message, currentUserId ?? undefined);
        scheduleSave(currentRoomId, room.elements);
        break;
      }

      case 'element-update': {
        if (!currentRoomId) break;
        const room = rooms.get(currentRoomId);
        if (!room) break;

        if (Array.isArray(message.elements)) {
          const merged = new Map(room.elements.map(element => [element.id, element]));
          for (const rawEl of message.elements) {
            const element = toDriplElement(rawEl);
            merged.set(element.id, element);
          }
          room.elements = Array.from(merged.values());
        } else {
          const rawElement = message.element;
          if (!rawElement) break;
          const element = toDriplElement(rawElement);
          room.elements = room.elements.filter(candidate => candidate.id !== element.id);
          room.elements.push(element);
        }

        broadcast(room, message, currentUserId ?? undefined);
        scheduleSave(currentRoomId, room.elements);
        break;
      }

      case 'cursor_move':
      case 'cursor-move': {
        if (!currentRoomId || !currentUserId) break;
        const room = rooms.get(currentRoomId);
        if (!room) break;

        room.cursors.set(currentUserId, { x: message.x, y: message.y });
        const user = room.users.get(currentUserId);
        const displayName = message.type === 'cursor-move' ? message.displayName : message.userName;
        const cursorPayload = {
          type: 'cursor_move',
          roomId: currentRoomId,
          userId: currentUserId,
          x: message.x,
          y: message.y,
          userName: displayName ?? user?.displayName ?? 'Unknown',
          displayName: displayName ?? user?.displayName ?? 'Unknown',
          color: message.color ?? user?.color ?? '#000000',
          timestamp: Date.now(),
        };

        broadcast(room, cursorPayload, currentUserId);
        broadcast(room, { ...cursorPayload, type: 'cursor-move' }, currentUserId);
        break;
      }

      case 'ping': {
        send(ws, { type: 'pong', timestamp: Date.now() });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!currentRoomId || !currentUserId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    room.users.delete(currentUserId);
    room.cursors.delete(currentUserId);

    const leavePayload = {
      type: 'user_leave',
      roomId: currentRoomId,
      userId: currentUserId,
      timestamp: Date.now(),
    };
    broadcast(room, leavePayload);
    broadcast(room, { ...leavePayload, type: 'user-leave' });

    if (room.users.size === 0) {
      rooms.delete(currentRoomId);
    }
  });
});

const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    const user = (ws as WebSocket & { __user?: UserConnection }).__user;
    if (!user) return;
    if (!user.isAlive) {
      ws.terminate();
      return;
    }
    user.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

server.listen(WS_PORT, () => {
  console.log(`WebSocket server listening on ${WS_PORT}`);
});

async function shutdown() {
  clearInterval(heartbeat);
  for (const [roomId, timeout] of saveTimeouts.entries()) {
    clearTimeout(timeout);
    const room = rooms.get(roomId);
    if (room) {
      await saveRoomElements(roomId, room.elements);
    }
  }
  await db.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
