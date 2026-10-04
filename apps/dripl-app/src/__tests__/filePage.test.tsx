import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FileInitialData } from '@/components/canvas/FileCanvasRoute';

/**
 * `app/file/[id]/page.tsx` is the server half of opening a saved canvas: it
 * authenticates the request, fetches the file, and hands the scene to
 * `FileCanvasRoute` inside the HTML. All 28 of its statements were uncovered, so
 * the questions that matter — *what happens when the response is bad* — had never
 * been asked.
 *
 * They are the interesting ones, because this page replaced a client fetch, and
 * the two failure shapes are easy to confuse:
 *
 *   - a **refusal** (401/403) is "not you", and the user belongs back at
 *     `/login?next=…` — the same detour the client produced;
 *   - anything else, 404 included, is "could not load", and must render the
 *     *unavailable* panel. A catch that fell through to `FileCanvasRoute` with
 *     `elements: []` would render a real canvas UI over an empty scene, which
 *     is indistinguishable from "your canvas is empty" — and the first thing
 *     anyone does about an empty canvas is start drawing on it.
 *
 * `serverApiError` is the real one, because it is what tells those two cases
 * apart; only the transport is mocked. `FileCanvasRoute` is replaced by a spy so
 * the assertions are about the props the server decided to send, not about the
 * canvas it renders.
 */

const redirect = vi.hoisted(() =>
  vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  })
);

const serverApiGet = vi.hoisted(() =>
  vi.fn<(path: string, options: { token: string | null; cache: string }) => Promise<unknown>>()
);

const routeProps = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ redirect }));

vi.mock('@/lib/server/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/server/api')>();
  return { ...actual, serverApiGet };
});

vi.mock('@/lib/server/session', () => ({
  readSessionUserId: vi.fn(),
  readSessionBearer: vi.fn(),
}));

vi.mock('@/components/canvas/FileCanvasRoute', () => ({
  FileCanvasRoute: (props: unknown) => {
    routeProps(props);
    return null;
  },
}));

/** `logError` is console-backed; silenced so a refusal does not spam the run. */
vi.mock('@dripl/common', async importOriginal => {
  const actual = await importOriginal<typeof import('@dripl/common')>();
  return { ...actual, logError: vi.fn() };
});

import { ServerApiError } from '@/lib/server/api';
import { readSessionBearer, readSessionUserId } from '@/lib/server/session';
import FilePage from '@/app/file/[id]/page';

const FILE_ID = 'file-abc';
const TOKEN = 'session-token-value';
const USER_ID = 'user-1';

type SentInitialData = FileInitialData;

/** The props the page handed to `FileCanvasRoute` on its last render. */
function sentRoute(): {
  fileId: string;
  fileName: string;
  updatedAt: string;
  initialData: SentInitialData;
} {
  const call = routeProps.mock.calls.at(-1);
  if (call === undefined) throw new Error('FileCanvasRoute was never rendered');
  return call[0] as {
    fileId: string;
    fileName: string;
    updatedAt: string;
    initialData: SentInitialData;
  };
}

function fileResponse(overrides: Record<string, unknown> = {}) {
  return {
    file: {
      id: FILE_ID,
      name: 'My Canvas',
      preview: null,
      folderId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-02T00:00:00.000Z',
      shareToken: null,
      sharePermission: null,
      shareExpiresAt: null,
      content: [],
      encryptedPayload: null,
      ...overrides,
    },
  };
}

/** Renders whatever the server component returned, or fails loudly. */
async function renderPage(id = FILE_ID) {
  const node = await FilePage({ params: Promise.resolve({ id }) });
  if (!React.isValidElement(node)) throw new Error('the page returned no element');
  return render(node);
}

/** Runs the page expecting a `redirect`, and returns where it sent the user. */
async function redirectTargetFor(id = FILE_ID): Promise<string> {
  try {
    await FilePage({ params: Promise.resolve({ id }) });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT:')) {
      return error.message.slice('NEXT_REDIRECT:'.length);
    }
    throw error;
  }
  throw new Error('the page did not redirect');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readSessionUserId).mockResolvedValue(USER_ID);
  vi.mocked(readSessionBearer).mockResolvedValue(TOKEN);
  serverApiGet.mockResolvedValue(fileResponse());
});

describe('/file/[id] — who is asking', () => {
  /**
   * Regression: no session means no canvas, and the user has to be sent to the
   * sign-in page carrying the file they were trying to open. The upstream call
   * must not even be attempted — a 401 from it would be a second, weaker
   * version of the same refusal.
   */
  it('sends an anonymous visitor to sign in without calling the API', async () => {
    vi.mocked(readSessionUserId).mockResolvedValue(null);

    const target = await redirectTargetFor();

    expect(target).toBe(`/login?next=${encodeURIComponent(`/file/${FILE_ID}`)}`);
    expect(serverApiGet).not.toHaveBeenCalled();
  });

  /**
   * Regression: `readSessionBearer()` returning null is a *different* stop from
   * a missing `userId` — a verified session with no usable token — and it must
   * stop before the fetch too, or the page makes an anonymous upstream call and
   * renders whatever it gets back.
   */
  it('sends a caller with no verified token to sign in', async () => {
    vi.mocked(readSessionBearer).mockResolvedValue(null);

    const target = await redirectTargetFor();

    expect(target).toBe(`/login?next=${encodeURIComponent(`/file/${FILE_ID}`)}`);
    expect(serverApiGet).not.toHaveBeenCalled();
  });

  /**
   * Regression: the `next` value is URL-supplied and goes straight into a
   * redirect. An unencoded id containing `&` or `#` would truncate the path and
   * bounce the user to a file that does not exist — or to a different one.
   */
  it('encodes the file id into the sign-in detour', async () => {
    vi.mocked(readSessionUserId).mockResolvedValue(null);

    const target = await redirectTargetFor('a/b c');

    expect(target).toBe(`/login?next=${encodeURIComponent('/file/a/b c')}`);
  });

  /**
   * Regression: the same encoding applies to the upstream path. `id` comes from
   * the route, so `/files/${id}` without `encodeURIComponent` lets an id
   * containing `/` address a different resource than the one being rendered.
   */
  it('encodes the file id into the upstream path', async () => {
    await renderPage('a/b c');

    expect(serverApiGet.mock.calls[0]![0]).toBe('/files/a%2Fb%20c');
  });
});

describe('/file/[id] — the fetch', () => {
  /**
   * Regression: the Next data cache is shared across visitors, so a cached
   * personalized body would be served to the *next* requester — one person's
   * canvas to another. `no-store` is the platform enforcing that rather than a
   * comment promising it.
   */
  it('asks for an uncached response', async () => {
    await renderPage();

    expect(serverApiGet.mock.calls[0]![1].cache).toBe('no-store');
  });

  /**
   * Regression: a server-side fetch has no ambient cookie jar for another
   * origin, so the verified token has to be forwarded explicitly as an option.
   * Drop it and every server render is an anonymous request that 401s.
   */
  it('forwards the verified session token', async () => {
    await renderPage();

    expect(serverApiGet.mock.calls[0]![1].token).toBe(TOKEN);
  });

  /**
   * Regression: what the server hands over is the file's own metadata. The route
   * parameter is what was *requested*; if the two ever disagree, the rendered
   * chrome (the title bar, the autosave target) must follow the response.
   */
  it('renders the response metadata, not the requested id', async () => {
    serverApiGet.mockResolvedValue(
      fileResponse({ id: 'renamed-id', name: 'Renamed', updatedAt: '2026-03-03T00:00:00.000Z' })
    );

    await renderPage(FILE_ID);

    expect(sentRoute()).toMatchObject({
      fileId: 'renamed-id',
      fileName: 'Renamed',
      updatedAt: '2026-03-03T00:00:00.000Z',
    });
  });
});

describe('/file/[id] — a refused request', () => {
  it.each([401, 403])(
    /**
     * Regression: a refusal is "not you", not "could not load". Rendering the
     * unavailable panel for a 401 tells the signed-in user their file is broken
     * when in fact they are simply not allowed to see it — and gives them a
     * "Back to dashboard" button where the sign-in they actually need was.
     */
    'redirects to sign in on a %i',
    async status => {
      serverApiGet.mockRejectedValue(new ServerApiError(status, 'Not yours'));

      const target = await redirectTargetFor();

      expect(target).toBe(`/login?next=${encodeURIComponent(`/file/${FILE_ID}`)}`);
      expect(routeProps).not.toHaveBeenCalled();
    }
  );

  /**
   * Regression: a 401 on the upstream call must not be reported as a load
   * failure, but the *token* is also never forwarded anywhere the user can see
   * it. Asserting the canvas never rendered is what distinguishes the two: the
   * panel and a canvas are both "something rendered".
   */
  it('does not render a canvas on a refusal', async () => {
    serverApiGet.mockRejectedValue(new ServerApiError(403, 'Not yours'));

    await expect(FilePage({ params: Promise.resolve({ id: FILE_ID }) })).rejects.toThrow(
      'NEXT_REDIRECT:'
    );
    expect(routeProps).not.toHaveBeenCalled();
  });
});

describe('/file/[id] — a response that is not the file', () => {
  it.each([
    ['a 404', () => new ServerApiError(404, 'File not found')],
    ['a 500', () => new ServerApiError(500, 'Internal error')],
    ['a transport failure', () => new TypeError('fetch failed')],
  ])(
    /**
     * Regression: everything that is not a refusal is "could not load", and has
     * to render the unavailable panel. The failure this guards is the catch
     * falling through to `<FileCanvasRoute elements: []>`: an empty canvas with
     * working toolbar, autosave and thumbnail buttons, which reads as a
     * deliberately blank canvas — and invites the user to draw on a file that
     * was never loaded.
     */
    'renders the unavailable panel for %s instead of an empty canvas',
    async (_label, makeError) => {
      serverApiGet.mockRejectedValue(makeError());

      await renderPage();

      expect(screen.getByText('This canvas could not be loaded.')).toBeInTheDocument();
      expect(routeProps).not.toHaveBeenCalled();
    }
  );

  /**
   * Regression: the panel is the user's only way out. A `Link` that lost its
   * `href`, or pointed at the file itself, leaves them on a dead page with no
   * navigation at all.
   */
  it('offers a way back to the dashboard from the unavailable panel', async () => {
    serverApiGet.mockRejectedValue(new ServerApiError(404, 'File not found'));

    await renderPage();

    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute(
      'href',
      '/dashboard'
    );
  });

  /**
   * Regression: a load failure must not be presented as the document. The panel
   * names no file, so nothing on screen claims the canvas loaded — asserted on
   * the file's own name, which a fallback that rendered the file chrome (a
   * titled, autosaving, empty canvas) would put on the page.
   */
  it('does not present the file name on a load failure', async () => {
    serverApiGet.mockRejectedValue(new ServerApiError(404, 'File not found'));

    await renderPage();

    expect(screen.queryByText('My Canvas')).toBeNull();
    expect(routeProps).not.toHaveBeenCalled();
  });
});

describe('/file/[id] — the stored content', () => {
  /**
   * Regression: the `content` column is `unknown` and has been written in two
   * shapes over the product's life (ADR-004: a JSON string, no schema). A reader
   * that only understood the current shape shows an older canvas as empty — and
   * an empty canvas is indistinguishable from a blank one, so it gets drawn on.
   */
  it('reads a bare element array, the pre-appState shape', async () => {
    const elements = [{ id: 'e1', type: 'rectangle' }];
    serverApiGet.mockResolvedValue(fileResponse({ content: elements }));

    await renderPage();

    expect(sentRoute().initialData.elements).toEqual(elements);
    expect(sentRoute().initialData.appState).toBeNull();
  });

  /**
   * Regression: the current shape carries `appState` alongside `elements`, and it
   * is the user's viewport (zoom/pan/theme). Reading `elements` and dropping
   * `appState` opens every old canvas at the default zoom with the default
   * theme, discarding how the owner had it set up. Asserted by reference, so a
   * copy-with-changes would also fail.
   */
  it('reads elements and appState from the current shape', async () => {
    const appState = { zoom: 2, panX: 40, panY: -12 };
    serverApiGet.mockResolvedValue(
      fileResponse({ content: { elements: [{ id: 'e1' }], appState } })
    );

    await renderPage();

    expect(sentRoute().initialData.elements).toEqual([{ id: 'e1' }]);
    expect(sentRoute().initialData.appState).toBe(appState);
  });

  it.each([
    ['the payload is a bare string', 'not an object'],
    ['the payload is a number', 7],
    ['the payload is null', null],
    ['the payload is undefined', undefined],
  ])(
    /**
     * Regression: a `content` that is not an object at all must degrade to an
     * empty scene rather than propagate. Passing `content.elements` straight
     * through would hand a string to the renderer as an element list, and the
     * failure shows up as a canvas that throws on its first draw instead of a
     * page that says it could not load.
     */
    'degrades to an empty scene when %s',
    async (_label, content) => {
      serverApiGet.mockResolvedValue(fileResponse({ content }));

      await renderPage();

      expect(sentRoute().initialData.elements).toEqual([]);
      expect(sentRoute().initialData.appState).toBeNull();
    }
  );

  it.each([
    ['elements is a string', { elements: 'nope', appState: { zoom: 3 } }],
    ['elements is an object', { elements: { id: 'e1' }, appState: null }],
    ['elements is missing', { appState: { zoom: 3 } }],
  ])(
    /**
     * Regression: `elements` and `appState` are validated independently, and an
     * unreadable element list must not cost the user their viewport. A reader
     * that bailed out of the whole payload on the first bad field would open
     * every such canvas at the default zoom.
     */
    'drops an unreadable element list when %s but keeps a usable appState',
    async (_label, content) => {
      serverApiGet.mockResolvedValue(fileResponse({ content }));

      await renderPage();

      expect(sentRoute().initialData.elements).toEqual([]);
      const appState = content as { appState?: unknown };
      expect(sentRoute().initialData.appState).toEqual(appState.appState ?? null);
    }
  );

  it.each([
    ['appState is a string', 'nope'],
    ['appState is a number', 7],
    ['appState is null', null],
  ])(
    /**
     * Regression: the mirror image. An unreadable `appState` must not take the
     * elements with it — the shapes are the user's scene and their viewport, and
     * losing the scene is the expensive half of that trade.
     */
    'keeps the elements but drops the appState when %s',
    async (_label, appState) => {
      serverApiGet.mockResolvedValue(
        fileResponse({ content: { elements: [{ id: 'e1' }], appState } })
      );

      await renderPage();

      expect(sentRoute().initialData.elements).toEqual([{ id: 'e1' }]);
      expect(sentRoute().initialData.appState).toBeNull();
    }
  );

  /**
   * Regression: the elements list is handed over by reference, not copied or
   * reshaped. A `.map()` that added a key, or a `JSON.parse(JSON.stringify())`
   * round trip, would silently rewrite a stored scene — and the autosave that
   * follows would write the rewritten version back over the original.
   */
  it('hands the stored elements over untouched', async () => {
    const elements = [{ id: 'e1', type: 'rectangle', x: 1 }];
    serverApiGet.mockResolvedValue(fileResponse({ content: { elements, appState: null } }));

    await renderPage();

    expect(sentRoute().initialData.elements[0]).toBe(elements[0]);
  });
});
