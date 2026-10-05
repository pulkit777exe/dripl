import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

/**
 * `/board/[token]` is the read-only preview behind a share link, and it had **no tests
 * at all** — all 27 of its statements were uncovered.
 *
 * Three things happen here that no other page in this set does, and each has a failure
 * mode worth naming:
 *
 *   1. It **wipes the live canvas store** (`setElements([], {skipHistory: true})` then
 *      `clearSelection()`) before handing over. This is a singleton store shared with
 *      the rest of the app, so a shared-board visit that did *not* clear it would leave
 *      the previous canvas's shapes on screen underneath the shared scene. The wipe is
 *      also why `skipHistory` is there: an undo that stepped back to the *previous*
 *      canvas would be a cross-document history leak.
 *   2. It **parses persisted content itself** (`parseRoomContent`). The `content`
 *      column is `unknown` (ADR-004), so a malformed row must degrade to an empty
 *      scene rather than hand a string to the renderer.
 *   3. It has a `cancelled` flag guarding every `setState`. Without it, a slow share
 *      request that resolves after the user navigated away still writes state — and,
 *      worse for this page, still performs the store wipe, so merely *opening* a share
 *      link and leaving would erase the canvas you were working on.
 *
 * `CanvasBootstrap` is replaced by a recording stub: it is a named export that pulls in
 * the whole editor, Rough.js and the bitmap cache, and the assertions here are about
 * the props this page *decides* to send — `readOnly` and `replaceExisting` above all,
 * since dropping either turns a preview into an editable or a cached-reuse view.
 */

type SharedRoomResponse = Awaited<ReturnType<typeof import('@/lib/api').apiClient.getSharedRoom>>;

const getSharedRoom = vi.hoisted(() => vi.fn<(token: string) => Promise<SharedRoomResponse>>());

const bootstrapProps = vi.hoisted(() => vi.fn<(props: CanvasBootstrapProps) => void>());

vi.mock('@/lib/api', () => ({ apiClient: { getSharedRoom } }));

vi.mock('@/components/canvas/CanvasBootstrap', () => ({
  CanvasBootstrap: (props: import('@/components/canvas/CanvasBootstrap').CanvasBootstrapProps) => {
    bootstrapProps(props);
    return <div data-testid="canvas-bootstrap" />;
  },
}));

import { useCanvasStore } from '@/lib/store';
import SharedBoardPage from '@/app/board/[token]/page';
import type { DriplElement } from '@dripl/common';
import type { CanvasBootstrapProps } from '@/components/canvas/CanvasBootstrap';

const TOKEN = 'share-token-abc';

/** A shape already on the canvas, so a wipe is observable. */
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

function sharedRoomResponse(
  overrides: Partial<SharedRoomResponse['room']> = {}
): SharedRoomResponse {
  return {
    room: {
      id: 'room-1',
      slug: 'design-review',
      name: 'Design Review',
      content: JSON.stringify({ elements: [{ id: 'shared-1', type: 'ellipse' }] }),
      isPublic: false,
      ...overrides,
    },
    permission: 'VIEW',
    expiresAt: '2026-12-31T00:00:00.000Z',
  };
}

/**
 * An empty envelope, which the typed contract forbids.
 *
 * The runtime `!room` half of `if (error || !room)` is only reachable when the request
 * *succeeds* and still leaves the state null, so the fallback copy
 * (`error ?? 'This share link is invalid or expired.'`) cannot be reached through a
 * well-formed response. It is asserted anyway because it is the branch a 200-with-no-body
 * would land on, and rendering a canvas then would be worse than a dead end.
 */
function emptyEnvelope(): SharedRoomResponse {
  return null as unknown as SharedRoomResponse;
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

function renderPage(token = TOKEN, paramsPromise?: Promise<{ token: string }>) {
  const params = paramsPromise ?? Promise.resolve({ token });
  return { ...render(<SharedBoardPage params={params} />), params };
}

/** Lets already-resolved promises land without moving any clock. */
async function settle(): Promise<void> {
  await act(async () => {});
}

/** The props `CanvasBootstrap` received on its last render. */
function sentProps(): CanvasBootstrapProps {
  const call = bootstrapProps.mock.calls.at(-1);
  if (call === undefined) throw new Error('CanvasBootstrap was never rendered');
  return call[0];
}

function hasElement(id: string): boolean {
  return useCanvasStore.getState().elements.some(element => element.id === id);
}

beforeEach(() => {
  vi.clearAllMocks();
  getSharedRoom.mockResolvedValue(sharedRoomResponse());
  // Seed a dirty canvas: a previous document's shapes plus a live selection, which is
  // exactly the state a shared-board visit must not inherit.
  useCanvasStore.setState({
    elements: [existingElement('mine-1'), existingElement('mine-2')],
    elementsById: new Map([
      ['mine-1', existingElement('mine-1')],
      ['mine-2', existingElement('mine-2')],
    ]),
    selectedIds: new Set(['mine-1']),
    past: [],
    future: [],
  });
});

describe('/board/[token] — while the share request runs', () => {
  /**
   * Regression: the page fetches on mount and the canvas cannot be rendered until the
   * content arrives, so this is the only thing on screen between the user pasting a
   * share link and the board appearing. Without it the page is a blank cream rectangle.
   */
  it('announces that the board is loading', async () => {
    const request = deferred<SharedRoomResponse>();
    getSharedRoom.mockReturnValue(request.promise);
    renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('Loading shared board...');
    expect(screen.queryByTestId('canvas-bootstrap')).not.toBeInTheDocument();

    await act(async () => request.resolve(sharedRoomResponse()));
  });

  /**
   * Regression: `loading` starts true and is only cleared in the `finally`. If the
   * flag were initialised false the page would flash the "invalid or expired" panel on
   * every load before the request came back — telling the user their own share link is
   * broken, for the duration of one request.
   */
  it('does not claim the link is invalid while the request is still open', async () => {
    const request = deferred<SharedRoomResponse>();
    getSharedRoom.mockReturnValue(request.promise);
    renderPage();

    expect(screen.queryByText('This share link is invalid or expired.')).not.toBeInTheDocument();
    expect(screen.queryByText('Board unavailable')).not.toBeInTheDocument();

    await act(async () => request.resolve(sharedRoomResponse()));
  });

  /**
   * Regression: the token comes from the route segment, so the request must use it.
   * Hard-coding a token, or fetching before `params` resolves, would load the wrong
   * board — and a share link that renders *some* board is far worse than one that
   * renders none.
   */
  it('requests the board named by the route token', async () => {
    renderPage('a-different-token');

    await settle();

    expect(getSharedRoom).toHaveBeenCalledWith('a-different-token');
  });
});

describe('/board/[token] — a shared board that loads', () => {
  /**
   * Regression: the pill names the room from the *response*, not from the URL, and it
   * says read-only. This is the only place the user is told what they are looking at;
   * a share link that renders an anonymous canvas gives no way to tell two shared
   * boards apart.
   */
  it('names the room and states that the view is read-only', async () => {
    getSharedRoom.mockResolvedValue(sharedRoomResponse({ name: 'Q3 Architecture' }));
    renderPage();

    await settle();

    expect(screen.getByText(/Q3 Architecture/)).toHaveTextContent(
      'Q3 Architecture · Read-only shared preview'
    );
  });

  /**
   * Regression: `readOnly` is what makes this a *preview*. Drop it and a VIEW-permission
   * visitor gets a working toolbar over someone else's board, and any edit is either
   * silently discarded or, worse, saved into the owner's room.
   */
  it('mounts the canvas read-only', async () => {
    renderPage();

    await settle();

    expect(sentProps()).toMatchObject({ mode: 'file', theme: 'light', readOnly: true });
  });

  /**
   * Regression: `replaceExisting`. Without it `CanvasBootstrap` offers to reuse a
   * cached local scene instead of loading the shared one, so opening a share link can
   * show the *previous* canvas — the same cross-document leak as a missing store wipe,
   * one layer down.
   */
  it('asks the canvas to replace any cached scene', async () => {
    renderPage();

    await settle();

    expect(sentProps()).toMatchObject({ replaceExisting: true });
  });

  /**
   * Regression: the parsed `content` is what the visitor sees. Asserted on the parsed
   * value rather than the string, so a `parseRoomContent` that returned the raw string
   * — or a `room.content` that was passed straight through — fails here.
   */
  it('hands the canvas the parsed room content', async () => {
    const content = { elements: [{ id: 'shared-1', type: 'ellipse' }], appState: { zoom: 2 } };
    getSharedRoom.mockResolvedValue(sharedRoomResponse({ content: JSON.stringify(content) }));
    renderPage();

    await settle();

    expect(sentProps()).toMatchObject({ initialData: content });
  });

  /**
   * Regression: the wipe. `setElements([], { skipHistory: true })` runs *before*
   * `setRoom`, so the previous document's shapes cannot survive into the shared view
   * even for one frame. Asserted on the real store, seeded with two of the visitor's
   * own elements.
   */
  it('empties the previous canvas before showing the shared scene', async () => {
    expect(hasElement('mine-1')).toBe(true);

    renderPage();
    await settle();

    expect(useCanvasStore.getState().elements).toEqual([]);
  });

  /**
   * Regression: `clearSelection()` follows the wipe. A selection index entry for a
   * removed element leaves the selection overlay resolving bounds for an id that is no
   * longer in the scene, which renders marquee handles at stale coordinates — shapes
   * that appear selectable on top of the shared board.
   */
  it('drops a selection made on the previous canvas', async () => {
    expect(useCanvasStore.getState().selectedIds.size).toBe(1);

    renderPage();
    await settle();

    expect(useCanvasStore.getState().selectedIds.size).toBe(0);
  });

  /**
   * Regression: the wipe must not be undoable. `skipHistory: true` keeps it out of
   * `past`, so the previous canvas's history does not survive into the share view
   * where a Ctrl-Z would restore the owner's document into this tab.
   */
  it('wipes without recording an undo step', async () => {
    renderPage();
    await settle();

    expect(useCanvasStore.getState().past).toEqual([]);
  });

  /**
   * Regression: `CanvasBootstrap` is the *only* place the shared scene is drawn, so
   * "the page rendered something" and "the board rendered" are not the same claim.
   * Asserted positively here so the negative assertions in the failure branches below
   * cannot be satisfied by a page that renders no canvas at all.
   */
  it('renders the canvas exactly once', async () => {
    renderPage();
    await settle();

    expect(screen.getByTestId('canvas-bootstrap')).toBeInTheDocument();
    expect(bootstrapProps).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression: the effect depends on `[params]`. In the App Router a client page
   * receives a *new* promise when the route segment changes, and without the dependency
   * a soft navigation between two share links would keep showing the first board.
   * Asserted over an explicit re-render with a new params object, so "once" is a
   * property of the render sequence.
   */
  it('does not re-fetch on a re-render with the same params', async () => {
    const params = Promise.resolve({ token: TOKEN });
    const { rerender } = render(<SharedBoardPage params={params} />);
    await settle();
    expect(getSharedRoom).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender(<SharedBoardPage params={params} />);
    });

    expect(getSharedRoom).toHaveBeenCalledTimes(1);
  });

  /** The control for the test above: a new params promise *is* a new route segment. */
  it('re-fetches when the route hands it a new params promise', async () => {
    const { rerender } = render(<SharedBoardPage params={Promise.resolve({ token: 'first' })} />);
    await settle();
    expect(getSharedRoom).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender(<SharedBoardPage params={Promise.resolve({ token: 'second' })} />);
    });
    await settle();

    expect(getSharedRoom).toHaveBeenCalledTimes(2);
    expect(getSharedRoom).toHaveBeenLastCalledWith('second');
  });
});

describe('/board/[token] — content that will not parse', () => {
  it.each([
    ['truncated JSON', '{"elements":['],
    ['an empty string', ''],
    ['a bare word', 'not json at all'],
  ])(
    /**
     * Regression: `parseRoomContent`'s `catch`. ADR-004 stores `content` as an
     * unvalidated JSON string, so a half-written or hand-edited row is a matter of time.
     * Passing the raw string on would hand `CanvasBootstrap` something that is not an
     * element list, and the failure surfaces as a canvas that throws on its first draw
     * — after the user has already decided the link worked.
     */
    'degrades to an empty scene when the content is %s',
    async (_label, content) => {
      getSharedRoom.mockResolvedValue(sharedRoomResponse({ content }));
      renderPage();

      await settle();

      expect(sentProps()).toMatchObject({ initialData: { elements: [] } });
      expect(screen.getByTestId('canvas-bootstrap')).toBeInTheDocument();
    }
  );

  /**
   * Regression: the fallback shape is `{ elements: [] }`, not `[]`.
   * `CanvasBootstrap` reads `initialData.elements`; handing it a bare array makes the
   * scene read as `undefined` and render as nothing at all — the same visible result as
   * a genuinely empty board, which is exactly what the fallback exists to avoid.
   */
  it('falls back to an object carrying an elements array', async () => {
    getSharedRoom.mockResolvedValue(sharedRoomResponse({ content: '{' }));
    renderPage();

    await settle();

    const props = sentProps();
    expect(props.mode === 'file' ? props.initialData : null).toEqual({
      elements: [],
    });
  });

  /**
   * LABELLED — known gap, pinned as it behaves today, not as it should behave.
   *
   * `parseRoomContent` catches *syntax* errors only. Valid JSON that is not a scene —
   * `'42'`, `'"text"'`, `'null'` — parses successfully and is handed straight to
   * `CanvasBootstrap` as `initialData`. It happens to be harmless today because
   * `loadInitialScene` guards on `Array.isArray` / `typeof === 'object'` and returns an
   * empty element list for anything else (see `lib/scene-loader.ts`), so the rendered
   * result is the same empty board the fallback produces. That is a *downstream* safety
   * net this page is relying on without knowing it: a JSON scalar in `content` is a
   * shape ADR-004 permits, and `parseRoomContent` claims to defend against unparseable
   * content without covering it.
   */
  it('passes a valid JSON scalar through to the canvas unchanged', async () => {
    getSharedRoom.mockResolvedValue(sharedRoomResponse({ content: '42' }));
    renderPage();

    await settle();

    const props = sentProps();
    expect(props.mode === 'file' ? props.initialData : undefined).toBe(42);
    expect(screen.getByTestId('canvas-bootstrap')).toBeInTheDocument();
  });

  /**
   * Regression: a room with genuinely empty content (`''` parses to nothing valid, but
   * `'{"elements":[]}'` is a well-formed empty scene) renders an empty board, not an
   * error. This is the control for the tests above: it proves the fallback is only
   * reached by unparseable text.
   */
  it('renders an empty scene when the room is legitimately empty', async () => {
    getSharedRoom.mockResolvedValue(sharedRoomResponse({ content: '{"elements":[]}' }));
    renderPage();

    await settle();

    expect(sentProps()).toMatchObject({ initialData: { elements: [] } });
    expect(screen.queryByText('Board unavailable')).not.toBeInTheDocument();
  });
});

describe('/board/[token] — a board that will not load', () => {
  it.each([
    ['the link was revoked', new Error('Share link has been revoked')],
    ['the link expired', new Error('This share link has expired')],
    ['the transport failed', new TypeError('fetch failed')],
  ])(
    /**
     * Regression: the `catch` has to put the server's own words on screen. A revoked
     * link and a network blip need different user responses — ask the owner for a new
     * link, versus try again — and a generic "something went wrong" gives the reader
     * neither.
     */
    'shows the message the server refused %s with',
    async (_label, failure) => {
      getSharedRoom.mockRejectedValue(failure);
      renderPage();

      await settle();

      expect(screen.getByRole('heading', { name: 'Board unavailable' })).toBeInTheDocument();
      expect(screen.getByText(failure.message)).toBeInTheDocument();
    }
  );

  /**
   * Regression: `requestError instanceof Error ? requestError.message : 'Unable to load
   * this board.'`. A non-`Error` rejection (a thrown string, an exotic transport
   * failure) has no `.message`, so without the guard the panel renders an empty
   * paragraph and the visitor is told nothing about why their link did nothing.
   */
  it('falls back to a readable message for a non-Error rejection', async () => {
    getSharedRoom.mockRejectedValue('kaboom');
    renderPage();

    await settle();

    expect(screen.getByText('Unable to load this board.')).toBeInTheDocument();
  });

  /**
   * Regression: the failure branch must render *no canvas*. This is the assertion the
   * whole store-wipe test leans on: a catch that fell through to the canvas with
   * `elements: []` would show a working read-only board over an empty scene, which is
   * indistinguishable from a shared board that is simply empty — and the visitor has no
   * way to know they are looking at nothing rather than at someone's work.
   */
  it('renders no canvas when the request fails', async () => {
    getSharedRoom.mockRejectedValue(new Error('Share link has been revoked'));
    renderPage();

    await settle();

    expect(screen.queryByTestId('canvas-bootstrap')).not.toBeInTheDocument();
    expect(bootstrapProps).not.toHaveBeenCalled();
  });

  /**
   * Regression: a failed load must leave the visitor's own canvas alone. The wipe is
   * inside the `try`'s success path, so a failure that emptied the store would destroy
   * the document they were working on for a link that never opened.
   */
  it('leaves the previous canvas untouched when the request fails', async () => {
    getSharedRoom.mockRejectedValue(new Error('Share link has been revoked'));
    renderPage();

    await settle();

    expect(hasElement('mine-1')).toBe(true);
    expect(hasElement('mine-2')).toBe(true);
    expect(useCanvasStore.getState().selectedIds.has('mine-1')).toBe(true);
  });

  /**
   * Regression: `error` is cleared by nothing on this page, and the page is mounted
   * fresh per visit, so the panel cannot outlive its cause. More importantly this pins
   * that the *loading* state is released on the failure path: a `finally` that had been
   * moved into the `try` would leave "Loading shared board..." on screen forever next
   * to a dead link.
   */
  it('leaves the loading state on the failure path', async () => {
    getSharedRoom.mockRejectedValue(new Error('Share link has been revoked'));
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Loading shared board...');

    await settle();

    expect(screen.queryByText('Loading shared board...')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Board unavailable' })).toBeInTheDocument();
  });

  /**
   * Regression: the `!room` half of `if (error || !room)`, and the `error ?? …`
   * fallback copy. A 200 carrying no payload would otherwise fall through to the canvas
   * with `room.room.name` throwing on the way out. Reachable only with a
   * contract-violating response — see `emptyEnvelope`.
   */
  it('renders the unavailable panel when the response carries no room', async () => {
    getSharedRoom.mockResolvedValue(emptyEnvelope());
    renderPage();

    await settle();

    expect(screen.getByRole('heading', { name: 'Board unavailable' })).toBeInTheDocument();
    expect(screen.getByText('This share link is invalid or expired.')).toBeInTheDocument();
    expect(bootstrapProps).not.toHaveBeenCalled();
  });
});

describe('/board/[token] — leaving before the board arrives', () => {
  /**
   * Regression: `cancelled` is set by the effect's cleanup, and it gates the *store
   * wipe* as well as the `setState`s. Without that gate, opening a share link and
   * immediately navigating away would still run `setElements([])` when the request
   * landed — erasing the canvas the visitor went back to, with no visible action of
   * theirs having caused it. This is asserted on the store, because after unmount
   * nothing is on screen and a state-update assertion would be watching nothing.
   */
  it('does not wipe the store when the visitor leaves before the response', async () => {
    const request = deferred<SharedRoomResponse>();
    getSharedRoom.mockReturnValue(request.promise);
    const { unmount } = renderPage();

    unmount();
    await act(async () => request.resolve(sharedRoomResponse()));

    expect(hasElement('mine-1')).toBe(true);
    expect(hasElement('mine-2')).toBe(true);
    expect(useCanvasStore.getState().selectedIds.has('mine-1')).toBe(true);
  });

  /**
   * Regression: the same gate on the failure path, and the pairing with the test above:
   * the *success* path is cancelled on unmount, and so is the failure path. A gate that
   * only covered the success branch would still set `error` on a dead component.
   */
  it('does not report a failure for a component that has already unmounted', async () => {
    const request = deferred<SharedRoomResponse>();
    getSharedRoom.mockReturnValue(request.promise);
    const { unmount } = renderPage();

    unmount();
    await act(async () => request.reject(new Error('Share link has been revoked')));

    expect(screen.queryByText('Board unavailable')).not.toBeInTheDocument();
  });

  /**
   * Regression: `cancelled` also gates the `finally`'s `setLoading(false)`, and that
   * one *is* observable without an unmount — because the cleanup runs on a `params`
   * identity change while the component stays mounted. An abandoned request landing
   * mid-flight for the current one therefore clears `loading` early, and with
   * `room` still null and `error` still null the page falls into
   * `if (error || !room)` and shows the visitor "This share link is invalid or
   * expired." for a link that is merely still loading. The `!room` fallback copy is
   * doing double duty as a loading-race symptom here.
   */
  it('keeps the loading screen up while the current request is still open', async () => {
    const abandoned = deferred<SharedRoomResponse>();
    const current = deferred<SharedRoomResponse>();
    getSharedRoom.mockReturnValueOnce(abandoned.promise).mockReturnValueOnce(current.promise);
    const first = renderPage('first-token');
    await settle();

    // A new params promise: the first effect is cleaned up, the component stays mounted.
    await act(async () => {
      first.rerender(<SharedBoardPage params={Promise.resolve({ token: 'second-token' })} />);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Loading shared board...');

    // The abandoned request lands first and must not end the current one's loading state.
    await act(async () => abandoned.resolve(sharedRoomResponse({ name: 'First Board' })));
    expect(screen.getByRole('status')).toHaveTextContent('Loading shared board...');
    expect(screen.queryByText('This share link is invalid or expired.')).not.toBeInTheDocument();

    await act(async () => current.resolve(sharedRoomResponse({ name: 'Second Board' })));
    expect(screen.getByText(/Second Board/)).toBeInTheDocument();
  });

  /**
   * Regression: a late response from an *abandoned* request must not overwrite the
   * board the visitor is now looking at. Two share links in sequence, the first slow,
   * and without the guard the first render wins the screen even though the second
   * resolved later.
   */
  it('lets the current request win when an abandoned one resolves late', async () => {
    const slow = deferred<SharedRoomResponse>();
    const fast = deferred<SharedRoomResponse>();
    getSharedRoom.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    const first = renderPage('first-token');
    await settle();

    // New route segment, new params promise: the first effect is cleaned up.
    await act(async () => {
      first.rerender(<SharedBoardPage params={Promise.resolve({ token: 'second-token' })} />);
    });
    await act(async () => fast.resolve(sharedRoomResponse({ name: 'Second Board' })));
    expect(screen.getByText(/Second Board/)).toBeInTheDocument();

    // The abandoned request lands afterwards and must not take the screen back.
    await act(async () => slow.resolve(sharedRoomResponse({ name: 'First Board' })));

    expect(screen.getByText(/Second Board/)).toBeInTheDocument();
    expect(screen.queryByText(/First Board/)).not.toBeInTheDocument();
  });
});
