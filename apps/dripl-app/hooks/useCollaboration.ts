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
  | { type: "room-state"; elements: DriplElement[]; users: BasicUser[] }
  | { type: "element-update"; elements: DriplElement[]; from: string }
  | { type: "cursor-move"; userId: string; x: number; y: number; color: string }
  | { type: "user-join"; user: BasicUser }
  | { type: "user-leave"; userId: string }
  | { type: "element-lock"; elementId: string; by: string }
  | { type: "element-unlock"; elementId: string }
  | { type: "pong" };

type ClientMessage =
  | { type: "join"; roomId: string; userId: string; displayName: string; color: string }
  | { type: "element-update"; roomId: string; elements: DriplElement[] }
  | { type: "cursor-move"; roomId: string; userId: string; x: number; y: number }
  | { type: "element-lock"; roomId: string; elementId: string; userId: string }
  | { type: "element-unlock"; roomId: string; elementId: string }
  | { type: "ping" };

export interface UseCollaborationReturn {
  isConnected: boolean;
  collaborators: CollabUser[];
  broadcastElements: (elements: DriplElement[]) => void;
  broadcastCursor: (x: number, y: number) => void;
  lockElement: (elementId: string) => void;
  unlockElement: (elementId: string) => void;
}

interface UseCollaborationOptions {
  onRemoteUpdate?: (elements: DriplElement[]) => void;
  displayName?: string | null;
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001";
const MAX_RETRIES = 8;

export function useCollaboration(
  roomId: string | null,
  options: UseCollaborationOptions = {},
): UseCollaborationReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const pingTimerRef = useRef<number | null>(null);
  const elementRafRef = useRef<number | null>(null);
  const pendingElementsRef = useRef<DriplElement[] | null>(null);
  const lastCursorSentAtRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const [isConnected, setIsConnected] = useState(false);
  const [collaborators, setCollaborators] = useState<Map<string, CollabUser>>(new Map());
  const permanentlyOfflineRef = useRef(false);
  const heldLocksRef = useRef<Set<string>>(new Set());

  const userId = useCanvasStore((state) => state.userId) ?? "anonymous";
  const setElementLock = useCanvasStore((state) => state.setElementLock);
  const releaseElementLock = useCanvasStore((state) => state.releaseElementLock);
  const clearElementLocks = useCanvasStore((state) => state.clearElementLocks);
  const setIsStoreConnected = useCanvasStore((state) => state.setIsConnected);
  const setRemoteUsers = useCanvasStore((state) => state.setRemoteUsers);
  const addRemoteUser = useCanvasStore((state) => state.addRemoteUser);
  const removeRemoteUser = useCanvasStore((state) => state.removeRemoteUser);
  const displayNameRef = useRef("Guest");
  const colorRef = useRef("#6965db");
  const onRemoteUpdateRef = useRef<UseCollaborationOptions["onRemoteUpdate"]>(
    options.onRemoteUpdate,
  );

  useEffect(() => {
    onRemoteUpdateRef.current = options.onRemoteUpdate;
  }, [options.onRemoteUpdate]);

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
      sendMessage({ type: "element-update", roomId, elements: payload });
      pendingElementsRef.current = null;
    }, 33);
  }, [roomId, sendMessage]);

  const broadcastElements = useCallback(
    (elements: DriplElement[]) => {
      pendingElementsRef.current = elements;
      scheduleElementBroadcast();
    },
    [scheduleElementBroadcast],
  );

  const broadcastCursor = useCallback(
    (x: number, y: number) => {
      const now = Date.now();
      if (now - lastCursorSentAtRef.current < 50) return;
      lastCursorSentAtRef.current = now;
      if (!roomId) return;
      sendMessage({
        type: "cursor-move",
        roomId,
        userId,
        x,
        y,
      });
    },
    [roomId, sendMessage, userId],
  );

  const lockElement = useCallback(
    (elementId: string) => {
      if (!roomId) return;
      heldLocksRef.current.add(elementId);
      sendMessage({
        type: "element-lock",
        roomId,
        elementId,
        userId,
      });
    },
    [roomId, sendMessage, userId],
  );

  const unlockElement = useCallback(
    (elementId: string) => {
      if (!roomId) return;
      heldLocksRef.current.delete(elementId);
      sendMessage({
        type: "element-unlock",
        roomId,
        elementId,
      });
    },
    [roomId, sendMessage],
  );

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
      if (pingTimerRef.current) {
        window.clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
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
          type: "join",
          roomId,
          userId,
          displayName: displayNameRef.current,
          color: colorRef.current,
        });

        pingTimerRef.current = window.setInterval(() => {
          sendMessage({ type: "ping" });
        }, 10_000);
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
          case "room-state": {
            onRemoteUpdateRef.current?.(message.elements);
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
                  displayName: user.displayName,
                  color: user.color,
                  x: 0,
                  y: 0,
                  updatedAt: Date.now(),
                });
                remoteUsersMap.set(user.userId, {
                  userId: user.userId,
                  userName: user.displayName,
                  color: user.color,
                });
              });
            setCollaborators(next);
            setRemoteUsers(remoteUsersMap);
            break;
          }
          case "element-update":
            if (message.from !== userId) {
              onRemoteUpdateRef.current?.(message.elements);
            }
            break;
          case "cursor-move":
            if (message.userId === userId) return;
            setCollaborators((prev) => {
              const next = new Map(prev);
              const existing = next.get(message.userId);
              next.set(message.userId, {
                userId: message.userId,
                displayName: existing?.displayName ?? "Collaborator",
                color: message.color,
                x: message.x,
                y: message.y,
                updatedAt: Date.now(),
              });
              return next;
            });
            break;
          case "user-join":
            if (message.user.userId === userId) return;
            addRemoteUser({
              userId: message.user.userId,
              userName: message.user.displayName,
              color: message.user.color,
            });
            setCollaborators((prev) => {
              const next = new Map(prev);
              next.set(message.user.userId, {
                userId: message.user.userId,
                displayName: message.user.displayName,
                color: message.user.color,
                x: 0,
                y: 0,
                updatedAt: Date.now(),
              });
              return next;
            });
            break;
          case "user-leave":
            removeRemoteUser(message.userId);
            setCollaborators((prev) => {
              const next = new Map(prev);
              next.delete(message.userId);
              return next;
            });
            break;
          case "element-lock":
            setElementLock(message.elementId, message.by);
            break;
          case "element-unlock":
            releaseElementLock(message.elementId);
            break;
          case "pong":
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
        if (pingTimerRef.current) {
          window.clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }
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
      heldLocksRef.current.forEach((elementId) => {
        if (roomId) {
          sendMessage({
            type: "element-unlock",
            roomId,
            elementId,
          });
        }
      });
      heldLocksRef.current.clear();

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
