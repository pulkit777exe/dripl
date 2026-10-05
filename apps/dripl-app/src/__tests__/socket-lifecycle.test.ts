import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCESS_DENIED_CLOSE_CODE,
  handleSocketClose,
  handleSocketOpen,
  HEARTBEAT_INTERVAL_MS,
  type SocketLifecycleContext,
} from '@/lib/collab/socket-lifecycle';

function fakeSocket() {
  return {
    readyState: 1,
    close: vi.fn(),
    send: vi.fn(),
  } as unknown as WebSocket;
}

function stubContext(overrides: Partial<SocketLifecycleContext> = {}): SocketLifecycleContext & {
  sent: Array<Record<string, unknown>>;
  scheduled: number[];
} {
  const sent: Array<Record<string, unknown>> = [];
  const scheduled: number[] = [];
  return {
    roomId: 'room-1',
    wsRef: { current: null },
    reconnectAttemptRef: { current: 0 },
    reconnectTimerRef: { current: null },
    heartbeatTimerRef: { current: null },
    shouldReconnectRef: { current: true },
    isFirstSyncRef: { current: false },
    pendingElementsRef: { current: null },
    prevElementsRef: { current: [] },
    activeUserIdRef: { current: 'user-1' },
    displayNameRef: { current: 'Ada' },
    colorRef: { current: '#ff0000' },
    setConnectionMessage: vi.fn(),
    setIsStoreConnected: vi.fn(),
    setRemoteUsers: vi.fn(),
    clearRemoteCursors: vi.fn(),
    clearElementLocks: vi.fn(),
    send: vi.fn((msg: Record<string, unknown>) => {
      sent.push(msg);
    }) as unknown as SocketLifecycleContext['send'],
    flushElementBroadcast: vi.fn(),
    isCurrentSocket: () => true,
    scheduleReconnect: vi.fn((delayMs: number) => {
      scheduled.push(delayMs);
    }) as unknown as SocketLifecycleContext['scheduleReconnect'],
    sent,
    scheduled,
    ...overrides,
  };
}

describe('handleSocketOpen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('closes a superseded socket without side effects', () => {
    const ws = fakeSocket();
    const ctx = stubContext({ isCurrentSocket: () => false });
    handleSocketOpen(ws, ctx);
    expect(ws.close).toHaveBeenCalled();
    expect(ctx.sent).toHaveLength(0);
    expect(ctx.setIsStoreConnected).not.toHaveBeenCalled();
  });

  it('joins, resets backoff, and heartbeats with pings', () => {
    const ws = fakeSocket();
    const ctx = stubContext();
    ctx.reconnectAttemptRef.current = 3;
    handleSocketOpen(ws, ctx);
    expect(ctx.reconnectAttemptRef.current).toBe(0);
    expect(ctx.setConnectionMessage).toHaveBeenCalledWith('Connected');
    expect(ctx.setIsStoreConnected).toHaveBeenCalledWith(true);
    expect(ctx.sent).toEqual([
      { type: 'join', roomId: 'room-1', userId: 'user-1', displayName: 'Ada', color: '#ff0000' },
    ]);
    expect(ctx.heartbeatTimerRef.current).not.toBeNull();

    actFlush();
    expect(ctx.sent.filter(m => m.type === 'ping')).toHaveLength(1);

    function actFlush() {
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    }
  });
});

describe('handleSocketClose', () => {
  it('ignores closes from a superseded socket', () => {
    const live = fakeSocket();
    const stale = fakeSocket();
    const ctx = stubContext();
    ctx.wsRef.current = live;
    handleSocketClose(stale, 1006, ctx);
    expect(ctx.setIsStoreConnected).not.toHaveBeenCalled();
    expect(ctx.scheduled).toHaveLength(0);
  });

  it('handles access-denied without reconnecting', () => {
    const ws = fakeSocket();
    const ctx = stubContext();
    ctx.wsRef.current = ws;
    ctx.pendingElementsRef.current = [];
    handleSocketClose(ws, ACCESS_DENIED_CLOSE_CODE, ctx);
    expect(ctx.shouldReconnectRef.current).toBe(false);
    expect(ctx.pendingElementsRef.current).toBeNull();
    expect(ctx.setConnectionMessage).toHaveBeenCalledWith('Access denied');
    expect(ctx.scheduled).toHaveLength(0);
  });

  it('clears presence and schedules a backoff reconnect', () => {
    const ws = fakeSocket();
    const ctx = stubContext();
    ctx.wsRef.current = ws;
    handleSocketClose(ws, 1006, ctx);
    expect(ctx.setIsStoreConnected).toHaveBeenCalledWith(false);
    expect(ctx.setRemoteUsers).toHaveBeenCalledWith(new Map());
    expect(ctx.clearRemoteCursors).toHaveBeenCalled();
    expect(ctx.clearElementLocks).toHaveBeenCalled();
    expect(ctx.setConnectionMessage).toHaveBeenCalledWith('Reconnecting...');
    expect(ctx.scheduled).toHaveLength(1);
    expect(ctx.reconnectAttemptRef.current).toBe(1);
  });

  it('gives up after the maximum attempts', () => {
    const ws = fakeSocket();
    const ctx = stubContext();
    ctx.wsRef.current = ws;
    ctx.reconnectAttemptRef.current = 5;
    handleSocketClose(ws, 1006, ctx);
    expect(ctx.setConnectionMessage).toHaveBeenCalledWith('Connection lost — refresh to retry');
    expect(ctx.scheduled).toHaveLength(0);
  });

  it('stays quiet when reconnects are disabled', () => {
    const ws = fakeSocket();
    const ctx = stubContext({ shouldReconnectRef: { current: false } });
    ctx.wsRef.current = ws;
    handleSocketClose(ws, 1006, ctx);
    expect(ctx.scheduled).toHaveLength(0);
  });
});
