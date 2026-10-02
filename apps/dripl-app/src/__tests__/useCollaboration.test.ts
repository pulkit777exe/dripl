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
    act(() => vi.advanceTimersByTime(50));
    // Same version re-broadcast is a no-op: the version-aware delta skips it
    // instead of over-sending a reference-different twin.
    expect(first.sent.map(item => JSON.parse(item).type)).toEqual(['join']);

    // A genuine version bump still sends while online.
    act(() => result.current.broadcastElements([element(2)]));
    act(() => vi.advanceTimersByTime(50));
    expect(first.sent.map(item => JSON.parse(item).type)).toEqual(['join', 'scene-delta']);

    act(() => first.close());
    const sentBeforeDisconnect = first.sent.length;
    act(() => {
      result.current.broadcastElements([element(3)]);
      vi.advanceTimersByTime(50);
    });
    expect(first.sent).toHaveLength(sentBeforeDisconnect);

    act(() => vi.advanceTimersByTime(1_000));
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
    act(() => vi.advanceTimersByTime(1_000));
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
    act(() => vi.advanceTimersByTime(50));
    expect(socket.sent.map(item => JSON.parse(item).type)).toEqual(['join']);

    act(() => socket.receive(syncMessage()));
    act(() => vi.advanceTimersByTime(50));
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
