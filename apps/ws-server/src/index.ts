import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../../.env');
config({ path: envPath });

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import type { DriplElement } from '@dripl/common';
import { pickUserColor } from '@dripl/common';
import { requiredEnv } from '@dripl/utils';
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

const JWT_SECRET = requiredEnv('JWT_SECRET');
const WS_PORT = Number(process.env.WS_PORT || 3001);
const HEARTBEAT_INTERVAL_MS = 30_000;
const SAVE_DEBOUNCE_MS = 2_000;
const PERIODIC_SAVE_INTERVAL_MS = Number(process.env.PERIODIC_SAVE_INTERVAL_MS) || 15_000;
const RATE_LIMIT_WINDOW_MS = 1_000;
const RATE_LIMIT_MAX_MESSAGES = 30;

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
const userMessageCounts = new Map<string, { count: number; resetAt: number }>();

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

async function saveRoomElements(roomId: string, elements: DriplElement[]): Promise<boolean> {
  const startTime = Date.now();
  try {
    const fileUpdate = await db.file.updateMany({
      where: { id: roomId },
      data: {
        content: serializeElements(elements),
        updatedAt: new Date(),
      },
    });

    if (fileUpdate.count > 0) {
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'save_room_success',
          roomId,
          durationMs: Date.now() - startTime,
          recordType: 'file',
        })
      );
      return true;
    }

    const canvasUpdate = await db.canvasRoom.updateMany({
      where: { slug: roomId },
      data: {
        content: serializeElements(elements),
        updatedAt: new Date(),
      },
    });

    console.log(
      JSON.stringify({
        level: 'info',
        event: 'save_room_success',
        roomId,
        durationMs: Date.now() - startTime,
        recordType: 'canvasRoom',
        updated: canvasUpdate.count,
      })
    );
    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'save_room_failure',
        roomId,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
    );
    return false;
  }
}

function scheduleSave(roomId: string, elements: DriplElement[]): void {
  const existing = saveTimeouts.get(roomId);
  if (existing) clearTimeout(existing);
  saveTimeouts.set(
    roomId,
    setTimeout(async () => {
      const success = await saveRoomElements(roomId, elements);
      if (!success) {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'save_debounced_failure',
            roomId,
            timestamp: Date.now(),
          })
        );
      }
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

wss.on('connection', (ws, req) => {
  const authUserId = resolveUserFromToken(resolveTokenFromUrl(req.url, req.headers.host));

  let currentRoomId: string | null = null;
  let currentUserId: string | null = null;

  ws.on('pong', () => {
    const user = (ws as WebSocket & { __user?: UserConnection }).__user;
    if (user) user.isAlive = true;
  });

  ws.on('message', async (raw: Buffer) => {
    const MAX_MESSAGE_SIZE = 10 * 1024 * 1024;
    const messageStr = raw.toString();
    if (messageStr.length > MAX_MESSAGE_SIZE) {
      console.warn(
        JSON.stringify({ level: 'warn', event: 'message_too_large', size: messageStr.length })
      );
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

    const wsKey =
      (ws as unknown as { __wsKey?: string }).__wsKey ||
      (ws as WebSocket & { __user?: UserConnection }).__user?.userId ||
      req.url ||
      '';
    const now = Date.now();
    const rateInfo = userMessageCounts.get(wsKey);
    if (rateInfo && rateInfo.resetAt > now) {
      rateInfo.count += 1;
      if (rateInfo.count > RATE_LIMIT_MAX_MESSAGES) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            event: 'rate_limit_exceeded',
            wsKey,
            count: rateInfo.count,
          })
        );
        ws.close(4000, 'Rate limit exceeded');
        return;
      }
    } else {
      userMessageCounts.set(wsKey, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
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

const rateLimitCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, info] of userMessageCounts.entries()) {
    if (info.resetAt < now) {
      userMessageCounts.delete(key);
    }
  }
}, 60_000);

const periodicSave = setInterval(async () => {
  const activeRooms = Array.from(rooms.entries());
  for (const [roomId, room] of activeRooms) {
    if (room.users.size > 0) {
      const success = await saveRoomElements(roomId, room.elements);
      if (!success) {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'periodic_save_failure',
            roomId,
            timestamp: Date.now(),
          })
        );
      }
    } else if (room.elements.length > 0) {
      const success = await saveRoomElements(roomId, room.elements);
      if (success) {
        rooms.delete(roomId);
      }
    }
  }
}, PERIODIC_SAVE_INTERVAL_MS);

server.listen(WS_PORT, () => {
  console.log(JSON.stringify({ level: 'info', event: 'websocket_server_started', port: WS_PORT }));
});

async function shutdown() {
  clearInterval(heartbeat);
  clearInterval(periodicSave);
  for (const [roomId, timeout] of saveTimeouts.entries()) {
    clearTimeout(timeout);
    const room = rooms.get(roomId);
    if (room) {
      const success = await saveRoomElements(roomId, room.elements);
      if (!success) {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'shutdown_save_failure',
            roomId,
            timestamp: Date.now(),
          })
        );
      }
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
