import { WebSocketServer, WebSocket } from "ws";
import { db } from "@dripl/db";
import type { DriplElement } from "@dripl/common";

interface CollabUser {
  userId: string;
  displayName: string;
  color: string;
}

type ClientMessage =
  | { type: "join"; roomId: string; userId: string; displayName: string; color: string }
  | { type: "element-update"; roomId: string; elements: DriplElement[] }
  | { type: "cursor-move"; roomId: string; userId: string; x: number; y: number }
  | { type: "element-lock"; roomId: string; elementId: string; userId: string }
  | { type: "element-unlock"; roomId: string; elementId: string }
  | { type: "ping" };

type ServerMessage =
  | { type: "room-state"; elements: DriplElement[]; users: CollabUser[] }
  | { type: "element-update"; elements: DriplElement[]; from: string }
  | { type: "cursor-move"; userId: string; x: number; y: number; color: string }
  | { type: "user-join"; user: CollabUser }
  | { type: "user-leave"; userId: string }
  | { type: "element-lock"; elementId: string; by: string }
  | { type: "element-unlock"; elementId: string }
  | { type: "pong" };

interface Room {
  clients: Set<WebSocket>;
  elements: DriplElement[];
  locks: Map<string, string>;
  users: Map<WebSocket, CollabUser>;
  loaded: boolean;
  loading: Promise<void> | null;
  flushTimer: NodeJS.Timeout | null;
  pendingElements: DriplElement[] | null;
  pendingFrom: string | null;
  pendingSender: WebSocket | null;
  persistTimer: NodeJS.Timeout | null;
}

interface ClientMeta {
  roomId: string | null;
  userId: string | null;
  color: string | null;
  displayName: string | null;
  lastPingAt: number;
}

const PORT = Number(process.env.WS_PORT ?? 3001);
const roomMap = new Map<string, Room>();
const clientMeta = new WeakMap<WebSocket, ClientMeta>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isElementArray(value: unknown): value is DriplElement[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) =>
      isRecord(item) &&
      isString(item.id) &&
      typeof item.type === "string" &&
      isFiniteNumber(item.x) &&
      isFiniteNumber(item.y),
  );
}

function makeRoom(): Room {
  return {
    clients: new Set<WebSocket>(),
    elements: [],
    locks: new Map<string, string>(),
    users: new Map<WebSocket, CollabUser>(),
    loaded: false,
    loading: null,
    flushTimer: null,
    pendingElements: null,
    pendingFrom: null,
    pendingSender: null,
    persistTimer: null,
  };
}

function parseIncoming(data: WebSocket.RawData): ClientMessage | null {
  try {
    const parsed = JSON.parse(data.toString()) as unknown;
    if (!isRecord(parsed) || typeof parsed.type !== "string") {
      return null;
    }

    switch (parsed.type) {
      case "ping":
        return { type: "ping" };
      case "join": {
        if (
          !isString(parsed.roomId) ||
          !isString(parsed.userId) ||
          !isString(parsed.displayName) ||
          !isString(parsed.color)
        ) {
          return null;
        }
        return {
          type: "join",
          roomId: parsed.roomId,
          userId: parsed.userId,
          displayName: parsed.displayName,
          color: parsed.color,
        };
      }
      case "element-update": {
        if (!isString(parsed.roomId) || !isElementArray(parsed.elements)) {
          return null;
        }
        return {
          type: "element-update",
          roomId: parsed.roomId,
          elements: parsed.elements as DriplElement[],
        };
      }
      case "cursor-move": {
        if (
          !isString(parsed.roomId) ||
          !isString(parsed.userId) ||
          !isFiniteNumber(parsed.x) ||
          !isFiniteNumber(parsed.y)
        ) {
          return null;
        }
        return {
          type: "cursor-move",
          roomId: parsed.roomId,
          userId: parsed.userId,
          x: parsed.x,
          y: parsed.y,
        };
      }
      case "element-lock": {
        if (
          !isString(parsed.roomId) ||
          !isString(parsed.elementId) ||
          !isString(parsed.userId)
        ) {
          return null;
        }
        return {
          type: "element-lock",
          roomId: parsed.roomId,
          elementId: parsed.elementId,
          userId: parsed.userId,
        };
      }
      case "element-unlock": {
        if (!isString(parsed.roomId) || !isString(parsed.elementId)) {
          return null;
        }
        return {
          type: "element-unlock",
          roomId: parsed.roomId,
          elementId: parsed.elementId,
        };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
}

function broadcast(
  room: Room,
  message: ServerMessage,
  exclude?: WebSocket | null,
) {
  room.clients.forEach((client) => {
    if (exclude && client === exclude) return;
    send(client, message);
  });
}

function mergeElements(current: DriplElement[], incoming: DriplElement[]): DriplElement[] {
  const byId = new Map<string, DriplElement>();
  current.forEach((element) => byId.set(element.id, element));

  incoming.forEach((element) => {
    const existing = byId.get(element.id);
    if (!existing) {
      byId.set(element.id, element);
      return;
    }
    byId.set(element.id, { ...existing, ...element });
  });

  const existingIds = new Set(current.map((element) => element.id));
  const updatedCurrent = current.map((element) => byId.get(element.id) ?? element);
  const appended = incoming
    .filter((element) => !existingIds.has(element.id))
    .map((element) => byId.get(element.id) ?? element);

  return [...updatedCurrent, ...appended];
}

async function saveRoom(roomId: string, elements: DriplElement[]) {
  try {
    await db.file.update({
      where: { id: roomId },
      data: { content: JSON.stringify(elements) },
    });
    return;
  } catch {
    // fallback to canvas room records when room id is slug-backed
  }

  try {
    await db.canvasRoom.update({
      where: { slug: roomId },
      data: { content: JSON.stringify(elements) },
    });
  } catch {
    // no-op for transient / ad-hoc rooms
  }
}

async function loadRoomElements(roomId: string): Promise<DriplElement[]> {
  try {
    const file = await db.file.findUnique({
      where: { id: roomId },
      select: { content: true },
    });
    if (file?.content) {
      return JSON.parse(file.content) as DriplElement[];
    }
  } catch {
    // try room fallback
  }

  try {
    const room = await db.canvasRoom.findUnique({
      where: { slug: roomId },
      select: { content: true },
    });
    if (room?.content) {
      return JSON.parse(room.content) as DriplElement[];
    }
  } catch {
    // ignore
  }

  return [];
}

async function ensureRoomLoaded(roomId: string, room: Room) {
  if (room.loaded) return;
  if (!room.loading) {
    room.loading = (async () => {
      room.elements = await loadRoomElements(roomId);
      room.loaded = true;
      room.loading = null;
    })();
  }
  await room.loading;
}

function scheduleFlush(room: Room) {
  if (room.flushTimer) return;
  room.flushTimer = setTimeout(() => {
    room.flushTimer = null;
    if (!room.pendingElements || !room.pendingFrom) return;
    const payload: ServerMessage = {
      type: "element-update",
      elements: room.pendingElements,
      from: room.pendingFrom,
    };
    broadcast(room, payload, room.pendingSender);
    room.pendingElements = null;
    room.pendingFrom = null;
    room.pendingSender = null;
  }, 33);
}

function schedulePersist(roomId: string, room: Room) {
  if (room.persistTimer) {
    clearTimeout(room.persistTimer);
  }
  room.persistTimer = setTimeout(() => {
    room.persistTimer = null;
    void saveRoom(roomId, room.elements);
  }, 2000);
}

function releaseUserLocks(room: Room, userId: string) {
  const unlocked: string[] = [];
  room.locks.forEach((owner, elementId) => {
    if (owner === userId) {
      room.locks.delete(elementId);
      unlocked.push(elementId);
    }
  });
  return unlocked;
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  clientMeta.set(ws, {
    roomId: null,
    userId: null,
    color: null,
    displayName: null,
    lastPingAt: Date.now(),
  });

  ws.on("message", async (data) => {
    const message = parseIncoming(data);
    if (!message) return;
    const meta = clientMeta.get(ws);
    if (!meta) return;

    if (message.type === "ping") {
      meta.lastPingAt = Date.now();
      send(ws, { type: "pong" });
      return;
    }

    if (message.type === "join") {
      const { roomId, userId, displayName, color } = message;
      const room = roomMap.get(roomId) ?? makeRoom();
      roomMap.set(roomId, room);
      await ensureRoomLoaded(roomId, room);

      meta.roomId = roomId;
      meta.userId = userId;
      meta.color = color;
      meta.displayName = displayName;
      meta.lastPingAt = Date.now();

      room.clients.add(ws);
      const user: CollabUser = { userId, displayName, color };
      room.users.set(ws, user);

      send(ws, {
        type: "room-state",
        elements: room.elements,
        users: Array.from(room.users.values()),
      });

      broadcast(room, { type: "user-join", user }, ws);
      return;
    }

    if (!meta.roomId || !meta.userId) {
      return;
    }

    const room = roomMap.get(meta.roomId);
    if (!room) return;

    if (message.type === "element-update") {
      if (message.roomId !== meta.roomId) return;
      room.elements = mergeElements(room.elements, message.elements);
      room.pendingElements = room.elements;
      room.pendingFrom = meta.userId;
      room.pendingSender = ws;
      scheduleFlush(room);
      schedulePersist(meta.roomId, room);
      return;
    }

    if (message.type === "cursor-move") {
      if (message.roomId !== meta.roomId) return;
      broadcast(
        room,
        {
          type: "cursor-move",
          userId: meta.userId,
          x: message.x,
          y: message.y,
          color: meta.color ?? "#6965db",
        },
        ws,
      );
      return;
    }

    if (message.type === "element-lock") {
      if (message.roomId !== meta.roomId) return;
      room.locks.set(message.elementId, meta.userId);
      broadcast(
        room,
        {
          type: "element-lock",
          elementId: message.elementId,
          by: meta.userId,
        },
        ws,
      );
      return;
    }

    if (message.type === "element-unlock") {
      if (message.roomId !== meta.roomId) return;
      room.locks.delete(message.elementId);
      broadcast(
        room,
        {
          type: "element-unlock",
          elementId: message.elementId,
        },
        ws,
      );
    }
  });

  ws.on("close", () => {
    const meta = clientMeta.get(ws);
    if (!meta?.roomId || !meta.userId) return;

    const room = roomMap.get(meta.roomId);
    if (!room) return;

    room.clients.delete(ws);
    room.users.delete(ws);
    broadcast(room, { type: "user-leave", userId: meta.userId }, ws);

    const unlocked = releaseUserLocks(room, meta.userId);
    unlocked.forEach((elementId) => {
      broadcast(room, { type: "element-unlock", elementId });
    });

    if (room.clients.size === 0) {
      if (room.flushTimer) clearTimeout(room.flushTimer);
      if (room.persistTimer) clearTimeout(room.persistTimer);
      room.pendingElements = null;
      room.pendingFrom = null;
      room.pendingSender = null;
      roomMap.delete(meta.roomId);
    }
  });
});

const heartbeat = setInterval(() => {
  const now = Date.now();
  wss.clients.forEach((client) => {
    const meta = clientMeta.get(client);
    if (!meta) return;
    if (now - meta.lastPingAt > 30_000) {
      client.terminate();
    }
  });
}, 10_000);

wss.on("close", () => {
  clearInterval(heartbeat);
});

process.on("SIGINT", () => {
  wss.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  wss.close(() => process.exit(0));
});

console.log(`[ws-server] listening on ws://localhost:${PORT}`);
