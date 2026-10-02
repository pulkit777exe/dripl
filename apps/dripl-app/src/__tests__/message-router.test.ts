import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import type { DriplElement } from '@dripl/common';
import { routeCollabMessage, type MessageRouterContext } from '@/lib/collab/messageRouter';
import type { ClientMessage, ServerMessage } from '@/lib/collab/protocol';

const el = (id: string, version = 1): DriplElement =>
  ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version,
    versionNonce: version,
  }) as DriplElement;

function stubContext(overrides: Partial<MessageRouterContext> = {}): MessageRouterContext {
  const store = useCanvasStore.getState();
  return {
    activeUserIdRef: { current: 'user-1' },
    prevElementsRef: { current: [] },
    isFirstSyncRef: { current: true },
    offlineQueueRef: { current: [] },
    pendingElementsRef: { current: null },
    followedUserIdRef: { current: null },
    onRemoteElementsRef: { current: vi.fn() },
    onFullSyncRef: { current: vi.fn() },
    setUserId: store.setUserId,
    setIsStoreConnected: store.setIsConnected,
    setRemoteUsers: store.setRemoteUsers,
    updateRemoteCursor: store.updateRemoteCursor,
    addRemoteUser: store.addRemoteUser,
    removeRemoteUser: store.removeRemoteUser,
    setElementLock: store.setElementLock,
    releaseElementLock: store.releaseElementLock,
    flushElementBroadcast: vi.fn(),
    sendText: vi.fn(),
    isSocketOpen: () => true,
    ...overrides,
  };
}

function route(message: ServerMessage, ctx: MessageRouterContext): boolean {
  return routeCollabMessage(message, ctx);
}

describe('routeCollabMessage sync', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      isConnected: false,
      remoteUsers: new Map(),
      remoteCursors: new Map(),
      readOnly: false,
    });
  });

  it('applies the authoritative snapshot and replays the offline queue', () => {
    const ctx = stubContext();
    const queued: ClientMessage = {
      type: 'scene-delta',
      added: [el('fresh')],
      clientMsgId: 'm1',
    };
    ctx.offlineQueueRef.current = [{ msg: queued, timestamp: 1 }];
    ctx.pendingElementsRef.current = [el('fresh')];

    const handled = route(
      {
        type: 'sync_room_state',
        elements: [el('a')],
        users: [{ userId: 'user-2', displayName: 'Bo', color: '#00ff00' }],
        cursors: [{ userId: 'user-2', x: 1, y: 2, displayName: 'Bo', color: '#00ff00' }],
        yourUserId: 'user-9',
        readOnly: true,
      },
      ctx
    );

    expect(handled).toBe(true);
    expect(ctx.onFullSyncRef.current).toHaveBeenCalledWith([el('a')]);
    expect(ctx.prevElementsRef.current).toEqual([el('a')]);
    expect(ctx.isFirstSyncRef.current).toBe(false);
    expect(ctx.activeUserIdRef.current).toBe('user-9');
    expect(useCanvasStore.getState().readOnly).toBe(true);
    // Queued + pending replay went out on the open socket.
    expect(ctx.sendText).toHaveBeenCalled();
    expect(ctx.flushElementBroadcast).toHaveBeenCalled();
    expect(ctx.offlineQueueRef.current).toEqual([]);
    // Presence landed in the store, excluding self.
    expect(useCanvasStore.getState().remoteUsers.has('user-2')).toBe(true);
    expect(useCanvasStore.getState().remoteCursors.get('user-2')?.x).toBe(1);
  });

  it('drops queued updates for server-deleted ids', () => {
    const ctx = stubContext();
    ctx.prevElementsRef.current = [el('gone')];
    ctx.offlineQueueRef.current = [
      { msg: { type: 'scene-delta', updated: [el('gone', 2)], clientMsgId: 'm2' }, timestamp: 1 },
    ];
    route({ type: 'sync_room_state', elements: [], users: [] }, ctx);
    // The stale update is filtered out; what (if anything) goes out carries
    // no reference to the deleted id — no resurrection.
    const sent = (ctx.sendText as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      ([text]) => JSON.parse(text as string) as { added?: unknown[]; updated?: unknown[] }
    );
    for (const msg of sent) {
      expect(msg.added ?? []).toEqual([]);
      expect(msg.updated ?? []).toEqual([]);
    }
  });
});

describe('routeCollabMessage deltas and presence', () => {
  it('merges scene deltas and refreshes the baseline', () => {
    const ctx = stubContext();
    ctx.isFirstSyncRef.current = false;
    useCanvasStore.setState({ elements: [el('a')], elementsById: new Map([['a', el('a')]]) });
    const handled = route({ type: 'scene-delta', added: [el('b')], deleted: ['a'] }, ctx);
    expect(handled).toBe(true);
    expect(ctx.onRemoteElementsRef.current).toHaveBeenCalledWith([el('b')], [], ['a']);
    expect(ctx.prevElementsRef.current).toEqual(useCanvasStore.getState().elements);
  });

  it('ignores empty deltas without touching the baseline', () => {
    const ctx = stubContext();
    const baseline = [el('a')];
    ctx.prevElementsRef.current = baseline;
    expect(route({ type: 'scene-delta' }, ctx)).toBe(true);
    expect(ctx.onRemoteElementsRef.current).not.toHaveBeenCalled();
    expect(ctx.prevElementsRef.current).toBe(baseline);
  });

  it('tracks cursors, joins, leaves, and locks', () => {
    const ctx = stubContext();
    expect(
      route(
        { type: 'cursor-move', userId: 'u2', x: 3, y: 4, displayName: 'Bo', color: '#00ff00' },
        ctx
      )
    ).toBe(true);
    expect(useCanvasStore.getState().remoteCursors.get('u2')?.x).toBe(3);

    expect(
      route({ type: 'user-join', userId: 'u3', displayName: 'Cy', color: '#0000ff' }, ctx)
    ).toBe(true);
    expect(useCanvasStore.getState().remoteUsers.get('u3')?.userName).toBe('Cy');

    expect(route({ type: 'user-leave', userId: 'u3' }, ctx)).toBe(true);
    expect(useCanvasStore.getState().remoteUsers.has('u3')).toBe(false);

    expect(route({ type: 'element-lock', elementId: 'a', userId: 'u2' }, ctx)).toBe(true);
    expect(useCanvasStore.getState().elementLocks.get('a')).toBe('u2');
    expect(route({ type: 'element-unlock', elementId: 'a', userId: 'u2' }, ctx)).toBe(true);
    expect(useCanvasStore.getState().elementLocks.has('a')).toBe(false);
  });

  it('ignores its own cursor and applies followed viewports only', () => {
    const ctx = stubContext();
    expect(
      route(
        { type: 'cursor-move', userId: 'user-1', x: 9, y: 9, displayName: 'Me', color: '#fff' },
        ctx
      )
    ).toBe(true);
    expect(useCanvasStore.getState().remoteCursors.has('user-1')).toBe(false);

    ctx.followedUserIdRef.current = 'u9';
    expect(route({ type: 'viewport-update', userId: 'u2', panX: 1, panY: 2, zoom: 3 }, ctx)).toBe(
      true
    );
    expect(useCanvasStore.getState().zoom).not.toBe(3);
    expect(route({ type: 'viewport-update', userId: 'u9', panX: 5, panY: 6, zoom: 3 }, ctx)).toBe(
      true
    );
    expect(useCanvasStore.getState().panX).toBe(5);
    expect(useCanvasStore.getState().panY).toBe(6);
    expect(useCanvasStore.getState().zoom).toBe(3);
  });

  it('returns false for stateless frames', () => {
    const ctx = stubContext();
    expect(route({ type: 'pong' }, ctx)).toBe(false);
    expect(route({ type: 'error', message: 'nope' }, ctx)).toBe(false);
  });
});
