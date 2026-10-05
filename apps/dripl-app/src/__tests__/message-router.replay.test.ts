import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { useCanvasStore } from '@/lib/store';
import { routeCollabMessage, type MessageRouterContext } from '@/lib/collab/messageRouter';
import type { ServerMessage } from '@/lib/collab/protocol';

/**
 * Reconnect recovery and self-presence in the collaboration router.
 *
 * Two things happen exactly once per authoritative sync, and both are about
 * *not resurrecting* or *not duplicating*: the snapshot's own user must not be
 * echoed back into presence, and a locally-held pending scene must be filtered
 * against the server's ids before it is re-broadcast. The legacy `scene-update`
 * receiver is here too because it is the one path that reports a whole packet
 * as an add batch.
 */

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

function stubContext(): MessageRouterContext {
  const store = useCanvasStore.getState();
  return {
    activeUserIdRef: { current: 'me' },
    prevElementsRef: { current: [] },
    isFirstSyncRef: { current: true },
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
  };
}

/** A server snapshot with no elements, so every local id is server-unknown. */
const emptySync: ServerMessage = { type: 'sync_room_state', elements: [], users: [] };

describe('routeCollabMessage — self-presence in a sync snapshot', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      isConnected: false,
      remoteUsers: new Map(),
      remoteCursors: new Map(),
      readOnly: false,
      elements: [],
    });
  });

  it('does not draw the local user own cursor from the snapshot', () => {
    const ctx = stubContext();
    routeCollabMessage(
      {
        type: 'sync_room_state',
        elements: [],
        users: [{ userId: 'other', displayName: 'Bo', color: '#0f0' }],
        cursors: [
          { userId: 'me', x: 1, y: 1, displayName: 'Me', color: '#fff' },
          { userId: 'other', x: 2, y: 3, displayName: 'Bo', color: '#0f0' },
        ],
        yourUserId: 'me',
      },
      ctx
    );

    const state = useCanvasStore.getState();
    // Self is excluded from both presence maps; the peer is not.
    expect(state.remoteCursors.has('me')).toBe(false);
    expect(state.remoteCursors.get('other')).toMatchObject({ x: 2, y: 3, userName: 'Bo' });
    expect(state.remoteUsers.has('me')).toBe(false);
    expect(state.remoteUsers.has('other')).toBe(true);
  });

  it('excludes the local user by the id the server assigned, not the local one', () => {
    // The snapshot's `yourUserId` wins over the ref the router was seeded with,
    // so the exclusion has to be tested with the two disagreeing — otherwise a
    // filter on the stale id would pass this test too.
    const ctx = stubContext();
    routeCollabMessage(
      {
        type: 'sync_room_state',
        elements: [],
        users: [{ userId: 'stale-local-id', displayName: 'Me', color: '#fff' }],
        cursors: [{ userId: 'server-side-id', x: 1, y: 1, displayName: 'Me', color: '#fff' }],
        yourUserId: 'server-side-id',
      },
      ctx
    );

    const state = useCanvasStore.getState();
    expect(ctx.activeUserIdRef.current).toBe('server-side-id');
    expect(state.remoteCursors.has('server-side-id')).toBe(false);
    expect(state.remoteUsers.has('stale-local-id')).toBe(true);
  });

  it('ignores a join for the local user without touching the store', () => {
    const ctx = stubContext();
    const before = useCanvasStore.getState().remoteUsers;

    const handled = routeCollabMessage(
      { type: 'user-join', userId: 'me', displayName: 'Me', color: '#fff' },
      ctx
    );

    // Handled (so the socket does not log it as unrecognised) but inert.
    expect(handled).toBe(true);
    expect(useCanvasStore.getState().remoteUsers).toBe(before);
    expect(useCanvasStore.getState().remoteUsers.has('me')).toBe(false);
  });

  it('still admits a peer join in the same session', () => {
    // The working direction of the guard above: without it, "ignore self" could
    // be satisfied by "ignore every join".
    const ctx = stubContext();
    routeCollabMessage(
      { type: 'user-join', userId: 'peer', displayName: 'Cy', color: '#00f' },
      ctx
    );
    expect(useCanvasStore.getState().remoteUsers.has('peer')).toBe(true);
  });

  it('names a peer by its legacy userName, and an anonymous one Guest', () => {
    const ctx = stubContext();
    routeCollabMessage(
      {
        type: 'sync_room_state',
        elements: [],
        users: [
          { userId: 'legacy', userName: 'Old Name', color: '#0f0' },
          { userId: 'anon', color: '#0f0' },
        ],
        cursors: [
          { userId: 'legacy', x: 1, y: 1, userName: 'Old Name', color: '#0f0' },
          { userId: 'anon', x: 2, y: 2, color: '#0f0' },
        ],
      },
      ctx
    );

    const state = useCanvasStore.getState();
    // `displayName ?? userName ?? 'Guest'`: each fallback has to be reachable,
    // and no name at all still has to render as something.
    expect(state.remoteUsers.get('legacy')?.userName).toBe('Old Name');
    expect(state.remoteUsers.get('anon')?.userName).toBe('Guest');
    expect(state.remoteCursors.get('legacy')?.userName).toBe('Old Name');
    expect(state.remoteCursors.get('anon')?.userName).toBe('Guest');
  });

  it('prefers displayName over userName when both are present', () => {
    const ctx = stubContext();
    routeCollabMessage(
      {
        type: 'sync_room_state',
        elements: [],
        users: [{ userId: 'both', userName: 'legacy', displayName: 'Modern', color: '#0f0' }],
      },
      ctx
    );
    expect(useCanvasStore.getState().remoteUsers.get('both')?.userName).toBe('Modern');
  });
});

describe('routeCollabMessage — read-only flag', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      isConnected: false,
      remoteUsers: new Map(),
      remoteCursors: new Map(),
      readOnly: false,
      elements: [],
    });
  });

  it('applies an explicit readOnly flag from the snapshot', () => {
    // Guarded on `typeof === 'boolean'`, so both values are applied — this is
    // not a truthiness check that `false` would slip through.
    routeCollabMessage(
      { type: 'sync_room_state', elements: [], users: [], readOnly: true },
      stubContext()
    );
    expect(useCanvasStore.getState().readOnly).toBe(true);

    routeCollabMessage(
      { type: 'sync_room_state', elements: [], users: [], readOnly: false },
      stubContext()
    );
    expect(useCanvasStore.getState().readOnly).toBe(false);
  });

  it('leaves the current read-only state alone when the server sends no flag', () => {
    useCanvasStore.setState({ readOnly: true });
    routeCollabMessage({ type: 'sync_room_state', elements: [], users: [] }, stubContext());
    // The field is optional; omitting it must not silently unlock the editor.
    expect(useCanvasStore.getState().readOnly).toBe(true);
  });
});

describe('routeCollabMessage — pending snapshot after a sync', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      isConnected: false,
      remoteUsers: new Map(),
      remoteCursors: new Map(),
      readOnly: false,
      elements: [],
    });
  });

  it('flushes the pending snapshot when the server still has its elements', () => {
    const ctx = stubContext();
    // `known` is on both sides, so it is a real pending edit rather than a
    // resurrection — the direction in which a flush is correct.
    ctx.prevElementsRef.current = [el('known')];
    ctx.pendingElementsRef.current = [el('known', 9)];

    routeCollabMessage({ type: 'sync_room_state', elements: [el('known')], users: [] }, ctx);

    expect(ctx.pendingElementsRef.current).toEqual([el('known', 9)]);
    expect(vi.mocked(ctx.flushElementBroadcast)).toHaveBeenCalledTimes(1);
  });

  it('clears the pending snapshot when the server has none of it left', () => {
    const ctx = stubContext();
    // `gone` was in our last local snapshot and is absent from the server's.
    ctx.prevElementsRef.current = [el('gone')];
    ctx.pendingElementsRef.current = [el('gone')];

    routeCollabMessage(emptySync, ctx);

    // Nulled, so a later coalesce cannot re-broadcast a server-side deletion.
    expect(ctx.pendingElementsRef.current).toBeNull();
    // And no flush: that would broadcast nothing while still waking the
    // outbound path on every sync.
    expect(vi.mocked(ctx.flushElementBroadcast)).not.toHaveBeenCalled();
  });

  it('leaves an already-null pending snapshot alone', () => {
    const ctx = stubContext();
    routeCollabMessage(emptySync, ctx);

    expect(ctx.pendingElementsRef.current).toBeNull();
    expect(vi.mocked(ctx.flushElementBroadcast)).not.toHaveBeenCalled();
  });

  it('keeps an element the local snapshot never had', () => {
    // The opposite of the resurrection case: something created offline is not
    // in `previousIds`, so it is not the server's job to have deleted it.
    const ctx = stubContext();
    ctx.pendingElementsRef.current = [el('brand-new')];

    routeCollabMessage(emptySync, ctx);

    expect(ctx.pendingElementsRef.current).toEqual([el('brand-new')]);
    expect(vi.mocked(ctx.flushElementBroadcast)).toHaveBeenCalledTimes(1);
  });
});

describe('routeCollabMessage — legacy scene-update receiver', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      isConnected: false,
      remoteUsers: new Map(),
      remoteCursors: new Map(),
      readOnly: false,
      elements: [el('local')],
    });
  });

  it('merges an init packet as an add batch and refreshes the baseline', () => {
    const ctx = stubContext();
    ctx.isFirstSyncRef.current = false;

    const handled = routeCollabMessage(
      { type: 'scene-update', subtype: 'init', elements: [el('remote')] },
      ctx
    );

    expect(handled).toBe(true);
    // A merge, not a replacement: everything is reported as *added* and no
    // delete is implied, so nothing local is dropped by an init packet.
    expect(vi.mocked(ctx.onRemoteElementsRef.current)).toHaveBeenCalledWith([el('remote')], [], []);
    expect(ctx.prevElementsRef.current).toBe(useCanvasStore.getState().elements);
  });

  it('merges an update packet the same way', () => {
    const ctx = stubContext();
    ctx.isFirstSyncRef.current = false;
    const baseline = [el('local')];
    ctx.prevElementsRef.current = baseline;

    const handled = routeCollabMessage(
      { type: 'scene-update', subtype: 'update', elements: [el('remote', 2)] },
      ctx
    );

    expect(handled).toBe(true);
    expect(vi.mocked(ctx.onRemoteElementsRef.current)).toHaveBeenCalledWith(
      [el('remote', 2)],
      [],
      []
    );
    // The baseline is *replaced* by the store's scene even though the packet was
    // treated as a delta, so identity does not survive the hop.
    expect(ctx.prevElementsRef.current).not.toBe(baseline);
    expect(ctx.prevElementsRef.current).toBe(useCanvasStore.getState().elements);
  });

  it('treats an empty legacy packet as handled without touching the merge', () => {
    const ctx = stubContext();
    const baseline = [el('local')];
    ctx.prevElementsRef.current = baseline;

    expect(routeCollabMessage({ type: 'scene-update', subtype: 'update', elements: [] }, ctx)).toBe(
      true
    );
    // The legacy path always refreshes the baseline, even for an empty batch.
    expect(ctx.prevElementsRef.current).not.toBe(baseline);
  });
});
