'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DriplElement } from '@dripl/common';
import { useCanvasStore } from '@/lib/canvas-store';

export interface CollabUser {
  userId: string;
  displayName: string;
  color: string;
  x: number;
  y: number;
  updatedAt: number;
}

interface UseCollaborationOptions {
  onRemoteElements?: (added: DriplElement[], updated: DriplElement[], deleted: string[]) => void;
  onFullSync?: (elements: DriplElement[]) => void;
  displayName?: string | null;
}

type ServerMessage =
  | {
      type: 'room-state' | 'sync_room_state';
      elements: DriplElement[];
      users: { userId: string; userName?: string; displayName?: string; color: string }[];
      yourUserId?: string;
    }
  | {
      type: 'scene-update';
      subtype: 'init' | 'update';
      elements: DriplElement[];
    }
  | { type: 'add_element'; element: DriplElement }
  | { type: 'update_element'; element: DriplElement }
  | { type: 'delete_element'; elementId: string }
  | {
      type: 'cursor-move' | 'cursor_move';
      userId: string;
      x: number;
      y: number;
      userName?: string;
      displayName?: string;
      color: string;
    }
  | {
      type: 'user_join' | 'user-join';
      userId: string;
      userName?: string;
      displayName?: string;
      color: string;
    }
  | { type: 'user_leave' | 'user-leave'; userId: string }
  | { type: 'pong' }
  | { type: 'error'; message: string };

type ClientMessage =
  | {
      type: 'join';
      roomId: string;
      userId: string;
      displayName: string;
      color: string;
    }
  | { type: 'leave' }
  | { type: 'scene-update'; subtype: 'init' | 'update'; elements: DriplElement[] }
  | {
      type: 'cursor-move';
      x: number;
      y: number;
      userName: string;
      displayName: string;
      color: string;
    }
  | { type: 'ping' };

export interface UseCollaborationReturn {
  isConnected: boolean;
  connectionMessage: string;
  collaborators: CollabUser[];
  broadcastElements: (_prevElements: DriplElement[], nextElements: DriplElement[]) => void;
  broadcastCursor: (x: number, y: number) => void;
  lockElement: (_elementId: string) => void;
  unlockElement: (_elementId: string) => void;
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001';

export function useCollaboration(
  roomId: string | null,
  options: UseCollaborationOptions = {}
): UseCollaborationReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const broadcastTimerRef = useRef<number | null>(null);
  const pendingElementsRef = useRef<DriplElement[] | null>(null);
  const isFirstSyncRef = useRef(true);
  const shouldReconnectRef = useRef(true);
  const reconnectAttemptRef = useRef(0);
  const lastCursorSentAtRef = useRef(0);

  const [isConnected, setIsConnected] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState('Reconnecting...');
  const [collaboratorsMap, setCollaboratorsMap] = useState<Map<string, CollabUser>>(new Map());

  const fallbackUserIdRef = useRef(crypto.randomUUID());
  const userId = useCanvasStore(state => state.userId) ?? fallbackUserIdRef.current;
  const setIsStoreConnected = useCanvasStore(state => state.setIsConnected);
  const setRemoteUsers = useCanvasStore(state => state.setRemoteUsers);
  const addRemoteUser = useCanvasStore(state => state.addRemoteUser);
  const removeRemoteUser = useCanvasStore(state => state.removeRemoteUser);
  const updateRemoteCursor = useCanvasStore(state => state.updateRemoteCursor);
  const clearElementLocks = useCanvasStore(state => state.clearElementLocks);

  const displayNameRef = useRef(options.displayName?.trim() || 'Guest');
  const colorRef = useRef('#6965db');
  const onRemoteElementsRef = useRef(options.onRemoteElements);
  const onFullSyncRef = useRef(options.onFullSync);

  useEffect(() => {
    onRemoteElementsRef.current = options.onRemoteElements;
    onFullSyncRef.current = options.onFullSync;
  }, [options.onFullSync, options.onRemoteElements]);

  useEffect(() => {
    if (options.displayName?.trim()) {
      displayNameRef.current = options.displayName.trim();
    }
  }, [options.displayName]);

  const send = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify(message));
  }, []);

  const flushElementBroadcast = useCallback(() => {
    const pending = pendingElementsRef.current;
    if (!pending || !roomId) return;
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    const subtype = isFirstSyncRef.current ? 'init' : 'update';
    if (isFirstSyncRef.current) isFirstSyncRef.current = false;

    send({ type: 'scene-update', subtype, elements: pending });
    pendingElementsRef.current = null;
  }, [roomId, send]);

  const broadcastElements = useCallback(
    (_prevElements: DriplElement[], nextElements: DriplElement[]) => {
      pendingElementsRef.current = nextElements;
      flushElementBroadcast();
    },
    [flushElementBroadcast]
  );

  const broadcastCursor = useCallback(
    (x: number, y: number) => {
      const now = Date.now();
      if (now - lastCursorSentAtRef.current < 50) return;
      lastCursorSentAtRef.current = now;
      send({
        type: 'cursor-move',
        x,
        y,
        userName: displayNameRef.current,
        displayName: displayNameRef.current,
        color: colorRef.current,
      });
    },
    [send]
  );

  const lockElement = useCallback((_elementId: string) => {}, []);
  const unlockElement = useCallback((_elementId: string) => {}, []);

  useEffect(() => {
    if (!roomId) {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (heartbeatTimerRef.current) {
        window.clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
      setIsConnected(false);
      setConnectionMessage('Disconnected');
      setIsStoreConnected(false);
      setRemoteUsers(new Map());
      setCollaboratorsMap(new Map());
      clearElementLocks();
      return;
    }

    shouldReconnectRef.current = true;

    const savedColor = localStorage.getItem('dripl_cursor_color');
    if (savedColor) colorRef.current = savedColor;

    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        setIsConnected(true);
        setConnectionMessage('Connected');
        setIsStoreConnected(true);
        send({
          type: 'join',
          roomId,
          userId,
          displayName: displayNameRef.current,
          color: colorRef.current,
        });

        if (heartbeatTimerRef.current) {
          window.clearInterval(heartbeatTimerRef.current);
        }
        heartbeatTimerRef.current = window.setInterval(() => {
          send({ type: 'ping' });
        }, 15_000);
      };

ws.onmessage = event => {
        let message: ServerMessage | null = null;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }
        if (!message) return;

        if (message.type === 'scene-update') {
          if (message.subtype === 'init') {
            onFullSyncRef.current?.(message.elements);
          } else {
            onRemoteElementsRef.current?.(message.elements, [], []);
          }
          return;
        }

        if (message.type === 'cursor_move' || message.type === 'cursor-move') {
          if (message.userId === userId) return;
          const displayName = message.displayName ?? message.userName ?? 'Guest';
          updateRemoteCursor(message.userId, {
            x: message.x,
            y: message.y,
            userName: displayName,
            color: message.color,
          });
          setCollaboratorsMap(prev => {
            const next = new Map(prev);
            next.set(message.userId, {
              userId: message.userId,
              displayName,
              color: message.color,
              x: message.x,
              y: message.y,
              updatedAt: Date.now(),
            });
            return next;
          });
          return;
        }

        if (message.type === 'user_join' || message.type === 'user-join') {
          if (message.userId === userId) return;
          const displayName = message.displayName ?? message.userName ?? 'Guest';
          addRemoteUser({
            userId: message.userId,
            userName: displayName,
            color: message.color,
          });
          setCollaboratorsMap(prev => {
            const next = new Map(prev);
            next.set(message.userId, {
              userId: message.userId,
              displayName,
              color: message.color,
              x: 0,
              y: 0,
              updatedAt: Date.now(),
            });
            return next;
          });
          return;
        }

        if (message.type === 'user_leave' || message.type === 'user-leave') {
          removeRemoteUser(message.userId);
          setCollaboratorsMap(prev => {
            const next = new Map(prev);
            next.delete(message.userId);
            return next;
          });
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        setIsStoreConnected(false);
        setRemoteUsers(new Map());
        setCollaboratorsMap(new Map());
        clearElementLocks();

        if (heartbeatTimerRef.current) {
          window.clearInterval(heartbeatTimerRef.current);
          heartbeatTimerRef.current = null;
        }

        if (!shouldReconnectRef.current) return;
        if (reconnectAttemptRef.current >= 5) {
          setConnectionMessage('Connection lost — refresh to retry');
          return;
        }
        setConnectionMessage('Reconnecting...');
        const delay = Math.min(30_000, 1000 * 2 ** reconnectAttemptRef.current);
        reconnectAttemptRef.current += 1;
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (heartbeatTimerRef.current) {
        window.clearInterval(heartbeatTimerRef.current);
      }
      if (broadcastTimerRef.current) {
        window.clearTimeout(broadcastTimerRef.current);
      }
      send({ type: 'leave' });
      wsRef.current?.close();
      setIsStoreConnected(false);
      setConnectionMessage('Disconnected');
      setRemoteUsers(new Map());
      setCollaboratorsMap(new Map());
    };
  }, [
    WS_URL,
    addRemoteUser,
    clearElementLocks,
    removeRemoteUser,
    roomId,
    send,
    setIsStoreConnected,
    setRemoteUsers,
    updateRemoteCursor,
    userId,
  ]);

  const collaborators = useMemo(() => Array.from(collaboratorsMap.values()), [collaboratorsMap]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
    }
    if (heartbeatTimerRef.current) {
      window.clearInterval(heartbeatTimerRef.current);
    }
    if (broadcastTimerRef.current) {
      window.clearTimeout(broadcastTimerRef.current);
    }
    if (wsRef.current) {
      send({ type: 'leave' });
      wsRef.current.close();
    }
    setIsStoreConnected(false);
    setConnectionMessage('Disconnected');
    setRemoteUsers(new Map());
    setCollaboratorsMap(new Map());
  }, []);

  return {
    isConnected,
    connectionMessage,
    collaborators,
    broadcastElements,
    broadcastCursor,
    lockElement,
    unlockElement,
    disconnect,
  };
}
