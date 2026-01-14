"use client";

import { useEffect, useRef, useCallback } from "react";
import { useCanvasStore, RemoteUser, RemoteCursor } from "@/lib/canvas-store";
import type { DriplElement } from "@dripl/common";
import { saveCanvasToIndexedDB } from "@/lib/canvas-db";

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
  const processedMessagesRef = useRef<Set<string>>(new Set());
  const lastMessageTimestampRef = useRef<Map<string, number>>(new Map());

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
      const messageWithId = {
        ...message,
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
      };
      wsRef.current.send(JSON.stringify(messageWithId));
    } else {
      console.warn("WebSocket not connected, message not sent:", message.type);
    }
  }, []);

  const connect = useCallback(() => {
    if (!userName) return;

    try {
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

        send({
          type: "join_room",
          roomId: roomSlug,
          userName: userName,
        });
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage & {
            id?: string;
            timestamp?: number;
            userId?: string;
          };

          if (message.id) {
            if (processedMessagesRef.current.has(message.id)) {
              return;
            }
            processedMessagesRef.current.add(message.id);

            if (processedMessagesRef.current.size > 1000) {
              const firstId = processedMessagesRef.current.values().next().value;
              if (firstId) processedMessagesRef.current.delete(firstId);
            }
          }

          if (message.type === "update_element" && message.timestamp && message.userId) {
            const elementId = (message as UpdateElementMessage).element.id;
            const lastTimestamp = lastMessageTimestampRef.current.get(elementId) || 0;
            
            if (message.timestamp <= lastTimestamp) {
              return;
            }
            lastMessageTimestampRef.current.set(elementId, message.timestamp);
          }

          switch (message.type) {
            case "sync_room_state": {
              const syncMsg = message as SyncRoomStateMessage;
              processedMessagesRef.current.clear();
              lastMessageTimestampRef.current.clear();
              setElements(syncMsg.elements || []);
              setUserId(syncMsg.yourUserId);

              if (syncMsg.users) {
                syncMsg.users.forEach((user) => {
                  if (user.userId !== syncMsg.yourUserId) {
                    addRemoteUser(user);
                  }
                });
              }

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
              if (addMsg.element && (!message.userId || message.userId !== elements.find(e => e.id === addMsg.element.id)?.id)) {
                addElement(addMsg.element);
              }
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

  useEffect(() => {
    const saveTimeout = setTimeout(() => {
      saveCanvasToIndexedDB(roomSlug, elements).catch((error) => {
        console.error("Failed to save to IndexedDB:", error);
      });
    }, 1000);

    return () => clearTimeout(saveTimeout);
  }, [elements, roomSlug]);

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
