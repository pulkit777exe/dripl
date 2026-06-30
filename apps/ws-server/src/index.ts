import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../../.env');
config({ path: envPath });

import { createLogger } from '@dripl/utils/logger';
export const logger = createLogger('ws-server');

const REQUIRED_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'PORT',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'HTTP_SERVER_URL',
] as const;

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required env var: ${key}`);
    process.exit(1);
  }
}

if (process.env.NODE_ENV === 'production' && !process.env.INTERNAL_SECRET) {
  console.error('FATAL: Missing required env var: INTERNAL_SECRET');
  process.exit(1);
}
if (!process.env.INTERNAL_SECRET) {
  console.warn('WARN: INTERNAL_SECRET not set — ticket validation will reject all connections');
}

if (process.env.JWT_SECRET && process.env.INTERNAL_SECRET && process.env.JWT_SECRET === process.env.INTERNAL_SECRET) {
  console.error('FATAL: JWT_SECRET and INTERNAL_SECRET must be different values');
  process.exit(1);
}

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { DriplElement } from '@dripl/common';
import { pickUserColor, DriplElementSchema } from '@dripl/common';
import { initializeDb, db } from '@dripl/db';
import { messageSchema } from './validation';
import type { UserConnection } from './types';
import {
  applyElementToYjs,
  applyElementsToYjs,
  deleteElementFromYjs,
  deleteElementsFromYjs,
  deleteYjsRoom,
  getElementsFromYjs,
  getYjsUpdate,
  applyYjsUpdate,
  getStateVector,
  encodeYjsDoc,
} from './yjsManager';
import { resolveTicketFromUrl, validateTicket } from './auth';
import { send, broadcast, roomUsersPayload, roomCursorsPayload } from './broadcast';
import {
  rooms,
  saveTimeouts,
  roomLastEmptyAt,
  userToRoomMap,
  MAX_ELEMENTS_PER_SCENE,
  MAX_EMPTY_ROOM_TTL_MS,
  getOrCreateRoom,
  loadRoomElements,
  saveRoomElements,
  scheduleSave,
  parseStoredElements,
} from './rooms';
import { checkRateLimit, setRateLimitIdentity, removeRateLimitIdentity } from './rateLimiter';

async function start() {
  try {
    await initializeDb();
    console.log(JSON.stringify({ level: 'info', event: 'db_connected' }));
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'db_connection_failed',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    process.exit(1);
  }
}

function toDriplElement(el: unknown): DriplElement {
  const parsed = DriplElementSchema.safeParse(el);
  if (!parsed.success) {
    throw new Error('Invalid element structure');
  }
  return parsed.data as DriplElement;
}

const YJS_MSG_UPDATE = 1;
const YJS_MSG_SYNC = 2;

function broadcastYjsUpdate(room: { users: Map<string, UserConnection> }, yjsUpdate: Uint8Array, exceptUserId?: string): void {
  const packet = new Uint8Array(1 + yjsUpdate.length);
  packet[0] = YJS_MSG_UPDATE;
  packet.set(yjsUpdate, 1);
  room.users.forEach(user => {
    if (exceptUserId && user.userId === exceptUserId) return;
    if (user.ws.readyState !== WebSocket.OPEN) return;
    user.ws.send(packet);
  });
}

function sendYjsSync(ws: WebSocket, stateVector: Uint8Array, yjsState: Uint8Array): void {
  const packet = new Uint8Array(1 + stateVector.length + yjsState.length);
  packet[0] = YJS_MSG_SYNC;
  packet.set(stateVector, 1);
  packet.set(yjsState, 1 + stateVector.length);
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(packet);
  }
}

const WS_PORT = Number(process.env.PORT) || 3001;
const HEARTBEAT_INTERVAL_MS = 30_000;
const PERIODIC_SAVE_INTERVAL_MS = Number(process.env.PERIODIC_SAVE_INTERVAL_MS) || 15_000;

const server = createServer(async (req, res) => {
  if (req.url === '/health') {
    try {
      await db.$queryRaw`SELECT 1`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        uptime: process.uptime(),
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        ts: Date.now(),
      }));
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: 'Database unreachable', ts: Date.now() }));
    }
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

const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
].filter(Boolean) as string[];

const wss = new WebSocketServer({
  server,
  maxPayload: 10 * 1024 * 1024,
  verifyClient: ({ origin }: { origin: string }, cb: (result: boolean, code?: number, message?: string) => void) => {
    if (!origin) {
      console.warn(JSON.stringify({ level: 'warn', event: 'ws_origin_rejected', reason: 'no_origin' }));
      return cb(false, 403, 'Forbidden');
    }
    const allowed = ALLOWED_ORIGINS.some(o => origin === o);
    if (allowed) return cb(true);
    console.warn(JSON.stringify({ level: 'warn', event: 'ws_origin_rejected', origin }));
    cb(false, 403, 'Forbidden');
  },
});

const wsToRoomMap = new Map<WebSocket, string>();

wss.on('connection', async (ws, req) => {
  const ticket = resolveTicketFromUrl(req.url, req.headers.host);
  if (!ticket) {
    ws.close(4001, 'Authentication required');
    console.warn(JSON.stringify({ level: 'warn', event: 'ws_auth_rejected', reason: 'no_ticket', url: req.url }));
    return;
  }

  const authUserId = await validateTicket(ticket);

  if (!authUserId) {
    ws.close(4001, 'Authentication required');
    console.warn(JSON.stringify({ level: 'warn', event: 'ws_auth_rejected', reason: 'invalid_ticket' }));
    return;
  }

  setRateLimitIdentity(ws, authUserId);

  let currentRoomId: string | null = null;
  let currentUserId: string | null = null;

  ws.on('pong', () => {
    const user = (ws as WebSocket & { __user?: UserConnection }).__user;
    if (user) user.isAlive = true;
  });

  ws.on('message', async (raw: Buffer) => {
    try {
    // Rate limit all messages including binary
    if (!(await checkRateLimit(ws))) {
      console.warn(
        JSON.stringify({ level: 'warn', event: 'rate_limit_exceeded' })
      );
      ws.close(4000, 'Rate limit exceeded');
      return;
    }

    // Handle binary Yjs messages
    if (raw instanceof Buffer && raw.length > 0 && raw[0] === YJS_MSG_UPDATE) {
      if (!currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (!room?.yjs) return;
      const yjsUpdate = raw.slice(1);
      applyYjsUpdate(room.yjs, yjsUpdate);
      // Sync Yjs state back to the legacy elements Map
      const yjsElements = getElementsFromYjs(room.yjs);
      room.elements.clear();
      for (const el of yjsElements) {
        room.elements.set(el.id, el);
      }
      broadcastYjsUpdate(room, yjsUpdate, currentUserId ?? undefined);
      room.dirty = true;
      scheduleSave(currentRoomId);
      return;
    }

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
        wsToRoomMap.set(ws, roomId);
        userToRoomMap.set(userId, roomId);

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
          elements: Array.from(room.elements.values()),
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

        // Send Yjs sync state to the new client
        if (room.yjs) {
          const stateVector = getStateVector(room.yjs);
          const yjsState = encodeYjsDoc(room.yjs);
          sendYjsSync(ws, stateVector, yjsState);
        }
        break;
      }

      case 'leave_room':
      case 'leave': {
        if (!currentRoomId || !currentUserId) break;
        const room = rooms.get(currentRoomId);
        if (!room) break;

        room.users.delete(currentUserId);
        room.cursors.delete(currentUserId);
        wsToRoomMap.delete(ws);
        userToRoomMap.delete(currentUserId);

        broadcast(room, {
          type: 'user-leave',
          roomId: currentRoomId,
          userId: currentUserId,
          timestamp: Date.now(),
        });

        if (room.users.size === 0) {
          if (room.elements.size > 0 && !room.saving) {
            room.saving = true;
            saveRoomElements(currentRoomId, room.elements)
              .then(success => {
                if (!success) {
                  console.error(
                    JSON.stringify({
                      level: 'error',
                      event: 'leave_save_failure',
                      roomId: currentRoomId,
                      timestamp: Date.now(),
                    })
                  );
                }
              })
              .finally(() => {
                room.saving = false;
              });
          }
          roomLastEmptyAt.set(currentRoomId, Date.now());
        }

        currentRoomId = null;
        currentUserId = null;
        break;
      }

      case 'add_element': {
        if (!currentRoomId) break;
        const room = rooms.get(currentRoomId);
        if (!room) break;
        try {
          const element = toDriplElement(message.element);
          const existing = room.elements.get(element.id);
          if (existing && (element.version ?? 0) <= (existing.version ?? 0)) break;
          room.elements.set(element.id, element);
          if (room.yjs) {
            applyElementToYjs(room.yjs, element);
            const yjsUpdate = getYjsUpdate(room.yjs);
            broadcastYjsUpdate(room, yjsUpdate, currentUserId ?? undefined);
          }
          broadcast(room, message, currentUserId ?? undefined);
          room.dirty = true;
          scheduleSave(currentRoomId);
        } catch {
          // Skip invalid element
        }
        break;
      }

      case 'update_element': {
        if (!currentRoomId) break;
        const room = rooms.get(currentRoomId);
        if (!room) break;
        try {
          const element = toDriplElement(message.element);
          const existing = room.elements.get(element.id);
          if (existing && (element.version ?? 0) < (existing.version ?? 0)) break;
          room.elements.set(element.id, element);
          if (room.yjs) {
            applyElementToYjs(room.yjs, element);
            const yjsUpdate = getYjsUpdate(room.yjs);
            broadcastYjsUpdate(room, yjsUpdate, currentUserId ?? undefined);
          }
          broadcast(room, message, currentUserId ?? undefined);
          room.dirty = true;
          scheduleSave(currentRoomId);
        } catch {
          // Skip invalid element
        }
        break;
      }

      case 'delete_element': {
        if (!currentRoomId) break;
        const room = rooms.get(currentRoomId);
        if (!room) break;
        room.elements.delete(message.elementId);
        if (room.yjs) {
          deleteElementFromYjs(room.yjs, message.elementId);
          const yjsUpdate = getYjsUpdate(room.yjs);
          broadcastYjsUpdate(room, yjsUpdate, currentUserId ?? undefined);
        }
        broadcast(room, message, currentUserId ?? undefined);
        room.dirty = true;
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

        const acceptedElements: DriplElement[] = [];
        const incomingIds = new Set<string>();
        for (const rawEl of message.elements) {
          try {
            const element = toDriplElement(rawEl);
            incomingIds.add(element.id);
            const existing = room.elements.get(element.id);
            if (existing && (element.version ?? 0) <= (existing.version ?? 0)) {
              continue;
            }
            room.elements.set(element.id, element);
            acceptedElements.push(element);
          } catch {
            // Skip invalid elements
          }
        }

        // Remove elements not in the incoming set (full state replacement)
        if (message.subtype === 'init') {
          const toRemove: string[] = [];
          for (const [id] of room.elements) {
            if (!incomingIds.has(id)) {
              toRemove.push(id);
            }
          }
          for (const id of toRemove) {
            room.elements.delete(id);
          }
          if (room.yjs && toRemove.length > 0) {
            deleteElementsFromYjs(room.yjs, toRemove);
          }
        }

        if (room.yjs && acceptedElements.length > 0) {
          applyElementsToYjs(room.yjs, acceptedElements);
          const yjsUpdate = getYjsUpdate(room.yjs);
          broadcastYjsUpdate(room, yjsUpdate, currentUserId ?? undefined);
        }

        broadcast(room, {
          type: 'scene-update',
          subtype: message.subtype,
          elements: acceptedElements,
        }, currentUserId ?? undefined);
        room.dirty = true;
        scheduleSave(currentRoomId);
        break;
      }

      case 'scene-delta': {
        if (!currentRoomId) break;
        const room = rooms.get(currentRoomId);
        if (!room) break;

        const acceptedAdded: unknown[] = [];
        const acceptedUpdated: unknown[] = [];
        const yjsChangedElements: DriplElement[] = [];

        if (message.added && Array.isArray(message.added)) {
          for (const rawEl of message.added) {
            try {
              const element = toDriplElement(rawEl);
              const existing = room.elements.get(element.id);
              if (existing && (element.version ?? 0) <= (existing.version ?? 0)) {
                continue;
              }
              room.elements.set(element.id, element);
              acceptedAdded.push(element);
              yjsChangedElements.push(element);
            } catch {
              // Skip invalid elements
            }
          }
        }

        if (message.updated && Array.isArray(message.updated)) {
          for (const rawEl of message.updated) {
            try {
              const element = toDriplElement(rawEl);
              const existing = room.elements.get(element.id);
              if (existing && (element.version ?? 0) < (existing.version ?? 0)) {
                continue;
              }
              room.elements.set(element.id, element);
              acceptedUpdated.push(element);
              yjsChangedElements.push(element);
            } catch {
              // Skip invalid elements
            }
          }
        }

        if (message.deleted && Array.isArray(message.deleted)) {
          for (const id of message.deleted) {
            room.elements.delete(id);
          }
          if (room.yjs) {
            deleteElementsFromYjs(room.yjs, message.deleted);
          }
        }

        if (room.yjs && yjsChangedElements.length > 0) {
          applyElementsToYjs(room.yjs, yjsChangedElements);
        }

        if (room.yjs && yjsChangedElements.length > 0) {
          const yjsUpdate = getYjsUpdate(room.yjs);
          broadcastYjsUpdate(room, yjsUpdate, currentUserId ?? undefined);
        }

        const filteredDelta: Record<string, unknown> = { type: 'scene-delta' };
        if (acceptedAdded.length > 0) filteredDelta.added = acceptedAdded;
        if (acceptedUpdated.length > 0) filteredDelta.updated = acceptedUpdated;
        if (message.deleted && Array.isArray(message.deleted) && message.deleted.length > 0) {
          filteredDelta.deleted = message.deleted;
        }

        broadcast(room, filteredDelta, currentUserId ?? undefined);
        room.dirty = true;
        scheduleSave(currentRoomId);
        break;
      }

      case 'element-update': {
        if (!currentRoomId) break;
        const room = rooms.get(currentRoomId);
        if (!room) break;

        if (Array.isArray(message.elements)) {
          const accepted: unknown[] = [];
          const yjsElements: DriplElement[] = [];
          for (const rawEl of message.elements) {
            try {
              const element = toDriplElement(rawEl);
              const existing = room.elements.get(element.id);
              if (existing && (element.version ?? 0) < (existing.version ?? 0)) {
                continue;
              }
              room.elements.set(element.id, element);
              accepted.push(element);
              yjsElements.push(element);
            } catch {
              // Skip invalid element
            }
          }
          if (room.yjs && yjsElements.length > 0) {
            applyElementsToYjs(room.yjs, yjsElements);
            const yjsUpdate = getYjsUpdate(room.yjs);
            broadcastYjsUpdate(room, yjsUpdate, currentUserId ?? undefined);
          }
          if (accepted.length > 0) {
            broadcast(room, { type: 'element-update', elements: accepted }, currentUserId ?? undefined);
          }
        } else {
          const rawElement = message.element;
          if (!rawElement) break;
          try {
            const element = toDriplElement(rawElement);
            const existing = room.elements.get(element.id);
            if (existing && (element.version ?? 0) < (existing.version ?? 0)) {
              break;
            }
            room.elements.set(element.id, element);
            if (room.yjs) {
              applyElementToYjs(room.yjs, element);
              const yjsUpdate = getYjsUpdate(room.yjs);
              broadcastYjsUpdate(room, yjsUpdate, currentUserId ?? undefined);
            }
            broadcast(room, { type: 'element-update', element }, currentUserId ?? undefined);
          } catch {
            // Skip invalid element
          }
        }

        room.dirty = true;
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

        // Update Yjs awareness
        if (room.yjs) {
          room.yjs.awareness.setLocalStateField('cursor', {
            x: message.x,
            y: message.y,
          });
          room.yjs.awareness.setLocalStateField('user', {
            id: currentUserId,
            name: displayName ?? user?.displayName ?? 'Unknown',
            color: message.color ?? user?.color ?? '#000000',
          });
        }

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
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', event: 'ws_message_handler_error', error: err instanceof Error ? err.message : String(err) }));
    }
  });

  ws.on('close', () => {
    removeRateLimitIdentity(ws);
    if (!currentRoomId || !currentUserId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    room.users.delete(currentUserId);
    room.cursors.delete(currentUserId);
    wsToRoomMap.delete(ws);
    userToRoomMap.delete(currentUserId);

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
      const roomId = wsToRoomMap.get(ws);
      if (roomId) {
        const room = rooms.get(roomId);
        if (room) {
          broadcast(room, {
            type: 'user-leave',
            roomId,
            userId: user.userId,
            timestamp: Date.now(),
          });
          room.users.delete(user.userId);
          room.cursors.delete(user.userId);
          scheduleSave(roomId);
          if (room.users.size === 0) {
            roomLastEmptyAt.set(roomId, Date.now());
          }
        }
      }
      wsToRoomMap.delete(ws);
      userToRoomMap.delete(user.userId);
      ws.terminate();
      return;
    }
    user.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

const periodicSave = setInterval(async () => {
  const activeRooms = Array.from(rooms.entries());
  const now = Date.now();
  const savePromises: Promise<{ roomId: string; success: boolean }>[] = [];

  for (const [roomId, room] of activeRooms) {
    if (room.users.size > 0) {
      roomLastEmptyAt.delete(roomId);
      if (!room.saving && room.dirty) {
        room.saving = true;
        savePromises.push(
          saveRoomElements(roomId, room.elements).then(success => {
            if (success) room.dirty = false;
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
        if (!room.saving && room.elements.size > 0 && room.dirty) {
          room.saving = true;
          savePromises.push(
            saveRoomElements(roomId, room.elements).then(success => {
              if (success) room.dirty = false;
              room.saving = false;
              return { roomId, success };
            })
          );
        }
        if (room.users.size === 0) {
          rooms.delete(roomId);
          roomLastEmptyAt.delete(roomId);
          if (room.yjs) {
            deleteYjsRoom(roomId);
          }
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

const RECONCILIATION_INTERVAL_MS = 60_000;

const reconciliation = setInterval(async () => {
  for (const [roomId, room] of rooms) {
    if (room.users.size === 0) continue;
    if (room.saving) continue;

    try {
      let dbContent: string | null = null;

      if (room.recordType === 'canvasRoom') {
        const dbRoom = await db.canvasRoom.findUnique({
          where: { slug: roomId },
          select: { content: true },
        });
        dbContent = dbRoom?.content ?? null;
      } else {
        const dbFile = await db.file.findUnique({
          where: { id: roomId },
          select: { content: true },
        });
        dbContent = dbFile?.content ?? null;
      }

      if (dbContent === null) continue;

      const dbParsed = parseStoredElements(dbContent);
      const dbIds = new Set(dbParsed.map((e: DriplElement) => e.id));
      const memIds = new Set(room.elements.keys());

      const addedInMem = [...memIds].filter(id => !dbIds.has(id));
      const addedInDb = [...dbIds].filter(id => !memIds.has(id));

      if (addedInMem.length > 0 || addedInDb.length > 0) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            event: 'state_divergence',
            roomId,
            memCount: memIds.size,
            dbCount: dbIds.size,
            onlyInMem: addedInMem.length,
            onlyInDb: addedInDb.length,
          })
        );
        room.saving = true;
        const success = await saveRoomElements(roomId, room.elements);
        room.saving = false;
        if (!success) {
          console.error(
            JSON.stringify({
              level: 'error',
              event: 'reconciliation_save_failure',
              roomId,
            })
          );
        }
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'reconciliation_check_error',
          roomId,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }
}, RECONCILIATION_INTERVAL_MS);

async function shutdown() {
  clearInterval(heartbeat);
  clearInterval(periodicSave);
  clearInterval(reconciliation);

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

start().then(() => {
  server.listen(WS_PORT, () => {
    console.log(JSON.stringify({ level: 'info', event: 'websocket_server_started', port: WS_PORT }));
  });
});
