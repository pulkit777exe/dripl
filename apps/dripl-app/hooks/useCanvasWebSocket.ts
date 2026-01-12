"use client";

import { useEffect, useRef, useCallback } from "react";
import { useCanvasStore, RemoteUser, RemoteCursor } from "@/lib/canvas-store";
import type { DriplElement } from "@dripl/common";
import { saveCanvasToIndexedDB } from "@/lib/canvas-db";

// Properly typed WebSocket message
interface SyncRoomStateMessage {
  type: "sync_room_state";
  elements: DriplElement[];
  users: RemoteUser[];
  cursors: Array<{
    userId: string;
    x: number;
    y: number;
    userName?: string;
    color?: string;
  }>;
  yourUserId: string;
}

interface UserJoinMessage {
  type: "user_join";
  userId: string;
  userName: string;
  color: string;
}

interface UserLeaveMessage {
  type: "user_leave";
  userId: string;
}

interface AddElementMessage {
  type: "add_element";
  element: DriplElement;
}

interface UpdateElementMessage {
  type: "update_element";
  element: DriplElement;
}

interface DeleteElementMessage {
  type: "delete_element";
  elementId: string;
}

interface CursorMoveMessage {
  type: "cursor_move";
  userId: string;
  x: number;
  y: number;
  userName?: string;
  color?: string;
}

type WebSocketMessage =
  | SyncRoomStateMessage
  | UserJoinMessage
  | UserLeaveMessage
  | AddElementMessage
  | UpdateElementMessage
  | DeleteElementMessage
  | CursorMoveMessage
  | { type: string };

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";

export function useCanvasWebSocket(
  roomSlug: string,
  userName: string | null,
  authToken?: string | null
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const reconnectAttemptsRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;

  const setIsConnected = useCanvasStore((state) => state.setIsConnected);
  const setElements = useCanvasStore((state) => state.setElements);
  const setUserId = useCanvasStore((state) => state.setUserId);
  const addElement = useCanvasStore((state) => state.addElement);
  const updateElement = useCanvasStore((state) => state.updateElement);
  const deleteElements = useCanvasStore((state) => state.deleteElements);
  const addRemoteUser = useCanvasStore((state) => state.addRemoteUser);
  const removeRemoteUser = useCanvasStore((state) => state.removeRemoteUser);
  const updateRemoteCursor = useCanvasStore(
    (state) => state.updateRemoteCursor
  );
  const elements = useCanvasStore((state) => state.elements);

  const send = useCallback((message: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn("WebSocket not connected, message not sent:", message.type);
    }
  }, []);

  const connect = useCallback(() => {
    if (!userName) return;

    try {
      // Build WebSocket URL with query parameters for authentication
      const wsUrl = new URL(WS_BASE_URL);
      wsUrl.searchParams.set("roomId", roomSlug);
      if (authToken) {
        wsUrl.searchParams.set("token", authToken);
      }

      const ws = new WebSocket(wsUrl.toString());
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connected");
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;

        // Join the room
        send({
          type: "join_room",
          roomId: roomSlug,
          userName: userName,
        });
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;

          switch (message.type) {
            case "sync_room_state": {
              const syncMsg = message as SyncRoomStateMessage;
              // Initial sync from server
              setElements(syncMsg.elements || []);
              setUserId(syncMsg.yourUserId);

              // Add remote users
              if (syncMsg.users) {
                syncMsg.users.forEach((user) => {
                  if (user.userId !== syncMsg.yourUserId) {
                    addRemoteUser(user);
                  }
                });
              }

              // Add remote cursors
              if (syncMsg.cursors) {
                syncMsg.cursors.forEach((cursor) => {
                  if (cursor.userId !== syncMsg.yourUserId) {
                    updateRemoteCursor(cursor.userId, {
                      x: cursor.x,
                      y: cursor.y,
                      userName: cursor.userName || "Unknown",
                      color: cursor.color || "#000000",
                    });
                  }
                });
              }
              break;
            }

            case "user_join": {
              const joinMsg = message as UserJoinMessage;
              addRemoteUser({
                userId: joinMsg.userId,
                userName: joinMsg.userName,
                color: joinMsg.color,
              });
              break;
            }

            case "user_leave": {
              const leaveMsg = message as UserLeaveMessage;
              removeRemoteUser(leaveMsg.userId);
              break;
            }

            case "add_element": {
              const addMsg = message as AddElementMessage;
              addElement(addMsg.element);
              break;
            }

            case "update_element": {
              const updateMsg = message as UpdateElementMessage;
              updateElement(updateMsg.element.id, updateMsg.element);
              break;
            }

            case "delete_element": {
              const deleteMsg = message as DeleteElementMessage;
              deleteElements([deleteMsg.elementId]);
              break;
            }

            case "cursor_move": {
              const cursorMsg = message as CursorMoveMessage;
              updateRemoteCursor(cursorMsg.userId, {
                x: cursorMsg.x,
                y: cursorMsg.y,
                userName: cursorMsg.userName || "Unknown",
                color: cursorMsg.color || "#000000",
              });
              break;
            }

            default:
              console.log("Unknown message type:", message.type);
          }
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
      };

      ws.onclose = () => {
        console.log("WebSocket disconnected");
        setIsConnected(false);

        // Attempt to reconnect
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current++;
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttemptsRef.current),
            30000
          );
          console.log(
            `Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          console.error("Max reconnection attempts reached");
        }
      };
    } catch (error) {
      console.error("Failed to create WebSocket connection:", error);
    }
  }, [
    roomSlug,
    userName,
    authToken,
    send,
    setIsConnected,
    setElements,
    setUserId,
    addElement,
    updateElement,
    deleteElements,
    addRemoteUser,
    removeRemoteUser,
    updateRemoteCursor,
  ]);

  // Auto-save to IndexedDB when elements change
  useEffect(() => {
    const saveTimeout = setTimeout(() => {
      saveCanvasToIndexedDB(roomSlug, elements).catch((error) => {
        console.error("Failed to save to IndexedDB:", error);
      });
    }, 1000); // Debounce saves by 1 second

    return () => clearTimeout(saveTimeout);
  }, [elements, roomSlug]);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return {
    send,
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
  };
}
