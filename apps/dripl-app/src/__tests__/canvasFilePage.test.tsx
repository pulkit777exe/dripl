import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * `app/canvas/[fileId]/page.tsx` is the server half of opening a collaboration room,
 * and **not one of its 15 statements had ever run**. It replaced a client-side
 * `useEffect` room lookup with a server one, so the interesting questions are all about
 * the paths the browser used to own — and each of them is a decision that renders
 * something a user sees:
 *
 *   - **authentication** happens first, before the room is even looked up. Two
 *     different stops can produce the same redirect (`readSessionUserId()` returning
 *     `null`, and `readSessionBearer()` returning `null` while a `userId` was found),
 *     and they must stop in different places.
 *   - a **refusal** (401/403) means "not you", and sends the caller back to sign in. A
 *     catch that treated it like every other failure would render "this session has
 *     ended" to someone who is perfectly well signed in and merely not allowed in —
 *     and offer them "Go to canvas" as the way forward.
 *   - everything else, **404 included**, is "could not load" and renders the
 *     unavailable panel. Both branches render *something*, so "a panel appeared" is not
 *     evidence of which one ran; the assertions here distinguish them by whether
 *     `CanvasRoomRoute` mounted at all.
 *
 * `serverApiError` and `ServerApiError` are the real ones — that class is what tells the
 * two failure shapes apart, and a mock of it would let the split be inverted silently.
 * Only the transport and the session readers are mocked. `logError` is replaced with a
 * spy because it is `console.error`-backed and the assertions want its *payload*, which
 * is a real decision this page makes: it logs the room id and the upstream status, and
 * deliberately not the credential.
 */

const redirect = vi.hoisted(() =>
  vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  })
);

const serverApiGet = vi.hoisted(() =>
  vi.fn<(path: string, options: { token: string | null; cache: string }) => Promise<unknown>>()
);

const routeProps = vi.hoisted(() => vi.fn<(props: { roomId: string }) => void>());
const logError = vi.hoisted(() => vi.fn<(message: string) => void>());

vi.mock('next/navigation', () => ({ redirect }));

vi.mock('@/lib/server/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/server/api')>();
  return { ...actual, serverApiGet };
});

vi.mock('@/lib/server/session', () => ({
  readSessionUserId: vi.fn(),
  readSessionBearer: vi.fn(),
}));

vi.mock('@/components/canvas/CanvasRoomRoute', () => ({
  CanvasRoomRoute: (props: { roomId: string }) => {
    routeProps(props);
    return <div data-testid="canvas-room-route" />;
  },
}));

// `logError` is console-backed; the assertions below read its payload, so it is replaced
// rather than silenced.
vi.mock('@dripl/common', async importOriginal => {
  const actual = await importOriginal<typeof import('@dripl/common')>();
  return { ...actual, logError };
});

import { ServerApiError } from '@/lib/server/api';
import { readSessionBearer, readSessionUserId } from '@/lib/server/session';
import CanvasFilePage from '@/app/canvas/[fileId]/page';

const ROOM_ID = 'room-abc';
const TOKEN = 'session-token-value';
const USER_ID = 'user-1';

function roomResponse(
  overrides: Partial<{
    id: string;
    slug: string;
    name: string;
    isPublic: boolean;
    content: string;
  }> = {}
) {
  return {
    room: {
      id: ROOM_ID,
      slug: 'design-review',
      name: 'Design Review',
      isPublic: true,
      content: '{"elements":[]}',
      ...overrides,
    },
  };
}

/** Renders whatever the server component returned, or fails loudly. */
async function renderPage(id = ROOM_ID) {
  const node = await CanvasFilePage({ params: Promise.resolve({ fileId: id }) });
  if (!React.isValidElement(node)) throw new Error('the page returned no element');
  return render(node);
}

/** Runs the page expecting a `redirect`, and returns where it sent the user. */
async function redirectTargetFor(id = ROOM_ID): Promise<string> {
  try {
    await CanvasFilePage({ params: Promise.resolve({ fileId: id }) });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT:')) {
      return error.message.slice('NEXT_REDIRECT:'.length);
    }
    throw error;
  }
  throw new Error('the page did not redirect');
}

/** The room id the route handed the canvas, read from the last `CanvasRoomRoute` render. */
function sentRoomId(): string {
  const call = routeProps.mock.calls.at(-1);
  if (call === undefined) throw new Error('CanvasRoomRoute was never rendered');
  return call[0].roomId;
}

/** The structured record the page logged, parsed back out of its JSON payload. */
function loggedRecord(): Record<string, unknown> {
  const call = logError.mock.calls.at(-1);
  if (call === undefined) throw new Error('logError was never called');
  return JSON.parse(call[0]) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readSessionUserId).mockResolvedValue(USER_ID);
  vi.mocked(readSessionBearer).mockResolvedValue(TOKEN);
  serverApiGet.mockResolvedValue(roomResponse());
});

describe('/canvas/[fileId] — who is asking', () => {
  /**
   * Regression: no session means no canvas, and the caller has to be sent to sign-in
   * carrying the room they were trying to open. The upstream call must not even be
   * attempted — a 401 from it would be a second, weaker version of the same refusal.
   */
  it('sends an anonymous visitor to sign in without calling the API', async () => {
    vi.mocked(readSessionUserId).mockResolvedValue(null);

    const target = await redirectTargetFor();

    expect(target).toBe(`/login?next=${encodeURIComponent(`/canvas/${ROOM_ID}`)}`);
    expect(serverApiGet).not.toHaveBeenCalled();
  });

  /**
   * Regression: `readSessionBearer()` returning `null` is a *different* stop from a
   * missing `userId` — a verified session with no usable token — and it must stop before
   * the fetch too. Otherwise the page makes an anonymous upstream call and renders
   * whatever that call returns, which is the point of the guard.
   */
  it('sends a caller with no verified token to sign in', async () => {
    vi.mocked(readSessionBearer).mockResolvedValue(null);

    const target = await redirectTargetFor();

    expect(target).toBe(`/login?next=${encodeURIComponent(`/canvas/${ROOM_ID}`)}`);
    expect(serverApiGet).not.toHaveBeenCalled();
  });

  /**
   * Regression: the first stop must come *before* the second. Both produce the same
   * redirect, so the only observable difference is that the second reader is never
   * consulted — asserted here so that reordering the two guards (and reaching the token
   * reader for an anonymous visitor) is caught.
   */
  it('does not look for a token when there is no user id at all', async () => {
    vi.mocked(readSessionUserId).mockResolvedValue(null);

    await redirectTargetFor();

    expect(readSessionBearer).not.toHaveBeenCalled();
  });

  /**
   * Regression: the `next` value is URL-supplied and goes straight into a redirect. An
   * unencoded id containing `&` or `#` would truncate the path and bounce the caller to
   * a room that does not exist — or, with `&`, to a *different* room's canvas.
   */
  it('encodes the room id into the sign-in detour', async () => {
    vi.mocked(readSessionUserId).mockResolvedValue(null);

    const target = await redirectTargetFor('a/b c&d');

    expect(target).toBe(`/login?next=${encodeURIComponent('/canvas/a/b c&d')}`);
  });

  /**
   * Regression: the same encoding applies to the upstream path. `fileId` comes from the
   * route, so `/rooms/${id}` without `encodeURIComponent` lets an id containing `/`
   * address a different resource than the one being rendered — the caller would be put
   * into a room they never asked for.
   */
  it('encodes the room id into the upstream path', async () => {
    await renderPage('a/b c');

    expect(serverApiGet.mock.calls[0]?.[0]).toBe('/rooms/a%2Fb%20c');
  });
});

describe('/canvas/[fileId] — the fetch', () => {
  /**
   * Regression: the Next data cache is shared across visitors, so a cached personalized
   * body would be served to the *next* requester — one person's room to another, and a
   * stale one if the room closed. `no-store` is the platform enforcing that rather than
   * a comment promising it. The module docstring says exactly this about the route.
   */
  it('asks for an uncached response', async () => {
    await renderPage();

    expect(serverApiGet.mock.calls[0]?.[1].cache).toBe('no-store');
  });

  /**
   * Regression: a server-side fetch has no ambient cookie jar for another origin, so the
   * verified token has to be forwarded explicitly. Drop the option and every server
   * render is an anonymous request that 401s — i.e. every signed-in collaborator is sent
   * to the login page by a route that was supposed to remove that detour.
   */
  it('forwards the verified session token', async () => {
    await renderPage();

    expect(serverApiGet.mock.calls[0]?.[1].token).toBe(TOKEN);
  });

  /**
   * Regression: the canvas is mounted with **`room.slug`**, not the route's `fileId`.
   * The two are different identifiers for the same room, and only one of them is what
   * `CanvasRoomRoute` asks the websocket for. Asserted by making them differ, which is
   * the only way the assertion has any content.
   */
  it('mounts the canvas with the slug from the response, not the requested id', async () => {
    serverApiGet.mockResolvedValue(roomResponse({ id: 'other-id', slug: 'renamed-slug' }));

    await renderPage(ROOM_ID);

    expect(sentRoomId()).toBe('renamed-slug');
  });

  /**
   * The control for the test above: the requested id and the slug agree in the fixture
   * used everywhere else, so that a build passing `fileId` through would render an
   * identical string here and the previous test would be the only thing standing.
   */
  it('uses a single identifier when the response agrees with the route', async () => {
    serverApiGet.mockResolvedValue(roomResponse({ id: ROOM_ID, slug: ROOM_ID }));

    await renderPage(ROOM_ID);

    expect(sentRoomId()).toBe(ROOM_ID);
    expect(serverApiGet.mock.calls[0]?.[0]).toBe(`/rooms/${ROOM_ID}`);
  });

  /**
   * Regression: a successful render mounts the canvas exactly once. The page is a server
   * component with no effects, so a second mount would mean the lookup ran twice — the
   * same request the route exists to make once, per render.
   */
  it('mounts the canvas exactly once', async () => {
    await renderPage();

    expect(routeProps).toHaveBeenCalledTimes(1);
    expect(serverApiGet).toHaveBeenCalledTimes(1);
  });
});

describe('/canvas/[fileId] — a refused request', () => {
  it.each([401, 403])(
    /**
     * Regression: a refusal is "not you", not "could not load". Rendering the
     * unavailable panel for a 403 tells a signed-in caller their session has ended when
     * in fact they were simply not allowed into this room — and hands them a "Go to
     * canvas" button where the sign-in they actually need was.
     */
    'redirects to sign in on a %i',
    async status => {
      serverApiGet.mockRejectedValue(new ServerApiError(status, 'Not yours'));

      const target = await redirectTargetFor();

      expect(target).toBe(`/login?next=${encodeURIComponent(`/canvas/${ROOM_ID}`)}`);
    }
  );

  /**
   * Regression: the redirect target on a refusal names the room the caller was trying to
   * open, so signing in resumes where they were. A refusal that redirected to a bare
   * `/login` would drop the caller on a login form and, after it, on the dashboard —
   * losing the room they were in.
   */
  it('carries the room through the refusal so sign-in resumes it', async () => {
    serverApiGet.mockRejectedValue(new ServerApiError(403, 'Not yours'));

    const target = await redirectTargetFor('launch-plan');

    expect(target).toBe(`/login?next=${encodeURIComponent('/canvas/launch-plan')}`);
  });

  /**
   * Regression: the unavailable panel and a canvas are both "something rendered", so the
   * only way to prove the refusal branch ran is that the canvas did **not**. Asserted
   * positively here: without it, a build whose `serverApiError` check had been dropped
   * would render the panel and every "unavailable" assertion below would still pass.
   */
  it('does not render a canvas on a refusal', async () => {
    serverApiGet.mockRejectedValue(new ServerApiError(403, 'Not yours'));

    await expect(CanvasFilePage({ params: Promise.resolve({ fileId: ROOM_ID }) })).rejects.toThrow(
      'NEXT_REDIRECT:'
    );
    expect(routeProps).not.toHaveBeenCalled();
  });

  /**
   * Regression: `redirect()` throws, so the `logError` below it in the same `catch` is
   * unreachable for a refusal — and it must be, because a refusal is an expected
   * outcome, not an incident. One request refused by the API would otherwise put an
   * `error`-level record in the logs every time someone opens a room they cannot enter.
   */
  it('does not log a refusal as a failure', async () => {
    serverApiGet.mockRejectedValue(new ServerApiError(401, 'Not yours'));

    await expect(CanvasFilePage({ params: Promise.resolve({ fileId: ROOM_ID }) })).rejects.toThrow(
      'NEXT_REDIRECT:'
    );

    expect(logError).not.toHaveBeenCalled();
  });
});

describe('/canvas/[fileId] — a response that is not the room', () => {
  it.each([
    ['a 404', () => new ServerApiError(404, 'Room not found')],
    ['a 500', () => new ServerApiError(500, 'Internal error')],
    ['a transport failure', () => new TypeError('fetch failed')],
  ])(
    /**
     * Regression: everything that is not a refusal is "could not load", and has to render
     * the unavailable panel. The failure this guards is the catch falling through to
     * `<CanvasRoomRoute>` with an empty scene — a full, working canvas with toolbar and
     * zoom controls over nothing, which reads as a deliberately blank board and invites
     * the caller to start drawing in a room that is gone.
     */
    'renders the unavailable panel for %s instead of an empty canvas',
    async (_label, makeError) => {
      serverApiGet.mockRejectedValue(makeError());

      await renderPage();

      expect(
        screen.getByText(/This collaboration session has ended or doesn.t exist/i)
      ).toBeInTheDocument();
      expect(routeProps).not.toHaveBeenCalled();
    }
  );

  /**
   * Regression: a **500 is not the user's fault** and must not be reported as though it
   * were — `serverApiError` is asked about `[401, 403]` only, so a 500 falls to the
   * panel and not to the login page. Asserted against a 500 explicitly because a build
   * that asked about `[401, 403, 500]` would still pass the 404 and transport cases.
   */
  it('does not sign the caller out when the API itself fails', async () => {
    serverApiGet.mockRejectedValue(new ServerApiError(500, 'Internal error'));

    await renderPage();

    expect(redirect).not.toHaveBeenCalled();
    expect(routeProps).not.toHaveBeenCalled();
  });

  /**
   * Regression: the panel is the caller's only way out. A `Link` that lost its `href`, or
   * pointed back at the room that does not exist, leaves them on a dead page.
   */
  it('offers a way to the canvas index from the unavailable panel', async () => {
    serverApiGet.mockRejectedValue(new ServerApiError(404, 'Room not found'));

    await renderPage();

    expect(screen.getByRole('link', { name: /go to canvas/i })).toHaveAttribute('href', '/canvas');
  });

  /**
   * Regression: a load failure must not present the room's name. The response carrying
   * it failed, so nothing on screen may claim which room this was — asserted on the
   * name from the *default* fixture, with the failing status set, so it cannot be
   * satisfied by a fixture that simply omits the name.
   */
  it('does not present the room name on a load failure', async () => {
    serverApiGet.mockRejectedValue(new ServerApiError(404, 'Room not found'));

    await renderPage();

    expect(screen.queryByText('Design Review')).toBeNull();
    expect(routeProps).not.toHaveBeenCalled();
  });

  /**
   * Regression: the log is the page's only diagnostic for this branch, and it is
   * structured. `event` is what makes the record greppable, so a build that logged a
   * bare sentence would be un-findable in aggregation; asserted as an exact value.
   */
  it('logs a structured failure event for a load failure', async () => {
    serverApiGet.mockRejectedValue(new ServerApiError(404, 'Room not found'));

    await renderPage();

    expect(loggedRecord()).toMatchObject({
      level: 'error',
      event: 'canvas_room_lookup_failed',
      roomId: ROOM_ID,
    });
  });

  /**
   * Regression: the record carries the upstream `status` when the error has one, so an
   * operator can tell a 404 (normal) from a 500 (an incident) without reproducing it.
   * `'status' in error` is what makes this safe on a plain `Error`, and the negative
   * case below pins that a transport failure does not invent a status.
   */
  it('records the upstream status when the failure carries one', async () => {
    serverApiGet.mockRejectedValue(new ServerApiError(503, 'Upstream down'));

    await renderPage();

    expect(loggedRecord()).toMatchObject({ status: 503 });
  });

  /**
   * Regression: the `error instanceof Error && 'status' in error` guard. A `TypeError`
   * from a failed `fetch` has no `status`, and reaching for it unguarded is the classic
   * "cannot read property of undefined" — which would replace an honest panel with an
   * error boundary. Asserted as *absent from the parsed record*, which is what
   * `JSON.stringify` does with an `undefined` field, plus the panel rendered alongside
   * so the assertion is about the log record and not about the branch.
   */
  it('omits the status for a failure that carries none', async () => {
    serverApiGet.mockRejectedValue(new TypeError('fetch failed'));

    await renderPage();

    expect(loggedRecord()).toMatchObject({ event: 'canvas_room_lookup_failed', roomId: ROOM_ID });
    expect(Object.keys(loggedRecord())).not.toContain('status');
    expect(
      screen.getByText(/This collaboration session has ended or doesn.t exist/i)
    ).toBeInTheDocument();
  });

  /**
   * Regression: the record is a *log*, not a response, and must carry no credential.
   * The token is in scope at this point in the function, and `JSON.stringify` of an
   * object built from the failure is exactly the shape where a token leaks. Asserted
   * positively — the whole serialised payload is searched — rather than with a
   * `not.toContain` against a payload that is asserted nowhere else.
   */
  it('never writes the session token into the log record', async () => {
    serverApiGet.mockRejectedValue(new ServerApiError(404, 'Room not found'));

    await renderPage();

    const [payload] = logError.mock.calls.at(-1) ?? [''];
    expect(typeof payload).toBe('string');
    expect(payload).not.toContain(TOKEN);
    // The room id it *is* supposed to carry, so the assertion above is not vacuous.
    expect(payload).toContain(ROOM_ID);
  });

  /**
   * The control for the two log assertions above: a successful lookup logs nothing at
   * all. Without it, a build that logged unconditionally could satisfy both "logs a
   * structured failure" and "never writes the token" by logging on every render.
   */
  it('logs nothing on a successful lookup', async () => {
    await renderPage();

    expect(logError).not.toHaveBeenCalled();
  });
});
