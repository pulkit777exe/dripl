import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';

/**
 * `useCollaboration` owns the socket, so it is replaced by a controllable
 * double. Everything this suite asserts — tombstone suppression, remote-echo
 * suppression, the read-only-until-sync guard, gesture-lock mirroring — lives
 * in `useCanvasSync` itself.
 */
const collab = vi.hoisted(() => ({
  options: null as {
    onFullSync?: (elements: DriplElement[]) => void;
    onRemoteElements?: (added: DriplElement[], updated: DriplElement[], deleted: string[]) => void;
    displayName?: string | null;
    shareToken?: string | null;
  } | null,
  broadcastElements: vi.fn(),
  broadcastCursor: vi.fn(),
  lockElement: vi.fn(),
  unlockElement: vi.fn(),
  heartbeatLockElement: vi.fn(),
  collaborators: [] as unknown[],
  isConnected: false,
  connectionMessage: 'Reconnecting...',
}));

vi.mock('@/hooks/useCollaboration', () => ({
  useCollaboration: (_roomId: string | null, options: typeof collab.options) => {
    collab.options = options;
    return {
      collaborators: collab.collaborators,
      broadcastElements: collab.broadcastElements,
      broadcastCursor: collab.broadcastCursor,
      lockElement: collab.lockElement,
      unlockElement: collab.unlockElement,
      heartbeatLockElement: collab.heartbeatLockElement,
      followUser: vi.fn(),
      unfollowUser: vi.fn(),
      broadcastViewport: vi.fn(),
      disconnect: vi.fn(),
      isConnected: collab.isConnected,
      connectionMessage: collab.connectionMessage,
    };
  },
}));

import { useCanvasStore } from '@/lib/store';
import { useCanvasSync } from '@/hooks/canvas/useCanvasSync';

function rect(id: string, version = 1): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    version,
    versionNonce: 1,
    updated: 1,
  } as DriplElement;
}

function seed(elements: DriplElement[] = []) {
  useCanvasStore.setState({
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    elementLocks: new Map(),
    readOnly: false,
    userId: 'me',
    draftElement: null,
    past: [],
    future: [],
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
  });
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
}

interface Props {
  roomSlug: string | null;
  shareToken: string | null;
}

function setup(options: { roomSlug?: string | null; shareToken?: string | null } = {}) {
  return renderHook(
    (props: Props) => {
      // Subscribe the way RoughCanvas does, so store writes actually reach the
      // hook's `elements` prop and its broadcast effect runs.
      const elements = useCanvasStore(state => state.elements);
      return useCanvasSync({
        roomSlug: props.roomSlug,
        shareToken: props.shareToken,
        displayName: 'Ada',
        elements,
      });
    },
    {
      initialProps: {
        // `??` would turn an explicit null back into the default room.
        roomSlug: options.roomSlug === undefined ? 'room-1' : options.roomSlug,
        shareToken: options.shareToken ?? null,
      },
    }
  );
}

beforeEach(() => {
  collab.broadcastElements.mockClear();
  collab.broadcastCursor.mockClear();
  collab.lockElement.mockClear();
  collab.unlockElement.mockClear();
  collab.heartbeatLockElement.mockClear();
  collab.options = null;
  collab.isConnected = false;
  seed();
});

describe('useCanvasSync initial-sync guard', () => {
  it('forces read-only until the server has sent a full sync', () => {
    setup();
    expect(useCanvasStore.getState().readOnly).toBe(true);
  });

  it('leaves a local canvas writable', () => {
    setup({ roomSlug: null });
    expect(useCanvasStore.getState().readOnly).toBe(false);
  });

  it('re-arms read-only on every reconnect until a sync has arrived', () => {
    const { rerender } = setup();
    expect(useCanvasStore.getState().readOnly).toBe(true);

    act(() => {
      collab.isConnected = true;
      rerender({ roomSlug: 'room-1', shareToken: null });
    });
    // The hook only ever *raises* readOnly; the server's own readOnly flag
    // (applied inside useCollaboration when room-state lands) lowers it.
    act(() => {
      useCanvasStore.getState().setReadOnly(false);
    });
    expect(useCanvasStore.getState().readOnly).toBe(false);

    // A reconnect before any sync arrived must re-arm the guard.
    act(() => {
      collab.isConnected = false;
      rerender({ roomSlug: 'room-1', shareToken: null });
    });
    expect(useCanvasStore.getState().readOnly).toBe(true);
  });

  it('leaves read-only alone once a sync has arrived', () => {
    const { rerender } = setup();

    act(() => {
      collab.options?.onFullSync?.([rect('a')]);
      collab.isConnected = true;
    });
    // Stand in for the server's readOnly flag arriving with room-state.
    act(() => {
      useCanvasStore.getState().setReadOnly(false);
    });
    act(() => {
      collab.isConnected = true;
      collab.connectionMessage = 'Connected';
      rerender({ roomSlug: 'room-1', shareToken: null });
    });

    expect(useCanvasStore.getState().readOnly).toBe(false);
    expect(useCanvasStore.getState().elements.map(el => el.id)).toEqual(['a']);
  });

  it('applies the full sync without adding an undo step', () => {
    seed([rect('local')]);
    setup();
    const before = useCanvasStore.getState().past.length;

    act(() => {
      collab.options?.onFullSync?.([rect('remote')]);
    });

    expect(useCanvasStore.getState().elements.map(el => el.id)).toEqual(['remote']);
    expect(useCanvasStore.getState().past.length).toBe(before);
  });
});

describe('useCanvasSync broadcast', () => {
  it('broadcasts nothing outside a room', () => {
    setup({ roomSlug: null });
    expect(collab.broadcastElements).not.toHaveBeenCalled();
  });

  it('broadcasts local changes once', () => {
    // The broadcast runs from an effect keyed on the element array, so the
    // store write itself is enough to drive it.
    const { rerender } = setup();
    collab.broadcastElements.mockClear();

    act(() => {
      useCanvasStore.getState().setElements([rect('a')], { skipHistory: true });
    });
    act(() => {
      rerender({ roomSlug: 'room-1', shareToken: null });
    });

    expect(collab.broadcastElements).toHaveBeenCalledTimes(1);
    const sent = collab.broadcastElements.mock.calls[0]![0] as DriplElement[];
    expect(sent.map(el => el.id)).toEqual(['a']);
  });

  it('does not echo a remote-applied change back to the server', () => {
    setup();
    // The full sync is itself a remote change.
    act(() => {
      collab.options?.onFullSync?.([rect('a')]);
    });
    collab.broadcastElements.mockClear();

    // One remote-applied update only: the suppression flag is single-shot, so
    // the very next local edit must still reach the wire.
    act(() => {
      collab.options?.onRemoteElements?.([], [{ ...rect('a', 2), x: 7 } as DriplElement], []);
    });
    expect(collab.broadcastElements).not.toHaveBeenCalled();

    act(() => {
      useCanvasStore.getState().updateElement('a', { x: 99 });
    });
    expect(collab.broadcastElements).toHaveBeenCalledTimes(1);
    expect(collab.broadcastElements.mock.calls[0]![0][0]!.x).toBe(99);
  });
});

describe('useCanvasSync remote deltas', () => {
  it('applies remote adds, updates and deletes', () => {
    setup();
    act(() => {
      collab.options?.onFullSync?.([rect('a'), rect('b')]);
    });

    act(() => {
      collab.options?.onRemoteElements?.(
        [rect('c')],
        [{ ...rect('a', 5), x: 42 } as DriplElement],
        ['b']
      );
    });

    const byId = useCanvasStore.getState().elementsById;
    expect([...byId.keys()].sort()).toEqual(['a', 'c']);
    expect(byId.get('a')?.x).toBe(42);
  });

  it('never applies a delta to the in-progress draft', () => {
    setup();
    act(() => {
      useCanvasStore.setState({
        draftElement: { ...rect('draft'), id: 'draft' } as DriplElement,
      });
      collab.options?.onRemoteElements?.([{ ...rect('draft'), x: 999 } as DriplElement], [], []);
    });

    // The draft is the local user's in-flight shape and must survive.
    expect(useCanvasStore.getState().draftElement?.x).not.toBe(999);
    expect(useCanvasStore.getState().elementsById.has('draft')).toBe(false);
  });

  it('suppresses a remote update to an element locked by the local gesture', () => {
    const { result } = setup();
    act(() => {
      collab.options?.onFullSync?.([rect('a')]);
    });
    expect(useCanvasStore.getState().elementsById.get('a')?.x).toBe(0);

    // Hold a gesture lock on 'a', exactly as a drag would.
    act(() => {
      result.current.lockElementsForGesture(['a']);
    });

    // A remote peer moves it. Reconciliation must refuse to overwrite the
    // element the local user is actively dragging, or their drag jumps.
    act(() => {
      collab.options?.onRemoteElements?.([], [{ ...rect('a', 9), x: 777 } as DriplElement], []);
    });

    expect(useCanvasStore.getState().elementsById.get('a')?.x).toBe(0);
  });

  it('applies a remote update to an element that is not gesture-locked', () => {
    const { result } = setup();
    act(() => {
      collab.options?.onFullSync?.([rect('a'), rect('b')]);
    });

    act(() => {
      result.current.lockElementsForGesture(['a']);
    });
    act(() => {
      collab.options?.onRemoteElements?.(
        [],
        [{ ...rect('a', 9), x: 777 } as DriplElement, { ...rect('b', 9), x: 555 } as DriplElement],
        []
      );
    });

    const byId = useCanvasStore.getState().elementsById;
    expect(byId.get('a')?.x).toBe(0);
    expect(byId.get('b')?.x).toBe(555);
  });

  it('releases the gesture lock after the gesture so later remotes land', () => {
    const { result } = setup();
    act(() => {
      collab.options?.onFullSync?.([rect('a')]);
    });
    act(() => {
      result.current.lockElementsForGesture(['a']);
    });

    act(() => {
      result.current.unlockGestureElements();
    });
    act(() => {
      collab.options?.onRemoteElements?.([], [{ ...rect('a', 9), x: 777 } as DriplElement], []);
    });

    expect(useCanvasStore.getState().elementsById.get('a')?.x).toBe(777);
  });
});

describe('useCanvasSync tombstone suppression', () => {
  it('refuses to resurrect a locally deleted element from a stale remote add', () => {
    const { rerender } = setup();
    act(() => {
      collab.options?.onFullSync?.([rect('a'), rect('b')]);
    });

    // Local delete of 'a'.
    act(() => {
      useCanvasStore.getState().deleteElements(['a']);
    });
    act(() => {
      rerender({ roomSlug: 'room-1', shareToken: null });
    });
    expect(useCanvasStore.getState().elementsById.has('a')).toBe(false);

    // A racing remote add for the same id must not bring it back.
    act(() => {
      collab.options?.onRemoteElements?.([rect('a')], [], []);
    });

    expect(useCanvasStore.getState().elementsById.has('a')).toBe(false);
    expect(useCanvasStore.getState().elements.map(el => el.id)).toEqual(['b']);
  });

  it('refuses to resurrect an element the server deleted', () => {
    setup();
    act(() => {
      collab.options?.onFullSync?.([rect('a')]);
    });
    act(() => {
      collab.options?.onRemoteElements?.([], [], ['a']);
    });
    expect(useCanvasStore.getState().elementsById.has('a')).toBe(false);

    act(() => {
      collab.options?.onRemoteElements?.([rect('a')], [], []);
    });

    expect(useCanvasStore.getState().elementsById.has('a')).toBe(false);
  });

  it('lets a full sync resurrect an id, since the server is authoritative', () => {
    setup();
    act(() => {
      collab.options?.onFullSync?.([rect('a')]);
    });
    act(() => {
      collab.options?.onRemoteElements?.([], [], ['a']);
    });
    expect(useCanvasStore.getState().elementsById.has('a')).toBe(false);

    // Explicit restore: the authoritative full sync clears the marker.
    act(() => {
      collab.options?.onFullSync?.([rect('a')]);
    });

    expect(useCanvasStore.getState().elementsById.has('a')).toBe(true);
  });

  it('drops tombstone markers when the room changes', () => {
    const { rerender } = setup();
    act(() => {
      collab.options?.onFullSync?.([rect('a')]);
    });
    act(() => {
      useCanvasStore.getState().deleteElements(['a']);
    });
    act(() => {
      rerender({ roomSlug: 'room-1', shareToken: null });
    });
    act(() => {
      collab.options?.onRemoteElements?.([], [], ['a']);
    });
    expect(useCanvasStore.getState().elementsById.has('a')).toBe(false);

    act(() => {
      rerender({ roomSlug: 'room-2', shareToken: null });
    });
    // Ids are scoped to one scene, so a fresh room may reuse them.
    act(() => {
      collab.options?.onRemoteElements?.([rect('a')], [], []);
    });

    expect(useCanvasStore.getState().elementsById.has('a')).toBe(true);
  });
});

describe('useCanvasSync gesture locks', () => {
  it('mirrors local locks to the collaboration layer and releases them', () => {
    const { result } = setup();

    act(() => {
      result.current.lockElementsForGesture(['a', 'b']);
    });
    expect(collab.lockElement).toHaveBeenCalledTimes(2);

    act(() => {
      result.current.unlockGestureElements();
    });
    expect(collab.unlockElement).toHaveBeenCalledTimes(2);
  });

  it('exposes the connected collaborators for the canvas chrome', () => {
    collab.isConnected = true;
    collab.connectionMessage = 'Connected';
    collab.collaborators = [{ userId: 'peer', userName: 'Bo', color: '#fff' }];

    const { result } = setup();

    expect(result.current.isConnected).toBe(true);
    expect(result.current.connectionMessage).toBe('Connected');
    expect(result.current.collaborators).toHaveLength(1);
  });

  it('passes the display name and share token to the collaboration layer', () => {
    setup({ shareToken: 'tok-123' });
    expect(collab.options?.displayName).toBe('Ada');
    expect(collab.options?.shareToken).toBe('tok-123');
  });
});
