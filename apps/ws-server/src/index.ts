import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../../.env');
config({ path: envPath });

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import type { DriplElement } from '@dripl/common';
import { pickUserColor } from '@dripl/common';
import { initializeDb, db } from '@dripl/db';
import { messageSchema } from './validation';
import type { UserConnection } from './types';
import { resolveTokenFromUrl, resolveUserFromToken } from './auth';
import { send, broadcast, roomUsersPayload, roomCursorsPayload } from './broadcast';
import {
  rooms,
  saveTimeouts,
  roomLastEmptyAt,
  MAX_ELEMENTS_PER_SCENE,
  MAX_EMPTY_ROOM_TTL_MS,
  getOrCreateRoom,
  loadRoomElements,
  saveRoomElements,
  scheduleSave,
} from './rooms';
import { checkRateLimit, startRateLimitCleanup } from './rateLimiter';

initializeDb().catch(err => {
  console.error('[ws-server] Failed to initialize database:', err);
  process.exit(1);
});

const driplElementSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.string(),
  x: z.number().finite().min(-100000).max(100000),
  y: z.number().finite().min(-100000).max(100000),
  width: z.number().finite().min(0).max(50000),
  height: z.number().finite().min(0).max(50000),
  strokeColor: z.string().max(50).optional(),
  backgroundColor: z.string().max(50).optional(),
  strokeWidth: z.number().min(0).max(100).optional(),
  opacity: z.number().min(0).max(1).optional(),
  text: z.string().max(10000).optional(),
  fontSize: z.number().min(1).max(500).optional(),
  points: z.array(z.tuple([z.number(), z.number()])).max(1000).optional(),
});

function toDriplElement(el: unknown): DriplElement {
  const parsed = driplElementSchema.safeParse(el);
  if (!parsed.success) {
    throw new Error('Invalid element structure');
  }
  return parsed.data as DriplElement;
}

const WS_PORT = Number(process.env.WS_PORT || 3001);
const HEARTBEAT_INTERVAL_MS = 30_000;
const PERIODIC_SAVE_INTERVAL_MS = Number(process.env.PERIODIC_SAVE_INTERVAL_MS) || 15_000;

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
  } else if (req.url === '/metrics') {
    let totalUsers = 0;
    for (const room of rooms.values()) {
      totalUsers += room.users.size;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        uptime: process.uptime(),
        activeRooms: rooms.size,
        activeConnections: wss.clients.size,
        totalUsers,
        memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      })
    );
  } else {
    res.writeHead(404);
    res.end();
  }
});

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000';
const wss = new WebSocketServer({
  server,
  maxPayload: 10 * 1024 * 1024,
  verifyClient: ({ origin }: { origin: string }, cb: (result: boolean, code?: number, message?: string) => void) => {
    if (!origin) return cb(true);
    const allowed = FRONTEND_URL.replace(/\/$/, '');
    if (origin === allowed) return cb(true);
    console.warn(JSON.stringify({ level: 'warn', event: 'ws_origin_rejected', origin }));
    cb(false, 403, 'Forbidden');
  },
});

const userRoomMap = new Map<WebSocket, string>();

wss.on('connection', (ws, req) => {
  const authUserId = resolveUserFromToken(resolveTokenFromUrl(req.url, req.headers.host));

  if (!authUserId) {
    ws.close(4001, 'Authentication required');
    console.warn(JSON.stringify({ level: 'warn', event: 'ws_auth_rejected', url: req.url }));
    return;
  }

  let currentRoomId: string | null = null;
  let currentUserId: string | null = null;

  ws.on('pong', () => {
    const user = (ws as WebSocket & { __user?: UserConnection }).__user;
    if (user) user.isAlive = true;
  });

  ws.on('message', async (raw: Buffer) => {
    const messageStr = raw.toString();

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

    if (!checkRateLimit(ws)) {
      console.warn(
        JSON.stringify({ level: 'warn', event: 'rate_limit_exceeded' })
      );
      ws.close(4000, 'Rate limit exceeded');
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

        const requestedName = message.type === 'join' ? message.displayName : message.userName;
        const requestedColor = message.type === 'join' ? message.color : undefined;

        const userId = authUserId;
        const displayName = requestedName || `User-${userId.slice(0, 4)}`;
        const color = requestedColor || pickUserColor();

        currentRoomId = roomId;
        currentUserId = userId;
        userRoomMap.set(ws, roomId);

        const connection: UserConnection = {
          userId,
          displayName,
          color,
          ws,
          isAlive: true,
        };
        room.users.set(userId, connection);
        (ws as WebSocket & { __user?: UserConnection }).__user = connection;

        send(ws, {
          type: 'sync_room_state',
          roomId,
          elements: room.elements,
          users: roomUsersPayload(room),
          cursors: roomCursorsPayload(room),
          yourUserId: userId,
          timestamp: Date.now(),
        });

        send(ws, {
          type: 'room-state',
          roomId,
          elements: room.elements,
          users: roomUsersPayload(room),
          cursors: roomCursorsPayload(room),
          yourUserId: userId,
          timestamp: Date.now(),
        });

        broadcast(room, {
          type: 'user-join',
          roomId,
          userId,
          userName: displayName,
          displayName,
          color,
          timestamp: Date.now(),
        }, userId);
        break;
      }

      case 'leave_room':
      case 'leave': {
        if (!currentRoomId || !currentUserId) break;
        const room = rooms.get(currentRoomId);
        if (!room) break;

        room.users.delete(currentUserId);
        room.cursors.delete(currentUserId);
        userRoomMap.delete(ws);

        broadcast(room, {
          type: 'user-leave',
          roomId: currentRoomId,
          userId: currentUserId,
          timestamp: Date.now(),
        });

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
        scheduleSave(currentRoomId);
        break;
      }

      case 'update_element': {
        if (!currentRoomId) break;
        const room = rooms.get(currentRoomId);
        if (!room) break;
        const element = toDriplElement(message.element);
        room.elements = room.elements.map(e => (e.id === element.id ? element : e));
        broadcast(room, message, currentUserId ?? undefined);
        scheduleSave(currentRoomId);
        break;
      }

      case 'delete_element': {
        if (!currentRoomId) break;
        const room = rooms.get(currentRoomId);
        if (!room) break;
        room.elements = room.elements.filter(element => element.id !== message.elementId);
        broadcast(room, message, currentUserId ?? undefined);
        scheduleSave(currentRoomId);
        break;
      }

      case 'scene-update': {
        if (!currentRoomId) break;
        const room = rooms.get(currentRoomId);
        if (!room) break;
        if (!Array.isArray(message.elements)) break;
        if (message.elements.length > MAX_ELEMENTS_PER_SCENE) {
          send(ws, { type: 'error', message: `Too many elements (max ${MAX_ELEMENTS_PER_SCENE})` });
          break;
        }

        const merged = new Map(room.elements.map(element => [element.id, element]));
        for (const rawEl of message.elements) {
          try {
            const element = toDriplElement(rawEl);
            merged.set(element.id, element);
          } catch {
            // Skip invalid elements
          }
        }
        room.elements = Array.from(merged.values());

        broadcast(room, {
          type: 'scene-update',
          subtype: message.subtype,
          elements: room.elements,
        }, currentUserId ?? undefined);
        scheduleSave(currentRoomId);
        break;
      }

      case 'scene-delta': {
        if (!currentRoomId) break;
        const room = rooms.get(currentRoomId);
        if (!room) break;

        const elementMap = new Map(room.elements.map(el => [el.id, el]));

        if (message.added && Array.isArray(message.added)) {
          for (const rawEl of message.added) {
            try {
              const element = toDriplElement(rawEl);
              elementMap.set(element.id, element);
            } catch {
              // Skip invalid elements
            }
          }
        }

        if (message.updated && Array.isArray(message.updated)) {
          for (const rawEl of message.updated) {
            try {
              const element = toDriplElement(rawEl);
              elementMap.set(element.id, element);
            } catch {
              // Skip invalid elements
            }
          }
        }

        if (message.deleted && Array.isArray(message.deleted)) {
          for (const id of message.deleted) {
            elementMap.delete(id);
          }
        }

        room.elements = Array.from(elementMap.values());

        broadcast(room, message, currentUserId ?? undefined);
        scheduleSave(currentRoomId);
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
        scheduleSave(currentRoomId);
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
        broadcast(room, {
          type: 'cursor_move',
          roomId: currentRoomId,
          userId: currentUserId,
          x: message.x,
          y: message.y,
          userName: displayName ?? user?.displayName ?? 'Unknown',
          displayName: displayName ?? user?.displayName ?? 'Unknown',
          color: message.color ?? user?.color ?? '#000000',
          timestamp: Date.now(),
        }, currentUserId);
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
    userRoomMap.delete(ws);

    broadcast(room, {
      type: 'user-leave',
      roomId: currentRoomId,
      userId: currentUserId,
      timestamp: Date.now(),
    });

    if (room.users.size === 0) {
      roomLastEmptyAt.set(currentRoomId, Date.now());
    }
  });
});

const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    const user = (ws as WebSocket & { __user?: UserConnection }).__user;
    if (!user) return;
    if (!user.isAlive) {
      const roomId = userRoomMap.get(ws);
      if (roomId) {
        const room = rooms.get(roomId);
        if (room) {
          room.users.delete(user.userId);
          room.cursors.delete(user.userId);
          if (room.users.size === 0) {
            roomLastEmptyAt.set(roomId, Date.now());
          }
        }
      }
      userRoomMap.delete(ws);
      ws.terminate();
      return;
    }
    user.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

const rateLimitCleanup = startRateLimitCleanup();

const periodicSave = setInterval(async () => {
  const activeRooms = Array.from(rooms.entries());
  const now = Date.now();
  const savePromises: Promise<{ roomId: string; success: boolean }>[] = [];

  for (const [roomId, room] of activeRooms) {
    if (room.users.size > 0) {
      roomLastEmptyAt.delete(roomId);
      if (!room.saving) {
        room.saving = true;
        savePromises.push(
          saveRoomElements(roomId, room.elements).then(success => {
            room.saving = false;
            return { roomId, success };
          })
        );
      }
    } else {
      const emptySince = roomLastEmptyAt.get(roomId);
      if (!emptySince) {
        roomLastEmptyAt.set(roomId, now);
        continue;
      }
      if (now - emptySince > MAX_EMPTY_ROOM_TTL_MS) {
        if (!room.saving && room.elements.length > 0) {
          room.saving = true;
          savePromises.push(
            saveRoomElements(roomId, room.elements).then(success => {
              room.saving = false;
              return { roomId, success };
            })
          );
        }
        if (room.users.size === 0) {
          rooms.delete(roomId);
          roomLastEmptyAt.delete(roomId);
        }
      }
    }
  }

  if (savePromises.length > 0) {
    const results = await Promise.allSettled(savePromises);
    for (const result of results) {
      if (result.status === 'fulfilled' && !result.value.success) {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'periodic_save_failure',
            roomId: result.value.roomId,
            timestamp: Date.now(),
          })
        );
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
  clearInterval(rateLimitCleanup);

  const savePromises: Promise<void>[] = [];
  for (const [roomId, timeout] of saveTimeouts.entries()) {
    clearTimeout(timeout);
    const room = rooms.get(roomId);
    if (room) {
      savePromises.push(
        saveRoomElements(roomId, room.elements).then(success => {
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
        })
      );
    }
  }

  const SHUTDOWN_TIMEOUT_MS = 10_000;
  const timeout = new Promise<void>(resolve => {
    setTimeout(() => {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'shutdown_timeout',
          timestamp: Date.now(),
        })
      );
      resolve();
    }, SHUTDOWN_TIMEOUT_MS);
  });

  await Promise.race([Promise.all(savePromises), timeout]);
  await db.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
