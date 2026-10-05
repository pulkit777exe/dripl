import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import { TopBar } from '@/components/canvas/TopBar';
import type { DriplElement } from '@dripl/common';

/**
 * `components/canvas/TopBar.tsx` is the canvas chrome's owner of share/collab
 * state, the settings `Menu`, the language preference, and the keyboard map.
 * The pre-existing `topBar.test.tsx` covers the store-independent surface: the
 * chrome buttons, the language *read*, and the share/collab requests.
 *
 * This file covers the four things that were left, all of which live in callbacks
 * the previous suite's `Menu`/`ShareModal` stubs never invoked:
 *
 *   - the three menu actions that dispatch window `CustomEvent`s
 *     (`dripl:find-on-canvas`, `dripl:open-command-palette`, `dripl:open-help`)
 *     and the language *write*;
 *   - `closeMenu` as handed to `useTopBarFileOps` via `onActionDone`;
 *   - `handleLeaveSession`, which is the only writer of `shouldLeaveRoom`;
 *   - the `stopPropagation` on the two chrome buttons' `mousedown`, which is what
 *     stops a canvas pointer-down from deselecting when the user opens the menu.
 *
 * The stubs below use the components' real prop types rather than bare shapes, so
 * a rename of a `Menu` or `ShareModal` prop breaks compilation here.
 */

const auth = vi.hoisted(() => ({ user: null as { name?: string } | null }));
const router = vi.hoisted(() => ({ push: vi.fn() }));

/**
 * The props of the most recent `Menu` render. Capturing them is what lets the
 * suite assert *identity* of the forwarded file-op callbacks rather than only
 * that something was rendered.
 */
const lastMenuProps = vi.hoisted(() => ({
  current: null as null | { onResetCanvas: unknown; onSaveToFile: unknown; onOpenFile: unknown },
}));

/**
 * A `Menu` stub that exposes every callback TopBar hands it, plus the props it
 * reads back. The real `Menu` is a dropdown that renders into a portal; what is
 * asserted here is the wiring, not the menu's own layout.
 */
vi.mock('@/components/canvas/Menu', () => ({
  Menu: ({
    isOpen,
    activeLanguage,
    onClose,
    onResetCanvas,
    onOpenFile,
    onSaveToFile,
    onFindOnCanvas,
    onOpenHelp,
    onOpenCommandPalette,
    onLanguageChange,
    onLiveCollaboration,
  }: {
    isOpen: boolean;
    activeLanguage: string;
    onClose: () => void;
    onResetCanvas: () => void;
    onOpenFile: () => void;
    onSaveToFile: () => void;
    onExportImage: () => void;
    onFindOnCanvas: () => void;
    onOpenHelp: () => void;
    onOpenCommandPalette: () => void;
    onLanguageChange: (code: string) => void;
    onLiveCollaboration: () => void;
  }) => {
    lastMenuProps.current = { onResetCanvas, onOpenFile, onSaveToFile };
    return isOpen ? (
      <div data-testid="menu" data-active-language={activeLanguage}>
        <button onClick={onClose}>menu close</button>
        <button onClick={onFindOnCanvas}>menu find</button>
        <button onClick={onOpenHelp}>menu help</button>
        <button onClick={onOpenCommandPalette}>menu palette</button>
        <button onClick={onLiveCollaboration}>menu live</button>
        <button onClick={() => onLanguageChange('fr')}>menu language fr</button>
        <button onClick={onResetCanvas}>menu reset</button>
        <button onClick={onOpenFile}>menu open file</button>
        <button onClick={onSaveToFile}>menu save file</button>
      </div>
    ) : null;
  },
}));

vi.mock('@/components/canvas/ShareModal', () => ({
  ShareModal: ({
    isOpen,
    onClose,
    onShareCanvas,
    onStopCollaboration,
    feedbackMessage,
    errorMessage,
    isCollaborating,
    roomId,
    fileId,
    collaborators,
  }: {
    isOpen: boolean;
    onClose: () => void;
    fileId: string;
    onShareCanvas: () => Promise<void>;
    onCollaborate: () => Promise<void>;
    onStopCollaboration: () => void;
    feedbackMessage: string | null;
    errorMessage: string | null;
    isCollaborating: boolean;
    roomId: string | null;
    collaborators: unknown[];
  }) =>
    isOpen ? (
      <div
        data-testid="share-modal"
        data-file-id={fileId}
        data-room-id={roomId ?? ''}
        data-collaborating={String(isCollaborating)}
        data-collaborator-count={String(collaborators.length)}
      >
        <button onClick={onClose}>modal close</button>
        <button onClick={onStopCollaboration}>modal leave</button>
        <button
          onClick={() => {
            void onShareCanvas();
          }}
        >
          modal share
        </button>
        {feedbackMessage ? <p>{feedbackMessage}</p> : null}
        {errorMessage ? <p>{errorMessage}</p> : null}
      </div>
    ) : null,
}));

vi.mock('@/app/context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

/** Records what `useTopBarFileOps` was handed, and can fire `onActionDone`. */
const fileOps = vi.hoisted(() => ({
  handleResetCanvas: vi.fn(),
  handleSaveToFile: vi.fn(),
  handleOpenFile: vi.fn(),
  handleExportImage: vi.fn(),
  onActionDone: null as null | (() => void),
}));

vi.mock('@/hooks/useTopBarFileOps', () => ({
  useTopBarFileOps: ({ onActionDone }: { onActionDone: () => void }) => {
    fileOps.onActionDone = onActionDone;
    return {
      handleResetCanvas: fileOps.handleResetCanvas,
      handleSaveToFile: fileOps.handleSaveToFile,
      handleOpenFile: fileOps.handleOpenFile,
      handleExportImage: fileOps.handleExportImage,
    };
  },
}));

function rect(id: string): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    version: 1,
    versionNonce: 1,
  } as DriplElement;
}

function seed(
  overrides: Partial<{
    fileId: string | null;
    roomId: string | null;
    isConnected: boolean;
    remoteUsers: Map<string, { id: string }>;
  }> = {}
) {
  useCanvasStore.setState({
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    fileId: overrides.fileId ?? null,
    fileName: 'untitled',
    isConnected: overrides.isConnected ?? false,
    roomId: overrides.roomId ?? null,
    remoteUsers: overrides.remoteUsers ?? new Map(),
    shouldLeaveRoom: false,
    past: [],
    future: [],
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
  });
  useCanvasStore.getState().setElements([rect('a')], { skipHistory: true });
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Open settings and options' }));
}

function openShareModal() {
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
}

/** A listener for a window-level CustomEvent TopBar dispatches. */
function listenFor(name: string) {
  const spy = vi.fn();
  window.addEventListener(name, spy);
  return { spy, stop: () => window.removeEventListener(name, spy) };
}

beforeEach(() => {
  auth.user = null;
  router.push.mockClear();
  // Every counter here is asserted against an exact call count, so a leaked count
  // from a previous test would read as a real double-fire.
  vi.clearAllMocks();
  fileOps.onActionDone = null;
  lastMenuProps.current = null;
  localStorage.clear();
  document.documentElement.lang = '';
  seed();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('TopBar settings-menu toggle', () => {
  // Regression: the menu button is a *toggle*, not an "open" button. Reading
  // `!isMenuOpen` (i.e. always opening) leaves no way to dismiss the menu with
  // the same button, so a user who opens it has to find the overlay -- and a
  // mutation to `setIsMenuOpen(true)` passes every open-only assertion.
  //
  // The close half is asserted, not merely the absence: the second click must
  // actually return the menu to the closed state.
  it('closes the menu when the same button is clicked again', () => {
    render(<TopBar />);

    openMenu();
    expect(screen.getByTestId('menu')).toBeInTheDocument();

    openMenu();
    expect(screen.queryByTestId('menu')).not.toBeInTheDocument();

    // And it can be re-opened, so this is a toggle rather than a one-way latch.
    openMenu();
    expect(screen.getByTestId('menu')).toBeInTheDocument();
  });
});

describe('TopBar find-on-canvas', () => {
  // Regression: the find action is a *window event bridge*, not a prop drill --
  // the find bar and the canvas both listen for it from outside the React tree.
  // The payload carries the trimmed query, and the menu closes so the find bar
  // is the only thing left on screen.
  it('dispatches the trimmed query as a window event and closes the menu', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('  needle  ');
    const find = listenFor('dripl:find-on-canvas');

    render(<TopBar />);
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'menu find' }));

    expect(find.spy).toHaveBeenCalledTimes(1);
    const [event] = find.spy.mock.calls[0] as [CustomEvent<{ query: string }>];
    expect(event.detail).toEqual({ query: 'needle' });
    expect(screen.queryByTestId('menu')).not.toBeInTheDocument();
    find.stop();
  });

  // Regression: `!query` (the user pressed Cancel, so `prompt` returns null) and
  // `!query.trim()` (they submitted only spaces) both bail out. Asserting the
  // bail as "no event fired" is safe here because the listener is a counter on a
  // synchronous dispatch, not a downstream effect.
  it('stays inert when the prompt is cancelled or blank', () => {
    const find = listenFor('dripl:find-on-canvas');
    render(<TopBar />);
    openMenu();

    vi.spyOn(window, 'prompt').mockReturnValue(null);
    fireEvent.click(screen.getByRole('button', { name: 'menu find' }));
    expect(find.spy).not.toHaveBeenCalled();

    vi.spyOn(window, 'prompt').mockReturnValue('   ');
    fireEvent.click(screen.getByRole('button', { name: 'menu find' }));
    expect(find.spy).not.toHaveBeenCalled();

    // Neither bail closes the menu -- only a real query dismisses it.
    expect(screen.getByTestId('menu')).toBeInTheDocument();
    find.stop();
  });
});

describe('TopBar help and command palette from the menu', () => {
  // Regression: the menu's help and palette entries dispatch the same window
  // events as the keyboard shortcuts, so a listener registered by either path
  // fires exactly once. Asserted as a call count because both are dispatched
  // synchronously from the click.
  it('dispatches open-help and open-command-palette and closes the menu', () => {
    const help = listenFor('dripl:open-help');
    const palette = listenFor('dripl:open-command-palette');

    render(<TopBar />);

    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'menu help' }));
    expect(help.spy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('menu')).not.toBeInTheDocument();

    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'menu palette' }));
    expect(palette.spy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('menu')).not.toBeInTheDocument();

    help.stop();
    palette.stop();
  });
});

describe('TopBar language preference', () => {
  // Regression: changing the language *writes* all three places the read path
  // consults -- the component's own state (so the `Menu` label updates without a
  // reload), `localStorage` (so the choice survives a reload), and
  // `documentElement.lang` (so screen readers and `:lang()` rules follow).
  it('persists the chosen language to state, storage and the document', () => {
    render(<TopBar />);
    openMenu();

    fireEvent.click(screen.getByRole('button', { name: 'menu language fr' }));

    expect(screen.getByTestId('menu')).toHaveAttribute('data-active-language', 'fr');
    expect(localStorage.getItem('dripl-language')).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');
  });

  // Regression: the stored language is read on mount, so a reload restores it.
  // This also pins that the read effect does not overwrite a stored value with
  // the `'en'` default.
  it('restores a stored language on mount and offers it to the menu', () => {
    localStorage.setItem('dripl-language', 'de');
    render(<TopBar />);
    openMenu();

    expect(screen.getByTestId('menu')).toHaveAttribute('data-active-language', 'de');
    expect(document.documentElement.lang).toBe('de');
  });
});

describe('TopBar onActionDone closes the menu', () => {
  // Regression: `closeMenu` is handed to `useTopBarFileOps` as `onActionDone` and
  // is called by the hook after every menu-initiated file action. The callback
  // itself is this component's only contribution -- if the hook stopped calling
  // it, or TopBar stopped passing it, the menu would stay open over the file
  // picker and the user would have to dismiss it by hand.
  it('closes the menu when a file op reports it finished', () => {
    render(<TopBar />);
    openMenu();
    expect(screen.getByTestId('menu')).toBeInTheDocument();

    expect(fileOps.onActionDone).not.toBeNull();
    act(() => fileOps.onActionDone?.());

    expect(screen.queryByTestId('menu')).not.toBeInTheDocument();
  });

  // Regression: the four file-op callbacks TopBar forwards are the hook's own
  // functions, unmodified and un-swapped. Identity is the assertion: a wrapper
  // (or a stale closure) would still render a working menu but would run the
  // reset or save against a different store snapshot than the one the menu was
  // rendered from.
  it('forwards the four file-op callbacks to the menu unchanged', () => {
    render(<TopBar />);
    openMenu();

    expect(lastMenuProps.current).toEqual({
      onResetCanvas: fileOps.handleResetCanvas,
      onSaveToFile: fileOps.handleSaveToFile,
      onOpenFile: fileOps.handleOpenFile,
    });

    // Clicking through the menu reaches those same functions.
    fireEvent.click(screen.getByRole('button', { name: 'menu reset' }));
    fireEvent.click(screen.getByRole('button', { name: 'menu open file' }));
    fireEvent.click(screen.getByRole('button', { name: 'menu save file' }));
    expect(fileOps.handleResetCanvas).toHaveBeenCalledTimes(1);
    expect(fileOps.handleOpenFile).toHaveBeenCalledTimes(1);
    expect(fileOps.handleSaveToFile).toHaveBeenCalledTimes(1);
  });
});

describe('TopBar leaving a collaboration session', () => {
  // Regression: `handleLeaveSession` is the only writer of `shouldLeaveRoom`,
  // and it must write it *and* navigate. Navigating without the flag re-joins the
  // room the user just left; setting the flag without navigating strands them in
  // the room.
  it('flags shouldLeaveRoom and navigates to the canvas list', () => {
    seed({ roomId: 'room-9', isConnected: true });
    render(<TopBar />);
    openShareModal();

    fireEvent.click(screen.getByRole('button', { name: 'modal leave' }));

    expect(useCanvasStore.getState().shouldLeaveRoom).toBe(true);
    expect(router.push).toHaveBeenCalledWith('/canvas');
  });

  // Regression: the flag is cleared for the next session, so `seed()` per test is
  // not the only thing keeping this honest -- assert the store's own setter ran.
  it('leaves the flag untouched until the action is taken', () => {
    seed({ roomId: 'room-9', isConnected: true });
    render(<TopBar />);
    openShareModal();

    expect(useCanvasStore.getState().shouldLeaveRoom).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'modal close' }));
    expect(useCanvasStore.getState().shouldLeaveRoom).toBe(false);
  });
});

describe('TopBar share modal props', () => {
  // Regression: the modal receives the live session state from the store, not a
  // snapshot taken when the modal opened. `isCollaborating` is what swaps the
  // modal between "start a room" and "stop this room".
  it('passes the file id, room id, connection state and collaborators through', () => {
    const collaborators = new Map([
      ['u1', { id: 'u1' }],
      ['u2', { id: 'u2' }],
    ]);
    seed({ fileId: 'file-42', roomId: 'room-9', isConnected: true, remoteUsers: collaborators });

    render(<TopBar />);
    openShareModal();

    const modal = screen.getByTestId('share-modal');
    expect(modal).toHaveAttribute('data-file-id', 'file-42');
    expect(modal).toHaveAttribute('data-room-id', 'room-9');
    expect(modal).toHaveAttribute('data-collaborating', 'true');
    expect(modal).toHaveAttribute('data-collaborator-count', '2');
  });

  // Regression: `fileId ?? ''` is the modal's "no file" signal -- a null file id
  // must not reach the modal as the string "null", which would produce a share
  // link scoped to a file that does not exist.
  it('passes an empty file id when no file is open', () => {
    render(<TopBar />);
    openShareModal();

    expect(screen.getByTestId('share-modal')).toHaveAttribute('data-file-id', '');
  });

  // Regression: the menu's "live collaboration" entry opens the share modal
  // *and* dismisses the menu, so the user does not end up with a dropdown stacked
  // over the modal they just asked for.
  it('opens the share modal from the menu and dismisses the menu', () => {
    render(<TopBar />);
    openMenu();

    fireEvent.click(screen.getByRole('button', { name: 'menu live' }));

    expect(screen.queryByTestId('menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('share-modal')).toBeInTheDocument();
  });

  // Regression: closing the modal clears both share messages, so a stale
  // "Link copied!" cannot survive into the next attempt and be read as the result
  // of the *new* share.
  it('clears the feedback and error messages when the modal closes', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'snap-2' }),
    } as Response);

    render(<TopBar />);
    openShareModal();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'modal share' }));
    });
    await waitFor(() => expect(screen.getByText('Link copied!')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'modal close' }));
    // Reopen: the previous run's feedback must not be on screen.
    openShareModal();
    expect(screen.queryByText('Link copied!')).not.toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});

describe('TopBar pointer-event isolation', () => {
  // Regression: both chrome buttons call `stopPropagation` on `mousedown`, which
  // is what stops the canvas's own pointer-down handler from running -- i.e. from
  // clearing the current selection or starting a marquee -- when the user is
  // only reaching for the menu or the share button.
  //
  // The wrapper's counter is the control: it proves the listener is live, so a
  // `not.toHaveBeenCalled()` on the button means the propagation was actually
  // stopped and not merely that nothing was listening.
  it('stops mousedown from the two chrome buttons reaching an ancestor', () => {
    const onWrapperMouseDown = vi.fn();
    render(
      <div onMouseDown={onWrapperMouseDown}>
        <TopBar />
      </div>
    );

    // Control: an unrelated mousedown inside the same wrapper does propagate.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Dripl plus' }));
    expect(onWrapperMouseDown).toHaveBeenCalledTimes(1);

    onWrapperMouseDown.mockClear();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Open settings and options' }));
    expect(onWrapperMouseDown).not.toHaveBeenCalled();

    onWrapperMouseDown.mockClear();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Share' }));
    expect(onWrapperMouseDown).not.toHaveBeenCalled();
  });

  // Regression: the *click* still opens the surface. The `stopPropagation` is on
  // `mousedown` only; adding it to `click` would make the buttons inert.
  it('still opens the menu and the modal on click', () => {
    const onWrapperMouseDown = vi.fn();
    render(
      <div onMouseDown={onWrapperMouseDown}>
        <TopBar />
      </div>
    );

    openMenu();
    expect(screen.getByTestId('menu')).toBeInTheDocument();

    openShareModal();
    expect(screen.getByTestId('share-modal')).toBeInTheDocument();
  });
});

describe('TopBar keyboard guard', () => {
  // Regression: the shortcut handler bails unless a modifier is held. Without the
  // guard, typing the letter "s" anywhere outside a field would save the file and
  // the letter "/" would open the command palette.
  it('ignores unmodified key presses', () => {
    render(<TopBar />);

    fireEvent.keyDown(window, { key: 'o' });
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyDown(window, { key: '/' });

    expect(fileOps.handleOpenFile).not.toHaveBeenCalled();
    expect(fileOps.handleSaveToFile).not.toHaveBeenCalled();
    const palette = listenFor('dripl:open-command-palette');
    fireEvent.keyDown(window, { key: '/' });
    expect(palette.spy).not.toHaveBeenCalled();
    palette.stop();
  });

  // Regression: the field guard covers all three shapes a focusable target can
  // take -- an `<input>`, a `<textarea>`, and a `contenteditable` element. Missing
  // the contenteditable case makes Cmd+S save the file while the user is typing in
  // the (contenteditable) text tool's inline editor.
  it('ignores shortcuts in inputs, textareas and contenteditable elements', () => {
    render(<TopBar />);

    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    // jsdom does not implement `HTMLElement.isContentEditable` (it reads
    // `undefined`), so the property the guard actually reads has to be supplied.
    // Setting `contentEditable` alone would make the guard vacuous.
    Object.defineProperty(editable, 'isContentEditable', { configurable: true, value: true });
    const input = document.createElement('input');
    document.body.append(input, textarea, editable);

    fireEvent.keyDown(input, { key: 's', ctrlKey: true });
    fireEvent.keyDown(textarea, { key: 's', ctrlKey: true });
    fireEvent.keyDown(editable, { key: 's', ctrlKey: true });

    expect(fileOps.handleSaveToFile).not.toHaveBeenCalled();
    input.remove();
    textarea.remove();
    editable.remove();
  });

  // Regression: a key with no binding (and a modifier held) is a no-op -- the
  // handler falls through every branch without acting.
  it('ignores an unbound modified key', () => {
    render(<TopBar />);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    expect(fileOps.handleOpenFile).not.toHaveBeenCalled();
    expect(fileOps.handleSaveToFile).not.toHaveBeenCalled();
    expect(fileOps.handleExportImage).not.toHaveBeenCalled();
  });

  // Regression: the export shortcut needs *both* Ctrl and Shift. Plain Cmd+E must
  // not export, because Cmd+E is a browser/editor binding users expect to keep.
  it('requires shift for the export shortcut', () => {
    render(<TopBar />);

    fireEvent.keyDown(window, { key: 'e', ctrlKey: true });
    expect(fileOps.handleExportImage).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'e', ctrlKey: true, shiftKey: true });
    expect(fileOps.handleExportImage).toHaveBeenCalledTimes(1);
  });

  // Regression: the handler calls `preventDefault` on the keys it binds, so the
  // browser does not also act on them (Cmd+S is Save Page in most browsers). The
  // spy is installed before the dispatch, per the ordering trap.
  it('prevents the default browser action on every bound shortcut', () => {
    render(<TopBar />);

    for (const key of ['o', 's', '/']) {
      const event = new KeyboardEvent('keydown', {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }

    const exportEvent = new KeyboardEvent('keydown', {
      key: 'E',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(exportEvent);
    expect(exportEvent.defaultPrevented).toBe(true);
  });

  // Regression: the shortcut handlers are re-registered whenever the file-op
  // callbacks change, and the *previous* listener is removed. A leaked listener
  // would double-fire: two saves, or two modals.
  it('does not double-fire a shortcut after a re-render', () => {
    const { rerender } = render(<TopBar />);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(fileOps.handleSaveToFile).toHaveBeenCalledTimes(1);

    rerender(<TopBar />);
    rerender(<TopBar />);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    expect(fileOps.handleSaveToFile).toHaveBeenCalledTimes(2);
  });
});
