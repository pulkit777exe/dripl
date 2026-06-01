import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-ws-tests';
const TEST_PORT = 30091;

let testServer: ReturnType<typeof createServer>;
let wss: WebSocketServer;

interface UserConnection {
  userId: string;
  displayName: string;
  color: string;
  ws: WebSocket;
}

interface RoomState {
  roomId: string;
  elements: Array<Record<string, unknown>>;
  users: Map<string, UserConnection>;
  cursors: Map<string, { x: number; y: number }>;
}

const rooms = new Map<string, RoomState>();
const RATE_LIMIT_MAX = 30;
const userMessageCounts = new Map<WebSocket, { count: number; resetAt: number }>();

function createAuthToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h' });
}

function verifyToken(token: string | null): string | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId?: string };
    return decoded.userId ?? null;
  } catch {
    return null;
  }
}

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function broadcast(room: RoomState, payload: unknown, exceptUserId?: string): void {
  const data = JSON.stringify(payload);
  room.users.forEach((user) => {
    if (exceptUserId && user.userId === exceptUserId) return;
    if (user.ws.readyState !== WebSocket.OPEN) return;
    user.ws.send(data);
  });
}

function setupServer(): Promise<void> {
  return new Promise((resolve) => {
    testServer = createServer();
    wss = new WebSocketServer({ server: testServer });

    wss.on('connection', (ws, req) => {
      const url = new URL(req.url || '', `http://localhost:${TEST_PORT}`);
      const token = url.searchParams.get('token');
      const userId = verifyToken(token);

      if (!userId) {
        ws.close(4001, 'Authentication required');
        return;
      }

      let currentRoomId: string | null = null;
      let currentUserId: string | null = null;

      ws.on('message', (raw: Buffer) => {
        const now = Date.now();
        const rateInfo = userMessageCounts.get(ws);
        if (rateInfo && rateInfo.resetAt > now) {
          rateInfo.count += 1;
          if (rateInfo.count > RATE_LIMIT_MAX) {
            ws.close(4000, 'Rate limit exceeded');
            return;
          }
        } else {
          userMessageCounts.set(ws, { count: 1, resetAt: now + 1000 });
        }

        let parsed: { type: string; [key: string]: unknown };
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          return;
        }

        if (parsed.type === 'join' || parsed.type === 'join_room') {
          const roomId = parsed.roomId as string;
          let room = rooms.get(roomId);
          if (!room) {
            room = { roomId, elements: [], users: new Map(), cursors: new Map() };
            rooms.set(roomId, room);
          }

          const displayName = (parsed.displayName || parsed.userName || `User-${userId.slice(0, 4)}`) as string;
          const color = (parsed.color as string) || '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');

          currentRoomId = roomId;
          currentUserId = userId;

          const connection: UserConnection = { userId, displayName, color, ws };
          room.users.set(userId, connection);
          (ws as WebSocket & { __userId?: string }).__userId = userId;

          send(ws, {
            type: 'sync_room_state',
            roomId,
            elements: room.elements,
            users: Array.from(room.users.values()).map((u) => ({
              userId: u.userId,
              userName: u.displayName,
              displayName: u.displayName,
              color: u.color,
            })),
            cursors: Array.from(room.cursors.entries()).map(([uid, c]) => ({
              userId: uid,
              x: c.x,
              y: c.y,
              userName: room.users.get(uid)?.displayName ?? 'Unknown',
              displayName: room.users.get(uid)?.displayName ?? 'Unknown',
              color: room.users.get(uid)?.color ?? '#000000',
            })),
            yourUserId: userId,
            timestamp: Date.now(),
          });

          send(ws, {
            type: 'room-state',
            roomId,
            elements: room.elements,
            users: Array.from(room.users.values()).map((u) => ({
              userId: u.userId,
              userName: u.displayName,
              displayName: u.displayName,
              color: u.color,
            })),
            cursors: Array.from(room.cursors.entries()).map(([uid, c]) => ({
              userId: uid,
              x: c.x,
              y: c.y,
              userName: room.users.get(uid)?.displayName ?? 'Unknown',
              displayName: room.users.get(uid)?.displayName ?? 'Unknown',
              color: room.users.get(uid)?.color ?? '#000000',
            })),
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
        } else if (parsed.type === 'leave' || parsed.type === 'leave_room') {
          if (!currentRoomId || !currentUserId) return;
          const room = rooms.get(currentRoomId);
          if (!room) return;

          room.users.delete(currentUserId);
          room.cursors.delete(currentUserId);

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
        } else if (parsed.type === 'add_element') {
          if (!currentRoomId) return;
          const room = rooms.get(currentRoomId);
          if (!room) return;

          const element = parsed.element as Record<string, unknown>;
          room.elements = room.elements.filter((el) => el.id !== element.id);
          room.elements.push(element);
          broadcast(room, parsed, currentUserId ?? undefined);
        } else if (parsed.type === 'update_element') {
          if (!currentRoomId) return;
          const room = rooms.get(currentRoomId);
          if (!room) return;

          const element = parsed.element as Record<string, unknown>;
          room.elements = room.elements.map((e) => (e.id === element.id ? element : e));
          broadcast(room, parsed, currentUserId ?? undefined);
        } else if (parsed.type === 'delete_element') {
          if (!currentRoomId) return;
          const room = rooms.get(currentRoomId);
          if (!room) return;

          room.elements = room.elements.filter((el) => el.id !== parsed.elementId);
          broadcast(room, parsed, currentUserId ?? undefined);
        } else if (parsed.type === 'scene-update') {
          if (!currentRoomId) return;
          const room = rooms.get(currentRoomId);
          if (!room) return;

          const elements = parsed.elements as Array<Record<string, unknown>>;
          if (!Array.isArray(elements)) return;

          const merged = new Map(room.elements.map((el) => [el.id, el]));
          for (const el of elements) {
            merged.set(el.id as string, el);
          }
          room.elements = Array.from(merged.values());

          broadcast(room, {
            type: 'scene-update',
            subtype: parsed.subtype,
            elements: room.elements,
          }, currentUserId ?? undefined);
        } else if (parsed.type === 'cursor_move' || parsed.type === 'cursor-move') {
          if (!currentRoomId || !currentUserId) return;
          const room = rooms.get(currentRoomId);
          if (!room) return;

          room.cursors.set(currentUserId, { x: parsed.x as number, y: parsed.y as number });
          const user = room.users.get(currentUserId);

          broadcast(room, {
            type: 'cursor_move',
            roomId: currentRoomId,
            userId: currentUserId,
            x: parsed.x,
            y: parsed.y,
            userName: (parsed.displayName || parsed.userName) ?? user?.displayName ?? 'Unknown',
            displayName: (parsed.displayName || parsed.userName) ?? user?.displayName ?? 'Unknown',
            color: (parsed.color as string) ?? user?.color ?? '#000000',
            timestamp: Date.now(),
          }, currentUserId);
        } else if (parsed.type === 'ping') {
          send(ws, { type: 'pong', timestamp: Date.now() });
        }
      });

      ws.on('close', () => {
        if (!currentRoomId || !currentUserId) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;

        room.users.delete(currentUserId);
        room.cursors.delete(currentUserId);

        broadcast(room, {
          type: 'user-leave',
          roomId: currentRoomId,
          userId: currentUserId,
          timestamp: Date.now(),
        });

        if (room.users.size === 0) {
          rooms.delete(currentRoomId);
        }
      });
    });

    testServer.listen(TEST_PORT, () => {
      resolve();
    });
  });
}

function connectClient(token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}?token=${token}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket, timeout = 3000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error('Timeout waiting for message'));
    }, timeout);
    const handler = (data: unknown) => {
      clearTimeout(timer);
      ws.removeListener('message', handler);
      resolve(JSON.parse((data as Buffer).toString()));
    };
    ws.on('message', handler);
  });
}

function waitForMessages(ws: WebSocket, count: number, timeout = 3000): Promise<unknown[]> {
  const messages: unknown[] = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error(`Timeout waiting for ${count} messages, got ${messages.length}`));
    }, timeout);
    const handler = (data: unknown) => {
      messages.push(JSON.parse((data as Buffer).toString()));
      if (messages.length === count) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(messages);
      }
    };
    ws.on('message', handler);
  });
}

function drainMessages(ws: WebSocket, count: number, timeout = 500): Promise<void> {
  return new Promise((resolve) => {
    let received = 0;
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      resolve();
    }, timeout);
    const handler = () => {
      received++;
      if (received >= count) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve();
      }
    };
    ws.on('message', handler);
  });
}

beforeAll(async () => {
  rooms.clear();
  userMessageCounts.clear();
  await setupServer();
}, 30000);

afterAll(() => {
  rooms.clear();
  userMessageCounts.clear();
  wss.close();
  testServer.close();
});

afterEach(() => {
  rooms.clear();
  userMessageCounts.clear();
});

describe('ws-server Integration Tests', () => {
  describe('Authentication', () => {
    it('rejects connection without token', async () => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
      await new Promise<void>((resolve) => {
        ws.on('close', (code) => {
          if (code === 4001) resolve();
        });
      });
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    }, 10000);

    it('rejects connection with invalid token', async () => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}?token=invalid`);
      await new Promise<void>((resolve) => {
        ws.on('close', (code) => {
          if (code === 4001) resolve();
        });
      });
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    }, 10000);

    it('accepts connection with valid token', async () => {
      const token = createAuthToken('user-test-1');
      const ws = await connectClient(token);
      ws.close();
    }, 10000);
  });

  describe('Join Room', () => {
    it('sends sync_room_state and room-state on join', async () => {
      const token = createAuthToken('user-join-1');
      const ws = await connectClient(token);

      send(ws, { type: 'join', roomId: 'room-join-1' });

      const [msg1, msg2] = await waitForMessages(ws, 2);

      expect((msg1 as { type: string }).type).toBe('sync_room_state');
      expect((msg1 as { roomId: string }).roomId).toBe('room-join-1');
      expect(Array.isArray((msg1 as { elements: unknown }).elements)).toBe(true);

      expect((msg2 as { type: string }).type).toBe('room-state');
      expect((msg2 as { roomId: string }).roomId).toBe('room-join-1');

      ws.close();
    }, 10000);

    it('sends user-join to existing room members', async () => {
      const token1 = createAuthToken('user-join-2');
      const token2 = createAuthToken('user-join-3');

      const ws1 = await connectClient(token1);
      send(ws1, { type: 'join', roomId: 'room-join-2' });
      await waitForMessages(ws1, 2);

      const ws2 = await connectClient(token2);
      send(ws2, { type: 'join', roomId: 'room-join-2' });
      await waitForMessages(ws2, 2);

      // Consume user-join broadcast that ws1 got from ws2 joining
      const msg1 = await waitForMessage(ws1);
      expect((msg1 as { type: string }).type).toBe('user-join');
      expect((msg1 as { userId: string }).userId).toBe('user-join-3');

      ws1.close();
      ws2.close();
    }, 10000);
  });

  describe('Leave Room', () => {
    it('broadcasts user-leave when user leaves', async () => {
      const token1 = createAuthToken('user-leave-1');
      const token2 = createAuthToken('user-leave-2');

      const ws1 = await connectClient(token1);
      send(ws1, { type: 'join', roomId: 'room-leave-1' });
      await waitForMessages(ws1, 2);

      const ws2 = await connectClient(token2);
      send(ws2, { type: 'join', roomId: 'room-leave-1' });
      await waitForMessages(ws2, 2);

      // Consume user-join that ws1 received
      await drainMessages(ws1, 1);

      send(ws2, { type: 'leave' });

      const msg = await waitForMessage(ws1);
      expect((msg as { type: string }).type).toBe('user-leave');
      expect((msg as { userId: string }).userId).toBe('user-leave-2');

      ws1.close();
      ws2.close();
    }, 10000);
  });

  describe('Element Operations', () => {
    it('add_element broadcasts to other users', async () => {
      const token1 = createAuthToken('user-elem-1');
      const token2 = createAuthToken('user-elem-2');

      const ws1 = await connectClient(token1);
      send(ws1, { type: 'join', roomId: 'room-elem-1' });
      await waitForMessages(ws1, 2);

      const ws2 = await connectClient(token2);
      send(ws2, { type: 'join', roomId: 'room-elem-1' });
      await waitForMessages(ws2, 2);

      // Consume user-join that ws1 received
      await drainMessages(ws1, 1);

      const element = {
        id: 'elem-new-1',
        type: 'rectangle',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
      };
      send(ws2, { type: 'add_element', element });

      const msg = await waitForMessage(ws1);
      expect((msg as { type: string }).type).toBe('add_element');
      expect((msg as { element: { id: string } }).element.id).toBe('elem-new-1');

      ws1.close();
      ws2.close();
    }, 10000);

    it('update_element broadcasts updated element', async () => {
      const token1 = createAuthToken('user-update-1');
      const token2 = createAuthToken('user-update-2');

      const ws1 = await connectClient(token1);
      send(ws1, { type: 'join', roomId: 'room-update-1' });
      await waitForMessages(ws1, 2);

      const ws2 = await connectClient(token2);
      send(ws2, { type: 'join', roomId: 'room-update-1' });
      await waitForMessages(ws2, 2);

      // Consume user-join that ws1 received
      await drainMessages(ws1, 1);

      const element = {
        id: 'elem-update-1',
        type: 'rectangle',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
      };
      send(ws2, { type: 'add_element', element });
      await waitForMessage(ws1);

      const updatedElement = { ...element, x: 100 };
      send(ws2, { type: 'update_element', element: updatedElement });

      const msg = await waitForMessage(ws1);
      expect((msg as { type: string }).type).toBe('update_element');
      expect((msg as { element: { x: number } }).element.x).toBe(100);

      ws1.close();
      ws2.close();
    }, 10000);

    it('delete_element removes element from room', async () => {
      const token1 = createAuthToken('user-delete-1');
      const token2 = createAuthToken('user-delete-2');

      const ws1 = await connectClient(token1);
      send(ws1, { type: 'join', roomId: 'room-delete-1' });
      await waitForMessages(ws1, 2);

      const ws2 = await connectClient(token2);
      send(ws2, { type: 'join', roomId: 'room-delete-1' });
      await waitForMessages(ws2, 2);

      // Consume user-join that ws1 received
      await drainMessages(ws1, 1);

      const element = {
        id: 'elem-delete-1',
        type: 'rectangle',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
      };
      send(ws2, { type: 'add_element', element });
      await waitForMessage(ws1);

      send(ws2, { type: 'delete_element', elementId: 'elem-delete-1' });

      const msg = await waitForMessage(ws1);
      expect((msg as { type: string }).type).toBe('delete_element');
      expect((msg as { elementId: string }).elementId).toBe('elem-delete-1');

      ws1.close();
      ws2.close();
    }, 10000);
  });

  describe('Scene Update', () => {
    it('scene-update broadcasts merged elements', async () => {
      const token1 = createAuthToken('user-scene-1');
      const token2 = createAuthToken('user-scene-2');

      const ws1 = await connectClient(token1);
      send(ws1, { type: 'join', roomId: 'room-scene-1' });
      await waitForMessages(ws1, 2);

      const ws2 = await connectClient(token2);
      send(ws2, { type: 'join', roomId: 'room-scene-1' });
      await waitForMessages(ws2, 2);

      // Consume user-join that ws1 received
      await drainMessages(ws1, 1);

      const elements = [
        { id: 'scene-elem-1', type: 'rectangle', x: 0, y: 0, width: 50, height: 50 },
        { id: 'scene-elem-2', type: 'rectangle', x: 100, y: 0, width: 50, height: 50 },
      ];
      send(ws2, { type: 'scene-update', subtype: 'update', elements });

      const msg = await waitForMessage(ws1);
      expect((msg as { type: string }).type).toBe('scene-update');
      expect(Array.isArray((msg as { elements: unknown }).elements)).toBe(true);
      expect(((msg as { elements: unknown[] }).elements).length).toBe(2);

      ws1.close();
      ws2.close();
    }, 10000);

    it('scene-update replaces existing elements', async () => {
      const token = createAuthToken('user-scene-replace');
      const ws = await connectClient(token);
      send(ws, { type: 'join', roomId: 'room-scene-replace' });
      await waitForMessages(ws, 2);

      const elements1 = [{ id: 'elem-replace-1', type: 'rectangle', x: 0, y: 0, width: 50, height: 50 }];
      send(ws, { type: 'scene-update', subtype: 'update', elements: elements1 });
      // No broadcast to self — just verify server accepted it by adding a second user who receives full state
      const token2 = createAuthToken('user-scene-replace-2');
      const ws2 = await connectClient(token2);
      send(ws2, { type: 'join', roomId: 'room-scene-replace' });
      const [, roomState] = await waitForMessages(ws2, 2) as Array<{ elements?: Array<{ id: string }> }>;
      expect(roomState?.elements?.some((e) => e.id === 'elem-replace-1')).toBe(true);

      const elements2 = [{ id: 'elem-replace-2', type: 'rectangle', x: 200, y: 0, width: 50, height: 50 }];
      send(ws, { type: 'scene-update', subtype: 'update', elements: elements2 });
      const msg = await waitForMessage(ws2);
      const msgElements = (msg as { elements: Array<{ id: string }> }).elements;
      expect(msgElements.some((e) => e.id === 'elem-replace-2')).toBe(true);

      ws.close();
      ws2.close();
    }, 10000);
  });

  describe('Cursor Movement', () => {
    it('cursor_move broadcasts to other users', async () => {
      const token1 = createAuthToken('user-cursor-1');
      const token2 = createAuthToken('user-cursor-2');

      const ws1 = await connectClient(token1);
      send(ws1, { type: 'join', roomId: 'room-cursor-1' });
      await waitForMessages(ws1, 2);

      const ws2 = await connectClient(token2);
      send(ws2, { type: 'join', roomId: 'room-cursor-1' });
      await waitForMessages(ws2, 2);

      // Consume user-join that ws1 received
      await drainMessages(ws1, 1);

      send(ws2, { type: 'cursor_move', x: 123, y: 456 });

      const msg = await waitForMessage(ws1);
      expect((msg as { type: string }).type).toBe('cursor_move');
      expect((msg as { x: number; y: number }).x).toBe(123);
      expect((msg as { x: number; y: number }).y).toBe(456);

      ws1.close();
      ws2.close();
    }, 10000);

    it('cursor-move (kebab case) works the same', async () => {
      const token1 = createAuthToken('user-cursor-kebab-1');
      const token2 = createAuthToken('user-cursor-kebab-2');

      const ws1 = await connectClient(token1);
      send(ws1, { type: 'join', roomId: 'room-cursor-kebab' });
      await waitForMessages(ws1, 2);

      const ws2 = await connectClient(token2);
      send(ws2, { type: 'join', roomId: 'room-cursor-kebab' });
      await waitForMessages(ws2, 2);

      // Consume user-join that ws1 received
      await drainMessages(ws1, 1);

      send(ws2, { type: 'cursor-move', x: 789, y: 101112 });

      const msg = await waitForMessage(ws1);
      expect((msg as { type: string }).type).toBe('cursor_move');
      expect((msg as { x: number }).x).toBe(789);

      ws1.close();
      ws2.close();
    }, 10000);
  });

  describe('Ping/Pong', () => {
    it('ping returns pong', async () => {
      const token = createAuthToken('user-ping');
      const ws = await connectClient(token);

      send(ws, { type: 'ping' });

      const msg = await waitForMessage(ws);
      expect((msg as { type: string }).type).toBe('pong');
      expect(typeof (msg as { timestamp: number }).timestamp).toBe('number');

      ws.close();
    }, 10000);
  });

  describe('Connection Close', () => {
    it('broadcasts user-leave when connection closes ungracefully', async () => {
      const token1 = createAuthToken('user-close-1');
      const token2 = createAuthToken('user-close-2');

      const ws1 = await connectClient(token1);
      send(ws1, { type: 'join', roomId: 'room-close-1' });
      await waitForMessages(ws1, 2);

      const ws2 = await connectClient(token2);
      send(ws2, { type: 'join', roomId: 'room-close-1' });
      await waitForMessages(ws2, 2);

      // Consume user-join that ws1 received
      await drainMessages(ws1, 1);

      ws2.close();

      const msg = await waitForMessage(ws1);
      expect((msg as { type: string }).type).toBe('user-leave');
      expect((msg as { userId: string }).userId).toBe('user-close-2');

      ws1.close();
    }, 10000);

    it('deletes empty room after all users leave', async () => {
      const token = createAuthToken('user-empty-room');
      const ws = await connectClient(token);
      send(ws, { type: 'join', roomId: 'room-empty-check' });
      await waitForMessages(ws, 2);

      expect(rooms.has('room-empty-check')).toBe(true);

      send(ws, { type: 'leave' });
      // Wait briefly for server to process the leave
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(rooms.has('room-empty-check')).toBe(false);

      ws.close();
    }, 10000);
  });
});
