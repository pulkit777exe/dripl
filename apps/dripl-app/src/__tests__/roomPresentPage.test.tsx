import { Suspense } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

/**
 * `/room/[roomSlug]/present` is the projector view of a collaboration room — the
 * thing cast to a screen at the front of a meeting — and it had **no tests at all**:
 * 19 of its 21 statements were uncovered.
 *
 * It is nearly a copy of its sibling `/room/[roomSlug]/view` (`roomViewPage.test.tsx`
 * owns that one), and the two differ in ways that matter and are worth pinning here
 * rather than assumed from the sibling's tests:
 *
 *   1. It stores **`content`** alone, not `{ name, content }`. The presenter gets no
 *      room name anywhere on screen, which is the point — the slide is the content,
 *      not the browser chrome around it.
 *   2. It offers **no `CanvasControls`**. A presenter is not driving the canvas; the
 *      only thing they may do is leave. A control bar appearing here is the failure
 *      this test guards, and it is invisible to anyone who only reads the sibling.
 *   3. Its loading branch is keyed on **`content === null`**, not on a `room` object.
 *      That distinction is observable: a room whose `content` is the *string* `'null'`
 *      parses to JSON `null`, and `JSON.parse('null')` is a legal parse — so this page
 *      must distinguish "not loaded" (`null`) from "loaded and literally null" and only
 *      the `=== null` reading on a `string | null` state can.
 *
 * `use(params)` suspends during render, so — exactly as documented in
 * `roomViewPage.test.tsx` — the initial `render` has to happen inside an awaited `act`
 * or the committed tree stays on the `Suspense` fallback with no retry scheduled.
 */

type CanvasRoomResponse = Awaited<ReturnType<typeof import('@/lib/api').apiClient.getCanvasRoom>>;

const getCanvasRoom = vi.hoisted(() => vi.fn<(roomId: string) => Promise<CanvasRoomResponse>>());
const bootstrapProps = vi.hoisted(() => vi.fn<(props: CanvasBootstrapProps) => void>());

vi.mock('@/lib/api', () => ({ apiClient: { getCanvasRoom } }));

vi.mock('@/components/canvas/CanvasBootstrap', () => ({
  CanvasBootstrap: (props: import('@/components/canvas/CanvasBootstrap').CanvasBootstrapProps) => {
    bootstrapProps(props);
    return <div data-testid="canvas-bootstrap" />;
  },
}));

// Asserted by *absence* only. `/room/[roomSlug]/view` deliberately mounts these; a
// presenter must not get a zoom/undo bar, and rendering the real ones would drag the
// editor, the store and Rough.js into this file for no assertion.
vi.mock('@/components/canvas/CanvasControls', () => ({
  CanvasControls: () => <div data-testid="canvas-controls" />,
}));

import RoomPresentPage from '@/app/room/[roomSlug]/present/page';
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
 * The page reads `params` with `use()` *during render*, so it suspends. The fallback is
 * empty on purpose: every assertion below must be about the page's own output, never
 * about the boundary's.
 */
function withSuspense(node: React.ReactElement) {
  return <Suspense fallback={<div data-testid="suspense-fallback" />}>{node}</Suspense>;
}

async function renderPage(slug = SLUG) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(withSuspense(<RoomPresentPage params={Promise.resolve({ roomSlug: slug })} />));
  });
  return result;
}

/** Lets already-resolved promises land without moving any clock. */
async function settle(): Promise<void> {
  await act(async () => {});
}

/** A soft navigation to another room: a new `params` promise, same mounted component. */
async function navigateTo(
  rendered: { rerender: (ui: React.ReactElement) => void },
  roomSlug: string
): Promise<void> {
  await act(async () => {
    rendered.rerender(withSuspense(<RoomPresentPage params={Promise.resolve({ roomSlug })} />));
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

beforeEach(() => {
  vi.clearAllMocks();
  getCanvasRoom.mockResolvedValue(roomResponse());
});

describe('/room/[roomSlug]/present — while the room is fetched', () => {
  /**
   * Regression: `content` starts `null`, so the first render *is* the
   * "Loading presentation" message. The projector is the one screen nobody is looking at
   * closely, so a silent blank while a room loads is exactly the failure that gets
   * nobody to mention it.
   */
  it('says it is loading before the room arrives', async () => {
    const request = deferred<CanvasRoomResponse>();
    getCanvasRoom.mockReturnValue(request.promise);
    await renderPage();

    await settle();

    expect(screen.getByRole('heading', { name: 'Loading presentation' })).toBeInTheDocument();
    expect(screen.getByText('Fetching the shared scene…')).toBeInTheDocument();
  });

  /**
   * Regression: the loading branch returns before the canvas, so no canvas and no
   * controls exist while the request is open. A build that mounted `CanvasBootstrap`
   * unconditionally would put a working, empty-looking canvas on the projector over a
   * scene nobody has received yet.
   */
  it('mounts no canvas while the room is still loading', async () => {
    const request = deferred<CanvasRoomResponse>();
    getCanvasRoom.mockReturnValue(request.promise);
    await renderPage();

    await settle();

    expect(screen.queryByTestId('canvas-bootstrap')).not.toBeInTheDocument();
    expect(bootstrapProps).not.toHaveBeenCalled();
  });

  /**
   * Regression: the slug comes from `use(params)`, so the effect's dependency is
   * `roomSlug` and the fetch must use it. Keyed on anything else, the projector loads
   * the wrong room — a rendered scene is more dangerous than no scene, because nobody
   * in the room is checking.
   */
  it('requests the room named by the route slug', async () => {
    await renderPage('a-different-room');

    await settle();

    expect(getCanvasRoom).toHaveBeenCalledWith('a-different-room');
  });
});

describe('/room/[roomSlug]/present — a room that loads', () => {
  /**
   * Regression: the parsed `content` *is* the scene. Asserted on the parsed value, so
   * passing the `room.content` string straight through fails here.
   */
  it('hands the canvas the parsed room content', async () => {
    const content = { elements: [{ id: 'shared-1' }], appState: { zoom: 3 } };
    getCanvasRoom.mockResolvedValue(roomResponse({ content: JSON.stringify(content) }));
    await renderPage();

    await settle();

    expect(initialData()).toEqual(content);
  });

  /**
   * Regression: a presenter must not be able to edit what is on the wall.
   * `CanvasBootstrap` gets `readOnly` as a prop rather than inferring it from the mode,
   * so dropping the prop turns a projected room into an editable one — with no visible
   * change in the chrome.
   */
  it('mounts the canvas read-only', async () => {
    await renderPage();

    await settle();

    expect(sentProps()).toMatchObject({ mode: 'file', theme: 'light', readOnly: true });
  });

  /**
   * Regression: `replaceExisting`. Without it `CanvasBootstrap` can offer to reuse the
   * *previous* local scene — so the projector would show the operator's own last canvas
   * under a page that claims it is showing the room. Asserted alongside `mode: 'file'`
   * because the prop is only meaningful there.
   */
  it('replaces any cached scene rather than offering to reuse it', async () => {
    await renderPage();

    await settle();

    expect(sentProps()).toMatchObject({ mode: 'file', replaceExisting: true });
  });

  /**
   * Regression: the presenter gets **no canvas controls**. `/room/[roomSlug]/view`
   * deliberately mounts them; this page must not. Asserted two ways — the control bar
   * is absent, and nothing else in the tree can act as a stand-in for it — because a
   * single `queryByTestId` on a stubbed child only proves *that* child is gone.
   */
  it('offers no canvas controls', async () => {
    await renderPage();

    await settle();

    expect(screen.getByTestId('canvas-bootstrap')).toBeInTheDocument();
    expect(screen.queryByTestId('canvas-controls')).not.toBeInTheDocument();
    // No other affordance either: the loaded presenter view is the canvas alone.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  /**
   * Regression: the room's `name` is in the response and is deliberately *not* used.
   * A presenter showing a meeting title is fine; showing the name of a *different*
   * room beside the current scene is not. Asserted negatively, with the scene asserted
   * alongside so a page that rendered nothing at all could not pass it.
   */
  it('renders no room chrome, so no name can sit beside the scene', async () => {
    getCanvasRoom.mockResolvedValue(roomResponse({ name: 'Launch Plan' }));
    await renderPage();

    await settle();

    expect(initialData()).toMatchObject({ elements: [{ id: 'shared-1' }] });
    expect(screen.queryByText('Launch Plan')).not.toBeInTheDocument();
    expect(screen.queryByText('Design Review')).not.toBeInTheDocument();
  });

  /**
   * Regression: the effect depends on `[roomSlug]`, and the deps are otherwise all
   * stable (`apiClient` is a module singleton, `use` returns a plain string). Drop the
   * array and every `setContent` re-render re-fires the request — which on a projector
   * means a visible reload of the scene mid-meeting, repeatedly.
   */
  it('does not re-fetch on a re-render with the same slug', async () => {
    const params = Promise.resolve({ roomSlug: SLUG });
    let rerender!: ReturnType<typeof render>['rerender'];
    await act(async () => {
      ({ rerender } = render(withSuspense(<RoomPresentPage params={params} />)));
    });
    expect(getCanvasRoom).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender(withSuspense(<RoomPresentPage params={params} />));
    });

    expect(getCanvasRoom).toHaveBeenCalledTimes(1);
  });

  /** The control for the test above: a different slug is a different room. */
  it('re-fetches and re-renders when the route hands it a different slug', async () => {
    getCanvasRoom
      .mockResolvedValueOnce(roomResponse({ content: '{"elements":[{"id":"from-first"}]}' }))
      .mockResolvedValueOnce(roomResponse({ content: '{"elements":[{"id":"from-second"}]}' }));
    const first = await renderPage('first-room');
    await settle();
    expect(initialData()).toMatchObject({ elements: [{ id: 'from-first' }] });

    await navigateTo(first, 'second-room');

    expect(getCanvasRoom).toHaveBeenCalledTimes(2);
    expect(getCanvasRoom).toHaveBeenLastCalledWith('second-room');
    expect(initialData()).toMatchObject({ elements: [{ id: 'from-second' }] });
  });
});

describe('/room/[roomSlug]/present — content that will not parse', () => {
  it.each([
    ['truncated JSON', '{"elements":['],
    ['an empty string', ''],
    ['a bare word', 'not json at all'],
  ])(
    /**
     * Regression: the `try`/`catch` around `JSON.parse` in the component body. The
     * `catch` is empty by design — the comment above it says so — and the observable
     * consequence is that `initialData` keeps its declared default of `{ elements: [] }`.
     * ADR-004 stores `content` as an unvalidated JSON string, so a half-written row is a
     * matter of time, and this page has no error boundary of its own: a thrown
     * `JSON.parse` would take the projector down mid-meeting with an empty screen.
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
   * Regression: the default is assigned *before* the `try` and the `catch` does not
   * reassign it. A `catch` that set `initialData = null` would hand `CanvasBootstrap`
   * nothing; `loadInitialScene` returns `null` for falsy `initialData`, which skips
   * `setElements` entirely and leaves the previous canvas on the wall under a page
   * claiming to show this room. Asserted as the exact default object.
   */
  it('keeps the declared empty-scene default when parsing fails', async () => {
    getCanvasRoom.mockResolvedValue(roomResponse({ content: '{' }));
    await renderPage();

    await settle();

    expect(initialData()).toStrictEqual({ elements: [] });
  });

  /**
   * Regression: the loading branch is `content === null`, where `content` is
   * `string | null`. The string `'null'` is a *legal* JSON parse yielding `null`, and it
   * must be treated as "loaded, and there is no scene" rather than as "still loading":
   * `JSON.parse('null')` returning `null` means a projection of nothing that at least
   * took its shot, instead of a presenter staring at "Fetching the shared scene…" for a
   * room that is present. Both branches are asserted, which is what pins the distinction
   * in each direction.
   */
  it('treats a stored JSON null as loaded rather than as still loading', async () => {
    getCanvasRoom.mockResolvedValue(roomResponse({ content: 'null' }));
    await renderPage();

    await settle();

    expect(screen.queryByText('Fetching the shared scene…')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Loading presentation' })).not.toBeInTheDocument();
    expect(initialData()).toBeNull();
  });

  /**
   * The control for the test above: an *absent* response body does not reach this
   * branch, because `room.content` is a required string in the response type — so the
   * only way `content` is ever `null` here is "the request has not answered". That is
   * what makes the `'null'` case above a genuine parse rather than a state accident.
   */
  it('has not resolved content before the response lands', async () => {
    const request = deferred<CanvasRoomResponse>();
    getCanvasRoom.mockReturnValue(request.promise);
    await renderPage();

    await settle();

    expect(screen.getByRole('heading', { name: 'Loading presentation' })).toBeInTheDocument();
    expect(bootstrapProps).not.toHaveBeenCalled();

    await act(async () => request.resolve(roomResponse({ content: 'null' })));
    expect(initialData()).toBeNull();
  });

  /**
   * Regression: the control for the malformed-content tests. Content that *does* parse
   * reaches the canvas unchanged, so the empty scene above cannot be satisfied by this
   * page discarding `content` unconditionally.
   */
  it('passes parseable content through untouched', async () => {
    const content = { elements: [{ id: 'a' }, { id: 'b' }] };
    getCanvasRoom.mockResolvedValue(roomResponse({ content: JSON.stringify(content) }));
    await renderPage();

    await settle();

    expect(initialData()).toEqual(content);
  });
});

describe('/room/[roomSlug]/present — a room that will not load', () => {
  it.each([
    ['the room is private', new Error('Room not found')],
    ['the request was refused', new Error('You do not have access to this room')],
    ['the transport failed', new TypeError('fetch failed')],
  ])(
    /**
     * Regression: the `catch` has to put the server's words on screen. "This room is
     * private" and "you are offline" call for different responses from whoever is
     * holding the clicker — ask for an invite versus fix the projector — and a generic
     * apology gives them neither.
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
   * room.'`. A bare rejection (a thrown string, an exotic `fetch` failure) has no
   * `.message`, so without the guard the panel is an empty paragraph and whoever is
   * presenting is told nothing at all about why the screen is blank.
   */
  it('falls back to a readable message for a non-Error rejection', async () => {
    getCanvasRoom.mockRejectedValue('kaboom');
    await renderPage();

    await settle();

    expect(screen.getByText('Unable to load room.')).toBeInTheDocument();
  });

  /**
   * Regression: the error branch must render no canvas and no controls. A catch that
   * fell through to the canvas would project a read-only *empty* room, which is
   * indistinguishable from a room that is simply blank — and the person presenting would
   * spend the meeting drawing on nothing.
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
   * Regression: `if (error)` comes *before* `if (content === null)`, so a failure
   * replaces the loading message rather than sitting beside it — both use the same
   * `RoomMessage` chrome, so without the ordering the projector would claim it is
   * fetching a scene it has already failed to fetch. Asserted as an absence.
   */
  it('replaces the loading message with the failure', async () => {
    const request = deferred<CanvasRoomResponse>();
    getCanvasRoom.mockReturnValue(request.promise);
    await renderPage();
    await settle();
    expect(screen.getByRole('heading', { name: 'Loading presentation' })).toBeInTheDocument();

    await act(async () => request.reject(new Error('Room not found')));

    expect(screen.queryByText('Fetching the shared scene…')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Room unavailable' })).toBeInTheDocument();
    expect(screen.getByText('Room not found')).toBeInTheDocument();
  });

  /**
   * Regression: `cancelled` gates the error `setState`. The observable form is a
   * *rejected* request landing after its effect was cleaned up while the component stayed
   * mounted — which is exactly what a slug change produces. Without the gate, the
   * abandoned failure would replace the incoming room's loading message with a dead end
   * for a room someone is still waiting on.
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
    expect(screen.getByRole('heading', { name: 'Loading presentation' })).toBeInTheDocument();

    await act(async () =>
      current.resolve(roomResponse({ content: '{"elements":[{"id":"second"}]}' }))
    );
    expect(screen.queryByText('Room unavailable')).not.toBeInTheDocument();
    expect(initialData()).toMatchObject({ elements: [{ id: 'second' }] });
  });
});

describe('/room/[roomSlug]/present — leaving before the room arrives', () => {
  /**
   * Regression: the same `cancelled` gate on the success path. Asserted on what the page
   * decided to render rather than on a `setState` that cannot be observed after unmount:
   * `CanvasBootstrap` mounting is the observable fact, and it happens here only when the
   * response was accepted.
   */
  it('renders no canvas when the presenter leaves before the response', async () => {
    const request = deferred<CanvasRoomResponse>();
    getCanvasRoom.mockReturnValue(request.promise);
    const { unmount } = await renderPage();

    unmount();
    await act(async () => request.resolve(roomResponse()));

    expect(bootstrapProps).not.toHaveBeenCalled();
    expect(screen.queryByTestId('canvas-controls')).not.toBeInTheDocument();
  });

  /**
   * Regression: the practical consequence of the gate under React's automatic batching —
   * two rooms in sequence, the first slow. Without it the abandoned response wins the
   * projector even though the presenter has already moved on to the second room, and the
   * wrong meeting is shown to the room for as long as it stays open.
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
