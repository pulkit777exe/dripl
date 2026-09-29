'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DriplElement } from '@dripl/common';
import { useCanvasStore } from '@/lib/store';
import { apiClient } from '@/lib/api';
import { computeSceneDelta, filterReplayPending } from '@/lib/collab/sceneDelta';

// JSON scene deltas are the wire protocol. A previous revision kept a dormant
// Yjs adapter behind YJS_WIRE_ENABLED=false; it gated only reads while write
// paths duplicated state into a Y.Doc, so it was removed outright (2026-09-27)
// rather than left to rot. Reintroducing Yjs is a protocol project, not a
// flag flip — see docs/collaboration-crdt-e2ee-decision.md.

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
  /** Public file-share token; it is exchanged for a short-lived WS ticket. */
  shareToken?: string | null;
}

type ServerMessage =
  | {
      type: 'room-state' | 'sync_room_state';
      elements: DriplElement[];
      users: { userId: string; userName?: string; displayName?: string; color: string }[];
      cursors?: Array<{
        userId: string;
        x: number;
        y: number;
        userName?: string;
        displayName?: string;
        color: string;
      }>;
      yourUserId?: string;
      readOnly?: boolean;
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
  | { type: 'element-lock'; elementId: string; userId: string }
  | { type: 'element-unlock'; elementId: string; userId: string }
  | { type: 'viewport-update'; userId: string; panX: number; panY: number; zoom: number }
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
  | {
      type: 'scene-update';
      subtype: 'init' | 'update';
      elements: DriplElement[];
      clientMsgId?: string;
    }
  | {
      type: 'scene-delta';
      added?: DriplElement[];
      updated?: DriplElement[];
      deleted?: string[];
      clientMsgId?: string;
    }
  | {
      type: 'cursor-move';
      x: number;
      y: number;
      userName: string;
      displayName: string;
      color: string;
    }
  | { type: 'element-lock'; elementId: string }
  | { type: 'element-unlock'; elementId: string }
  | { type: 'viewport-update'; panX: number; panY: number; zoom: number }
  | { type: 'follow-user'; targetUserId: string }
  | { type: 'unfollow-user' }
  | { type: 'ping' };

export interface UseCollaborationReturn {
  isConnected: boolean;
  connectionMessage: string;
  collaborators: CollabUser[];
  broadcastElements: (nextElements: DriplElement[]) => void;
  broadcastCursor: (x: number, y: number) => void;
  lockElement: (_elementId: string) => void;
  unlockElement: (_elementId: string) => void;
  followUser: (_targetUserId: string) => void;
  unfollowUser: () => void;
  broadcastViewport: (_panX: number, _panY: number, _zoom: number) => void;
  disconnect: () => void;
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001';

function safeColor(value: string | null | undefined, fallback: string): string {
  return value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

async function getWsTicket(shareToken?: string | null, signal?: AbortSignal): Promise<string> {
  return shareToken
    ? apiClient.getShareWsTicket(shareToken, signal)
    : apiClient.getWsTicket(signal);
}

export function useCollaboration(
  roomId: string | null,
  options: UseCollaborationOptions = {}
): UseCollaborationReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const pendingElementsRef = useRef<DriplElement[] | null>(null);
  const elementBroadcastTimerRef = useRef<number | null>(null);
  const prevElementsRef = useRef<DriplElement[]>([]);
  const isFirstSyncRef = useRef(true);
  const shouldReconnectRef = useRef(true);
  const reconnectAttemptRef = useRef(0);
  const lastCursorSentAtRef = useRef(0);

  // Offline queue for messages sent while disconnected
  const offlineQueueRef = useRef<Array<{ msg: ClientMessage; timestamp: number }>>([]);
  const OFFLINE_QUEUE_MAX = 100;

  // Follow mode
  const followedUserIdRef = useRef<string | null>(null);
  const viewportBroadcastThrottleRef = useRef(0);

  const [isConnected, setIsConnected] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState('Reconnecting...');
  const [collaboratorsMap, setCollaboratorsMap] = useState<Map<string, CollabUser>>(new Map());

  const fallbackUserIdRef = useRef(crypto.randomUUID());
  const userId = useCanvasStore(state => state.userId) ?? fallbackUserIdRef.current;
  const activeUserIdRef = useRef(userId);
  const setUserId = useCanvasStore(state => state.setUserId);
  const setIsStoreConnected = useCanvasStore(state => state.setIsConnected);
  const setRemoteUsers = useCanvasStore(state => state.setRemoteUsers);
  const addRemoteUser = useCanvasStore(state => state.addRemoteUser);
  const removeRemoteUser = useCanvasStore(state => state.removeRemoteUser);
  const updateRemoteCursor = useCanvasStore(state => state.updateRemoteCursor);
  const clearElementLocks = useCanvasStore(state => state.clearElementLocks);
  const setElementLock = useCanvasStore(state => state.setElementLock);
  const releaseElementLock = useCanvasStore(state => state.releaseElementLock);

  const displayNameRef = useRef((options.displayName?.trim() || 'Guest').slice(0, 50));
  const shareToken = options.shareToken ?? null;
  const colorRef = useRef('#6965db');
  const onRemoteElementsRef = useRef(options.onRemoteElements);
  const onFullSyncRef = useRef(options.onFullSync);

  useEffect(() => {
    onRemoteElementsRef.current = options.onRemoteElements;
    onFullSyncRef.current = options.onFullSync;
  }, [options.onFullSync, options.onRemoteElements]);

  useEffect(() => {
    if (options.displayName?.trim()) {
      displayNameRef.current = options.displayName.trim().slice(0, 50);
    }
  }, [options.displayName]);

  const send = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      if (message.type === 'scene-update' || message.type === 'scene-delta') {
        const queue = offlineQueueRef.current;
        if (queue.length >= OFFLINE_QUEUE_MAX) {
          queue.shift();
        }
        queue.push({ msg: message, timestamp: Date.now() });
      }
      return;
    }
    wsRef.current.send(JSON.stringify(message));
  }, []);

  const flushElementBroadcast = useCallback(() => {
    if (elementBroadcastTimerRef.current !== null) {
      window.clearTimeout(elementBroadcastTimerRef.current);
      elementBroadcastTimerRef.current = null;
    }
    const pending = pendingElementsRef.current;
    if (!pending || !roomId) return;
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    if (isFirstSyncRef.current) {
      // First sync: send full state via JSON (for backward compat)
      send({
        type: 'scene-update',
        subtype: 'init',
        elements: pending,
        clientMsgId: crypto.randomUUID(),
      });
      isFirstSyncRef.current = false;
    } else {
      // Subsequent syncs: compute and send delta via JSON
      const { added, updated, deleted } = computeSceneDelta(prevElementsRef.current, pending);

      if (added.length > 0 || updated.length > 0 || deleted.length > 0) {
        send({
          type: 'scene-delta',
          added: added.length > 0 ? added : undefined,
          updated: updated.length > 0 ? updated : undefined,
          deleted: deleted.length > 0 ? deleted : undefined,
          clientMsgId: crypto.randomUUID(),
        });
      }
    }

    prevElementsRef.current = pending;
    pendingElementsRef.current = null;
  }, [roomId, send]);

  const broadcastElements = useCallback(
    (nextElements: DriplElement[]) => {
      // A room page mounts with whatever scene is already in the global store.
      // Never turn that pre-join snapshot into a delete/update message: the
      // server's initial sync is authoritative, and the local scene may belong
      // to a previously opened canvas.
      if (isFirstSyncRef.current) return;
      pendingElementsRef.current = nextElements;
      // Coalesce pointer-move updates into a bounded stream. JSON remains the
      // authoritative protocol; the old immediate path could send two large
      // messages per frame and exceed the 30-message/s server budget.
      if (elementBroadcastTimerRef.current === null) {
        elementBroadcastTimerRef.current = window.setTimeout(() => {
          elementBroadcastTimerRef.current = null;
          flushElementBroadcast();
        }, 50);
      }
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

  const lockElement = useCallback(
    (elementId: string) => {
      send({ type: 'element-lock', elementId });
    },
    [send]
  );

  const unlockElement = useCallback(
    (elementId: string) => {
      send({ type: 'element-unlock', elementId });
    },
    [send]
  );

  const followUser = useCallback(
    (targetUserId: string) => {
      followedUserIdRef.current = targetUserId;
      send({ type: 'follow-user', targetUserId });
    },
    [send]
  );

  const unfollowUser = useCallback(() => {
    followedUserIdRef.current = null;
    send({ type: 'unfollow-user' });
  }, [send]);

  const broadcastViewport = useCallback(
    (panX: number, panY: number, zoom: number) => {
      const now = Date.now();
      if (now - viewportBroadcastThrottleRef.current < 100) return;
      viewportBroadcastThrottleRef.current = now;
      send({ type: 'viewport-update', panX, panY, zoom });
    },
    [send]
  );

  useEffect(() => {
    // Refs survive a route change because the hook component may be reused.
    // Reset all room-scoped outbound state before the new socket can join;
    // otherwise a previous room's pending snapshot can delete the new room's
    // elements when its first sync arrives.
    isFirstSyncRef.current = true;
    pendingElementsRef.current = null;
    offlineQueueRef.current = [];
    prevElementsRef.current = [];
  }, [roomId, shareToken]);

  useEffect(() => {
    if (!roomId) {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (elementBroadcastTimerRef.current !== null) {
        window.clearTimeout(elementBroadcastTimerRef.current);
        elementBroadcastTimerRef.current = null;
      }
      if (heartbeatTimerRef.current) {
        window.clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
      setIsConnected(false);
      setConnectionMessage('Disconnected');
      setIsStoreConnected(false);
      useCanvasStore.getState().setReadOnly(false);
      setRemoteUsers(new Map());
      setCollaboratorsMap(new Map());
      clearElementLocks();
      return;
    }

    shouldReconnectRef.current = true;
    // A room is read-only until the authoritative sync has arrived. This keeps
    // pre-sync local mutations (including AI output) from being silently
    // replaced by the server snapshot.
    useCanvasStore.getState().setReadOnly(true);
    let disposed = false;
    let ticketAbortController: AbortController | null = null;

    const savedColor = localStorage.getItem('dripl_cursor_color');
    if (savedColor) colorRef.current = safeColor(savedColor, colorRef.current);

    const connect = async () => {
      if (disposed) return;
      ticketAbortController?.abort();
      const controller = new AbortController();
      ticketAbortController = controller;
      let ws: WebSocket;
      try {
        const ticket = await getWsTicket(shareToken, controller.signal);
        if (disposed || controller.signal.aborted || !shouldReconnectRef.current) return;
        ws = new WebSocket(`${WS_URL}?ticket=${encodeURIComponent(ticket)}`);
      } catch {
        if (disposed || controller.signal.aborted || !shouldReconnectRef.current) return;
        setConnectionMessage('Failed to authenticate — refresh to retry');
        return;
      } finally {
        if (ticketAbortController === controller) ticketAbortController = null;
      }
      if (disposed || !shouldReconnectRef.current) {
        ws.close();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed || wsRef.current !== ws) {
          ws.close();
          return;
        }
        reconnectAttemptRef.current = 0;
        setIsConnected(true);
        setConnectionMessage('Connected');
        setIsStoreConnected(true);
        send({
          type: 'join',
          roomId,
          userId: activeUserIdRef.current,
          displayName: displayNameRef.current,
          color: colorRef.current,
        });

        // Scene messages are replayed only after the server has acknowledged
        // the join with `sync_room_state`. Sending them immediately after the
        // join frame races the server's async authorization/load handler and
        // can silently drop offline edits.
        if (heartbeatTimerRef.current) {
          window.clearInterval(heartbeatTimerRef.current);
        }
        heartbeatTimerRef.current = window.setInterval(() => {
          send({ type: 'ping' });
        }, 15_000);
      };

      ws.onmessage = (event: MessageEvent) => {
        if (wsRef.current !== ws) return;
        // The server speaks JSON only. Binary frames have no protocol left
        // (the Yjs wire format was removed), so ignore them outright.
        if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
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

        if (message.type === 'sync_room_state' || message.type === 'room-state') {
          const previousLocalElements = prevElementsRef.current;
          const synchronizedUserId =
            typeof message.yourUserId === 'string' && message.yourUserId.length > 0
              ? message.yourUserId
              : activeUserIdRef.current;
          activeUserIdRef.current = synchronizedUserId;
          setUserId(synchronizedUserId);
          onFullSyncRef.current?.(message.elements);
          prevElementsRef.current = message.elements;
          isFirstSyncRef.current = false;
          setIsStoreConnected(true);
          if (typeof message.readOnly === 'boolean') {
            useCanvasStore.getState().setReadOnly(message.readOnly);
          }

          const initialUsers = message.users.filter(user => user.userId !== synchronizedUserId);
          setRemoteUsers(
            new Map(
              initialUsers.map(user => [
                user.userId,
                {
                  userId: user.userId,
                  userName: user.displayName ?? user.userName ?? 'Guest',
                  color: user.color,
                },
              ])
            )
          );
          setCollaboratorsMap(
            new Map(
              initialUsers.map(user => [
                user.userId,
                {
                  userId: user.userId,
                  displayName: user.displayName ?? user.userName ?? 'Guest',
                  color: user.color,
                  x: 0,
                  y: 0,
                  updatedAt: Date.now(),
                },
              ])
            )
          );
          for (const cursor of message.cursors ?? []) {
            if (cursor.userId === synchronizedUserId) continue;
            updateRemoteCursor(cursor.userId, {
              x: cursor.x,
              y: cursor.y,
              userName: cursor.displayName ?? cursor.userName ?? 'Guest',
              color: cursor.color,
            });
          }

          // The server has now completed join authorization and loaded the
          // room. Replay queued scene messages in order, then send the latest
          // coalesced snapshot if one is waiting. If an element that existed
          // in our last local snapshot is absent from the authoritative sync,
          // treat queued updates to that ID as stale rather than resurrecting
          // a server-side deletion. This is a conservative reconnect guard;
          // the server still needs durable tombstones for a complete CRDT-
          // style convergence guarantee.
          const serverIds = new Set(message.elements.map(element => element.id));
          const previousIds = new Set(previousLocalElements.map(element => element.id));
          const queuedMessages = offlineQueueRef.current.splice(0);
          for (const { msg } of queuedMessages) {
            let messageToSend = msg;
            if (msg.type === 'scene-delta') {
              const added = msg.added?.filter(element => !previousIds.has(element.id));
              const updated = msg.updated?.filter(
                element => !previousIds.has(element.id) || serverIds.has(element.id)
              );
              if (
                msg.added &&
                !added?.length &&
                msg.updated &&
                !updated?.length &&
                !msg.deleted?.length
              ) {
                continue;
              }
              messageToSend = { ...msg, added, updated };
            } else if (msg.type === 'scene-update') {
              const elements = filterReplayPending(msg.elements, previousIds, serverIds);
              if (elements.length === 0) continue;
              messageToSend = { ...msg, elements };
            }
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(messageToSend));
          }
          if (pendingElementsRef.current) {
            const filteredPending = filterReplayPending(
              pendingElementsRef.current,
              previousIds,
              serverIds
            );
            pendingElementsRef.current = filteredPending.length > 0 ? filteredPending : null;
            if (pendingElementsRef.current) flushElementBroadcast();
          }
          return;
        }

        if (message.type === 'scene-update') {
          if (message.subtype === 'init') {
            // Legacy init packets are treated as a merge, matching the active
            // server's versioned reconciliation semantics. The authoritative
            // replacement path is sync_room_state above; treating init as a
            // blind local replacement can make the client and server diverge
            // when a stale packet omits newer elements.
            onRemoteElementsRef.current?.(message.elements, [], []);
            prevElementsRef.current = useCanvasStore.getState().elements;
          } else {
            // Legacy `update` packets may contain only the accepted subset.
            // Treat them as a delta and keep the full local baseline used to
            // compute the next outgoing delta.
            onRemoteElementsRef.current?.(message.elements, [], []);
            prevElementsRef.current = useCanvasStore.getState().elements;
          }
          return;
        }

        if (message.type === 'scene-delta') {
          const added = message.added || [];
          const updated = message.updated || [];
          const deleted = message.deleted || [];
          if (added.length > 0 || updated.length > 0 || deleted.length > 0) {
            onRemoteElementsRef.current?.(added, updated, deleted);
            prevElementsRef.current = useCanvasStore.getState().elements;
          }
          return;
        }

        if (message.type === 'cursor_move' || message.type === 'cursor-move') {
          if (message.userId === activeUserIdRef.current) return;
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
          if (message.userId === activeUserIdRef.current) return;
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

        if (message.type === 'element-lock') {
          setElementLock(message.elementId, message.userId);
          return;
        }

        if (message.type === 'element-unlock') {
          releaseElementLock(message.elementId);
          return;
        }

        if (message.type === 'viewport-update') {
          // Apply viewport from followed user
          if (followedUserIdRef.current === message.userId) {
            const store = useCanvasStore.getState();
            store.setPan(message.panX, message.panY);
            store.setZoom(message.zoom);
          }
          return;
        }
      };

      ws.onclose = event => {
        if (wsRef.current !== ws) return;
        if (event.code === 4003) {
          shouldReconnectRef.current = false;
          offlineQueueRef.current = [];
          pendingElementsRef.current = null;
          setConnectionMessage('Access denied');
          setIsStoreConnected(false);
          if (heartbeatTimerRef.current) {
            window.clearInterval(heartbeatTimerRef.current);
            heartbeatTimerRef.current = null;
          }
          return;
        }
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
        const base = Math.min(30_000, 1000 * 2 ** reconnectAttemptRef.current);
        const delay = base * (0.5 + Math.random() * 0.5);
        reconnectAttemptRef.current += 1;
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };
    };

    const cursorCleanupTimer = window.setInterval(() => {
      const state = useCanvasStore.getState();
      const now = Date.now();
      state.remoteCursors.forEach((cursor, uid) => {
        if (now - cursor.updatedAt > 5000) {
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
      disposed = true;
      shouldReconnectRef.current = false;
      ticketAbortController?.abort();
      ticketAbortController = null;
      window.removeEventListener('online', handleOnline);
      window.clearInterval(cursorCleanupTimer);
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (elementBroadcastTimerRef.current !== null) {
        window.clearTimeout(elementBroadcastTimerRef.current);
        elementBroadcastTimerRef.current = null;
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
    };
  }, [
    WS_URL,
    addRemoteUser,
    clearElementLocks,
    flushElementBroadcast,
    removeRemoteUser,
    roomId,
    shareToken,
    send,
    setIsStoreConnected,
    setRemoteUsers,
    setUserId,
    updateRemoteCursor,
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
    followUser,
    unfollowUser,
    broadcastViewport,
    disconnect,
  };
}
