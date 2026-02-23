import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import type { DriplElement } from "@dripl/common";

/**
 * WebSocket Backend Server
 * Per TDD Backend Technical Design:
 * - Room Manager (in-memory room state)
 * - Diff Relay Engine
 * - Snapshot Service (periodic)
 * - Presence tracking
 */

interface UserPresence {
  userId: string;
  userName: string;
  color: string;
  cursor?: { x: number; y: number };
}

interface RoomState {
  boardId: string;
  elementsMap: Map<string, DriplElement>;
  latestVersion: number;
  users: Map<string, UserPresence>;
  lastSnapshotAt: number;
}

// WebSocket message types
interface WSMessage {
  type: string;
  [key: string]: unknown;
}

// Room storage
const rooms = new Map<string, RoomState>();

// Client tracking
interface Client {
  ws: WebSocket;
  roomId: string | null;
  userId: string | null;
}

const clients = new Map<WebSocket, Client>();

// Configuration
const SNAPSHOT_INTERVAL_MS = 30000; // 30 seconds
const MAX_PAYLOAD_SIZE = 1024 * 1024; // 1MB

/**
 * Create a new room
 */
function createRoom(boardId: string): RoomState {
  const room: RoomState = {
    boardId,
    elementsMap: new Map(),
    latestVersion: 0,
    users: new Map(),
    lastSnapshotAt: Date.now(),
  };
  rooms.set(boardId, room);
  console.log(`[WS] Room created: ${boardId}`);
  return room;
}

/**
 * Get or create a room
 */
function getRoom(boardId: string): RoomState {
  let room = rooms.get(boardId);
  if (!room) {
    room = createRoom(boardId);
  }
  return room;
}

/**
 * Broadcast to all clients in a room except sender
 */
function broadcastToRoom(
  roomId: string,
  message: WSMessage,
  excludeWs: WebSocket | null = null,
): void {
  const room = rooms.get(roomId);
  if (!room) return;

  const messageStr = JSON.stringify(message);

  room.users.forEach((_, clientUserId) => {
    clients.forEach((client, ws) => {
      if (
        client.roomId === roomId &&
        client.userId !== clientUserId &&
        ws !== excludeWs
      ) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(messageStr);
        }
      }
    });
  });
}

/**
 * Send to a specific user
 */
function sendToUser(ws: WebSocket, message: WSMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Handle incoming messages
 */
function handleMessage(ws: WebSocket, message: WSMessage): void {
  const client = clients.get(ws);
  if (!client) return;

  switch (message.type) {
    case "join": {
      const boardId = message.boardId as string;
      const userId = message.userId as string;
      const userName = (message.userName as string) || "Anonymous";
      const color =
        (message.color as string) ||
        "#" + Math.floor(Math.random() * 16777215).toString(16);
      const lastKnownVersion = (message.lastKnownVersion as number) || 0;

      // Join room
      const room = getRoom(boardId);
      client.roomId = boardId;
      client.userId = userId;

      // Add user to room
      room.users.set(userId, { userId, userName, color });

      console.log(`[WS] User ${userId} joined room ${boardId}`);

      // Send initial state
      const elements = Array.from(room.elementsMap.values());

      // Calculate missing diffs if reconnecting
      let missingDiffs: DriplElement[] = [];
      if (lastKnownVersion < room.latestVersion) {
        missingDiffs = elements.filter(
          (el) => (el.version ?? 0) > lastKnownVersion,
        );
      }

      sendToUser(ws, {
        type: "sync_room_state",
        elements,
        missingDiffs,
        yourUserId: userId,
        users: Array.from(room.users.values()),
        version: room.latestVersion,
      });

      // Notify others
      broadcastToRoom(
        boardId,
        {
          type: "user_join",
          userId,
          userName,
          color,
        },
        ws,
      );
      break;
    }

    case "add_element": {
      if (!client.roomId || !client.userId) return;

      const element = message.element as DriplElement;
      if (!element || !element.id) return;

      const room = rooms.get(client.roomId);
      if (!room) return;

      // Validate payload size
      const payloadSize = JSON.stringify(message).length;
      if (payloadSize > MAX_PAYLOAD_SIZE) {
        console.warn(`[WS] Payload too large: ${payloadSize} bytes`);
        return;
      }

      // Set version
      element.version = room.latestVersion + 1;
      element.updated = Date.now();

      // Store element
      room.elementsMap.set(element.id, element);
      room.latestVersion = element.version!;

      // Broadcast to others
      broadcastToRoom(
        client.roomId,
        {
          type: "add_element",
          element,
        },
        ws,
      );

      console.log(`[WS] Element added: ${element.id} v${element.version}`);
      break;
    }

    case "update_element": {
      if (!client.roomId) return;

      const element = message.element as DriplElement;
      if (!element || !element.id) return;

      const room = rooms.get(client.roomId);
      if (!room) return;

      // Validate payload size
      const payloadSize = JSON.stringify(message).length;
      if (payloadSize > MAX_PAYLOAD_SIZE) {
        console.warn(`[WS] Payload too large: ${payloadSize} bytes`);
        return;
      }

      const existing = room.elementsMap.get(element.id);

      // Version-based reconciliation (per TDD)
      if (existing && (element.version ?? 0) <= (existing.version ?? 0)) {
        // Discard if version is not newer
        console.log(`[WS] Rejected update for ${element.id} - version too old`);
        return;
      }

      // Update version
      element.version = room.latestVersion + 1;
      element.updated = Date.now();

      // Store element
      room.elementsMap.set(element.id, element);
      room.latestVersion = element.version!;

      // Broadcast to others
      broadcastToRoom(
        client.roomId,
        {
          type: "update_element",
          element,
        },
        ws,
      );

      console.log(`[WS] Element updated: ${element.id} v${element.version}`);
      break;
    }

    case "delete_element": {
      if (!client.roomId) return;

      const elementId = message.elementId as string;
      if (!elementId) return;

      const room = rooms.get(client.roomId);
      if (!room) return;

      // Delete element
      room.elementsMap.delete(elementId);

      // Broadcast to others
      broadcastToRoom(
        client.roomId,
        {
          type: "delete_element",
          elementId,
        },
        ws,
      );

      console.log(`[WS] Element deleted: ${elementId}`);
      break;
    }

    case "cursor_move": {
      if (!client.roomId || !client.userId) return;

      const x = message.x as number;
      const y = message.y as number;

      const room = rooms.get(client.roomId);
      if (!room) return;

      // Update cursor position
      const user = room.users.get(client.userId);
      if (user) {
        user.cursor = { x, y };
      }

      // Broadcast to others (no persistence per TDD)
      broadcastToRoom(
        client.roomId,
        {
          type: "cursor_move",
          userId: client.userId,
          x,
          y,
          userName: user?.userName,
          color: user?.color,
        },
        ws,
      );
      break;
    }

    default:
      console.log(`[WS] Unknown message type: ${message.type}`);
  }
}

/**
 * Handle client disconnect
 */
function handleClose(ws: WebSocket): void {
  const client = clients.get(ws);
  if (!client) return;

  if (client.roomId && client.userId) {
    const room = rooms.get(client.roomId);
    if (room) {
      // Remove user from room
      room.users.delete(client.userId);

      // Notify others
      broadcastToRoom(client.roomId, {
        type: "user_leave",
        userId: client.userId,
      });

      // Clean up empty rooms
      if (room.users.size === 0) {
        // Trigger final snapshot (in production, save to DB)
        console.log(`[WS] Room ${client.roomId} is empty - cleaning up`);
        rooms.delete(client.roomId);
      }
    }
  }

  clients.delete(ws);
  console.log(`[WS] Client disconnected`);
}

/**
 * Create and start WebSocket server
 */
export function createWebSocketServer(port: number = 3001): void {
  const server = createServer();

  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws: WebSocket) => {
    console.log("[WS] New client connected");

    // Track client
    clients.set(ws, {
      ws,
      roomId: null,
      userId: null,
    });

    ws.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as WSMessage;
        handleMessage(ws, message);
      } catch (error) {
        console.error("[WS] Failed to parse message:", error);
      }
    });

    ws.on("close", () => {
      handleClose(ws);
    });

    ws.on("error", (error: Error) => {
      console.error("[WS] WebSocket error:", error);
    });
  });

  // Periodic snapshot (per TDD Section 5.3)
  setInterval(() => {
    rooms.forEach((room, boardId) => {
      if (room.users.size > 0) {
        // In production: save to database
        console.log(
          `[WS] Snapshot for room ${boardId}: ${room.elementsMap.size} elements, v${room.latestVersion}`,
        );
        room.lastSnapshotAt = Date.now();
      }
    });
  }, SNAPSHOT_INTERVAL_MS);

  server.listen(port, () => {
    console.log(`[WS] WebSocket server running on ws://localhost:${port}`);
  });
}

// Run if called directly - ES module compatible check
const isMainModule =
  process.argv[1]?.includes("websocket-server") ||
  process.argv[1]?.includes("src/websocket-server");

if (isMainModule) {
  createWebSocketServer();
}

export default { createWebSocketServer };
