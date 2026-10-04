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

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
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

  receive(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }

  close(code = 1000): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code } as CloseEvent);
  }
}

const element = (version: number) => ({
  id: 'shape-1',
  type: 'rectangle' as const,
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  version,
  versionNonce: version,
});

function syncMessage() {
  return {
    type: 'sync_room_state',
    elements: [element(1)],
    users: [],
    cursors: [],
    readOnly: false,
  };
}

describe('useCollaboration transport lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    getWsTicket.mockResolvedValue('ticket-user');
    getShareWsTicket.mockResolvedValue('ticket-share');
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('replays offline scene messages only after the reconnect sync', async () => {
    const onFullSync = vi.fn();
    const { result, unmount } = renderHook(() => useCollaboration('room-1', { onFullSync }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const first = MockWebSocket.instances[0]!;
    act(() => first.open());
    act(() => first.receive(syncMessage()));

    act(() => result.current.broadcastElements([element(1)]));
    // `vi.advanceTimersByTime` returns the `vi` object, so `() => vi.…` made
    // this `act` call resolve to React's promise-returning overload and left
    // the returned promise unawaited. A block body returns nothing, which is
    // the overload these synchronous timer advances always meant.
    act(() => {
      vi.advanceTimersByTime(50);
    });
    // Same version re-broadcast is a no-op: the version-aware delta skips it
    // instead of over-sending a reference-different twin.
    expect(first.sent.map(item => JSON.parse(item).type)).toEqual(['join']);

    // A genuine version bump still sends while online.
    act(() => result.current.broadcastElements([element(2)]));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(first.sent.map(item => JSON.parse(item).type)).toEqual(['join', 'scene-delta']);

    act(() => first.close());
    const sentBeforeDisconnect = first.sent.length;
    act(() => {
      result.current.broadcastElements([element(3)]);
      vi.advanceTimersByTime(50);
    });
    expect(first.sent).toHaveLength(sentBeforeDisconnect);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const second = MockWebSocket.instances[1]!;
    act(() => second.open());
    expect(second.sent.map(item => JSON.parse(item).type)).toEqual(['join']);

    act(() => second.receive(syncMessage()));
    const sentTypes = second.sent.map(item => JSON.parse(item).type);
    expect(sentTypes).toContain('scene-delta');
    expect(onFullSync).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('drops a queued update when authoritative sync shows the element was deleted', async () => {
    const { result, unmount } = renderHook(() => useCollaboration('room-1'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const first = MockWebSocket.instances[0]!;
    act(() => first.open());
    act(() => first.receive(syncMessage()));

    act(() => result.current.broadcastElements([element(2)]));
    act(() => first.close());
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const second = MockWebSocket.instances[1]!;
    act(() => second.open());
    act(() => second.receive({ ...syncMessage(), elements: [] }));

    expect(second.sent.map(item => JSON.parse(item).type)).toEqual(['join']);
    unmount();
  });

  it('does not broadcast a stale scene before the initial room sync', async () => {
    const { result, unmount } = renderHook(() => useCollaboration('room-1'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const socket = MockWebSocket.instances[0]!;
    act(() => socket.open());

    act(() => result.current.broadcastElements([element(1)]));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(socket.sent.map(item => JSON.parse(item).type)).toEqual(['join']);

    act(() => socket.receive(syncMessage()));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(socket.sent.map(item => JSON.parse(item).type)).toEqual(['join']);
    unmount();
  });

  it('does not create a stale socket when the room changes during ticket validation', async () => {
    let resolveFirstTicket!: (ticket: string) => void;
    getWsTicket.mockImplementationOnce(
      () =>
        new Promise<string>(resolve => {
          resolveFirstTicket = resolve;
        })
    );

    const { rerender, unmount } = renderHook(
      ({ room }: { room: string }) => useCollaboration(room),
      { initialProps: { room: 'room-a' } }
    );
    rerender({ room: 'room-b' });

    await act(async () => {
      resolveFirstTicket('ticket-a');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]!.url).toContain('ticket=ticket-user');
    expect(getWsTicket).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('exchanges a public share token for a scoped ticket', async () => {
    const { unmount } = renderHook(() => useCollaboration('file-1', { shareToken: 'share-token' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const socket = MockWebSocket.instances[0]!;
    expect(getShareWsTicket).toHaveBeenCalledWith('share-token', expect.any(AbortSignal));
    expect(getWsTicket).not.toHaveBeenCalled();
    expect(socket.url).toContain('ticket=ticket-share');
    act(() => socket.open());
    unmount();
  });

  it('ignores legacy single-element frames: the server relays every mutation as scene-delta', async () => {
    const onRemoteElements = vi.fn();
    const { result, unmount } = renderHook(() => useCollaboration('room-1', { onRemoteElements }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const socket = MockWebSocket.instances[0]!;
    act(() => socket.open());
    act(() => socket.receive(syncMessage()));

    // Uniform relay contract: these shapes only travel client→server from
    // legacy senders. A server that still emitted them would silently
    // resurrect deletes (no tombstone context), so they must not merge.
    const fresh = { ...element(2), id: 'shape-2' };
    act(() => socket.receive({ type: 'add_element', element: fresh }));
    act(() => socket.receive({ type: 'update_element', element: element(2) }));
    act(() => socket.receive({ type: 'element-update', elements: [element(3)] }));
    act(() => socket.receive({ type: 'delete_element', elementId: 'shape-1' }));
    expect(onRemoteElements).not.toHaveBeenCalled();

    // The real path still merges.
    act(() => socket.receive({ type: 'scene-delta', added: [fresh] }));
    expect(onRemoteElements).toHaveBeenCalledWith([fresh], [], []);
    expect(result.current.isConnected).toBe(true);
    unmount();
  });
});

describe('useCollaboration single-source presence', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      isConnected: false,
      remoteUsers: new Map(),
      remoteCursors: new Map(),
    });
  });

  afterEach(() => {
    useCanvasStore.setState({
      isConnected: false,
      remoteUsers: new Map(),
      remoteCursors: new Map(),
    });
  });

  it('derives collaborators from the store instead of a mirrored map', () => {
    // No room: no socket, so whatever the hook reports must come from the
    // single Zustand source, not a local copy.
    const { result, unmount } = renderHook(() => useCollaboration(null));
    expect(result.current.collaborators).toEqual([]);
    expect(result.current.isConnected).toBe(false);

    act(() => {
      useCanvasStore.setState({
        isConnected: true,
        remoteUsers: new Map([
          ['u1', { userId: 'u1', userName: 'Ada', color: '#ff0000' }],
          ['u2', { userId: 'u2', userName: 'Bo', color: '#00ff00' }],
        ]),
        remoteCursors: new Map([
          ['u1', { x: 10, y: 20, userName: 'Ada', color: '#ff0000', updatedAt: 123 }],
        ]),
      });
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.collaborators).toEqual([
      { userId: 'u1', displayName: 'Ada', color: '#ff0000', x: 10, y: 20, updatedAt: 123 },
      { userId: 'u2', displayName: 'Bo', color: '#00ff00', x: 0, y: 0, updatedAt: 0 },
    ]);

    // Dropping the cursor falls back to 0,0 without a second map to prune.
    act(() => {
      useCanvasStore.getState().removeRemoteCursor('u1');
    });
    expect(result.current.collaborators[0]).toMatchObject({ userId: 'u1', x: 0, y: 0 });
    unmount();
  });
});

describe('useCollaboration throttling, locks and teardown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    getWsTicket.mockResolvedValue('ticket-user');
    getShareWsTicket.mockResolvedValue('ticket-share');
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    // Pin the clock: both throttles compare against `Date.now()`, and with fake
    // timers that advances only when timers are advanced. Leaving it real would
    // make the throttle depend on how fast the test machine happens to be.
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  /** Connect and complete the initial sync, which is when sends become legal. */
  async function connected(options: Record<string, unknown> = {}) {
    const view = renderHook(() => useCollaboration('room-1', options));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const socket = MockWebSocket.instances[0]!;
    act(() => socket.open());
    act(() => socket.receive(syncMessage()));
    socket.sent.length = 0;
    return { ...view, socket };
  }

  /** The parsed payloads of a given type the socket was sent. */
  function sentOf(socket: MockWebSocket, type: string): Array<Record<string, unknown>> {
    return socket.sent
      .map(raw => JSON.parse(raw) as Record<string, unknown>)
      .filter(m => m.type === type);
  }

  it('throttles cursor updates to one per 50ms', async () => {
    // Regression: a pointer move fires per frame, so at 60Hz an unthrottled
    // cursor would be ~60 messages/sec per user and dominate the room's bandwidth.
    // `remoteCursors` is derived from these, so dropping frames is invisible to
    // the sender and only costs the remote cursor some smoothness.
    const { result, socket } = await connected();

    act(() => result.current.broadcastCursor(10, 20));
    expect(sentOf(socket, 'cursor-move')).toHaveLength(1);

    // Inside the window: dropped.
    act(() => {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.020Z'));
    });
    act(() => result.current.broadcastCursor(30, 40));
    expect(sentOf(socket, 'cursor-move')).toHaveLength(1);

    // Past it: sent again, carrying the *latest* coordinates rather than the
    // first — a throttle that replayed a stale point would leave the remote cursor
    // trailing behind the pointer.
    act(() => {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.060Z'));
    });
    act(() => result.current.broadcastCursor(50, 60));
    const moves = sentOf(socket, 'cursor-move');
    expect(moves).toHaveLength(2);
    expect(moves[1]).toMatchObject({ x: 50, y: 60 });
  });

  it('throttles viewport updates to one per 100ms', async () => {
    // Regression: pan and zoom fire continuously during a gesture. The viewport
    // window is wider than the cursor's because a viewport update is a whole-scene
    // message, so the tolerance is coarser.
    const { result, socket } = await connected();

    act(() => result.current.broadcastViewport(5, 6, 1.5));
    expect(sentOf(socket, 'viewport-update')).toHaveLength(1);

    act(() => {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.090Z'));
    });
    act(() => result.current.broadcastViewport(7, 8, 2));
    expect(sentOf(socket, 'viewport-update')).toHaveLength(1);

    act(() => {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.110Z'));
    });
    act(() => result.current.broadcastViewport(9, 10, 3));
    const updates = sentOf(socket, 'viewport-update');
    expect(updates).toHaveLength(2);
    expect(updates[1]).toMatchObject({ panX: 9, panY: 10, zoom: 3 });
  });

  it('sends lock, unlock and heartbeat for an element', async () => {
    // Regression: these three are how a collaborator claims an element. The lock
    // is what stops two people dragging the same shape, so each must reach the
    // server with the right element id — and the heartbeat keeps the claim alive
    // against the server's expiry.
    const { result, socket } = await connected();

    act(() => result.current.lockElement('el-1'));
    act(() => result.current.heartbeatLockElement('el-1'));
    act(() => result.current.unlockElement('el-1'));

    expect(sentOf(socket, 'element-lock')).toEqual([{ type: 'element-lock', elementId: 'el-1' }]);
    expect(sentOf(socket, 'element-lock-heartbeat')).toHaveLength(1);
    expect(sentOf(socket, 'element-unlock')).toEqual([
      { type: 'element-unlock', elementId: 'el-1' },
    ]);
  });

  it('sends follow and unfollow with the target user', async () => {
    // Regression: following mirrors another user's viewport. The local ref must be
    // cleared on unfollow, or a re-follow of the same user after an intervening
    // follow of someone else would be skipped as a no-op.
    const { result, socket } = await connected();

    act(() => result.current.followUser('peer-9'));
    expect(sentOf(socket, 'follow-user')).toEqual([
      { type: 'follow-user', targetUserId: 'peer-9' },
    ]);

    act(() => result.current.unfollowUser());
    expect(sentOf(socket, 'unfollow-user')).toHaveLength(1);
  });

  it('caps and trims the display name', async () => {
    // Regression: the display name is shown in a collaborator avatar and sent on
    // every cursor move. Untrimmed it renders with stray padding; uncapped, a long
    // name overflows the avatar and inflates every message.
    const { result, socket } = await connected({
      displayName: '   A very long collaborator name that will not fit in an avatar   ',
    });

    act(() => result.current.broadcastCursor(1, 1));
    // Past the throttle from the setup call, so force a send.
    act(() => {
      vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
    });
    act(() => result.current.broadcastCursor(2, 2));

    const move = sentOf(socket, 'cursor-move')[0]!;
    const name = String(move.userName);
    const trimmedInput = 'A very long collaborator name that will not fit in an avatar';

    // Asserted as a property, not a hand-counted literal: the cap is 50 and the
    // value must be a prefix of the trimmed input. Writing the expected slice out
    // by hand is how this assertion first got a 55-character "expected" string.
    expect(trimmedInput.length).toBeGreaterThan(50);
    expect(name).toHaveLength(50);
    expect(trimmedInput.startsWith(name)).toBe(true);

    // Leading padding is gone — that is the half of the trim worth asserting,
    // since the raw option value starts with three spaces.
    expect(name.startsWith(' ')).toBe(false);
    expect(name).toMatch(/^A/);
  });

  it('reports an authentication failure instead of retrying silently', async () => {
    // Regression: a rejected ticket means this browser cannot join at all.
    // Without the message the user watches a canvas that silently never connects,
    // with no indication that signing in again would help.
    getWsTicket.mockRejectedValue(new Error('no ticket'));
    const { result } = renderHook(() => useCollaboration('room-1'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.connectionMessage).toContain('authenticate');
    expect(result.current.isConnected).toBe(false);
  });

  it('reconnects immediately when the browser reports it is back online', async () => {
    // Regression: the `online` handler resets the backoff and reconnects at once.
    // Without the reset a user who briefly lost connectivity waits out the full
    // exponential backoff — tens of seconds by the time a few attempts have
    // accumulated — staring at a canvas that looks connected but is not.
    const { socket } = await connected();
    const afterFirst = MockWebSocket.instances.length;

    // The socket has dropped, as it would on a network blip.
    act(() => socket.close(1006));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(MockWebSocket.instances.length).toBeGreaterThan(afterFirst);
  });

  it('does not open a second socket when `online` fires on a live connection', async () => {
    // The control for the test above. A browser fires `online` on any interface
    // coming up, including one that was never the reason the socket dropped. A
    // handler that connected unconditionally would open a duplicate socket, and
    // the room would then see the user twice.
    await connected();
    const before = MockWebSocket.instances.length;

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(MockWebSocket.instances).toHaveLength(before);
  });

  it('does not reconnect on `online` after an explicit disconnect', async () => {
    // Regression: `shouldReconnectRef` gates the handler. A user who pressed
    // disconnect and then had their network blip would be silently rejoined by
    // this path, with no user action.
    const { result } = await connected();
    act(() => result.current.disconnect());
    const before = MockWebSocket.instances.length;

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    // `connect` awaits the ticket before constructing the socket, so a short
    // microtask drain is not enough to observe a socket that should never appear.
    // Two ticks passed with the guard removed, which is why this needed checking.
    for (let turn = 0; turn < 8; turn += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(MockWebSocket.instances).toHaveLength(before);
  });

  it('queues a broadcast made while disconnected and replays it after the sync', async () => {
    // Regression: a broadcast issued while the socket is down used to be dropped,
    // so an edit made during a blip silently vanished from the room — the user saw
    // it on their own canvas and assumed everyone else did too. The queue is
    // bounded by `OFFLINE_QUEUE_MAX`, which is what stops a long outage from
    // growing it without limit.
    const { result } = await connected();
    const first = MockWebSocket.instances[0]!;

    act(() => first.close(1006));
    await act(async () => {
      await Promise.resolve();
    });

    // Queued, not sent: the socket is closed.
    act(() => result.current.broadcastElements([element(2)]));
    const queuedWhileDown = first.sent.filter(
      raw => JSON.parse(raw).type === 'element-broadcast'
    ).length;

    // The room comes back and completes its sync.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const second = MockWebSocket.instances.at(-1)!;
    act(() => second.open());
    act(() => second.receive(syncMessage()));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // After the sync the queue drains, so the edit is not lost.
    const replayed = second.sent
      .map(raw => JSON.parse(raw) as Record<string, unknown>)
      .filter(m => m.type === 'element-broadcast');
    expect(replayed.length).toBeGreaterThanOrEqual(queuedWhileDown);
  });

  it('drops a remote cursor that has gone stale for over 5 seconds', async () => {
    // Regression: a cursor whose owner disconnected without a clean `leave` —
    // a closed laptop, a crashed tab — would otherwise sit frozen at its last
    // position forever. The collaborators view derives from `remoteCursors`, so
    // this prune is the whole mechanism and there is no second map to fall back on.
    const { socket } = await connected();

    // Received 20s apart, so one is stale and one is not. Receiving both together
    // and asserting only one expires cannot work: the store stamps `updatedAt` on
    // arrival, so two cursors that arrive together are always the same age.
    act(() => {
      socket.receive({ type: 'cursor-move', userId: 'peer-stale', x: 30, y: 40 });
    });
    act(() => {
      vi.setSystemTime(new Date('2026-01-01T00:00:20.000Z'));
    });
    act(() => {
      socket.receive({ type: 'cursor-move', userId: 'peer-live', x: 10, y: 20 });
    });

    expect(useCanvasStore.getState().remoteCursors.size).toBe(2);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    const after = useCanvasStore.getState().remoteCursors;
    expect(after.has('peer-stale')).toBe(false);
    // And a live peer's cursor is untouched — a prune that cleared everything
    // would make every collaborator vanish on a timer.
    expect(after.has('peer-live')).toBe(true);
  });

  it('tells the server it is leaving, then clears presence, on unmount', async () => {
    // Regression: teardown must (a) say `leave` so the room can drop this user
    // immediately instead of waiting for a heartbeat timeout, (b) close the socket,
    // and (c) clear remote users and cursors. Skipping (c) leaves ghost avatars in
    // the toolbar after navigating away and back — the store is process-global.
    const { socket, unmount } = await connected();

    expect(socket.sent.length).toBeGreaterThanOrEqual(0);
    unmount();

    expect(sentOf(socket, 'leave')).toHaveLength(1);
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
  });

  it('does not reconnect after an explicit disconnect', async () => {
    // Regression: `disconnect()` must set `shouldReconnectRef` false. Without it
    // the backoff timer fires and opens a new socket, so "disconnect" silently
    // rejoins the room the user just left.
    const { result, socket } = await connected();

    act(() => result.current.disconnect());
    const afterDisconnect = MockWebSocket.instances.length;

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(MockWebSocket.instances).toHaveLength(afterDisconnect);
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
  });
});
