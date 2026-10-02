import type { DriplElement } from '@dripl/common';
import { useCanvasStore } from '@/lib/store';
import type { RemoteUser } from '@/lib/store/helpers';
import { decideHealingAction } from './healing';
import type { ClientMessage } from './protocol';
import { computeReconnectDelay, shouldGiveUpReconnecting } from './reconnect';

export const HEARTBEAT_INTERVAL_MS = 15_000;
export const ACCESS_DENIED_CLOSE_CODE = 4003;

interface Ref<T> {
  current: T;
}

/**
 * Socket open/close lifecycle — extracted from `useCollaboration`.
 *
 * The hook owns refs, timers, and the `connect()` recursion; everything
 * decided at open/close time lives here as functions over an explicit
 * context, so reconnect/backoff/heartbeat behavior is unit-testable
 * without mocked sockets driving the full hook.
 */
export interface SocketLifecycleContext {
  roomId: string;
  wsRef: Ref<WebSocket | null>;
  reconnectAttemptRef: Ref<number>;
  reconnectTimerRef: Ref<number | null>;
  heartbeatTimerRef: Ref<number | null>;
  shouldReconnectRef: Ref<boolean>;
  isFirstSyncRef: Ref<boolean>;
  pendingElementsRef: Ref<DriplElement[] | null>;
  prevElementsRef: Ref<DriplElement[]>;
  offlineQueueRef: Ref<Array<{ msg: ClientMessage; timestamp: number }>>;
  activeUserIdRef: Ref<string>;
  displayNameRef: Ref<string>;
  colorRef: Ref<string>;
  setConnectionMessage: (message: string) => void;
  setIsStoreConnected: (connected: boolean) => void;
  setRemoteUsers: (users: Map<string, RemoteUser>) => void;
  clearRemoteCursors: () => void;
  clearElementLocks: () => void;
  send: (message: ClientMessage) => void;
  flushElementBroadcast: () => void;
  /** True while this socket is still the live one (not disposed/superseded). */
  isCurrentSocket: (ws: WebSocket) => boolean;
  /** Schedule `connect()` after the backoff delay. */
  scheduleReconnect: (delayMs: number) => void;
}

function stopHeartbeat(ctx: SocketLifecycleContext): void {
  if (ctx.heartbeatTimerRef.current) {
    window.clearInterval(ctx.heartbeatTimerRef.current);
    ctx.heartbeatTimerRef.current = null;
  }
}

function startHeartbeat(ws: WebSocket, ctx: SocketLifecycleContext): void {
  stopHeartbeat(ctx);
  ctx.heartbeatTimerRef.current = window.setInterval(() => {
    ctx.send({ type: 'ping' });
    // Healing tick (frontend-only, protocol-compatible): see
    // lib/collab/healing.ts. Best-effort; the next tick retries.
    try {
      if (!ctx.isCurrentSocket(ws)) return;
      if (ws.readyState !== WebSocket.OPEN) return;
      const action = decideHealingAction(
        ctx.isFirstSyncRef.current,
        ctx.pendingElementsRef.current,
        ctx.prevElementsRef.current,
        useCanvasStore.getState().elements
      );
      if (action.kind === 'flush-pending') {
        ctx.flushElementBroadcast();
      } else if (action.kind === 'requeue') {
        ctx.pendingElementsRef.current = action.elements;
        ctx.flushElementBroadcast();
      }
    } catch {
      // Healing is best-effort; the next tick retries.
    }
  }, HEARTBEAT_INTERVAL_MS);
}

/** Wire a freshly opened socket: join, reset backoff, start heartbeat. */
export function handleSocketOpen(ws: WebSocket, ctx: SocketLifecycleContext): void {
  if (!ctx.isCurrentSocket(ws)) {
    ws.close();
    return;
  }
  ctx.reconnectAttemptRef.current = 0;
  ctx.setConnectionMessage('Connected');
  ctx.setIsStoreConnected(true);
  ctx.send({
    type: 'join',
    roomId: ctx.roomId,
    userId: ctx.activeUserIdRef.current,
    displayName: ctx.displayNameRef.current,
    color: ctx.colorRef.current,
  });

  // Scene messages are replayed only after the server has acknowledged
  // the join with `sync_room_state`. Sending them immediately after the
  // join frame races the server's async authorization/load handler and
  // can silently drop offline edits.
  startHeartbeat(ws, ctx);
}

/** Handle a socket close: deny, give up, or back off and reconnect. */
export function handleSocketClose(ws: WebSocket, code: number, ctx: SocketLifecycleContext): void {
  if (ctx.wsRef.current !== ws) return;
  if (code === ACCESS_DENIED_CLOSE_CODE) {
    ctx.shouldReconnectRef.current = false;
    ctx.offlineQueueRef.current = [];
    ctx.pendingElementsRef.current = null;
    ctx.setConnectionMessage('Access denied');
    ctx.setIsStoreConnected(false);
    stopHeartbeat(ctx);
    return;
  }
  ctx.setIsStoreConnected(false);
  ctx.setRemoteUsers(new Map());
  ctx.clearRemoteCursors();
  ctx.clearElementLocks();
  stopHeartbeat(ctx);

  if (!ctx.shouldReconnectRef.current) return;
  if (shouldGiveUpReconnecting(ctx.reconnectAttemptRef.current)) {
    ctx.setConnectionMessage('Connection lost — refresh to retry');
    return;
  }
  ctx.setConnectionMessage('Reconnecting...');
  const delay = computeReconnectDelay(ctx.reconnectAttemptRef.current);
  ctx.reconnectAttemptRef.current += 1;
  ctx.scheduleReconnect(delay);
}
