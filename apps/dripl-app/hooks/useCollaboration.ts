'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DriplElement } from '@dripl/common';
import { useCanvasStore } from '@/lib/canvas-store';
import * as Y from 'yjs';

const YJS_MSG_UPDATE = 1;
const YJS_MSG_SYNC = 2;

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
  | {
      type: 'scene-delta';
      added?: DriplElement[];
      updated?: DriplElement[];
      deleted?: string[];
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
      type: 'scene-delta';
      added?: DriplElement[];
      updated?: DriplElement[];
      deleted?: string[];
    }
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
  disconnect: () => void;
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001';

export function useCollaboration(
  roomId: string | null,
  options: UseCollaborationOptions = {}
): UseCollaborationReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const pendingElementsRef = useRef<DriplElement[] | null>(null);
  const prevElementsRef = useRef<DriplElement[]>([]);
  const isFirstSyncRef = useRef(true);
  const shouldReconnectRef = useRef(true);
  const reconnectAttemptRef = useRef(0);
  const lastCursorSentAtRef = useRef(0);

  // Yjs refs
  const yDocRef = useRef<Y.Doc | null>(null);
  const yElementsRef = useRef<Y.Map<DriplElement> | null>(null);
  const ySyncedRef = useRef(false);

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

  // Initialize Y.Doc
  useEffect(() => {
    const doc = new Y.Doc();
    const elements = doc.getMap<DriplElement>('elements');
    yDocRef.current = doc;
    yElementsRef.current = elements;

    return () => {
      doc.destroy();
      yDocRef.current = null;
      yElementsRef.current = null;
    };
  }, []);

  // Observe Y.Doc element changes → sync to Zustand store
  useEffect(() => {
    const elements = yElementsRef.current;
    if (!elements) return;

    const observer = (event: Y.YMapEvent<DriplElement>) => {
      if (!ySyncedRef.current) return;

      const storeElements = useCanvasStore.getState().elements;
      const storeMap = new Map(storeElements.map(el => [el.id, el]));
      let changed = false;

      event.changes.keys.forEach((change, key) => {
        if (change.action === 'add' || change.action === 'update') {
          const yEl = elements.get(key);
          if (yEl) {
            storeMap.set(key, yEl);
            changed = true;
          }
        } else if (change.action === 'delete') {
          if (storeMap.has(key)) {
            storeMap.delete(key);
            changed = true;
          }
        }
      });

      if (changed) {
        useCanvasStore.getState().setElements(Array.from(storeMap.values()));
      }
    };

    elements.observe(observer);
    return () => {
      elements.unobserve(observer);
    };
  }, []);

  const send = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify(message));
  }, []);

  const sendBinary = useCallback((data: Uint8Array) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(data);
  }, []);

  const flushElementBroadcast = useCallback(() => {
    const pending = pendingElementsRef.current;
    if (!pending || !roomId) return;
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    // Update local Y.Doc with the pending elements
    const yElements = yElementsRef.current;
    const yDoc = yDocRef.current;
    if (yElements && yDoc) {
      yDoc.transact(() => {
        const yIds = new Set(yElements.keys());
        const pendingIds = new Set(pending.map(el => el.id));

        // Add/update elements in Yjs
        for (const el of pending) {
          yElements.set(el.id, el);
        }

        // Delete elements no longer in the local state
        for (const id of yIds) {
          if (!pendingIds.has(id)) {
            yElements.delete(id);
          }
        }
      });

      // Send Yjs binary update to server
      const update = Y.encodeStateAsUpdate(yDoc);
      const packet = new Uint8Array(1 + update.length);
      packet[0] = YJS_MSG_UPDATE;
      packet.set(update, 1);
      sendBinary(packet);
    }

    if (isFirstSyncRef.current) {
      // First sync: send full state via JSON (for backward compat)
      send({ type: 'scene-update', subtype: 'init', elements: pending });
      isFirstSyncRef.current = false;
    } else {
      // Subsequent syncs: compute and send delta via JSON
      const prev = prevElementsRef.current;
      const prevMap = new Map(prev.map(el => [el.id, el]));
      const nextMap = new Map(pending.map(el => [el.id, el]));

      const added: DriplElement[] = [];
      const updated: DriplElement[] = [];
      const deleted: string[] = [];

      for (const el of pending) {
        const prevEl = prevMap.get(el.id);
        if (!prevEl) {
          added.push(el);
        } else if (prevEl !== el) {
          updated.push(el);
        }
      }

      for (const el of prev) {
        if (!nextMap.has(el.id)) {
          deleted.push(el.id);
        }
      }

      if (added.length > 0 || updated.length > 0 || deleted.length > 0) {
        send({
          type: 'scene-delta',
          added: added.length > 0 ? added : undefined,
          updated: updated.length > 0 ? updated : undefined,
          deleted: deleted.length > 0 ? deleted : undefined,
        });
      }
    }

    prevElementsRef.current = pending;
    pendingElementsRef.current = null;
  }, [roomId, send, sendBinary]);

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
      ySyncedRef.current = false;
      return;
    }

    shouldReconnectRef.current = true;
    ySyncedRef.current = false;

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

      ws.onmessage = (event: MessageEvent) => {
        // Handle binary Yjs messages
        if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
          const handleBinary = (data: ArrayBuffer) => {
            const bytes = new Uint8Array(data);
            if (bytes.length === 0) return;

            const msgType = bytes[0];

            if (msgType === YJS_MSG_UPDATE) {
              const update = bytes.slice(1);
              const yDoc = yDocRef.current;
              if (yDoc) {
                Y.applyUpdate(yDoc, update);
                ySyncedRef.current = true;
              }
              return;
            }

            if (msgType === YJS_MSG_SYNC) {
              // Format: [type][stateVector...][yjsState...]
              // Server sends full state on join; we apply it and don't reply
              // (server already has our state since we just joined)
              const payload = bytes.slice(1);
              const yDoc = yDocRef.current;
              if (yDoc && payload.length > 0) {
                Y.applyUpdate(yDoc, payload);
                ySyncedRef.current = true;
              }
              return;
            }
          };

          if (event.data instanceof ArrayBuffer) {
            handleBinary(event.data);
          } else if (event.data instanceof Blob) {
            event.data.arrayBuffer().then(handleBinary);
          }
          return;
        }

        // Handle JSON messages
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
            prevElementsRef.current = message.elements;

            // Also populate local Y.Doc from full sync
            const yElements = yElementsRef.current;
            const yDoc = yDocRef.current;
            if (yElements && yDoc) {
              yDoc.transact(() => {
                yElements.clear();
                for (const el of message.elements) {
                  yElements.set(el.id, el);
                }
              });
              ySyncedRef.current = true;
            }
          } else {
            onRemoteElementsRef.current?.(message.elements, [], []);
            prevElementsRef.current = message.elements;
          }
          return;
        }

        if (message.type === 'scene-delta') {
          const added = message.added || [];
          const updated = message.updated || [];
          const deleted = message.deleted || [];
          if (added.length > 0 || updated.length > 0 || deleted.length > 0) {
            onRemoteElementsRef.current?.(added, updated, deleted);
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
        ySyncedRef.current = false;

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

    const cursorCleanupTimer = window.setInterval(() => {
      const state = useCanvasStore.getState();
      const now = Date.now();
      state.remoteCursors.forEach((cursor, uid) => {
        if (now - (cursor as any).updatedAt > 5000) {
          state.removeRemoteCursor(uid);
          setCollaboratorsMap(prev => {
            const next = new Map(prev);
            next.delete(uid);
            return next;
          });
        }
      });
    }, 5000);

    connect();

    // Reconnect immediately when browser comes back online
    const handleOnline = () => {
      if (!shouldReconnectRef.current) return;
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      // Reset attempts and reconnect immediately
      reconnectAttemptRef.current = 0;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      connect();
    };
    window.addEventListener('online', handleOnline);

    return () => {
      shouldReconnectRef.current = false;
      window.removeEventListener('online', handleOnline);
      window.clearInterval(cursorCleanupTimer);
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (heartbeatTimerRef.current) {
        window.clearInterval(heartbeatTimerRef.current);
      }
      send({ type: 'leave' });
      wsRef.current?.close();
      setIsStoreConnected(false);
      setConnectionMessage('Disconnected');
      setRemoteUsers(new Map());
      setCollaboratorsMap(new Map());
      ySyncedRef.current = false;
    };
  }, [
    WS_URL,
    addRemoteUser,
    clearElementLocks,
    removeRemoteUser,
    roomId,
    send,
    sendBinary,
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
