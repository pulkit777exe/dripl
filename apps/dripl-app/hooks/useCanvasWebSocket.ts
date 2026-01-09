"use client";

import { useEffect, useRef, useCallback } from "react";
import { useCanvasStore } from "@/lib/canvas-store";
import type { DriplElement } from "@dripl/common";
import { saveCanvasToIndexedDB } from "@/lib/canvas-db";

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

export function useCanvasWebSocket(roomSlug: string, userName: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const reconnectAttemptsRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;

  const setIsConnected = useCanvasStore((state) => state.setIsConnected);
  const setElements = useCanvasStore((state) => state.setElements);
  const addElement = useCanvasStore((state) => state.addElement);
  const updateElement = useCanvasStore((state) => state.updateElement);
  const deleteElements = useCanvasStore((state) => state.deleteElements);
  const addRemoteUser = useCanvasStore((state) => state.addRemoteUser);
  const removeRemoteUser = useCanvasStore((state) => state.removeRemoteUser);
  const updateRemoteCursor = useCanvasStore(
    (state) => state.updateRemoteCursor
  );
  const removeRemoteCursor = useCanvasStore(
    (state) => state.removeRemoteCursor
  );
  const elements = useCanvasStore((state) => state.elements);

  const send = useCallback((message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn("WebSocket not connected, message not sent:", message.type);
    }
  }, []);

  const connect = useCallback(() => {
    if (!userName) return;

    try {
      const ws = new WebSocket("ws://localhost:3001");
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
          const message: WebSocketMessage = JSON.parse(event.data);

          switch (message.type) {
            case "sync_room_state":
              // Initial sync from server
              setElements(message.elements || []);

              // Add remote users
              if (message.users) {
                message.users.forEach((user: any) => {
                  if (user.userId !== message.yourUserId) {
                    addRemoteUser(user);
                  }
                });
              }

              // Add remote cursors
              if (message.cursors) {
                message.cursors.forEach((cursor: any) => {
                  if (cursor.userId !== message.yourUserId) {
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

            case "user_join":
              addRemoteUser({
                userId: message.userId,
                userName: message.userName,
                color: message.color,
              });
              break;

            case "user_leave":
              removeRemoteUser(message.userId);
              break;

            case "add_element":
              addElement(message.element);
              break;

            case "update_element":
              updateElement(message.element.id, message.element);
              break;

            case "delete_element":
              deleteElements([message.elementId]);
              break;

            case "cursor_move":
              updateRemoteCursor(message.userId, {
                x: message.x,
                y: message.y,
                userName: message.userName || "Unknown",
                color: message.color || "#000000",
              });
              break;

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
    send,
    setIsConnected,
    setElements,
    addElement,
    updateElement,
    deleteElements,
    addRemoteUser,
    removeRemoteUser,
    updateRemoteCursor,
    userName,
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
