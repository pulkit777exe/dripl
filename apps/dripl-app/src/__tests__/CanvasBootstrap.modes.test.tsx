import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { logError, logWarn } from '@dripl/common';
import type { DriplElement } from '@dripl/common';

/**
 * The three bootstrap modes, driven through the real store.
 *
 * `CanvasBootstrap` picks where a scene comes from — IndexedDB, localStorage, or a
 * file payload — and each source has a rule that is easy to get backwards:
 *
 *   local: IndexedDB wins outright, because it is the *newer* copy. Reading
 *          localStorage as well would silently discard later edits, which is the
 *          defect the IndexedDB mirror exists to prevent.
 *   room:  a fresh authenticated room must be blanked, because the global store
 *          still holds the previous canvas. A shared *file* link must not be
 *          blanked — its scene has already been decrypted.
 *   file:  an existing local scene must not be clobbered without asking.
 *
 * `CanvasBootstrap.fileSceneKey.test.tsx` covers the commit-loop key and
 * `CanvasBootstrap.loop.test.tsx` covers the store-write storm, so neither is
 * repeated here. The real store is used because these modes are entirely about
 * what ends up in it.
 */

const loadCanvasFromIndexedDB = vi.fn();
const saveCanvasToIndexedDB = vi.fn();
const loadLocalCanvasFromStorage = vi.fn();
const loadInitialScene = vi.fn();
const startPerformanceObservers = vi.fn();

vi.mock('@dripl/common', async importOriginal => ({
  ...(await importOriginal<typeof import('@dripl/common')>()),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: mockResolvedTheme }),
}));

vi.mock('@/components/canvas/RoughCanvas', () => ({ default: () => <div data-testid="canvas" /> }));
vi.mock('@/components/canvas/CanvasErrorBoundary', () => ({
  CanvasErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/canvas-db', () => ({
  saveCanvasToIndexedDB: (...args: unknown[]) => saveCanvasToIndexedDB(...args),
  loadCanvasFromIndexedDB: (...args: unknown[]) => loadCanvasFromIndexedDB(...args),
}));

vi.mock('@/utils/localCanvasStorage', () => ({
  loadLocalCanvasFromStorage: () => loadLocalCanvasFromStorage(),
}));

vi.mock('@/lib/scene-loader', () => ({
  loadInitialScene: (...args: unknown[]) => loadInitialScene(...args),
}));

vi.mock('@/utils/performance-observers', () => ({
  startPerformanceObservers: () => startPerformanceObservers(),
}));

import { useCanvasStore } from '@/lib/store';
import { CanvasBootstrap } from '@/components/canvas/CanvasBootstrap';

let mockResolvedTheme = 'light';

function element(id: string): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    strokeColor: '#000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    updated: 1,
  } as DriplElement;
}

const emptyStorage = {
  elements: null,
  appState: null,
} as ReturnType<typeof loadLocalCanvasFromStorage>;

/** Drain the async bootstrap chain. */
async function settle() {
  for (let turn = 0; turn < 10; turn += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  mockResolvedTheme = 'light';
  loadCanvasFromIndexedDB.mockReset().mockResolvedValue(null);
  saveCanvasToIndexedDB.mockReset().mockResolvedValue(undefined);
  loadLocalCanvasFromStorage.mockReset().mockReturnValue(emptyStorage);
  loadInitialScene.mockReset().mockResolvedValue({ elements: [], appState: null });
  startPerformanceObservers.mockReset();
  // The logging spies are module-level, so they carry across tests
  // unless cleared here — which would make the 'no warning' control
  // fail on the previous test's call.
  vi.mocked(logWarn).mockClear();
  vi.mocked(logError).mockClear();
  document.body.innerHTML = '';
  useCanvasStore.setState({
    elements: [],
    selectedIds: new Set<string>(),
    isDrawing: false,
    roomSlug: null,
    readOnly: false,
    currentStrokeColor: '#1e1e1e',
    zoom: { value: 1 },
    panX: 0,
    panY: 0,
  } as never);
});

describe('CanvasBootstrap local mode', () => {
  it('prefers the IndexedDB copy and does not also read localStorage', async () => {
    // Regression: IndexedDB is written continuously after init while
    // localStorage is only written at save time, so IndexedDB is the newer scene.
    // Reading localStorage as a fallback *after* IndexedDB returned a non-empty
    // scene would overwrite those later edits with the older copy.
    loadCanvasFromIndexedDB.mockResolvedValue([element('from-idb')]);
    loadLocalCanvasFromStorage.mockReturnValue({
      elements: [element('from-localstorage')],
      appState: null,
    } as ReturnType<typeof loadLocalCanvasFromStorage>);

    render(<CanvasBootstrap mode="local" theme="light" />);
    await settle();

    const ids = useCanvasStore.getState().elements.map(e => e.id);
    expect(ids).toEqual(['from-idb']);
  });

  it('falls back to localStorage when IndexedDB has nothing', async () => {
    // Regression: the fallback is what runs when IndexedDB is unavailable at all
    // (private mode, or a first visit). Dropping it would leave the local canvas
    // permanently blank.
    loadLocalCanvasFromStorage.mockReturnValue({
      elements: [element('from-localstorage')],
      appState: null,
    } as ReturnType<typeof loadLocalCanvasFromStorage>);

    render(<CanvasBootstrap mode="local" theme="light" />);
    await settle();

    expect(useCanvasStore.getState().elements.map(e => e.id)).toEqual(['from-localstorage']);
  });

  it('restores the selection alongside the scene', async () => {
    // Regression: elements and `selectedIds` come from the same snapshot but are
    // written by two different calls. Restoring the scene without the selection
    // leaves a restored file where the user had things selected but nothing is.
    loadLocalCanvasFromStorage.mockReturnValue({
      elements: [element('a'), element('b')],
      appState: null,
      selectedIds: ['b'],
    } as ReturnType<typeof loadLocalCanvasFromStorage>);

    render(<CanvasBootstrap mode="local" theme="light" />);
    await settle();

    expect([...useCanvasStore.getState().selectedIds]).toEqual(['b']);
  });

  it('reports a truncated copy instead of letting it look complete', async () => {
    // Regression: localStorage has a size cap, so a large canvas is restored
    // partial. The warning exists so that is visible; dropping it means a user
    // sees a scene missing its last N elements with no indication why.
    loadLocalCanvasFromStorage.mockReturnValue({
      elements: [element('a')],
      appState: null,
      elementsTruncated: true,
      totalElements: 40,
    } as ReturnType<typeof loadLocalCanvasFromStorage>);

    render(<CanvasBootstrap mode="local" theme="light" />);
    await settle();

    expect(logWarn).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(vi.mocked(logWarn).mock.calls[0]![0] as string) as {
      event: string;
      restoredElements: number;
      totalElements: number;
    };
    expect(payload.event).toBe('local_canvas_truncated');
    // Both counts, so the log says how much is missing rather than just that
    // something was.
    expect(payload.restoredElements).toBe(1);
    expect(payload.totalElements).toBe(40);
  });

  it('says nothing about truncation when the copy was whole', async () => {
    // The control for the test above: a warning on every local open would be
    // noise that trains everyone to ignore it.
    loadLocalCanvasFromStorage.mockReturnValue({
      elements: [element('a')],
      appState: null,
    } as ReturnType<typeof loadLocalCanvasFromStorage>);

    render(<CanvasBootstrap mode="local" theme="light" />);
    await settle();

    expect(logWarn).not.toHaveBeenCalled();
  });

  it('restores the viewport and grid from the saved app state', async () => {
    // Regression: `applyAppStateToStore` is a separate call from the elements one,
    // so restoring the scene without it is entirely possible — and would drop the
    // user back at the default zoom on every visit.
    loadLocalCanvasFromStorage.mockReturnValue({
      elements: [],
      // The serialized form is a plain number, not the store's `{ value }`.
      appState: { zoom: 3, panX: 15, panY: -8, gridSize: 40 },
    } as unknown as ReturnType<typeof loadLocalCanvasFromStorage>);

    render(<CanvasBootstrap mode="local" theme="light" />);
    await settle();

    // The store's `zoom` is a plain number, clamped by `setZoom` to [0.1, 20].
    const store = useCanvasStore.getState();
    expect(store.zoom).toBe(3);
    expect(store.panX).toBe(15);
    expect(store.panY).toBe(-8);
  });

  it('mirrors later edits into IndexedDB once a stroke settles', async () => {
    // Regression: this used to run at initialization only, which let a stale
    // IndexedDB scene win on the next reload and silently discard everything
    // drawn since. It is debounced at 500ms and skipped mid-stroke, because
    // persisting every frame of a drag is the cost it is avoiding.
    vi.useFakeTimers();
    try {
      loadCanvasFromIndexedDB.mockResolvedValue(null);
      render(<CanvasBootstrap mode="local" theme="light" />);
      await act(async () => {
        await Promise.resolve();
      });

      saveCanvasFromStore([element('edited')]);
      await act(async () => {
        vi.advanceTimersByTime(501);
      });

      expect(saveCanvasToIndexedDB).toHaveBeenCalledWith('local-canvas', [
        expect.objectContaining({ id: 'edited' }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not persist mid-stroke', async () => {
    // Regression: `isDrawing` gates the mirror. Writing during a stroke would
    // capture a half-finished path, and IndexedDB would then serve that as the
    // scene on the next load.
    vi.useFakeTimers();
    try {
      render(<CanvasBootstrap mode="local" theme="light" />);
      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        useCanvasStore.setState({ isDrawing: true } as never);
      });
      saveCanvasFromStore([element('half-stroke')]);
      await act(async () => {
        vi.advanceTimersByTime(501);
      });

      expect(saveCanvasToIndexedDB).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

/** Push elements through the store, the way an edit does. */
function saveCanvasFromStore(elements: DriplElement[]) {
  act(() => {
    useCanvasStore.getState().setElements(elements, { skipHistory: true });
  });
}

describe('CanvasBootstrap room mode', () => {
  it('blanks a fresh authenticated room so the previous canvas cannot flash', async () => {
    // Regression: the global store still holds whatever canvas was open before.
    // Without this, joining a room renders the old canvas until the socket's
    // initial sync lands — which reads as your private work being shared with
    // everyone in the room.
    act(() => {
      useCanvasStore.getState().setElements([element('my-private-scene')], {
        skipHistory: true,
      });
    });

    render(<CanvasBootstrap mode="room" theme="light" roomSlug="design-review" />);
    await settle();

    expect(useCanvasStore.getState().elements).toEqual([]);
    expect(useCanvasStore.getState().selectedIds).toEqual(new Set());
  });

  it('leaves a shared file link intact', async () => {
    // The control for the guard above, and the one that would break if the check
    // were loosened to "any room mode". A shared *file* arrives already
    // validated and decrypted, so blanking it would leave a blank canvas that
    // the room snapshot cannot repair — the server stores only the encrypted
    // envelope, so it legitimately has no scene to send.
    act(() => {
      useCanvasStore.getState().setElements([element('decrypted-scene')], {
        skipHistory: true,
      });
    });

    render(<CanvasBootstrap mode="room" theme="light" roomSlug="share" shareToken="tok" />);
    await settle();

    expect(useCanvasStore.getState().elements.map(e => e.id)).toEqual(['decrypted-scene']);
  });

  it('does not read or write a scene of its own', async () => {
    // Regression: room mode's scene arrives over the socket. Touching either
    // durable store here would race that sync and could clobber it.
    render(<CanvasBootstrap mode="room" theme="light" roomSlug="a-room" />);
    await settle();

    expect(loadInitialScene).not.toHaveBeenCalled();
    expect(loadCanvasFromIndexedDB).not.toHaveBeenCalled();
    expect(loadLocalCanvasFromStorage).not.toHaveBeenCalled();
  });

  it('publishes the room slug to the store', async () => {
    // Regression: the socket layer reads `roomSlug` out of the store rather than
    // taking it as a prop, so failing to publish it leaves the canvas connected
    // to nothing while looking perfectly normal.
    render(<CanvasBootstrap mode="room" theme="light" roomSlug="design-review" />);
    await settle();

    expect(useCanvasStore.getState().roomSlug).toBe('design-review');
  });
});

describe('CanvasBootstrap file mode', () => {
  it('loads a file scene with nothing to lose, without asking', async () => {
    // Regression: the confirmation modal is gated on there being an existing
    // scene. Prompting on an empty canvas would block every share link behind a
    // dialog about replacing content that does not exist.
    loadInitialScene.mockResolvedValue({ elements: [element('from-file')], appState: null });

    render(
      <CanvasBootstrap mode="file" theme="light" initialData={{ elements: [], appState: null }} />
    );
    await settle();

    expect(useCanvasStore.getState().elements.map(e => e.id)).toEqual(['from-file']);
    expect(document.querySelector('.replace-btn')).toBeNull();
  });

  it('asks before replacing an existing scene, and replaces on confirm', async () => {
    // Regression: the whole point of the modal. Confirming must apply the file
    // scene; the guard is `initialElements.length > 0 && scene.elements.length > 0
    // && !replaceExisting`, and dropping any one of those three changes behaviour.
    act(() => {
      useCanvasStore.getState().setElements([element('mine')], { skipHistory: true });
    });
    loadInitialScene.mockResolvedValue({ elements: [element('theirs')], appState: null });

    render(
      <CanvasBootstrap mode="file" theme="light" initialData={{ elements: [], appState: null }} />
    );
    await settle();

    // Still mine: nothing has been applied while the question is open.
    expect(useCanvasStore.getState().elements.map(e => e.id)).toEqual(['mine']);

    const replace = document.querySelector('.replace-btn')!;
    await act(async () => {
      fireEvent.click(replace);
    });
    await settle();

    expect(useCanvasStore.getState().elements.map(e => e.id)).toEqual(['theirs']);
  });

  it('keeps the existing scene when the confirmation is cancelled', async () => {
    // Regression: cancelling must be a true no-op on the scene. It is also the
    // only path on which the loaded scene is discarded, so a cancel that still
    // applied it would be silent data loss.
    act(() => {
      useCanvasStore.getState().setElements([element('mine')], { skipHistory: true });
    });
    loadInitialScene.mockResolvedValue({ elements: [element('theirs')], appState: null });

    render(
      <CanvasBootstrap mode="file" theme="light" initialData={{ elements: [], appState: null }} />
    );
    await settle();

    const cancel = document.querySelector('.cancel-btn')!;
    await act(async () => {
      fireEvent.click(cancel);
    });
    await settle();

    expect(useCanvasStore.getState().elements.map(e => e.id)).toEqual(['mine']);
    // And the modal is gone, not left on screen.
    expect(document.querySelector('.replace-btn')).toBeNull();
  });

  it('cancels when the backdrop is clicked but a button is not', async () => {
    // Regression: the backdrop handler checks `e.target === modal`. Without that
    // check, a click on either button would bubble to the backdrop and cancel the
    // replace the user just confirmed.
    act(() => {
      useCanvasStore.getState().setElements([element('mine')], { skipHistory: true });
    });
    loadInitialScene.mockResolvedValue({ elements: [element('theirs')], appState: null });

    const { container } = render(
      <CanvasBootstrap mode="file" theme="light" initialData={{ elements: [], appState: null }} />
    );
    await settle();

    const modal = document.querySelector('.replace-btn')!.closest('div.fixed')!;
    await act(async () => {
      fireEvent.click(modal);
    });
    await settle();

    expect(useCanvasStore.getState().elements.map(e => e.id)).toEqual(['mine']);
    expect(container).toBeTruthy();
  });

  it('skips the confirmation when replaceExisting is set', async () => {
    // Regression: `replaceExisting` is how a shared-file link opens a scene into
    // a canvas that may still hold the previous one. It must replace outright —
    // a modal here is unreachable in intent and would strand the user.
    act(() => {
      useCanvasStore.getState().setElements([element('mine')], { skipHistory: true });
    });
    loadInitialScene.mockResolvedValue({ elements: [element('theirs')], appState: null });

    render(
      <CanvasBootstrap
        mode="file"
        theme="light"
        replaceExisting
        initialData={{ elements: [], appState: null }}
      />
    );
    await settle();

    expect(document.querySelector('.replace-btn')).toBeNull();
    expect(useCanvasStore.getState().elements.map(e => e.id)).toEqual(['theirs']);
  });

  it('applies an empty file scene so a stale canvas is not left showing', async () => {
    // Regression: an empty file is still a file. Skipping the write because
    // "there is nothing to load" would leave the previously opened canvas on
    // screen under the new file's name — the wrong document, silently.
    act(() => {
      useCanvasStore.getState().setElements([element('previous-file')], {
        skipHistory: true,
      });
    });
    loadInitialScene.mockResolvedValue({ elements: [], appState: null });

    render(
      <CanvasBootstrap
        mode="file"
        theme="light"
        replaceExisting
        initialData={{ elements: [], appState: null }}
      />
    );
    await settle();

    expect(useCanvasStore.getState().elements).toEqual([]);
  });

  it('logs a failed load and still leaves the spinner', async () => {
    // Regression: every read on this path is fallible — a corrupt payload, a
    // revoked grant, private-mode IndexedDB. An unhandled rejection left the user
    // on "Loading canvas..." for the rest of the session with nothing in the log.
    // The caller's requirement is both halves: report it, and end the spinner.
    loadInitialScene.mockRejectedValue(new Error('corrupt payload'));

    render(
      <CanvasBootstrap mode="file" theme="light" initialData={{ elements: [], appState: null }} />
    );
    await settle();

    expect(logError).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(vi.mocked(logError).mock.calls[0]![0] as string) as {
      event: string;
      mode: string;
      error: string;
    };
    expect(payload.event).toBe('canvas_bootstrap_failed');
    expect(payload.mode).toBe('file');
    expect(payload.error).toBe('corrupt payload');

    // An empty canvas the user can see and fix beats an infinite spinner.
    expect(screen.queryByText('Loading canvas...')).toBeNull();
    expect(screen.getByTestId('canvas')).toBeInTheDocument();
  });

  it('shows a loading state before the scene resolves', async () => {
    // Regression: `isInitialized` is the only thing standing between the user and
    // a blank canvas. Without it the RoughCanvas would mount over an empty store
    // and then visibly pop as the scene arrives.
    let release: (v: unknown) => void = () => {};
    loadInitialScene.mockReturnValue(
      new Promise(resolve => {
        release = resolve;
      })
    );

    render(
      <CanvasBootstrap mode="file" theme="light" initialData={{ elements: [], appState: null }} />
    );

    expect(screen.getByText('Loading canvas...')).toBeInTheDocument();
    expect(screen.queryByTestId('canvas')).toBeNull();

    await act(async () => {
      release({ elements: [element('late')], appState: null });
    });
    await settle();

    expect(screen.queryByText('Loading canvas...')).toBeNull();
  });
});

describe('CanvasBootstrap cross-cutting', () => {
  it('sets read-only on mount and clears it on unmount', async () => {
    // Regression: unmounting without clearing would leave the store read-only
    // forever, so every canvas after a shared-file visit is inert — and nothing
    // in the UI says why.
    const { unmount } = render(<CanvasBootstrap mode="local" theme="light" readOnly />);
    await settle();
    expect(useCanvasStore.getState().readOnly).toBe(true);

    unmount();
    expect(useCanvasStore.getState().readOnly).toBe(false);
  });

  it('leaves a writable mount writable', async () => {
    // The control for the test above: `readOnly` defaults false, and a default
    // that leaked `true` would make every canvas read-only.
    render(<CanvasBootstrap mode="local" theme="light" />);
    await settle();
    expect(useCanvasStore.getState().readOnly).toBe(false);
  });

  it('adapts the default stroke colour to the theme, but only when it is still a default', async () => {
    // Regression: the effect rewrites the stroke colour when it is one of the
    // three defaults, so a theme switch makes the drawing visible on a dark
    // canvas. It must not touch a colour the user chose — overwriting that would
    // silently discard a deliberate pick on every theme change.
    useCanvasStore.setState({ currentStrokeColor: '#1e1e1e' } as never);
    const { unmount } = render(<CanvasBootstrap mode="local" theme="light" />);
    await settle();
    expect(useCanvasStore.getState().currentStrokeColor).toBe('#1e1e1e');

    unmount();
    useCanvasStore.setState({ currentStrokeColor: '#ff00ff' } as never);
    mockResolvedTheme = 'dark';
    render(<CanvasBootstrap mode="local" theme="dark" />);
    await settle();

    // A user colour survives.
    expect(useCanvasStore.getState().currentStrokeColor).toBe('#ff00ff');
  });

  it('starts the performance observers exactly once', async () => {
    // Regression: registered per mount, the observers accumulate across
    // navigations and each one keeps its own entries alive.
    const { rerender } = render(<CanvasBootstrap mode="local" theme="light" />);
    await settle();
    rerender(<CanvasBootstrap mode="local" theme="dark" />);
    await settle();

    expect(startPerformanceObservers).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes nothing it did not subscribe, and survives a re-render', async () => {
    // Regression: the store subscription is via selectors, so a selector that
    // returns a fresh object each call re-renders forever. `elements` is read by
    // identity here; a `useShallow` slip would show up as an unstable render
    // count rather than a thrown error.
    const { rerender } = render(<CanvasBootstrap mode="room" theme="light" roomSlug="r" />);
    await settle();
    expect(() => rerender(<CanvasBootstrap mode="room" theme="dark" roomSlug="r" />)).not.toThrow();
    await waitFor(() => expect(screen.getByTestId('canvas')).toBeInTheDocument());
  });
});
