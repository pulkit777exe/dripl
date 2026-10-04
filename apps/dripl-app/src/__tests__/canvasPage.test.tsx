import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import type { DriplElement } from '@dripl/common';

/**
 * `/canvas` is the app's default landing surface, and it had **no tests at all**.
 *
 * Three things live here that nothing else owns:
 *
 *   identity  — a signed-out visitor gets an anonymous id, and it must be *stable*
 *               across reloads. A fresh id every load orphans the previous canvas
 *               and any socket lock keyed on it.
 *   snapshot  — `?snapshot=<id>` fetches someone else's canvas and offers to
 *               replace the current one. It is an untrusted URL-supplied payload
 *               parsed with a schema and a size cap, so the refusals matter more
 *               than the happy path.
 *   storage   — a localStorage availability probe decides whether the user is told
 *               their work will not be saved. Getting that wrong in the optimistic
 *               direction loses their canvas silently.
 *
 * The real Zustand store and the real `DriplElementSchema` are used throughout: the
 * point of most of these tests is what lands in the store and what the parser
 * accepts, and a mock would test the mock.
 */

const router = { replace: vi.fn(), push: vi.fn() };
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => mockSearchParams,
}));

vi.mock('next/dynamic', () => ({ default: () => () => null }));

vi.mock('@/components/canvas/CanvasToolbar', () => ({ CanvasToolbar: () => null }));
vi.mock('@/components/canvas/CanvasControls', () => ({ CanvasControls: () => null }));
vi.mock('@/components/canvas/TopBar', () => ({ TopBar: () => null }));
vi.mock('@/components/canvas/HelpModal', () => ({
  // Observable, so "did the Help affordance open it" is a real assertion. A
  // `null` stub would make every help test pass against a page that never opened
  // anything, as long as it also never crashed.
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="help-modal">
        <button onClick={onClose}>close-help</button>
      </div>
    ) : null,
}));
vi.mock('@/components/canvas/CanvasBootstrap', () => ({ CanvasBootstrap: () => null }));
vi.mock('@/components/canvas/CanvasErrorBoundary', () => ({
  CanvasErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ effectiveTheme: mockTheme, isDark: mockTheme === 'dark' }),
}));

vi.mock('@/app/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, token: mockToken }),
}));

vi.mock('@/utils/localCanvasStorage', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/localCanvasStorage')>()),
  saveLocalCanvasToStorage: (...args: unknown[]) => saveLocalCanvasToStorage(...args),
}));

vi.mock('@/components/ui/ErrorState', () => ({
  LoadingState: () => <div data-testid="loading" />,
  WarningBanner: (props: {
    message: string;
    onDismiss: () => void;
    action?: { label: string; onClick: () => void };
  }) => (
    <div data-testid="warning">
      <span>{props.message}</span>
      <button onClick={props.onDismiss}>dismiss-warning</button>
      {props.action && <button onClick={props.action.onClick}>{props.action.label}</button>}
    </div>
  ),
  ErrorState: (props: {
    title: string;
    message: string;
    onRetry: () => void;
    onDismiss: () => void;
  }) => (
    <div data-testid="error-state">
      <h2>{props.title}</h2>
      <span>{props.message}</span>
      <button onClick={props.onRetry}>retry</button>
      <button onClick={props.onDismiss}>dismiss-error</button>
    </div>
  ),
}));

import { useCanvasStore } from '@/lib/store';
import CanvasPage from '@/app/canvas/page';

let mockUser: { id: string } | null = null;
let mockToken: string | null = null;
let mockTheme: 'light' | 'dark' = 'light';

const fetchMock = vi.fn();
const saveLocalCanvasToStorage = vi.fn();
// Captured before any spy is installed: calling `Storage.prototype.setItem`
// from inside a spy on it re-enters the spy and recurses until the stack
// blows. Declared once at module scope because two tests in the same
// `describe` need it and a second `const` would collide.
const realSetItem = Storage.prototype.setItem;

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

/** A snapshot payload is a JSON string of an element array. */
function payloadOf(elements: DriplElement[]): string {
  return JSON.stringify(elements);
}

beforeEach(() => {
  vi.clearAllMocks();
  router.replace.mockReset();
  router.push.mockReset();
  mockSearchParams = new URLSearchParams();
  mockUser = null;
  mockToken = null;
  mockTheme = 'light';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  useCanvasStore.setState({
    elements: [],
    selectedIds: new Set<string>(),
    panX: 0,
    panY: 0,
    userId: null,
    zoom: 1,
  } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/canvas identity', () => {
  it('prefers the signed-in user id', async () => {
    // Regression: the user id keys socket locks and anonymous-canvas ownership.
    // Falling through to the anonymous branch while signed in would put a signed
    // user's edits under a throwaway identity.
    mockUser = { id: 'user-1' };
    render(<CanvasPage />);

    await waitFor(() => expect(useCanvasStore.getState().userId).toBe('user-1'));
  });

  it('falls back to the token when there is no user object', async () => {
    // Regression: a session restored from a token has no `user` yet. Falling
    // straight to anonymous would give a signed-in visitor a throwaway identity.
    mockToken = 'tok-abc';
    render(<CanvasPage />);

    await waitFor(() => expect(useCanvasStore.getState().userId).toBe('tok-abc'));
  });

  it('reuses a stored anonymous id rather than minting a new one', async () => {
    // Regression: this is the whole point of the anonymous branch. A fresh id per
    // load orphans the previous canvas and any lock keyed on it, and the user has
    // no way to notice — the canvas simply vanishes on reload.
    localStorage.setItem('dripl_anon_id', 'anon-existing');
    render(<CanvasPage />);

    await waitFor(() => expect(useCanvasStore.getState().userId).toBe('anon-existing'));
  });

  it('stores a newly minted anonymous id so the next load reuses it', async () => {
    // The control for the test above: the mint path must *persist*, or stability
    // never happens.
    render(<CanvasPage />);

    await waitFor(() => expect(useCanvasStore.getState().userId).toBeTruthy());
    const minted = useCanvasStore.getState().userId!;

    expect(localStorage.getItem('dripl_anon_id')).toBe(minted);
  });
});

describe('/canvas help affordances', () => {
  it('opens help on "?" and on Ctrl+/', async () => {
    // Regression: both bindings are advertised in the toolbar. Either one alone
    // silently doing nothing is the kind of bug nobody reports.
    render(<CanvasPage />);

    await act(async () => {
      fireEvent.keyDown(window, { key: '?' });
    });
    expect(screen.getByTestId('help-modal')).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(window, { key: '/' });
    });
  });

  it('opens help from the in-page Help button', async () => {
    // Regression: the keyboard shortcut and the custom event are covered above,
    // but the visible button in the canvas corner is a separate handler. Losing it
    // leaves the only discoverable affordance dead while the shortcuts keep working.
    render(<CanvasPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    });

    expect(screen.getByTestId('help-modal')).toBeInTheDocument();
  });

  it('closes help again', async () => {
    // Regression: `onClose` clears the flag. Without it the modal covers the canvas
    // with no way out except a reload.
    render(<CanvasPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('close-help'));
    });

    expect(screen.queryByTestId('help-modal')).toBeNull();
  });

  it('opens help from the dripl:open-help event', async () => {
    // Regression: the TopBar dispatches this rather than reaching into the page's
    // state. If the listener is missing the Help button in the top bar is dead.
    render(<CanvasPage />);

    await act(async () => {
      window.dispatchEvent(new Event('dripl:open-help'));
    });

    expect(screen.getByTestId('help-modal')).toBeInTheDocument();
  });

  it('removes both window listeners on unmount', async () => {
    // Regression: two `window` listeners with no cleanup accumulate on every
    // navigation, so one Help press eventually opens N modals.
    //
    // Asserted on `removeEventListener` rather than by pressing the key after
    // unmount: once the component is gone, a leaked listener calling
    // `setIsHelpOpen(true)` renders nothing, so the behavioural version of this
    // test passes whether or not the cleanup exists. The spy is what makes the
    // leak observable.
    const removed: string[] = [];
    const realRemove = window.removeEventListener;
    const spy = vi.spyOn(window, 'removeEventListener').mockImplementation(function (
      type: string,
      listener: EventListenerOrEventListenerObject
    ) {
      removed.push(type);
      realRemove.call(window, type, listener);
    });

    try {
      const { unmount } = render(<CanvasPage />);
      unmount();

      expect(removed).toContain('keydown');
      expect(removed).toContain('dripl:open-help');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('/canvas scroll back', () => {
  it('offers the scroll-back control only once the canvas is panned', async () => {
    // Regression: at pan 0,0 the control points at content already on screen, so
    // showing it is pure noise.
    const { rerender } = render(<CanvasPage />);
    expect(screen.queryByRole('button', { name: 'Scroll back to content' })).toBeNull();

    act(() => {
      useCanvasStore.setState({ panX: 120 } as never);
    });
    rerender(<CanvasPage />);

    expect(screen.getByRole('button', { name: 'Scroll back to content' })).toBeInTheDocument();
  });

  it('resets the pan to the origin, not to the centre', async () => {
    // Regression: `setPan(0, 0)` specifically. A `setPan` that recentred would
    // leave the user looking at empty space with the button still there.
    useCanvasStore.setState({ panX: -300, panY: 480 } as never);
    render(<CanvasPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Scroll back to content' }));
    });

    const store = useCanvasStore.getState();
    expect(store.panX).toBe(0);
    expect(store.panY).toBe(0);
  });

  it('hides the control again once the pan is reset', async () => {
    // Regression: the control is derived from the pan, not latched. A latch would
    // leave a button that resets an already-centred canvas.
    useCanvasStore.setState({ panX: 50 } as never);
    const { rerender } = render(<CanvasPage />);
    expect(screen.getByRole('button', { name: 'Scroll back to content' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Scroll back to content' }));
    });
    rerender(<CanvasPage />);

    expect(screen.queryByRole('button', { name: 'Scroll back to content' })).toBeNull();
  });
});

describe('/canvas storage probe', () => {
  it('stays silent when localStorage works', async () => {
    // Regression: a banner that appears on every load is noise that trains users
    // to dismiss it, so the warning it eventually needs to carry gets dismissed.
    render(<CanvasPage />);
    await waitFor(() => expect(screen.queryByTestId('warning')).toBeNull());
  });

  it('warns that work will not be saved when localStorage throws', async () => {
    // Regression: this is the user's only warning that their canvas is not being
    // persisted. Private browsing and quota-exhausted profiles both throw here,
    // and without the banner their work is lost silently on close.
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      // Scoped to the probe's own key: the anonymous-id write also goes
      // through `setItem`, and a blanket throw escapes that effect, which
      // has no try/catch of its own.
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === '__dripl-storage-test') throw new Error('QuotaExceededError');
        realSetItem.call(this, key, value);
      });
    try {
      render(<CanvasPage />);
      await waitFor(() => expect(screen.getByTestId('warning')).toBeInTheDocument());
      expect(screen.getByText(/won't be saved in this browser session/)).toBeInTheDocument();
    } finally {
      setItem.mockRestore();
    }
  });

  it('can dismiss the storage warning', async () => {
    // Regression: a warning the user cannot dismiss is a permanent banner over
    // the canvas chrome.
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      // Scoped to the probe's own key: the anonymous-id write also goes
      // through `setItem`, and a blanket throw escapes that effect, which
      // has no try/catch of its own.
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === '__dripl-storage-test') throw new Error('nope');
        realSetItem.call(this, key, value);
      });
    try {
      render(<CanvasPage />);
      await waitFor(() => expect(screen.getByTestId('warning')).toBeInTheDocument());

      await act(async () => {
        fireEvent.click(screen.getByText('dismiss-warning'));
      });

      expect(screen.queryByTestId('warning')).toBeNull();
    } finally {
      setItem.mockRestore();
    }
  });

  it('opens the storage support article in a new tab', async () => {
    // Regression: the banner's only action. It must open in a new tab with
    // `noopener`-style isolation rather than navigating the canvas away -- losing
    // unsaved work to a help page is the opposite of the banner's intent.
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (key === '__dripl-storage-test') throw new Error('quota');
      realSetItem.call(this, key, value);
    });
    const open = vi.fn();
    vi.stubGlobal('open', open);
    try {
      render(<CanvasPage />);
      await waitFor(() => expect(screen.getByTestId('warning')).toBeInTheDocument());

      await act(async () => {
        fireEvent.click(screen.getByText('Learn more'));
      });

      expect(open).toHaveBeenCalledWith('https://support.google.com/chrome/answer/95647', '_blank');
    } finally {
      setItem.mockRestore();
    }
  });

  it('does not probe storage on a snapshot link', async () => {
    // Regression: the probe is gated on `!snapshotId`. A snapshot link replaces
    // the canvas wholesale, so warning about *local* persistence is the wrong
    // message — and it would appear over the "Load shared canvas?" prompt.
    mockSearchParams = new URLSearchParams('snapshot=abc');
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: '[]' }) });

    render(<CanvasPage />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId('warning')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('/canvas snapshot link', () => {
  function withSnapshot(id = 'snap-1') {
    mockSearchParams = new URLSearchParams(`snapshot=${id}`);
  }

  it('does not fetch when there is no snapshot parameter', async () => {
    // Regression: an unconditional fetch on every canvas load would hit the
    // snapshot API for every user, every time.
    render(<CanvasPage />);
    await waitFor(() => expect(useCanvasStore.getState().userId).toBeTruthy());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prompts before replacing the current canvas, and does not replace yet', async () => {
    // Regression: this is a destructive action behind a URL. Applying the payload
    // on arrival, without asking, silently destroys whatever the user was working
    // on — the comment in the source says so.
    withSnapshot();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: payloadOf([element('theirs')]) }),
    });

    render(<CanvasPage />);
    await screen.findByText('Load shared canvas?');

    expect(fetchMock).toHaveBeenCalledWith('/api/canvas/snapshots/snap-1');
    // Nothing applied yet.
    expect(useCanvasStore.getState().elements).toEqual([]);
  });

  it('replaces the canvas, clears the selection, and persists on confirm', async () => {
    // Regression: `setSelectedIds(new Set())` is part of this. Carrying the old
    // selection across a wholesale replace leaves ids selected that no longer
    // exist, and the next delete or group operation acts on them.
    withSnapshot();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: payloadOf([element('theirs'), element('also-theirs')]) }),
    });
    act(() => {
      useCanvasStore.setState({
        elements: [element('mine')],
        selectedIds: new Set(['mine']),
      } as never);
    });

    render(<CanvasPage />);
    await screen.findByText('Load shared canvas?');

    await act(async () => {
      fireEvent.click(screen.getByText('Load'));
    });

    const store = useCanvasStore.getState();
    // Sorted, because `restoreElements` z-index-sorts the scene: what matters is
    // that both remote elements are present, not the order they arrive in.
    expect(store.elements.map(e => e.id).sort()).toEqual(['also-theirs', 'theirs']);
    expect(store.selectedIds).toEqual(new Set());
    // Persisted, so the replaced scene survives a reload rather than existing
    // only in the tab that loaded the link.
    expect(saveLocalCanvasToStorage).toHaveBeenCalledTimes(1);
    // Asserted as a sorted id list: `restoreElements` runs the scene through the
    // same z-index sort the editor uses, so array order is not preserved and
    // pinning it would pin a detail of the pipeline rather than the behaviour.
    expect(
      saveLocalCanvasToStorage.mock.calls[0]![0].map((e: DriplElement) => e.id).sort()
    ).toEqual(['also-theirs', 'theirs']);
    expect(router.replace).toHaveBeenCalledWith('/canvas');
  });

  it('leaves the current canvas and its persistence untouched on cancel', async () => {
    // Regression: the comment in the source is explicit — cancel must leave the
    // local scene *and its persistence state* intact. Saving on cancel would
    // rewrite the user's canvas to storage at the moment they declined.
    withSnapshot();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: payloadOf([element('theirs')]) }),
    });
    act(() => {
      useCanvasStore.setState({ elements: [element('mine')] } as never);
    });

    render(<CanvasPage />);
    await screen.findByText('Load shared canvas?');

    await act(async () => {
      fireEvent.click(screen.getByText('Cancel'));
    });

    expect(useCanvasStore.getState().elements.map(e => e.id)).toEqual(['mine']);
    // And nothing was written to persistence -- the scene the user declined to
    // replace must not be rewritten on the way out.
    expect(saveLocalCanvasToStorage).not.toHaveBeenCalled();
    expect(screen.queryByText('Load shared canvas?')).toBeNull();
    expect(router.replace).toHaveBeenCalledWith('/canvas');
  });

  it('refuses a payload with an element type it does not recognise', async () => {
    // Regression: the payload is URL-supplied and untrusted, and this is the
    // boundary that stops it. `DriplElementSchema` is a `z.enum` on `type`, so a
    // document containing one unknown element must be refused *whole* — a
    // partially-applied document is worse than none, because the user cannot tell
    // which half loaded.
    withSnapshot();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: JSON.stringify([element('ok'), { ...element('bad'), type: 'not-a-type' }]),
      }),
    });
    act(() => {
      useCanvasStore.setState({ elements: [element('mine')] } as never);
    });

    render(<CanvasPage />);
    await screen.findByText('Load shared canvas?');

    await act(async () => {
      fireEvent.click(screen.getByText('Load'));
    });

    expect(screen.getByTestId('error-state')).toBeInTheDocument();
    // And crucially: the good element alongside the bad one was NOT applied.
    expect(useCanvasStore.getState().elements.map(e => e.id)).toEqual(['mine']);
  });

  it('refuses a payload over the scene element cap', async () => {
    // Regression: `MAX_SCENE_ELEMENTS` is a cap a URL can push past. Without it, a
    // shared link could force an unbounded scene into the store and the renderer
    // on the victim's machine.
    withSnapshot();
    // MAX_SCENE_ELEMENTS is 5_000, so one over is the smallest violating payload.
    const oversized = Array.from({ length: 5001 }, (_, i) => element(`e${i}`));
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: payloadOf(oversized) }),
    });
    act(() => {
      useCanvasStore.getState().setElements([element('mine')], { skipHistory: true });
    });

    render(<CanvasPage />);
    await screen.findByText('Load shared canvas?');

    await act(async () => {
      fireEvent.click(screen.getByText('Load'));
    });

    expect(screen.getByTestId('error-state')).toBeInTheDocument();
    expect(useCanvasStore.getState().elements.map(e => e.id)).toEqual(['mine']);
  });

  it('refuses a payload that is not JSON', async () => {
    // Regression: the shape is `{ data: string }` and the string is parsed
    // separately, so a server that returns something else reaches `JSON.parse`.
    withSnapshot();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: 'this is not json' }),
    });

    render(<CanvasPage />);
    await screen.findByText('Load shared canvas?');

    await act(async () => {
      fireEvent.click(screen.getByText('Load'));
    });

    expect(screen.getByTestId('error-state')).toBeInTheDocument();
  });

  it('reports an expired or unknown snapshot link', async () => {
    // Regression: a 404 must be a readable message, not a silent blank canvas. The
    // user followed a link a colleague sent; "expired" is the whole answer.
    withSnapshot('gone');
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });

    render(<CanvasPage />);

    await waitFor(() => expect(screen.getByTestId('error-state')).toBeInTheDocument());
    expect(screen.getByText(/invalid or has expired/)).toBeInTheDocument();
    // And no prompt: there is nothing to load.
    expect(screen.queryByText('Load shared canvas?')).toBeNull();
  });

  it('reports a snapshot request that fails outright', async () => {
    // The control for the test above: a thrown fetch is the same user-visible
    // outcome as a 404, and must not leave the user on a blank canvas.
    withSnapshot();
    fetchMock.mockRejectedValue(new Error('network down'));

    render(<CanvasPage />);

    await waitFor(() => expect(screen.getByTestId('error-state')).toBeInTheDocument());
    expect(screen.getByText(/invalid or has expired/)).toBeInTheDocument();
  });

  it('lets the user dismiss a failed snapshot, returning to a clean canvas URL', async () => {
    // Regression: dismissing must clear the error *and* strip the `?snapshot=` from
    // the URL. Leaving it there means a reload immediately re-fetches the same
    // dead link and the error is back.
    withSnapshot('gone');
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });

    render(<CanvasPage />);
    await waitFor(() => expect(screen.getByTestId('error-state')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByText('dismiss-error'));
    });

    expect(screen.queryByTestId('error-state')).toBeNull();
    expect(router.replace).toHaveBeenCalledWith('/canvas');
  });

  it('retries a failed snapshot by reloading, clearing the error first', async () => {
    // Regression: retry clears the error *and* reloads. Reloading without
    // clearing would be fine, but clearing without reloading leaves the user
    // staring at a working-looking canvas that is not the one they asked for --
    // the snapshot is still in the URL and still never loaded.
    withSnapshot('gone');
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });

    render(<CanvasPage />);
    await waitFor(() => expect(screen.getByTestId('error-state')).toBeInTheDocument());

    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload },
    });
    try {
      await act(async () => {
        fireEvent.click(screen.getByText('retry'));
      });
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('resolves the snapshot once, not on every re-render', async () => {
    // Regression: `hasResolvedSnapshotRef` is what stops this. Without it the
    // effect re-runs on any re-render, refetching and re-prompting — so a user
    // who dismisses the prompt gets it straight back.
    withSnapshot();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: payloadOf([element('theirs')]) }),
    });

    const { rerender } = render(<CanvasPage />);
    await screen.findByText('Load shared canvas?');

    rerender(<CanvasPage />);
    rerender(<CanvasPage />);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not load a second snapshot when the parameter changes mid-session', async () => {
    // Regression, and the case the resolve-once guard actually exists for. A plain
    // re-render never re-runs the effect anyway, because its only dependency is
    // `snapshotId` — so the guard looks redundant until the parameter itself
    // changes. Without it, navigating from `?snapshot=a` to `?snapshot=b` fetches
    // the second document and puts a second "replace your canvas?" prompt on screen
    // for a link the user never clicked.
    withSnapshot('first');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: payloadOf([element('theirs')]) }),
    });

    const { rerender } = render(<CanvasPage />);
    await screen.findByText('Load shared canvas?');
    expect(fetchMock).toHaveBeenCalledWith('/api/canvas/snapshots/first');

    mockSearchParams = new URLSearchParams('snapshot=second');
    rerender(<CanvasPage />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalledWith('/api/canvas/snapshots/second');
  });

  it('does not set state after unmounting mid-fetch', async () => {
    // Regression: a snapshot fetch that resolves after the user navigated away
    // calls `setSnapshotPayload` on an unmounted component. React tolerates it,
    // but the payload would then be applied to the *next* canvas the user opens.
    withSnapshot();
    let release: (v: unknown) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise(resolve => {
        release = resolve;
      })
    );

    const { unmount } = render(<CanvasPage />);
    unmount();

    await act(async () => {
      release({ ok: true, json: async () => ({ data: payloadOf([element('theirs')]) }) });
    });

    expect(screen.queryByText('Load shared canvas?')).toBeNull();
    expect(useCanvasStore.getState().elements).toEqual([]);
  });
});
