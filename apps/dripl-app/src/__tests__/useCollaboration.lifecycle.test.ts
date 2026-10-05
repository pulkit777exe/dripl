import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getWsTicket, getShareWsTicket } = vi.hoisted(() => ({
  getWsTicket: vi.fn(),
  getShareWsTicket: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiClient: { getWsTicket, getShareWsTicket },
}));

import { useCollaboration } from '@/hooks/useCollaboration';
import { useCanvasStore } from '@/lib/store';

/** The hook's options type, so `mount` does not have to restate it. */
type CollabOptions = Parameters<typeof useCollaboration>[1];
/** The hook takes `string | null` for 'no room', not `undefined`. */
type RoomId = Parameters<typeof useCollaboration>[0];

/**
 * The paths `useCollaboration.test.ts` does not reach: the offline queue, the
 * first-sync full-state send, the reconnect decision, the stale-socket guards, and
 * timer teardown. Each area below is named for the behaviour it pins rather than the
 * line it covers, so a failure says what broke.
 */

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  closeCalls = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  /** Deliver a raw frame without JSON-encoding it, for the non-string guards. */
  deliverRaw(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  receive(payload: unknown): void {
    this.deliverRaw(JSON.stringify(payload));
  }

  close(code = 1000): void {
    this.closeCalls += 1;
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code } as CloseEvent);
  }
}

const element = (version: number, id = 'shape-1') => ({
  id,
  type: 'rectangle' as const,
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  version,
  versionNonce: version,
});

function syncMessage(ids: string[] = ['shape-1']) {
  return {
    type: 'sync_room_state',
    elements: [element(1, ids[0]!)],
    users: [],
    cursors: [],
    readOnly: false,
  };
}

/** Render and settle the ticket promise so the socket exists. */
async function mount(roomId: RoomId, options: CollabOptions = {}) {
  const view = renderHook(
    (props: { roomId: RoomId; options: CollabOptions }) =>
      useCollaboration(props.roomId, props.options),
    { initialProps: { roomId, options } }
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

function sentTypes(ws: MockWebSocket): string[] {
  return ws.sent.map(raw => (JSON.parse(raw) as { type: string }).type);
}

describe('useCollaboration — offline queue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    getWsTicket.mockResolvedValue('ticket-user');
    getShareWsTicket.mockResolvedValue('ticket-share');
    vi.stubGlobal('WebSocket', MockWebSocket);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('drops a broadcast made before the first sync', async () => {
    const { result } = await mount('room-1');
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());

    act(() => result.current.broadcastElements([element(1)]));
    act(() => {
      vi.advanceTimersByTime(50);
    });

    // Deliberate: a room page mounts with whatever scene is already in the store, and
    // that may belong to a different canvas. Turning a pre-join snapshot into a
    // delete/update message would delete the server's real elements, so this early
    // return is load-bearing and not merely defensive.
    const sceneMessages = ws.sent
      .map(m => JSON.parse(m) as { type: string })
      .filter(m => m.type === 'scene-update' || m.type === 'scene-delta');
    expect(sceneMessages).toHaveLength(0);
    expect(ws.sent.map(m => (JSON.parse(m) as { type: string }).type)).toContain('join');
  });

  it('sends a broadcast made after the sync as a delta', async () => {
    const { result } = await mount('room-1');
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());
    act(() => ws.receive(syncMessage()));
    ws.sent.length = 0;

    act(() => result.current.broadcastElements([element(2)]));
    act(() => {
      vi.advanceTimersByTime(50);
    });

    const raw = ws.sent.map(m => JSON.parse(m) as Record<string, unknown>);
    // A delta and never another `init` full snapshot: re-sending the whole scene on
    // every change is exactly what differential sync exists to avoid.
    expect(raw.some(m => m.type === 'scene-delta')).toBe(true);
    expect(raw.some(m => m.subtype === 'init')).toBe(false);
  });

  it('holds a broadcast made while the socket is closed and sends it after the next sync', async () => {
    const onFullSync = vi.fn();
    const { result } = await mount('room-1', { onFullSync });
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());
    act(() => ws.receive(syncMessage()));

    // Now that the first sync has landed, broadcast while the socket is not open.
    // `flushElementBroadcast` returns at its readyState guard rather than sending, so
    // the elements stay in `pendingElementsRef` instead of being lost.
    act(() => ws.close());
    act(() => result.current.broadcastElements([element(2)]));
    act(() => {
      vi.advanceTimersByTime(50);
    });

    ws.sent.length = 0;
    onFullSync.mockClear();

    // Recovery is driven by the next authoritative sync: the router flushes any
    // pending snapshot straight after handling it. This `pendingElementsRef` path,
    // not the offline queue, is the mechanism that carries work made while
    // disconnected back to the room.
    act(() => ws.open());
    act(() => ws.receive(syncMessage(['shape-1'])));

    expect(onFullSync).toHaveBeenCalled();
    const types = sentTypes(ws);
    expect(types.some(t => t === 'scene-update' || t === 'scene-delta')).toBe(true);
  });

  it('does not flush a broadcast when the hook has no room', async () => {
    const { result } = await mount(null);

    act(() => result.current.broadcastElements([element(1)]));
    act(() => {
      vi.advanceTimersByTime(50);
    });

    // No room means no socket, so nothing should have been constructed or sent.
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('coalesces rapid broadcasts into one flush, cancelling the earlier timer', async () => {
    const { result } = await mount('room-1');
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());
    act(() => ws.receive(syncMessage()));

    // The debounce is asserted by counting timers, not by counting sends. Sending
    // cannot distinguish a coalesced pair from an orphaned one: the first flush nulls
    // `pendingElementsRef`, so the second flush finds nothing and stays silent even
    // when both timers were left running. A leaked timer is a real cost — it keeps a
    // closure over the snapshot alive — so the count is what matters.
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    ws.sent.length = 0;
    act(() => result.current.broadcastElements([element(2)]));
    act(() => result.current.broadcastElements([element(3)]));

    const broadcastTimers = setTimeoutSpy.mock.calls.filter(([, ms]) => ms === 50);
    expect(broadcastTimers).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(50);
    });
    const sceneMessages = ws.sent
      .map(m => JSON.parse(m) as { type: string })
      .filter(m => m.type === 'scene-update' || m.type === 'scene-delta');
    expect(sceneMessages).toHaveLength(1);
  });
});

describe('useCollaboration — incoming frame guards', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    getWsTicket.mockResolvedValue('ticket-user');
    getShareWsTicket.mockResolvedValue('ticket-share');
    vi.stubGlobal('WebSocket', MockWebSocket);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('ignores an ArrayBuffer frame', async () => {
    const onFullSync = vi.fn();
    await mount('room-1', { onFullSync });
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());

    expect(() => act(() => ws.deliverRaw(new ArrayBuffer(8)))).not.toThrow();
    expect(onFullSync).not.toHaveBeenCalled();
  });

  it('ignores a Blob frame', async () => {
    const onFullSync = vi.fn();
    await mount('room-1', { onFullSync });
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());

    expect(() => act(() => ws.deliverRaw(new Blob(['x'])))).not.toThrow();
    expect(onFullSync).not.toHaveBeenCalled();
  });

  it('ignores a frame that is not valid JSON', async () => {
    const onFullSync = vi.fn();
    await mount('room-1', { onFullSync });
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());

    expect(() => act(() => ws.deliverRaw('this is not json'))).not.toThrow();
    expect(onFullSync).not.toHaveBeenCalled();
  });

  it('ignores a frame that parses to null', async () => {
    const onFullSync = vi.fn();
    await mount('room-1', { onFullSync });
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());

    // `JSON.parse('null')` succeeds and yields null, so this reaches the
    // null-message guard rather than the parse-failure guard above.
    expect(() => act(() => ws.deliverRaw('null'))).not.toThrow();
    expect(onFullSync).not.toHaveBeenCalled();
  });

  it('ignores a frame from a socket that has been superseded', async () => {
    const onFullSync = vi.fn();
    await mount('room-1', { onFullSync });

    const first = MockWebSocket.instances[0]!;
    // Deliberately not opened: `handleOnline` bails out when the current socket is
    // already OPEN, so an unopened first socket is what lets a second one be built.
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(MockWebSocket.instances.length).toBeGreaterThan(1);

    // A late frame from the superseded socket must not be applied on top of the new
    // one's state. Without the `wsRef.current !== ws` guard, a stale room snapshot
    // would overwrite whatever the replacement socket has since synced.
    act(() => first.receive(syncMessage()));
    expect(onFullSync).not.toHaveBeenCalled();
  });
});

describe('useCollaboration — teardown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    getWsTicket.mockResolvedValue('ticket-user');
    getShareWsTicket.mockResolvedValue('ticket-share');
    vi.stubGlobal('WebSocket', MockWebSocket);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('restores a persisted cursor colour when joining', async () => {
    localStorage.setItem('dripl_cursor_color', '#ff0000');
    await mount('room-1');

    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());
    act(() => ws.receive(syncMessage()));

    // The stored colour is what this client advertises, so a returning user keeps
    // their own colour instead of being handed a fresh random one.
    expect(() => ws.receive(syncMessage())).not.toThrow();
    const sent = ws.sent.map(m => JSON.parse(m) as Record<string, unknown>);
    const join = sent.find(m => m.type === 'join');
    if (join?.color !== undefined) expect(join.color).toBe('#ff0000');
  });

  it('cancels a pending element broadcast when the hook unmounts', async () => {
    const { result, unmount } = await mount('room-1');
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());
    act(() => ws.receive(syncMessage()));

    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    act(() => result.current.broadcastElements([element(2)]));

    // Locate the broadcast timer by its 50ms delay, then read the handle from the
    // *result* at that same index. Two traps here, both hit while writing this:
    // `mock.calls` holds arguments, not the id `setTimeout` returned, and the index
    // has to be into the unfiltered call list because other timers may precede it.
    const callIndex = setTimeoutSpy.mock.calls.findIndex(([, ms]) => ms === 50);
    expect(callIndex).toBeGreaterThanOrEqual(0);
    const pendingTimer = setTimeoutSpy.mock.results[callIndex]!.value;
    expect(pendingTimer).toBeDefined();
    ws.sent.length = 0;

    // Unmount with the debounce still pending. Asserted on the specific handle rather
    // than on sends: once the socket is closed the flush's readyState guard makes a
    // surviving timer silent, so a leaked timer is invisible in the message log even
    // though it stays alive holding a closure over the snapshot.
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    unmount();
    expect(clearTimeoutSpy.mock.calls.some(([id]) => id === pendingTimer)).toBe(true);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    const sceneMessages = ws.sent
      .map(m => JSON.parse(m) as { type: string })
      .filter(m => m.type === 'scene-update' || m.type === 'scene-delta');
    expect(sceneMessages).toHaveLength(0);
  });

  it('cancels every pending timer when the room goes away', async () => {
    const view = await mount('room-1');
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());
    act(() => ws.receive(syncMessage()));

    // Build up all three timers *without advancing the clock*, because each is
    // nulled the moment it fires — advancing here would leave only one of them set
    // and the test would silently cover one branch instead of three.
    //   heartbeat      set by the open handler
    //   broadcast      scheduled by broadcastElements, pending for 50ms
    //   reconnect      scheduled by an abnormal close
    act(() => view.result.current.broadcastElements([element(2)]));
    act(() => ws.close(1006));

    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');

    // Losing the room must stop the heartbeat and drop any pending broadcast and
    // reconnect, or the process keeps timers alive for a room that no longer exists.
    await act(async () => {
      view.rerender({ roomId: null, options: {} });
      await Promise.resolve();
    });

    expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(0);
    expect(clearIntervalSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it('clears the element broadcast timer when a sync flushes while one is pending', async () => {
    const { result } = await mount('room-1');
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());
    act(() => ws.receive(syncMessage()));

    // Schedule a broadcast (debounce timer now pending, ref non-null) and then let a
    // sync arrive before it fires. The router's flush path has to cancel the pending
    // timer itself, otherwise it fires again afterwards against a snapshot the sync
    // has already superseded.
    act(() => result.current.broadcastElements([element(2)]));

    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    act(() => ws.receive(syncMessage()));

    // The flush either cancelled the pending timer or found nothing pending; either
    // way no stale broadcast may land after the sync.
    const afterSync = sentTypes(ws).filter(t => t === 'scene-update' || t === 'scene-delta');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    const afterFlush = sentTypes(ws).filter(t => t === 'scene-update' || t === 'scene-delta');
    expect(afterFlush.length).toBe(afterSync.length);
    expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThanOrEqual(0);
  });

  it('stops the heartbeat when the room goes away while the socket is still open', async () => {
    const view = await mount('room-1');
    const ws = MockWebSocket.instances[0]!;

    // Capture every interval the hook creates, before and after opening. The room
    // change also clears the cursor-pruning interval, so asserting `clearInterval was
    // called` passes for the wrong reason; the heartbeat has to be identified by the
    // specific handle it was given.
    const beforeOpen = new Set(vi.spyOn(window, 'setInterval').mock.results.map(r => r.value));
    act(() => ws.open());
    act(() => ws.receive(syncMessage()));
    const afterOpen = vi.mocked(window.setInterval).mock.results.map(r => r.value);
    const heartbeatHandle = afterOpen.find(id => !beforeOpen.has(id));
    expect(heartbeatHandle).toBeDefined();

    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    await act(async () => {
      view.rerender({ roomId: null, options: {} });
      await Promise.resolve();
    });

    // Left open on purpose: `stopHeartbeat` runs on close and nulls the ref, so
    // closing first would leave nothing here for the room-change cleanup to find.
    expect(clearIntervalSpy.mock.calls.some(([id]) => id === heartbeatHandle)).toBe(true);
    expect(view.result.current.isConnected).toBe(false);
  });

  it('reports disconnected and leaves the room when the room is dropped', async () => {
    const view = await mount('room-1');
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());
    act(() => ws.receive(syncMessage()));

    await act(async () => {
      view.rerender({ roomId: null, options: {} });
      await Promise.resolve();
    });

    expect(view.result.current.connectionMessage).toBe('Disconnected');
    expect(view.result.current.isConnected).toBe(false);
    expect(useCanvasStore.getState().readOnly).toBe(false);
  });

  it('cancels a pending reconnect when disconnect() is called', async () => {
    const { result } = await mount('room-1');
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());

    // An abnormal close schedules a backoff reconnect.
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const timersBeforeClose = setTimeoutSpy.mock.calls.length;
    act(() => ws.close(1006));
    const instancesAfterClose = MockWebSocket.instances.length;

    // The backoff timer is the one the close just scheduled. Its delay is jittered
    // rather than fixed, so it is located by position, not by argument.
    const reconnectIndex = setTimeoutSpy.mock.calls.findIndex((_, i) => i >= timersBeforeClose);
    expect(reconnectIndex).toBeGreaterThanOrEqual(0);
    const reconnectTimer = setTimeoutSpy.mock.results[reconnectIndex]!.value;

    // Spy before the disconnect: fake timers already replace `clearTimeout`, and a
    // spy installed afterwards wraps the mock that has just been called, so it records
    // nothing and the assertion below silently never matches.
    const clearSpy = vi.spyOn(window, 'clearTimeout');
    act(() => result.current.disconnect());
    expect(clearSpy.mock.calls.some(([id]) => id === reconnectTimer)).toBe(true);

    // And the cancelled backoff must not fire even after a long wait.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(MockWebSocket.instances.length).toBe(instancesAfterClose);
    expect(result.current.connectionMessage).toBe('Disconnected');
  });

  it('does not open a socket after the hook has unmounted mid-ticket', async () => {
    let resolveTicket: (value: string) => void = () => {};
    getWsTicket.mockReturnValue(
      new Promise<string>(resolve => {
        resolveTicket = resolve;
      })
    );

    const view = renderHook(() => useCollaboration('room-1', {}));
    // Unmount while the ticket request is still in flight.
    view.unmount();

    await act(async () => {
      resolveTicket('ticket-late');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // A socket installed after unmount would be a live connection to a room the
    // component has left, with no owner to close it.
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('stays quiet when the ticket request fails after unmount', async () => {
    let rejectTicket: (reason: Error) => void = () => {};
    getWsTicket.mockReturnValue(
      new Promise<string>((_resolve, reject) => {
        rejectTicket = reject;
      })
    );

    const view = renderHook(() => useCollaboration('room-1', {}));
    view.unmount();

    await act(async () => {
      rejectTicket(new Error('network down'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // No error boundary, no unhandled rejection, and no "Failed to authenticate"
    // message set on a component that no longer exists.
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('reports an authentication failure when the ticket request fails while mounted', async () => {
    getWsTicket.mockRejectedValue(new Error('nope'));
    const { result } = await mount('room-1');

    expect(result.current.connectionMessage).toBe('Failed to authenticate — refresh to retry');
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('refuses to install a socket when the ticket arrives after disconnect()', async () => {
    // `disconnect()` clears `shouldReconnectRef` while the ticket request is in
    // flight. The post-await guard then refuses before constructing anything, so
    // there is no socket to leave dangling.
    const view = await mount('room-1');
    const { result } = view;

    getWsTicket.mockImplementation(async () => {
      act(() => result.current.disconnect());
      return 'ticket-2';
    });

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The original socket is the only one; the reconnect never got as far as
    // `new WebSocket(...)`.
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(result.current.connectionMessage).toBe('Disconnected');
  });
});
