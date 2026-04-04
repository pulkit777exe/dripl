"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { DriplElement } from "@dripl/common";
import { useCanvasStore } from "@/lib/canvas-store";

export interface CollabUser {
  userId: string;
  displayName: string;
  color: string;
  x: number;
  y: number;
  updatedAt: number;
}

interface BasicUser {
  userId: string;
  displayName: string;
  color: string;
}

type ServerMessage =
  | {
      type: "sync_room_state";
      elements: DriplElement[];
      users: { userId: string; userName: string; color: string }[];
      cursors: {
        userId: string;
        x: number;
        y: number;
        userName: string;
        color: string;
      }[];
      yourUserId: string;
    }
  | {
      type: "user_join";
      userId: string;
      userName: string;
      color: string;
    }
  | { type: "user_leave"; userId: string }
  | { type: "add_element"; element: DriplElement }
  | { type: "update_element"; element: DriplElement }
  | { type: "delete_element"; elementId: string }
  | {
      type: "cursor_move";
      userId: string;
      x: number;
      y: number;
      userName: string;
      color: string;
    }
  | { type: "error"; message: string }
  | {
      type: "broadcast";
      message: Record<string, unknown>;
    };

type ClientMessage =
  | { type: "join_room"; roomId: string; userName?: string }
  | { type: "leave_room" }
  | { type: "add_element"; element: DriplElement }
  | { type: "update_element"; element: DriplElement }
  | { type: "delete_element"; elementId: string }
  | {
      type: "cursor_move";
      x: number;
      y: number;
      userName?: string;
      color?: string;
    };

export interface UseCollaborationReturn {
  isConnected: boolean;
  collaborators: CollabUser[];
  broadcastElements: (
    prevElements: DriplElement[],
    nextElements: DriplElement[],
  ) => void;
  broadcastCursor: (x: number, y: number) => void;
  lockElement: (elementId: string) => void;
  unlockElement: (elementId: string) => void;
}

interface UseCollaborationOptions {
  onRemoteElements?: (
    added: DriplElement[],
    updated: DriplElement[],
    deleted: string[],
  ) => void;
  onFullSync?: (elements: DriplElement[]) => void;
  displayName?: string | null;
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3003";
const MAX_RETRIES = 8;

export function useCollaboration(
  roomId: string | null,
  options: UseCollaborationOptions = {},
): UseCollaborationReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const elementRafRef = useRef<number | null>(null);
  const pendingElementsRef = useRef<{
    prev: DriplElement[];
    next: DriplElement[];
  } | null>(null);
  const lastCursorSentAtRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const [isConnected, setIsConnected] = useState(false);
  const [collaborators, setCollaborators] = useState<Map<string, CollabUser>>(
    new Map(),
  );
  const permanentlyOfflineRef = useRef(false);

  const userId = useCanvasStore((state) => state.userId) ?? "anonymous";
  const setElementLock = useCanvasStore((state) => state.setElementLock);
  const releaseElementLock = useCanvasStore(
    (state) => state.releaseElementLock,
  );
  const clearElementLocks = useCanvasStore((state) => state.clearElementLocks);
  const setIsStoreConnected = useCanvasStore((state) => state.setIsConnected);
  const setRemoteUsers = useCanvasStore((state) => state.setRemoteUsers);
  const addRemoteUser = useCanvasStore((state) => state.addRemoteUser);
  const removeRemoteUser = useCanvasStore((state) => state.removeRemoteUser);
  const displayNameRef = useRef("Guest");
  const colorRef = useRef("#6965db");
  const onRemoteElementsRef = useRef<
    UseCollaborationOptions["onRemoteElements"]
  >(options.onRemoteElements);
  const onFullSyncRef = useRef<UseCollaborationOptions["onFullSync"]>(
    options.onFullSync,
  );

  useEffect(() => {
    onRemoteElementsRef.current = options.onRemoteElements;
    onFullSyncRef.current = options.onFullSync;
  }, [options.onRemoteElements, options.onFullSync]);

  useEffect(() => {
    if (options.displayName && options.displayName.trim()) {
      displayNameRef.current = options.displayName;
    }
  }, [options.displayName]);

  const sendMessage = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify(message));
  }, []);

  const scheduleElementBroadcast = useCallback(() => {
    if (elementRafRef.current !== null) return;
    elementRafRef.current = window.setTimeout(() => {
      elementRafRef.current = null;
      const payload = pendingElementsRef.current;
      if (!payload || !roomId) return;

      const { prev: prevElements, next: nextElements } = payload;
      const prevMap = new Map(prevElements.map((el) => [el.id, el]));
      const nextMap = new Map(nextElements.map((el) => [el.id, el]));

      for (const [id, el] of nextMap) {
        if (!prevMap.has(id)) {
          sendMessage({ type: "add_element", element: el });
        } else if (prevMap.get(id) !== el) {
          sendMessage({ type: "update_element", element: el });
        }
      }

      for (const id of prevMap.keys()) {
        if (!nextMap.has(id)) {
          sendMessage({ type: "delete_element", elementId: id });
        }
      }

      pendingElementsRef.current = null;
    }, 33);
  }, [roomId, sendMessage]);

  const broadcastElements = useCallback(
    (prevElements: DriplElement[], nextElements: DriplElement[]) => {
      pendingElementsRef.current = { prev: prevElements, next: nextElements };
      scheduleElementBroadcast();
    },
    [scheduleElementBroadcast],
  );

  const broadcastCursor = useCallback(
    (x: number, y: number) => {
      const now = Date.now();
      if (now - lastCursorSentAtRef.current < 50) return;
      lastCursorSentAtRef.current = now;
      sendMessage({
        type: "cursor_move",
        x,
        y,
        userName: displayNameRef.current,
        color: colorRef.current,
      });
    },
    [sendMessage],
  );

  const lockElement = useCallback((_elementId: string) => {
    // Element locking is not supported by ws-server yet.
    // The local canvas-store still tracks locks for UI purposes.
  }, []);

  const unlockElement = useCallback((_elementId: string) => {
    // Element unlocking is not supported by ws-server yet.
  }, []);

  useEffect(() => {
    if (roomId !== null) return;
    shouldReconnectRef.current = false;
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setIsConnected(false);
    setIsStoreConnected(false);
    setRemoteUsers(new Map());
    setCollaborators(new Map());
    clearElementLocks();
  }, [clearElementLocks, roomId, setIsStoreConnected, setRemoteUsers]);

  useEffect(() => {
    if (!roomId) return;
    shouldReconnectRef.current = true;
    displayNameRef.current =
      localStorage.getItem("dripl_username") ?? `Guest-${userId.slice(0, 4)}`;
    const savedColor = localStorage.getItem("dripl_cursor_color");
    if (savedColor) {
      colorRef.current = savedColor;
    }
  }, [roomId, userId]);

  useEffect(() => {
    if (!roomId) return;

    const cleanupConnection = () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };

    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        setIsConnected(true);
        setIsStoreConnected(true);
        if (permanentlyOfflineRef.current) {
          toast.success("Collaboration reconnected");
          permanentlyOfflineRef.current = false;
        }

        sendMessage({
          type: "join_room",
          roomId,
          userName: displayNameRef.current,
        });
      };

      ws.onmessage = (event) => {
        let message: ServerMessage | null = null;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }
        if (!message || typeof message !== "object" || !("type" in message)) {
          return;
        }
        switch (message.type) {
          case "sync_room_state": {
            onFullSyncRef.current?.(message.elements);
            const next = new Map<string, CollabUser>();
            const remoteUsersMap = new Map<
              string,
              { userId: string; userName: string; color: string }
            >();
            message.users
              .filter((user) => user.userId !== userId)
              .forEach((user) => {
                next.set(user.userId, {
                  userId: user.userId,
                  displayName: user.userName,
                  color: user.color,
                  x: 0,
                  y: 0,
                  updatedAt: Date.now(),
                });
                remoteUsersMap.set(user.userId, {
                  userId: user.userId,
                  userName: user.userName,
                  color: user.color,
                });
              });
            setCollaborators(next);
            setRemoteUsers(remoteUsersMap);
            break;
          }
          case "add_element":
            onRemoteElementsRef.current?.([message.element], [], []);
            break;
          case "update_element":
            onRemoteElementsRef.current?.([], [message.element], []);
            break;
          case "delete_element":
            onRemoteElementsRef.current?.([], [], [message.elementId]);
            break;
          case "cursor_move":
            if (message.userId === userId) return;
            setCollaborators((prev) => {
              const next = new Map(prev);
              const existing = next.get(message.userId);
              next.set(message.userId, {
                userId: message.userId,
                displayName: message.userName ?? "Collaborator",
                color: message.color,
                x: message.x,
                y: message.y,
                updatedAt: Date.now(),
              });
              return next;
            });
            break;
          case "user_join":
            if (message.userId === userId) return;
            addRemoteUser({
              userId: message.userId,
              userName: message.userName,
              color: message.color,
            });
            setCollaborators((prev) => {
              const next = new Map(prev);
              next.set(message.userId, {
                userId: message.userId,
                displayName: message.userName,
                color: message.color,
                x: 0,
                y: 0,
                updatedAt: Date.now(),
              });
              return next;
            });
            break;
          case "user_leave":
            removeRemoteUser(message.userId);
            setCollaborators((prev) => {
              const next = new Map(prev);
              next.delete(message.userId);
              return next;
            });
            break;
          case "error":
            console.error("WebSocket error:", message.message);
            break;
          default:
            break;
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        setIsStoreConnected(false);
        clearElementLocks();
        setRemoteUsers(new Map());
        setCollaborators(new Map());
        if (!shouldReconnectRef.current) {
          return;
        }
        if (reconnectAttemptRef.current >= MAX_RETRIES) {
          if (!permanentlyOfflineRef.current) {
            toast.error("Collaboration unavailable — working offline");
            permanentlyOfflineRef.current = true;
          }
          return;
        }
        const delay = Math.min(30_000, 1000 * 2 ** reconnectAttemptRef.current);
        reconnectAttemptRef.current += 1;
        toast.message("Collaboration disconnected, reconnecting…");
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // Allow onclose to handle reconnect/backoff path consistently.
      };
    };

    connect();

    return () => {
      shouldReconnectRef.current = false;

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        sendMessage({ type: "leave_room" });
      }

      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (elementRafRef.current) {
        window.clearTimeout(elementRafRef.current);
        elementRafRef.current = null;
      }
      setIsStoreConnected(false);
      setRemoteUsers(new Map());
      setCollaborators(new Map());
      cleanupConnection();
    };
  }, [
    clearElementLocks,
    addRemoteUser,
    removeRemoteUser,
    releaseElementLock,
    roomId,
    sendMessage,
    setElementLock,
    setIsStoreConnected,
    setRemoteUsers,
    userId,
  ]);

  const collaboratorList = useMemo(
    () => Array.from(collaborators.values()),
    [collaborators],
  );

  return {
    isConnected,
    collaborators: collaboratorList,
    broadcastElements,
    broadcastCursor,
    lockElement,
    unlockElement,
  };
}
