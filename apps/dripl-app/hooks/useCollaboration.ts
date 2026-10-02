'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DriplElement } from '@dripl/common';
import { useCanvasStore } from '@/lib/store';
import { computeSceneDelta } from '@/lib/collab/sceneDelta';
import { enqueueOfflineMessage, OFFLINE_QUEUE_MAX } from '@/lib/collab/offlineQueue';
import { routeCollabMessage } from '@/lib/collab/messageRouter';
import {
  handleSocketClose,
  handleSocketOpen,
  type SocketLifecycleContext,
} from '@/lib/collab/socket-lifecycle';
import type {
  ClientMessage,
  CollabUser,
  ServerMessage,
  UseCollaborationOptions,
  UseCollaborationReturn,
} from '@/lib/collab/protocol';
import { getWsTicket, safeColor } from '@/lib/collab/connection';

// JSON scene deltas are the wire protocol. A previous revision kept a dormant
// Yjs adapter behind YJS_WIRE_ENABLED=false; it gated only reads while write
// paths duplicated state into a Y.Doc, so it was removed outright (2026-09-27)
// rather than left to rot. Reintroducing Yjs is a protocol project, not a
// flag flip — see docs/collaboration-crdt-e2ee-decision.md.

// Wire-protocol types live in lib/collab/protocol.ts. `CollabUser` and the
// option/return interfaces are re-exported here so existing import sites
// (`@/hooks/useCollaboration`) keep working.
export type {
  CollabUser,
  UseCollaborationOptions,
  UseCollaborationReturn,
} from '@/lib/collab/protocol';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001';

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

  // Offline queue for messages sent while disconnected (bounded; see lib/collab/offlineQueue)
  const offlineQueueRef = useRef<Array<{ msg: ClientMessage; timestamp: number }>>([]);

  // Follow mode
  const followedUserIdRef = useRef<string | null>(null);
  const viewportBroadcastThrottleRef = useRef(0);

  const [connectionMessage, setConnectionMessage] = useState('Reconnecting...');

  // Single source of truth: connection and presence live in the Zustand store
  // (collabSlice). A previous revision mirrored them in local useState
  // (isConnected, collaboratorsMap), which meant two sources for the same UI
  // and double renders on every cursor move. Derive read-only views here.
  const isConnected = useCanvasStore(state => state.isConnected);
  const remoteUsers = useCanvasStore(state => state.remoteUsers);
  const remoteCursors = useCanvasStore(state => state.remoteCursors);

  const fallbackUserIdRef = useRef(crypto.randomUUID());
  const userId = useCanvasStore(state => state.userId) ?? fallbackUserIdRef.current;
  const activeUserIdRef = useRef(userId);
  const setUserId = useCanvasStore(state => state.setUserId);
  const setIsStoreConnected = useCanvasStore(state => state.setIsConnected);
  const setRemoteUsers = useCanvasStore(state => state.setRemoteUsers);
  const addRemoteUser = useCanvasStore(state => state.addRemoteUser);
  const removeRemoteUser = useCanvasStore(state => state.removeRemoteUser);
  const updateRemoteCursor = useCanvasStore(state => state.updateRemoteCursor);
  const clearRemoteCursors = useCanvasStore(state => state.clearRemoteCursors);
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
        enqueueOfflineMessage(offlineQueueRef.current, message, OFFLINE_QUEUE_MAX);
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

  const heartbeatLockElement = useCallback(
    (elementId: string) => {
      send({ type: 'element-lock-heartbeat', elementId });
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
      setIsStoreConnected(false);
      setConnectionMessage('Disconnected');
      useCanvasStore.getState().setReadOnly(false);
      setRemoteUsers(new Map());
      clearRemoteCursors();
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

      const socketCtx = (): SocketLifecycleContext => ({
        roomId,
        wsRef,
        reconnectAttemptRef,
        reconnectTimerRef,
        heartbeatTimerRef,
        shouldReconnectRef,
        isFirstSyncRef,
        pendingElementsRef,
        prevElementsRef,
        offlineQueueRef,
        activeUserIdRef,
        displayNameRef,
        colorRef,
        setConnectionMessage,
        setIsStoreConnected,
        setRemoteUsers,
        clearRemoteCursors,
        clearElementLocks,
        send,
        flushElementBroadcast,
        isCurrentSocket: candidate => !disposed && wsRef.current === candidate,
        scheduleReconnect: delayMs => {
          reconnectTimerRef.current = window.setTimeout(connect, delayMs);
        },
      });

      ws.onopen = () => {
        // Join, backoff reset, and heartbeat live in
        // lib/collab/socket-lifecycle so they are unit-testable.
        handleSocketOpen(ws, socketCtx());
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

        // Scene/presence dispatch lives in lib/collab/messageRouter so the
        // hook stays a transport lifecycle owner.
        routeCollabMessage(message, {
          activeUserIdRef,
          prevElementsRef,
          isFirstSyncRef,
          offlineQueueRef,
          pendingElementsRef,
          followedUserIdRef,
          onRemoteElementsRef,
          onFullSyncRef,
          setUserId,
          setIsStoreConnected,
          setRemoteUsers,
          updateRemoteCursor,
          addRemoteUser,
          removeRemoteUser,
          setElementLock,
          releaseElementLock,
          flushElementBroadcast,
          sendText: text => ws.send(text),
          isSocketOpen: () => ws.readyState === WebSocket.OPEN,
        });
      };

      ws.onclose = event => {
        handleSocketClose(ws, event.code, socketCtx());
      };
    };

    const cursorCleanupTimer = window.setInterval(() => {
      const state = useCanvasStore.getState();
      const now = Date.now();
      state.remoteCursors.forEach((cursor, uid) => {
        if (now - cursor.updatedAt > 5000) {
          // The collaborators view derives from remoteCursors, so dropping
          // the cursor here is sufficient — no second map to prune.
          state.removeRemoteCursor(uid);
        }
      });
    }, 5000);

    // `connect` is fire-and-forget by construction — the browser `online`
    // event below reconnects the same way. It cannot reject: the one `await`
    // (the ticket fetch) is inside the try/catch that sets the "Failed to
    // authenticate" message, and everything after it is synchronous. `disposed`
    // is what stops a late resolution installing a socket for a room this
    // effect has already left.
    void connect();

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
      // Same fire-and-forget contract as the initial connect above.
      void connect();
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
      clearRemoteCursors();
    };
  }, [
    WS_URL,
    addRemoteUser,
    clearElementLocks,
    clearRemoteCursors,
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

  // Derived read-only view over the store's remoteUsers + remoteCursors.
  // Users without a cursor yet (just joined) render at 0,0.
  const collaborators: CollabUser[] = useMemo(
    () =>
      Array.from(remoteUsers.values()).map(user => {
        const cursor = remoteCursors.get(user.userId);
        return {
          userId: user.userId,
          displayName: user.userName,
          color: user.color,
          x: cursor?.x ?? 0,
          y: cursor?.y ?? 0,
          updatedAt: cursor?.updatedAt ?? 0,
        };
      }),
    [remoteUsers, remoteCursors]
  );

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
    clearRemoteCursors();
  }, [clearRemoteCursors, send, setIsStoreConnected, setRemoteUsers]);

  return {
    isConnected,
    connectionMessage,
    collaborators,
    broadcastElements,
    broadcastCursor,
    lockElement,
    unlockElement,
    heartbeatLockElement,
    followUser,
    unfollowUser,
    broadcastViewport,
    disconnect,
  };
}
