import { Suspense } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

/**
 * `/room/[roomSlug]/view` is the public "look at this room" page, and it had **no tests
 * at all** — all 23 of its statements were uncovered.
 *
 * It is the sibling of `/board/[token]` but a different page in three ways that matter,
 * and each difference is where the risk is:
 *
 *   1. It reads the slug with `use(params)` during render, while `/board/[token]`
 *      resolves the promise inside the effect. That makes its first paint a suspend,
 *      and it is why the "Loading room" message below is a *rendered* state rather than
 *      an effect-driven one.
 *   2. It **does not wipe the canvas store** — deliberately, and worth pinning: unlike
 *      the share-link page, nothing here clears `elements`. `CanvasBootstrap` is mounted
 *      with `replaceExisting`, and its own file-mode effect does the load.
 *   3. Its content parsing is inline in the component body, with the malformed-content
 *      `catch` written empty and a comment explaining why. A comment is not a
 *      behaviour, and an emptied-out `catch` that grew a `throw` would put the room page
 *      in an error boundary over one bad row.
 *
 * `CanvasBootstrap` and `CanvasControls` are recording stubs. `CanvasControls` in
 * particular is asserted *by presence inside the overlay*, not by its own behaviour —
 * `canvasControls.test.tsx` owns that — because the only thing this page decides about
 * it is that it is present, wrapped in a `pointer-events-auto` island inside a
 * `pointer-events-none` overlay. That nesting is load-bearing: the overlay must let
 * clicks through to the canvas everywhere except on the controls themselves.
 */

type CanvasRoomResponse = Awaited<ReturnType<typeof import('@/lib/api').apiClient.getCanvasRoom>>;

const getCanvasRoom = vi.hoisted(() => vi.fn<(roomId: string) => Promise<CanvasRoomResponse>>());

const bootstrapProps = vi.hoisted(() => vi.fn<(props: CanvasBootstrapProps) => void>());
const controlsRenderCount = vi.hoisted(() => ({ count: 0 }));

vi.mock('@/lib/api', () => ({ apiClient: { getCanvasRoom } }));

vi.mock('@/components/canvas/CanvasBootstrap', () => ({
  CanvasBootstrap: (props: import('@/components/canvas/CanvasBootstrap').CanvasBootstrapProps) => {
    bootstrapProps(props);
    return <div data-testid="canvas-bootstrap" />;
  },
}));

vi.mock('@/components/canvas/CanvasControls', () => ({
  CanvasControls: () => {
    controlsRenderCount.count += 1;
    return <div data-testid="canvas-controls" />;
  },
}));

import { useCanvasStore } from '@/lib/store';
import RoomViewPage from '@/app/room/[roomSlug]/view/page';
import type { DriplElement } from '@dripl/common';
import type { CanvasBootstrapProps } from '@/components/canvas/CanvasBootstrap';

const SLUG = 'design-review';

function roomResponse(overrides: Partial<CanvasRoomResponse['room']> = {}): CanvasRoomResponse {
  return {
    room: {
      id: 'room-1',
      slug: SLUG,
      name: 'Design Review',
      isPublic: true,
      content: JSON.stringify({ elements: [{ id: 'shared-1', type: 'ellipse' }] }),
      ...overrides,
    },
  };
}

/** A promise plus the handle that settles it. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * This page reads `params` with `use()` *during render*, so it suspends until the
 * promise settles — a real `Suspense` boundary is part of the contract, not a test
 * artefact. The fallback is deliberately empty so the assertions below can only ever see
 * the page's own output.
 */
function withSuspense(node: React.ReactElement) {
  return <Suspense fallback={<div data-testid="suspense-fallback" />}>{node}</Suspense>;
}

/**
 * Renders the page and lets the `use(params)` suspend resolve.
 *
 * The render itself has to be inside an *awaited* `act`. `render()` called bare is
 * wrapped in a synchronous `act` by Testing Library, and the params promise resolves
 * after it returns — leaving the committed tree as the `Suspense` fallback with no
 * retry scheduled, because the retry belongs to the `act` scope that has already closed.
 * Verified: the same tree inside `await act(async () => { render(...) })` commits the
 * page, and `await act(async () => {})` afterwards does not.
 */
async function renderPage(slug = SLUG, paramsPromise?: Promise<{ roomSlug: string }>) {
  const params = paramsPromise ?? Promise.resolve({ roomSlug: slug });
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(withSuspense(<RoomViewPage params={params} />));
  });
  return result;
}

/** Lets already-resolved promises land without moving any clock. */
async function settle(): Promise<void> {
  await act(async () => {});
}

/**
 * A soft navigation to another room: a new `params` promise handed to the same mounted
 * component. The new promise suspends, so the effect cleanup — and therefore
 * `cancelled = true` for the in-flight request — happens when the render commits.
 */
async function navigateTo(
  rendered: { rerender: (ui: React.ReactElement) => void },
  roomSlug: string
): Promise<void> {
  await act(async () => {
    rendered.rerender(withSuspense(<RoomViewPage params={Promise.resolve({ roomSlug })} />));
  });
  await settle();
}

function sentProps(): CanvasBootstrapProps {
  const call = bootstrapProps.mock.calls.at(-1);
  if (call === undefined) throw new Error('CanvasBootstrap was never rendered');
  return call[0];
}

function initialData(): unknown {
  const props = sentProps();
  if (props.mode !== 'file') throw new Error(`expected file mode, got ${props.mode}`);
  return props.initialData;
}

function hasElement(id: string): boolean {
  return useCanvasStore.getState().elements.some(element => element.id === id);
}

function existingElement(id: string): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 10,
    y: 20,
    width: 100,
    height: 60,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  controlsRenderCount.count = 0;
  getCanvasRoom.mockResolvedValue(roomResponse());
  useCanvasStore.setState({
    elements: [existingElement('mine-1')],
    elementsById: new Map([['mine-1', existingElement('mine-1')]]),
    selectedIds: new Set(['mine-1']),
    past: [],
    future: [],
  });
});

describe('/room/[roomSlug]/view — while the room is fetched', () => {
  /**
   * Regression: `room` starts null, so the first render *is* the "Loading room"
   * message. This page resolves `params` with `use()` during render and fetches in an
   * effect, so there is no other way to tell the user anything is happening — drop this
   * branch and the page is an empty beige rectangle for the length of the request.
   */
  it('says it is loading before the room arrives', async () => {
    const request = deferred<CanvasRoomResponse>();
    getCanvasRoom.mockReturnValue(request.promise);
    await renderPage();

    // The params promise settles first (that is the suspend); the *room* request is what
    // is still open, and this is the state the visitor spends the request in.
    await settle();

    expect(screen.getByRole('heading', { name: 'Loading room' })).toBeInTheDocument();
    expect(screen.getByText('Fetching the shared scene…')).toBeInTheDocument();
  });

  /**
   * Regression: the room's name is *not* shown while loading, even though the response
   * that carries it has not arrived. Asserted negatively because the alternative —
   * showing the name as soon as `room` is set but before `content` is usable — would
   * make the loading state lie about what it has.
   */
  it('does not name the room it has not received yet', async () => {
    const request = deferred<CanvasRoomResponse>();
    getCanvasRoom.mockReturnValue(request.promise);
    await renderPage();

    await settle();

    expect(screen.queryByText('Design Review')).not.toBeInTheDocument();
    expect(screen.queryByTestId('canvas-bootstrap')).not.toBeInTheDocument();
  });

  /**
   * Regression: the slug comes from `use(params)`, so the effect's dependency is
   * `roomSlug` and the fetch must use it. A fetch keyed on anything else loads the wrong
   * room, and a room that renders *some* scene is worse than one that renders none.
   */
  it('requests the room named by the route slug', async () => {
    await renderPage('a-different-room');

    await settle();

    expect(getCanvasRoom).toHaveBeenCalledWith('a-different-room');
  });
});

describe('/room/[roomSlug]/view — a room that loads', () => {
  /**
   * Regression: this is the shared scene, so it must be read-only and must replace any
   * cached one. `replaceExisting` without it means `CanvasBootstrap` can offer to reuse
   * the previous local scene — showing a visitor someone else's board link while
   * displaying their own drawing.
   */
  it('mounts the canvas read-only and replacing any cached scene', async () => {
    await renderPage();

    await settle();

    expect(sentProps()).toMatchObject({
      mode: 'file',
      theme: 'light',
      readOnly: true,
      replaceExisting: true,
    });
  });

  /**
   * Regression: the parsed `content` is the scene. Asserted on the parsed value, so a
   * `room.content` passed through as a string fails here.
   */
  it('hands the canvas the parsed room content', async () => {
    const content = { elements: [{ id: 'shared-1', type: 'ellipse' }], appState: { zoom: 3 } };
    getCanvasRoom.mockResolvedValue(roomResponse({ content: JSON.stringify(content) }));
    await renderPage();

    await settle();

    expect(initialData()).toEqual(content);
  });

  /**
   * Regression: `setRoom({ name, content })` narrows the response to two fields, and the
   * effect depends on `roomSlug`. Copying the whole response instead would put
   * `id`/`slug`/`isPublic` into the state object, which is harmless — so this asserts
   * only what is observable: that the scene the canvas receives came from `content` and
   * that the name is not used anywhere on screen. Asserting the state shape directly is
   * not possible from outside the component, and reaching into it would be the wrong
   * kind of test.
   */
  it('renders no room chrome, so a stale name cannot be shown beside a new scene', async () => {
    getCanvasRoom.mockResolvedValue(roomResponse({ name: 'Launch Plan' }));
    await renderPage();

    await settle();

    expect(initialData()).toMatchObject({ elements: [{ id: 'shared-1' }] });
    expect(screen.queryByText('Launch Plan')).not.toBeInTheDocument();
  });

  /**
   * Regression: `CanvasControls` must be present on a loaded room. It is the only
   * affordance this page offers — zoom, undo/redo, marquee mode — and its absence on a
   * read-only view is a plausible-looking simplification that leaves the visitor with no
   * way to zoom into the detail they opened the link to inspect.
   */
  it('offers canvas controls once the room has loaded', async () => {
    await renderPage();

    await settle();

    expect(screen.getByTestId('canvas-controls')).toBeInTheDocument();
    expect(controlsRenderCount.count).toBeGreaterThan(0);
  });

  /**
   * Regression: the overlay is `pointer-events-none` with an inner `pointer-events-auto`
   * island. Dropping the outer class makes the full-width bar swallow every click on the
   * canvas beneath it; dropping the inner one makes the controls themselves unclickable
   * while still looking enabled. Both are invisible in a snapshot, so both are asserted.
   */
  it('nests the controls in a click-through overlay', async () => {
    await renderPage();
    await settle();

    const controls = screen.getByTestId('canvas-controls');
    const island = controls.parentElement;
    if (!island) throw new Error('controls wrapper not rendered');
    expect(island).toHaveClass('pointer-events-auto');

    const overlay = island.parentElement;
    if (!overlay) throw new Error('overlay not rendered');
    expect(overlay).toHaveClass('pointer-events-none');
  });

  /**
   * Regression: the controls are *absent* while the room is loading, because the
   * loading branch returns before the main render. Asserted so that a version which
   * mounted the controls unconditionally would be pinned — it would show a working
   * control bar over a message that says nothing has loaded yet.
   */
  it('shows no controls while the room is still loading', async () => {
    const request = deferred<CanvasRoomResponse>();
    getCanvasRoom.mockReturnValue(request.promise);
    await renderPage();

    await settle();

    expect(screen.queryByTestId('canvas-controls')).not.toBeInTheDocument();
    expect(controlsRenderCount.count).toBe(0);
  });

  /**
   * Regression: the page does *not* wipe the canvas store, unlike `/board/[token]`. This
   * is pinned as the behaviour it is — the loading is left to `CanvasBootstrap`'s own
   * file-mode effect, which this page asks for with `replaceExisting`. If a future change
   * added a `setElements([])` here, the visitor's own in-progress canvas would be
   * destroyed by opening a public room link, and this test would say so.
   */
  it('leaves the existing canvas store alone', async () => {
    await renderPage();
    await settle();

    expect(hasElement('mine-1')).toBe(true);
    expect(useCanvasStore.getState().selectedIds.has('mine-1')).toBe(true);
  });

  /**
   * Regression: the effect depends on `[roomSlug]`. In the App Router a soft navigation
   * from one public room to another re-renders this component with a new slug; without
   * the dependency the second room would render the first room's scene.
   */
  it('does not re-fetch on a re-render with the same slug', async () => {
    const params = Promise.resolve({ roomSlug: SLUG });
    let rerender!: ReturnType<typeof render>['rerender'];
    await act(async () => {
      ({ rerender } = render(withSuspense(<RoomViewPage params={params} />)));
    });
    expect(getCanvasRoom).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender(withSuspense(<RoomViewPage params={params} />));
    });

    expect(getCanvasRoom).toHaveBeenCalledTimes(1);
  });

  /** The control for the test above: a different slug is a different room. */
  it('re-fetches when the route hands it a different slug', async () => {
    const { rerender } = await renderPage('first-room');
    expect(getCanvasRoom).toHaveBeenCalledTimes(1);

    await navigateTo({ rerender }, 'second-room');

    expect(getCanvasRoom).toHaveBeenCalledTimes(2);
    expect(getCanvasRoom).toHaveBeenLastCalledWith('second-room');
  });
});

describe('/room/[roomSlug]/view — content that will not parse', () => {
  it.each([
    ['truncated JSON', '{"elements":['],
    ['an empty string', ''],
    ['a bare word', 'not json at all'],
  ])(
    /**
     * Regression: the `try`/`catch` around `JSON.parse` in the component body. The
     * `catch` is empty by design (the comment above it says so), and the observable
     * consequence is that `initialData` keeps its declared default of
     * `{ elements: [] }`. That is the property worth pinning: an *empty scene rendered*,
     * not a thrown render. ADR-004 stores `content` as an unvalidated JSON string, so a
     * half-written row is a matter of time, and this page has no error boundary of its
     * own to catch one.
     */
    'renders an empty scene when the content is %s',
    async (_label, content) => {
      getCanvasRoom.mockResolvedValue(roomResponse({ content }));
      await renderPage();

      await settle();

      expect(initialData()).toEqual({ elements: [] });
      expect(screen.getByTestId('canvas-bootstrap')).toBeInTheDocument();
      expect(screen.queryByText('Room unavailable')).not.toBeInTheDocument();
    }
  );

  /**
   * Regression: the default is assigned *before* the `try`, and the `catch` does not
   * reassign it. A `catch` that set `initialData = null` would hand `CanvasBootstrap`
   * nothing, and `loadInitialScene` returns `null` for falsy `initialData` — which skips
   * `setElements` entirely and leaves the previous canvas on screen under a page that
   * says it is showing a room. Asserted as the exact default object.
   */
  it('keeps the declared empty-scene default when parsing fails', async () => {
    getCanvasRoom.mockResolvedValue(roomResponse({ content: '{' }));
    await renderPage();

    await settle();

    expect(initialData()).toStrictEqual({ elements: [] });
  });

  /**
   * The control for the tests above: content that *does* parse reaches the canvas
   * unchanged, so the empty scene above cannot be satisfied by the page discarding
   * `content` unconditionally.
   */
  it('passes parseable content through untouched', async () => {
    const content = { elements: [{ id: 'a' }, { id: 'b' }] };
    getCanvasRoom.mockResolvedValue(roomResponse({ content: JSON.stringify(content) }));
    await renderPage();

    await settle();

    expect(initialData()).toEqual(content);
  });
});

describe('/room/[roomSlug]/view — a room that will not load', () => {
  it.each([
    ['the room is private', new Error('Room not found')],
    ['the request was refused', new Error('You do not have access to this room')],
    ['the transport failed', new TypeError('fetch failed')],
  ])(
    /**
     * Regression: the `catch` has to put the server's words on screen. "Private" and
     * "offline" call for different responses from the reader — ask for an invite versus
     * try again — and a generic apology gives them neither.
     */
    'shows the message the server refused because %s',
    async (_label, failure) => {
      getCanvasRoom.mockRejectedValue(failure);
      await renderPage();

      await settle();

      expect(screen.getByRole('heading', { name: 'Room unavailable' })).toBeInTheDocument();
      expect(screen.getByText(failure.message)).toBeInTheDocument();
    }
  );

  /**
   * Regression: `requestError instanceof Error ? requestError.message : 'Unable to load
   * room.'`. A non-`Error` rejection has no `.message`, so without the guard the panel
   * renders an empty paragraph and the visitor is told nothing.
   */
  it('falls back to a readable message for a non-Error rejection', async () => {
    getCanvasRoom.mockRejectedValue('kaboom');
    await renderPage();

    await settle();

    expect(screen.getByText('Unable to load room.')).toBeInTheDocument();
  });

  /**
   * Regression: the error branch must render no canvas and no controls. A catch that
   * fell through to the canvas would show a read-only room view over an empty scene,
   * which is indistinguishable from a room that is simply empty.
   */
  it('renders no canvas and no controls when the request fails', async () => {
    getCanvasRoom.mockRejectedValue(new Error('Room not found'));
    await renderPage();

    await settle();

    expect(screen.queryByTestId('canvas-bootstrap')).not.toBeInTheDocument();
    expect(screen.queryByTestId('canvas-controls')).not.toBeInTheDocument();
    expect(bootstrapProps).not.toHaveBeenCalled();
  });

  /**
   * Regression: this page has no `loading` flag at all — the "Loading room" message *is*
   * the `!room` branch, and `error` short-circuits it. So a failure has to replace the
   * loading message rather than sit beside it, which is what `if (error)` before
   * `if (!room)` buys. Asserted as an absence, since both messages use the same
   * `RoomMessage` chrome.
   */
  it('replaces the loading message with the failure', async () => {
    const request = deferred<CanvasRoomResponse>();
    getCanvasRoom.mockReturnValue(request.promise);
    await renderPage();
    expect(screen.getByRole('heading', { name: 'Loading room' })).toBeInTheDocument();

    await act(async () => request.reject(new Error('Room not found')));

    expect(screen.queryByText('Fetching the shared scene…')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Room unavailable' })).toBeInTheDocument();
    expect(screen.getByText('Room not found')).toBeInTheDocument();
  });

  /**
   * Regression: `cancelled` gates the error `setState`. The observable form of this
   * gate is a *rejected* request landing after its effect was cleaned up while the
   * component stayed mounted — which is what a slug change produces. Without the gate,
   * the abandoned failure would replace the incoming room's loading message with a
   * dead end for a room the visitor is still waiting on.
   */
  it('ignores a failure from a request the route has moved on from', async () => {
    const abandoned = deferred<CanvasRoomResponse>();
    const current = deferred<CanvasRoomResponse>();
    getCanvasRoom.mockReturnValueOnce(abandoned.promise).mockReturnValueOnce(current.promise);
    const first = await renderPage('first-room');
    await settle();

    await navigateTo(first, 'second-room');
    await act(async () => abandoned.reject(new Error('Room not found')));

    expect(screen.queryByText('Room unavailable')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Loading room' })).toBeInTheDocument();

    await act(async () =>
      current.resolve(roomResponse({ name: 'Second Room', content: '{"elements":[]}' }))
    );
    expect(screen.queryByText('Room unavailable')).not.toBeInTheDocument();
    expect(screen.getByTestId('canvas-bootstrap')).toBeInTheDocument();
  });
});

describe('/room/[roomSlug]/view — leaving before the room arrives', () => {
  /**
   * Regression: the same `cancelled` gate on the success path. Asserted on what the
   * page decided to render rather than on a `setState` that cannot be observed after
   * unmount — `CanvasBootstrap` mounting at all is the observable fact, and it is one
   * this page causes only when the response was accepted.
   */
  it('renders no canvas when the visitor leaves before the response', async () => {
    const request = deferred<CanvasRoomResponse>();
    getCanvasRoom.mockReturnValue(request.promise);
    const { unmount } = await renderPage();

    unmount();
    await act(async () => request.resolve(roomResponse()));

    expect(bootstrapProps).not.toHaveBeenCalled();
    expect(screen.queryByTestId('canvas-controls')).not.toBeInTheDocument();
  });

  /**
   * Regression: the practical consequence of the gate under React's automatic batching
   * — two rooms in sequence, the first slow. Without it the abandoned response wins
   * the screen even though the visitor has already moved to the second room.
   */
  it('lets the current request win when an abandoned one resolves late', async () => {
    const slow = deferred<CanvasRoomResponse>();
    const fast = deferred<CanvasRoomResponse>();
    getCanvasRoom.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    const first = await renderPage('first-room');
    await settle();

    await navigateTo(first, 'second-room');
    const secondScene = { elements: [{ id: 'from-second' }] };
    await act(async () => fast.resolve(roomResponse({ content: JSON.stringify(secondScene) })));
    expect(initialData()).toEqual(secondScene);

    await act(async () =>
      slow.resolve(roomResponse({ content: JSON.stringify({ elements: [{ id: 'from-first' }] }) }))
    );

    expect(initialData()).toEqual(secondScene);
  });
});
