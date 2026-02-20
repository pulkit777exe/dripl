"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useCanvasStore } from "@/lib/canvas-store";
import type { RemoteUser, RemoteCursor } from "@/lib/canvas-store";
import type { DriplElement } from "@dripl/common";
import { saveCanvasToIndexedDB } from "@/lib/canvas-db";
import { ReconciliationManager, reconcileElements, shouldDiscardRemoteElement } from "@/lib/reconciliation";
import type { AppState } from "@/types/canvas";

const SYNC_FULL_SCENE_INTERVAL_MS = 20000;

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
const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_PROCESSED_IDS = 1000;
const INDEXEDDB_SAVE_DEBOUNCE_MS = 1000;

const NOOP_SEND = (_message: Record<string, unknown>) => {};

export function useCanvasWebSocket(
  roomSlug: string | null,
  userName: string | null,
  authToken?: string | null,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const reconnectAttemptsRef = useRef(0);
  const processedMessagesRef = useRef<Set<string>>(new Set());
  const lastMessageTimestampRef = useRef<Map<string, number>>(new Map());
  const reconciliationManagerRef = useRef<ReconciliationManager>(new ReconciliationManager());
  const fullSyncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastBroadcastedSceneVersionRef = useRef<number>(0);
  const broadcastedElementVersionsRef = useRef<Map<string, number>>(new Map());

  const [isConnected, setIsConnectedLocal] = useState(false);

  const setIsConnected = useCanvasStore((s) => s.setIsConnected);
  const setElements = useCanvasStore((s) => s.setElements);
  const setUserId = useCanvasStore((s) => s.setUserId);
  const addElement = useCanvasStore((s) => s.addElement);
  const updateElement = useCanvasStore((s) => s.updateElement);
  const deleteElements = useCanvasStore((s) => s.deleteElements);
  const addRemoteUser = useCanvasStore((s) => s.addRemoteUser);
  const removeRemoteUser = useCanvasStore((s) => s.removeRemoteUser);
  const updateRemoteCursor = useCanvasStore((s) => s.updateRemoteCursor);

  const send = useCallback((message: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const messageWithId = {
        ...message,
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        timestamp: Date.now(),
      };
      
      // Track broadcasted elements
      if (message.type === "sync_room_state" && message.elements) {
        (message.elements as DriplElement[]).forEach(el => {
          broadcastedElementVersionsRef.current.set(el.id, el.version ?? 0);
        });
      } else if (message.type === "add_element" && message.element) {
        const element = message.element as DriplElement;
        broadcastedElementVersionsRef.current.set(element.id, element.version ?? 0);
      } else if (message.type === "update_element" && message.element) {
        const element = message.element as DriplElement;
        broadcastedElementVersionsRef.current.set(element.id, element.version ?? 0);
      }
      
      wsRef.current.send(JSON.stringify(messageWithId));
    } else {
      console.warn("WebSocket not connected, message not sent:", message.type);
    }
  }, []);

  // -----------------------------------------------------------------------
  // handleMessage()  — processes an incoming server message.
  //
  // Uses `useCanvasStore.getState()` for element lookups so we never close
  // over a stale `elements` array.
  // -----------------------------------------------------------------------
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data) as WebSocketMessage & {
          id?: string;
          timestamp?: number;
          userId?: string;
        };

        if (message.id) {
          if (processedMessagesRef.current.has(message.id)) return;
          processedMessagesRef.current.add(message.id);

          if (processedMessagesRef.current.size > MAX_PROCESSED_IDS) {
            const first = processedMessagesRef.current.values().next().value;
            if (first) processedMessagesRef.current.delete(first);
          }
        }

        if (
          message.type === "update_element" &&
          message.timestamp &&
          message.userId
        ) {
          const elementId = (message as UpdateElementMessage).element.id;
          const lastTs = lastMessageTimestampRef.current.get(elementId) || 0;

          if (message.timestamp <= lastTs) return;
          lastMessageTimestampRef.current.set(elementId, message.timestamp);
        }

        switch (message.type) {
          case "sync_room_state": {
            const syncMsg = message as SyncRoomStateMessage;

            processedMessagesRef.current.clear();
            lastMessageTimestampRef.current.clear();

            setElements(syncMsg.elements || []);
            setUserId(syncMsg.yourUserId);

            syncMsg.users?.forEach((user) => {
              if (user.userId !== syncMsg.yourUserId) {
                addRemoteUser(user);
              }
            });

            syncMsg.cursors?.forEach((cursor) => {
              if (cursor.userId !== syncMsg.yourUserId) {
                updateRemoteCursor(cursor.userId, {
                  x: cursor.x,
                  y: cursor.y,
                  userName: cursor.userName || "Unknown",
                  color: cursor.color || "#000000",
                });
              }
            });
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
            if (!addMsg.element) break;

            const currentElements = useCanvasStore.getState().elements;
            const alreadyExists = currentElements.some(
              (e) => e.id === addMsg.element.id,
            );
            if (!alreadyExists) {
              addElement(addMsg.element);
            }
            break;
          }

           case "update_element": {
            const updateMsg = message as UpdateElementMessage;
            const currentElements = useCanvasStore.getState().elements;
            const reconciliationResult = reconcileElements(currentElements, [updateMsg.element]);
            
            if (reconciliationResult.accepted.length > 0) {
              reconciliationResult.accepted.forEach((el) => {
                updateElement(el.id, el);
              });
              console.log("[Reconciliation] Accepted update for:", updateMsg.element.id, "version:", updateMsg.element.version);
            } else {
              console.log("[Reconciliation] Rejected update for:", updateMsg.element.id, "- version too old");
            }
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
    },
    [
      setElements,
      setUserId,
      addElement,
      updateElement,
      deleteElements,
      addRemoteUser,
      removeRemoteUser,
      updateRemoteCursor,
    ],
  );

  // -----------------------------------------------------------------------
  // Track broadcasted element versions to avoid redundant updates
  // -----------------------------------------------------------------------
  const trackBroadcastedElements = useCallback((elements: DriplElement[]) => {
    elements.forEach(el => {
      broadcastedElementVersionsRef.current.set(el.id, el.version ?? 0);
    });
  }, []);

  // -----------------------------------------------------------------------
  // Get syncable elements - only send elements that have been updated
  // -----------------------------------------------------------------------
  const getSyncableElements = useCallback((elements: DriplElement[]): DriplElement[] => {
    return elements.reduce((acc, element) => {
      const lastBroadcastedVersion = broadcastedElementVersionsRef.current.get(element.id);
      if (
        !lastBroadcastedVersion || 
        (element.version ?? 0) > lastBroadcastedVersion
      ) {
        acc.push(element);
      }
      return acc;
    }, [] as DriplElement[]);
  }, []);

  const queueBroadcastAllElements = useCallback(() => {
    const currentElements = useCanvasStore.getState().elements;
    const currentVersion = getSceneVersion(currentElements);
    
    if (currentVersion > lastBroadcastedSceneVersionRef.current) {
      const syncableElements = getSyncableElements(currentElements);
      
      if (syncableElements.length > 0) {
        send({
          type: "sync_room_state",
          elements: syncableElements,
          timestamp: Date.now(),
        });
        trackBroadcastedElements(syncableElements);
        lastBroadcastedSceneVersionRef.current = currentVersion;
      }
    }
  }, [send, trackBroadcastedElements, getSyncableElements]);

  const getSceneVersion = useCallback((elements: DriplElement[]): number => {
    return elements.reduce((max, el) => {
      return Math.max(max, el.version ?? 0);
    }, 0);
  }, []);

  const connect = useCallback(() => {
    if (!userName || !roomSlug) return;

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
        setIsConnectedLocal(true);
        reconnectAttemptsRef.current = 0;

        fullSyncIntervalRef.current = setInterval(() => {
          queueBroadcastAllElements();
        }, SYNC_FULL_SCENE_INTERVAL_MS);

        send({
          type: "join_room",
          roomId: roomSlug,
          userName: userName,
        });
      };

      ws.onmessage = handleMessage;

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
      };

      ws.onclose = () => {
        console.log("WebSocket disconnected");
        setIsConnected(false);
        setIsConnectedLocal(false);

        if (fullSyncIntervalRef.current) {
          clearInterval(fullSyncIntervalRef.current);
          fullSyncIntervalRef.current = null;
        }

        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current++;
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttemptsRef.current),
            30000,
          );
          console.log(
            `Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`,
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
  }, [roomSlug, userName, authToken, send, handleMessage, setIsConnected]);

  useEffect(() => {
    if (!roomSlug) return;

    const elements = useCanvasStore.getState().elements;
    const saveTimeout = setTimeout(() => {
      saveCanvasToIndexedDB(roomSlug, elements).catch((error) => {
        console.error("Failed to save to IndexedDB:", error);
      });
    }, INDEXEDDB_SAVE_DEBOUNCE_MS);

    return () => clearTimeout(saveTimeout);
  }, [roomSlug, useCanvasStore((s) => s.elements)]);

  useEffect(() => {
    if (!roomSlug) return;

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, roomSlug]);

  if (roomSlug === null) {
    return {
      send: NOOP_SEND,
      isConnected: false,
    };
  }

  return {
    send,
    isConnected,
  };
}
