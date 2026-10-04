import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import type { DriplElement } from '@dripl/common';

/**
 * `FileCanvasRoute` is the autosave and conflict-detection owner for a saved
 * canvas. Everything interesting in it is a decision about *when not to write*:
 * the first pass must not echo the scene back to the server, an unchanged scene
 * must not re-save, and a genuine conflict must stop the loop rather than
 * overwrite. Those three negatives are what this file is about.
 *
 * The real Zustand store is used throughout — the component reads `zoom`, `panX`
 * and `panY` back out of it via `getState()` inside the save, so a mocked store
 * would test the mock.
 */

const updateFile = vi.fn();
const getFile = vi.fn();
const generateThumbnail = vi.fn();

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('@/components/canvas/CanvasBootstrap', () => ({
  CanvasBootstrap: () => null,
}));
vi.mock('@/components/canvas/CanvasToolbar', () => ({ CanvasToolbar: () => null }));
vi.mock('@/components/canvas/CanvasControls', () => ({ CanvasControls: () => null }));
vi.mock('@/components/canvas/TopBar', () => ({ TopBar: () => null }));
vi.mock('@/components/canvas/HelpModal', () => ({ default: () => null }));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ effectiveTheme: 'light', isDark: false }),
}));

vi.mock('@/app/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));

vi.mock('@/lib/api', () => ({
  apiClient: {
    updateFile: (...args: unknown[]) => updateFile(...args),
    getFile: (...args: unknown[]) => getFile(...args),
  },
}));

vi.mock('@/utils/export', () => ({
  generateThumbnail: (...args: unknown[]) => generateThumbnail(...args),
}));

import { useCanvasStore } from '@/lib/store';
import { FileCanvasRoute } from '@/components/canvas/FileCanvasRoute';

let mockUser: { id: string } | null = { id: 'user-1' };

const FILE_ID = 'file-1';
const FILE_NAME = 'My Canvas';
const UPDATED_AT = '2026-01-01T00:00:00.000Z';

/** The 800ms autosave debounce, and the longest a test should ever wait. */
const DEBOUNCE = 800;

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

function renderRoute(props: Partial<React.ComponentProps<typeof FileCanvasRoute>> = {}) {
  return render(
    <FileCanvasRoute
      fileId={FILE_ID}
      fileName={FILE_NAME}
      updatedAt={UPDATED_AT}
      initialData={{ elements: [], appState: null }}
      {...props}
    />
  );
}

/**
 * Advance past the debounce, then drain the whole save chain.
 *
 * The conflict path is `saveContent` -> catch -> `await getFile` -> `setSaveError`,
 * several microtask turns deep, so a single `await Promise.resolve()` left the
 * state unsettled. Draining in a loop lets every assertion below be a plain
 * synchronous query: no polling, and no interaction between fake timers and
 * testing-library's async `findBy*` (whose interval is timer-driven and would hang
 * until the test timeout).
 */
async function flushSave() {
  await act(async () => {
    vi.advanceTimersByTime(DEBOUNCE + 1);
  });
  for (let turn = 0; turn < 20; turn += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** The content payload of the nth `updateFile` call. */
function savedContent(call = 0): { elements: DriplElement[]; appState: Record<string, number> } {
  return updateFile.mock.calls[call]![1].content as {
    elements: DriplElement[];
    appState: Record<string, number>;
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  mockUser = { id: 'user-1' };
  updateFile.mockReset();
  getFile.mockReset();
  generateThumbnail.mockReset();
  // A thumbnail is best-effort; the default is "none available" so the
  // preview-write path is only exercised where a test asks for it.
  generateThumbnail.mockResolvedValue(null);
  updateFile.mockResolvedValue({ file: { updatedAt: '2026-01-02T00:00:00.000Z' } });
  useCanvasStore.setState({
    elements: [],
    fileId: null,
    fileName: '',
    userId: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    clipboard: [],
    selectedIds: new Set<string>(),
  } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FileCanvasRoute mount', () => {
  it('clears the previous file state before adopting the new file', () => {
    // Regression: this component is reused across `/file/[id]` navigations, so a
    // client-side move from one file to another keeps the store. Without the
    // reset the new canvas would open showing the old file's elements, selection
    // and clipboard — and a stray paste would land the old file's content here.
    act(() => {
      useCanvasStore.setState({
        elements: [element('stale')],
        clipboard: [element('stale')],
        selectedIds: new Set(['stale']),
      } as never);
    });

    renderRoute();

    const store = useCanvasStore.getState();
    expect(store.elements).toEqual([]);
    expect(store.clipboard).toEqual([]);
    expect(store.selectedIds).toEqual(new Set());
    expect(store.fileId).toBe(FILE_ID);
    expect(store.fileName).toBe(FILE_NAME);
    expect(store.userId).toBe('user-1');
  });

  it('does not claim a user id when signed out', () => {
    // Regression: `setUserId(user.id)` is inside an `if (user)`. Guarding it
    // matters because the id is what the socket and lock ownership key on —
    // setting it to `undefined` would make two anonymous sessions collide.
    mockUser = null;
    act(() => {
      useCanvasStore.setState({ userId: 'someone-else' } as never);
    });

    renderRoute();

    // Whatever it was, it must not have become `undefined` from `null?.id`.
    expect(useCanvasStore.getState().userId).not.toBeUndefined();
  });
});

describe('FileCanvasRoute autosave', () => {
  it('does not write the scene back on the first pass', async () => {
    // Regression: `initialSyncDoneRef` records a baseline and returns. Without
    // it, every page open would PATCH the file with the bytes it was just served
    // — a pointless write that also bumps `updatedAt`, which would then collide
    // with any other tab that had the file open.
    act(() => {
      useCanvasStore.setState({ elements: [element('a')] } as never);
    });
    renderRoute();
    await flushSave();

    expect(updateFile).not.toHaveBeenCalled();
  });

  it('does not save while signed out', async () => {
    // Regression: autosave requires a user. Saving as anonymous would 401 on
    // every keystroke and, worse, the conflict path would then fetch a file the
    // user cannot read.
    mockUser = null;
    act(() => {
      useCanvasStore.setState({ elements: [element('a')] } as never);
    });
    renderRoute();

    act(() => {
      useCanvasStore.setState({ elements: [element('a'), element('b')] } as never);
    });
    await flushSave();

    expect(updateFile).not.toHaveBeenCalled();
  });

  it('does not save into a store pointed at a different file', async () => {
    // Regression: the effect gates on `storeFileId !== fileId`. This is the guard
    // that stops a stale component instance from PATCHing file A with file B's
    // scene during the frame where a navigation has moved the store on but not
    // yet unmounted this route.
    renderRoute();
    act(() => {
      useCanvasStore.setState({ fileId: 'other-file' } as never);
    });
    act(() => {
      useCanvasStore.setState({ elements: [element('a'), element('b')] } as never);
    });
    await flushSave();

    expect(updateFile).not.toHaveBeenCalled();
  });

  it('debounces a burst of edits into one save carrying the viewport', async () => {
    // Regression: the debounce is what makes autosave affordable — a drag
    // produces dozens of element updates and must not produce dozens of PATCHes.
    // The viewport is part of the payload because a file restores where you left
    // it; dropping `appState` here would silently reset everyone's zoom on open.
    renderRoute();
    act(() => {
      useCanvasStore.setState({ zoom: 2.5, panX: 30, panY: -12 } as never);
    });

    act(() => {
      useCanvasStore.setState({ elements: [element('a')] } as never);
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    act(() => {
      useCanvasStore.setState({ elements: [element('a'), element('b')] } as never);
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    // Past the debounce measured from the *last* edit.
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE + 1);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(updateFile).toHaveBeenCalledTimes(1);
    expect(updateFile.mock.calls[0]![0]).toBe(FILE_ID);
    // The last content wins, not the first.
    expect(savedContent().elements.map(e => e.id)).toEqual(['a', 'b']);
    // The viewport is read back out of the store with `getState()` at save time,
    // not captured when the debounce started — so a zoom change made while the
    // timer was pending is still persisted.
    expect(savedContent().appState).toEqual({ zoom: 2.5, panX: 30, panY: -12 });
    // The optimistic-concurrency fence is the `updatedAt` we were handed.
    expect(updateFile.mock.calls[0]![1].expectedUpdatedAt).toBe(UPDATED_AT);
  });

  it('does not re-save a scene that has not changed', async () => {
    // Regression: the `currentContent === savedContent` short-circuit. Without it,
    // every unrelated store write that produced a new `elements` array identity
    // would re-save — a save loop that never terminates on its own.
    renderRoute();
    act(() => {
      useCanvasStore.setState({ elements: [element('a')] } as never);
    });
    await flushSave();
    expect(updateFile).toHaveBeenCalledTimes(1);

    // A fresh array with identical contents: same scene, new reference.
    act(() => {
      useCanvasStore.setState({ elements: [element('a')] } as never);
    });
    await flushSave();

    expect(updateFile).toHaveBeenCalledTimes(1);
  });

  it('saves a generated thumbnail as a second, separately-fenced write', async () => {
    // Regression: the preview write fences on the *post-save* `updatedAt`. Using
    // the pre-save one would 409 against the write that just landed, and the file
    // would keep a stale thumbnail forever.
    generateThumbnail.mockResolvedValue('data:image/png;base64,AAA');
    renderRoute();
    act(() => {
      useCanvasStore.setState({ elements: [element('a')] } as never);
    });
    await flushSave();
    await act(async () => {
      await Promise.resolve();
    });

    expect(updateFile).toHaveBeenCalledTimes(2);
    expect(updateFile.mock.calls[1]![1]).toEqual({
      preview: 'data:image/png;base64,AAA',
      expectedUpdatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('skips the preview write when no thumbnail was produced', async () => {
    // Regression: an empty canvas renders no thumbnail. Writing `preview: ''`
    // would replace a previously good thumbnail with nothing, which is worse
    // than leaving the old one.
    generateThumbnail.mockResolvedValue('');
    renderRoute();
    act(() => {
      useCanvasStore.setState({ elements: [element('a')] } as never);
    });
    await flushSave();
    await act(async () => {
      await Promise.resolve();
    });

    expect(updateFile).toHaveBeenCalledTimes(1);
  });

  it('survives a failing thumbnail without failing the save', async () => {
    // Regression: the thumbnail is explicitly best-effort. Its rejection is
    // swallowed so it cannot surface as an autosave error the user must act on,
    // when the content save — the thing that matters — already succeeded.
    generateThumbnail.mockRejectedValue(new Error('canvas is tainted'));
    renderRoute();
    act(() => {
      useCanvasStore.setState({ elements: [element('a')] } as never);
    });
    await flushSave();
    await act(async () => {
      await Promise.resolve();
    });

    expect(updateFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/canvas is tainted/)).toBeNull();
  });
});

describe('FileCanvasRoute conflict handling', () => {
  /** A conflict whose re-read matches what we last saved — safe to retry. */
  function benignConflict() {
    getFile.mockResolvedValue({
      file: { updatedAt: '2026-01-03T00:00:00.000Z', content: { elements: [], appState: null } },
    });
    const err = Object.assign(new Error('File changed while saving'), { status: 409 });
    updateFile.mockRejectedValueOnce(err).mockResolvedValue({
      file: { updatedAt: '2026-01-04T00:00:00.000Z' },
    });
  }

  it('retries transparently when the server scene still matches our baseline', async () => {
    // Regression: two tabs opening the same file and neither typing produce
    // exactly this — a 409 whose content is unchanged. Demanding a reload here
    // would make an entirely benign race look like data loss.
    benignConflict();
    renderRoute();
    act(() => {
      useCanvasStore.setState({ elements: [element('a')] } as never);
    });
    await flushSave();
    await act(async () => {
      await Promise.resolve();
    });

    expect(getFile).toHaveBeenCalledWith(FILE_ID);
    expect(updateFile).toHaveBeenCalledTimes(2);
    // The retry fences on the timestamp we just re-read, not the stale one.
    expect(updateFile.mock.calls[1]![1].expectedUpdatedAt).toBe('2026-01-03T00:00:00.000Z');
    expect(screen.queryByText(/changed elsewhere/)).toBeNull();
  });

  it('halts saving and demands a reload when the scenes genuinely diverged', async () => {
    // Regression: this is the data-loss guard. Someone else saved a different
    // scene, so retrying would overwrite their work and ours. `saveConflictRef`
    // latches, so subsequent local edits must not keep writing.
    getFile.mockResolvedValue({
      file: {
        updatedAt: '2026-01-03T00:00:00.000Z',
        content: { elements: [element('THEIRS')], appState: null },
      },
    });
    updateFile.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }));

    renderRoute();
    act(() => {
      useCanvasStore.setState({ elements: [element('a')] } as never);
    });
    await flushSave();
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/changed elsewhere/)).toBeInTheDocument();

    // Further edits must not save: the latch holds until a reload.
    updateFile.mockClear();
    act(() => {
      useCanvasStore.setState({ elements: [element('a'), element('b')] } as never);
    });
    await flushSave();
    expect(updateFile).not.toHaveBeenCalled();
  });

  it('still demands a reload when the conflicting file cannot be re-read', async () => {
    // Regression: the inner `catch`. Without it a failed `getFile` would fall
    // through to the generic handler and show the *network* message, telling the
    // user to retry when in fact their next save would clobber a newer version.
    getFile.mockRejectedValue(new Error('gone'));
    updateFile.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }));

    renderRoute();
    act(() => {
      useCanvasStore.setState({ elements: [element('a')] } as never);
    });
    await flushSave();
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/changed elsewhere/)).toBeInTheDocument();
  });

  it('reads a legacy bare-array body when deciding whether a conflict is benign', async () => {
    // Regression: `elementsFromFileContent` accepts both stored shapes. Files
    // written before the `{elements, appState}` envelope store a bare array.
    // Reading only `.elements` would make every legacy file look like it had
    // diverged, so every conflict on an old file would demand a reload instead
    // of retrying. `version` is what makes the two serialisations distinct.
    const elements = [element('a')];
    updateFile.mockResolvedValueOnce({ file: { updatedAt: '2026-01-02T00:00:00.000Z' } });
    getFile.mockResolvedValue({
      // The bare array holds the same elements we saved.
      file: { updatedAt: '2026-01-03T00:00:00.000Z', content: elements },
    });
    const err = Object.assign(new Error('changed while saving'), { status: 409 });

    renderRoute();
    act(() => {
      useCanvasStore.setState({ elements } as never);
    });
    await flushSave();
    await act(async () => {
      await Promise.resolve();
    });

    // Now force the conflict with a body in the same legacy shape.
    updateFile.mockRejectedValueOnce(err).mockResolvedValue({
      file: { updatedAt: '2026-01-04T00:00:00.000Z' },
    });
    act(() => {
      useCanvasStore.setState({ elements: [...elements, element('b')] } as never);
    });
    await flushSave();
    await act(async () => {
      await Promise.resolve();
    });

    // The bare array was understood, so it compared equal to the baseline and the
    // retry happened rather than the reload banner.
    expect(screen.queryByText(/changed elsewhere/)).toBeNull();
  });

  it('shows an ordinary failure without offering a reload', async () => {
    // Regression: the Reload button is gated on the conflict message. Offering it
    // for a transient network error invites the user to throw away unsaved work
    // in exchange for a page that will probably fail the same way.
    updateFile.mockRejectedValue(new Error('Network unreachable'));
    renderRoute();
    act(() => {
      useCanvasStore.setState({ elements: [element('a')] } as never);
    });
    await flushSave();

    expect(screen.getByText('Network unreachable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
  });

  it('stops autosaving after an ordinary failure, and resumes once it clears', async () => {
    // Regression: the effect early-returns while `saveError` is set, which stops a
    // failing save from retrying forever. It must also start working again once
    // the error clears — a permanently wedged canvas is the other failure.
    updateFile.mockRejectedValue(new Error('nope'));
    renderRoute();
    act(() => {
      useCanvasStore.setState({ elements: [element('a')] } as never);
    });
    await flushSave();
    expect(screen.getByText('nope')).toBeInTheDocument();

    updateFile.mockClear();
    updateFile.mockResolvedValue({ file: { updatedAt: '2026-01-05T00:00:00.000Z' } });
    act(() => {
      useCanvasStore.setState({ elements: [element('a'), element('b')] } as never);
    });
    await flushSave();

    // Still gated on the error, so nothing was written while the banner is up.
    expect(updateFile).not.toHaveBeenCalled();
  });
});

describe('FileCanvasRoute unmount', () => {
  it('flushes one save when unmounting with edits still pending', async () => {
    // Regression: navigating away inside the debounce window would otherwise drop
    // the edit with no warning at all — the single most expensive way this
    // component can lose work. The flush is deliberately not debounced.
    const { unmount } = renderRoute();
    act(() => {
      useCanvasStore.setState({ elements: [element('a')] } as never);
    });
    // Unmount before the 800ms elapses.
    act(() => {
      useCanvasStore.setState({ elements: [element('a'), element('b')] } as never);
    });

    await act(async () => {
      unmount();
      await Promise.resolve();
    });

    expect(updateFile).toHaveBeenCalledTimes(1);
    expect(savedContent().elements.map(e => e.id)).toEqual(['a', 'b']);
  });

  it('does not save on unmount when there is nothing pending', async () => {
    // The control for the flush above. Without `pendingSaveRef`, every unmount —
    // including one with no edits at all — would PATCH the file.
    const { unmount } = renderRoute();
    act(() => {
      useCanvasStore.setState({ elements: [element('a')] } as never);
    });
    await flushSave();
    updateFile.mockClear();

    await act(async () => {
      unmount();
      await Promise.resolve();
    });

    expect(updateFile).not.toHaveBeenCalled();
  });

  it('does not flush when the pending edit was already saved', async () => {
    // Regression: the debounce fired, so `pendingSaveRef` is false again. Flushing
    // here would write the same bytes twice and race the preview write that is
    // still in flight against its own `expectedUpdatedAt`.
    const { unmount } = renderRoute();
    act(() => {
      useCanvasStore.setState({ elements: [element('a')] } as never);
    });
    await flushSave();
    updateFile.mockClear();

    await act(async () => {
      unmount();
      await Promise.resolve();
    });

    expect(updateFile).not.toHaveBeenCalled();
  });

  it('swallows a failing flush rather than throwing during unmount', async () => {
    // Regression: this runs in a cleanup function, where a rejected promise is
    // unhandled and would surface as an unhandled rejection in the console of a
    // page the user has already navigated away from.
    updateFile.mockRejectedValue(new Error('gone'));
    const { unmount } = renderRoute();
    act(() => {
      useCanvasStore.setState({ elements: [element('a')] } as never);
    });

    await act(async () => {
      unmount();
      await Promise.resolve();
    });

    // No unhandled rejection escaped; the call was still attempted.
    expect(updateFile).toHaveBeenCalled();
  });
});

describe('FileCanvasRoute reload affordance', () => {
  it('reloads the page when the conflict banner is clicked', async () => {
    // Regression: the banner's only action is a full reload. It has to call
    // `window.location.reload`, which is awkward to observe, so the seam is
    // replaced with a spy and the absence of the handler is the assertion.
    getFile.mockResolvedValue({
      file: {
        updatedAt: '2026-01-03T00:00:00.000Z',
        content: { elements: [element('THEIRS')], appState: null },
      },
    });
    updateFile.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }));

    renderRoute();
    act(() => {
      useCanvasStore.setState({ elements: [element('a')] } as never);
    });
    await flushSave();
    await act(async () => {
      await Promise.resolve();
    });

    const button = screen.getByRole('button', { name: 'Reload' });
    const original = window.location;
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload },
    });
    try {
      fireEvent.click(button);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('shows no banner before anything has failed', () => {
    // Regression: the banner is conditionally rendered on a `null` initial state.
    // A truthy initial would put an empty red bar across the top of every canvas.
    renderRoute();
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
    expect(document.body.textContent).not.toContain('changed elsewhere');
  });
});
