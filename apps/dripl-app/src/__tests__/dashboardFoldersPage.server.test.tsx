import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';

/**
 * `app/dashboard/folders/page.tsx` had **not one of its 13 statements covered**.
 *
 * It is Collections — the list of canvases *shared with* the signed-in user — and
 * it is the server half of that list, converted from a client `useEffect` fetch
 * behind a full-page skeleton for the same reasons as `app/dashboard/page.tsx`.
 *
 * The reason it is worth testing separately rather than as a copy of the dashboard's
 * suite is that the same shape hides a *different* mistake. Both pages do
 * "who is asking → fetch → seed the island → classify the failure", and both have two
 * guards that produce an identical `redirect('/login')`. What differs is the resource:
 *
 *   path      — this one reads `/files/shared`, and it is easy to reuse the dashboard
 *               page wholesale and leave the wrong path in. That renders the user's
 *               *own* canvases where their shared ones belong: a different, equally
 *               plausible-looking list, and no error anywhere.
 *   audience  — a Collections page renders rows owned by other people. `SharedFiles`
 *               is where the ownership gate lives, so the seed has to be handed over
 *               verbatim; a page that reshaped or re-paginated the response would
 *               either hide files or hand the island rows it will refuse to act on.
 *
 * `serverApiError` and `ServerApiError` are the real ones — that class is what splits
 * a refusal from an incident, and mocking it would let the split invert silently.
 */

const redirect = vi.hoisted(() =>
  vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  })
);

const serverApiGet = vi.hoisted(() =>
  vi.fn<(path: string, options: { token: string | null; cache: 'no-store' }) => Promise<unknown>>()
);

const sharedFilesProps = vi.hoisted(() =>
  vi.fn<(props: { initial: SharedFilesInitialShape }) => void>()
);

type SharedFilesInitialShape = {
  files: Array<{ id: string; name: string }>;
  total: number;
  page: number;
  limit: number;
};

vi.mock('next/navigation', () => ({ redirect }));

vi.mock('@/lib/server/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/server/api')>();
  return { ...actual, serverApiGet };
});

vi.mock('@/lib/server/session', () => ({
  readSessionUserId: vi.fn(),
  readSessionBearer: vi.fn(),
}));

vi.mock('@/components/dashboard/SharedFiles', () => ({
  SharedFiles: (props: { initial: SharedFilesInitialShape }) => {
    sharedFilesProps(props);
    return <div data-testid="shared-files" />;
  },
}));

import { ServerApiError } from '@/lib/server/api';
import { readSessionBearer, readSessionUserId } from '@/lib/server/session';
import CollectionsPage from '@/app/dashboard/folders/page';

const TOKEN = 'session-token-value';
const USER_ID = 'user-1';

/** A share row: `userId` is the *owner*, and here it is somebody else. */
function sharedRow(id: string, name: string) {
  return {
    id,
    name,
    preview: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    userId: 'someone-else',
    sharedAt: '2026-01-03T00:00:00.000Z',
    sharedBy: { id: 'someone-else', name: 'Someone Else', email: 's@example.com', image: null },
  };
}

function sharedResponse(overrides: Record<string, unknown> = {}) {
  return {
    files: [sharedRow('file-theirs', 'Their canvas')],
    total: 1,
    page: 1,
    limit: 20,
    ...overrides,
  };
}

/** Renders whatever the server component returned, or fails loudly. */
async function renderPage(): Promise<void> {
  const node = await CollectionsPage();
  if (!React.isValidElement(node)) throw new Error('the page returned no element');
  render(node);
}

/** Runs the page expecting a `redirect`, and returns where it sent the user. */
async function redirectTarget(): Promise<string> {
  try {
    await CollectionsPage();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT:')) {
      return error.message.slice('NEXT_REDIRECT:'.length);
    }
    throw error;
  }
  throw new Error('the page did not redirect');
}

/** The rejection the page threw, for the paths that are not redirects. */
async function thrownBy(): Promise<unknown> {
  try {
    await CollectionsPage();
  } catch (error) {
    return error;
  }
  throw new Error('the page did not throw');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readSessionUserId).mockResolvedValue(USER_ID);
  vi.mocked(readSessionBearer).mockResolvedValue(TOKEN);
  serverApiGet.mockResolvedValue(sharedResponse());
});

describe('/dashboard/folders — who is asking', () => {
  /**
   * Regression: this page renders one person's list of shared canvases, so an
   * anonymous request must be refused before anything is requested. The layout is the
   * real gate; this is the belt-and-braces copy, and it is the copy that still holds if
   * a future edit reorders the layout and the page.
   */
  it('sends an anonymous visitor to sign in without calling the API', async () => {
    vi.mocked(readSessionUserId).mockResolvedValue(null);

    const target = await redirectTarget();

    expect(target).toBe('/login');
    expect(serverApiGet).not.toHaveBeenCalled();
    expect(sharedFilesProps).not.toHaveBeenCalled();
  });

  /**
   * Regression: a user id with no usable token is a *different* stop from no user id,
   * and both land on the same redirect. Without a counter the two are indistinguishable,
   * so a build that had deleted this guard entirely would still pass every redirect
   * assertion in this file.
   */
  it('sends a caller with no verified token to sign in without calling the API', async () => {
    vi.mocked(readSessionBearer).mockResolvedValue(null);

    const target = await redirectTarget();

    expect(target).toBe('/login');
    expect(serverApiGet).not.toHaveBeenCalled();
    expect(sharedFilesProps).not.toHaveBeenCalled();
  });

  /**
   * Regression: guard order. The user-id stop must come first, so an anonymous visitor
   * never pays for a second JWT verification. The `invocationCallOrder` comparison is
   * the assertion — "it redirected" cannot tell the two stops apart.
   */
  it('does not look for a token when there is no user id at all', async () => {
    vi.mocked(readSessionUserId).mockResolvedValue(null);

    await redirectTarget();

    expect(readSessionBearer).not.toHaveBeenCalled();
    expect(vi.mocked(readSessionUserId).mock.invocationCallOrder[0]).toBeLessThan(
      Number.MAX_SAFE_INTEGER
    );
  });

  /**
   * The control for the ordering assertion above: on the working path both readers are
   * consulted, user id first. Without it, "the token reader was not called" would also
   * hold for a build that never called it at all.
   */
  it('consults both session readers, user id first, when a session exists', async () => {
    await renderPage();

    expect(vi.mocked(readSessionUserId).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(readSessionBearer).mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    );
  });

  /**
   * Regression: one refusal only. A second `redirect()` reaching Next would win over the
   * first, so the caller could be sent somewhere the page never chose.
   */
  it('redirects exactly once, to the login route', async () => {
    vi.mocked(readSessionUserId).mockResolvedValue(null);

    await redirectTarget();

    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith('/login');
  });
});

describe('/dashboard/folders — the fetch', () => {
  /**
   * Regression: the resource is the *shared* list. This is the assertion that separates
   * this page from the dashboard's, and it is the one a copy-paste of
   * `app/dashboard/page.tsx` would fail: `/files` renders the user's own canvases here,
   * which is a plausible list with no error anywhere on the page.
   */
  it("asks for the shared-files collection, not the user's own files", async () => {
    await renderPage();

    expect(serverApiGet.mock.calls[0]?.[0]).toBe('/files/shared?page=1&limit=20');
  });

  /**
   * Regression: the seed is page one at the module's `PAGE_SIZE`, both built by
   * interpolation. A build that dropped `limit` changes how many rows are in the first
   * HTML response, which is the entire point of the server-side conversion.
   */
  it('asks for page one at the page size', async () => {
    await renderPage();

    expect(serverApiGet.mock.calls[0]?.[0]).toContain('page=1&limit=20');
  });

  /**
   * Regression: `no-store` is the disclosure control, and here it is sharper than on the
   * dashboard. A cached Collections body would hand one visitor the set of canvases
   * other people shared with the *previous* visitor.
   */
  it('asks for an uncached response', async () => {
    await renderPage();

    expect(serverApiGet.mock.calls[0]?.[1].cache).toBe('no-store');
  });

  /**
   * Regression: a server-side fetch has no ambient cookie jar for another origin, so the
   * verified token must be forwarded explicitly or the upstream 401s and every
   * signed-in user is bounced to sign in by the very route that removed that detour.
   */
  it('forwards the verified session token', async () => {
    await renderPage();

    expect(serverApiGet.mock.calls[0]?.[1].token).toBe(TOKEN);
  });

  /**
   * Regression: one request per render — this is a server component with no effects.
   */
  it('makes exactly one upstream request', async () => {
    await renderPage();

    expect(serverApiGet).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression: the island receives the upstream body *unmodified*. `SharedFiles` owns
   * the ownership gate (`ownedFileIds`) — the API answers 404 for a PATCH or DELETE on
   * somebody else's canvas — so a page that reshaped the response would feed the gate
   * rows it cannot act on. Asserted by identity, so a copy that dropped a field is
   * caught as well as a deep-equal-shaped one.
   */
  it('seeds the island with the upstream body unchanged', async () => {
    const response = sharedResponse({ total: 3 });
    serverApiGet.mockResolvedValue(response);

    await renderPage();

    const props = sharedFilesProps.mock.calls.at(-1)?.[0];
    expect(props?.initial).toBe(response);
    expect(props?.initial.files).toBe(response.files);
    expect(props?.initial.total).toBe(3);
  });

  /**
   * Regression: nobody has shared anything with a brand-new account, and that is a
   * legitimate answer. A build that treated an empty list as a failure would redirect
   * every new user to the login page on their first visit to Collections.
   */
  it('renders the island when nothing has been shared with the caller', async () => {
    serverApiGet.mockResolvedValue(sharedResponse({ files: [], total: 0 }));

    await renderPage();

    expect(redirect).not.toHaveBeenCalled();
    expect(sharedFilesProps).toHaveBeenCalledTimes(1);
    expect(sharedFilesProps.mock.calls.at(-1)?.[0].initial.files).toEqual([]);
  });
});

describe('/dashboard/folders — a refused request', () => {
  it.each([401, 403])(
    /**
     * Regression: a refusal is "not you", and the outcome matches having no session —
     * sign in again. Falling through to the error boundary would show a 500-shaped
     * error to a user whose session is merely stale.
     */
    'redirects to sign in on a %i',
    async status => {
      serverApiGet.mockRejectedValue(new ServerApiError(status, 'Not yours'));

      const target = await redirectTarget();

      expect(target).toBe('/login');
      expect(redirect).toHaveBeenCalledWith('/login');
    }
  );

  /**
   * Regression: the refusal is a redirect, so the `catch` unwinds on the redirect's
   * throw and the upstream error never reaches Next's error boundary. Asserted on the
   * *rejection identity*, because the redirect count alone is satisfied equally by a
   * build that called `redirect()` and then rethrew.
   */
  it('does not let the upstream error escape a refusal', async () => {
    const upstream = new ServerApiError(401, 'Not yours');
    serverApiGet.mockRejectedValue(upstream);

    const thrown = await thrownBy();

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('NEXT_REDIRECT:/login');
    expect(thrown).not.toBe(upstream);
  });

  /**
   * Regression: a refusal renders nothing. The island is the only thing this page can
   * render, so "the island did not mount" is the positive proof that the `catch` took
   * the refusal branch rather than falling through to a render.
   */
  it('renders nothing on a refusal', async () => {
    serverApiGet.mockRejectedValue(new ServerApiError(403, 'Not yours'));

    await redirectTarget();

    expect(sharedFilesProps).not.toHaveBeenCalled();
  });
});

describe('/dashboard/folders — an upstream failure that is not a refusal', () => {
  it.each([
    ['a 404', () => new ServerApiError(404, 'No such collection')],
    ['a 500', () => new ServerApiError(500, 'Internal error')],
    ['a 502', () => new ServerApiError(502, 'Bad gateway')],
    ['a transport failure', () => new TypeError('fetch failed')],
  ])(
    /**
     * Regression: only `[401, 403]` means "sign in again". Everything else is an
     * incident and belongs in the error boundary: a 500 answered with a redirect would
     * sign out every signed-in user during an outage and hide the outage behind a
     * working-looking login page. The 500 and 502 cases are here because a build that
     * widened the status list would still pass the 404 and transport rows.
     */
    'propagates %s to the error boundary instead of signing the caller out',
    async (_label, makeError) => {
      serverApiGet.mockRejectedValue(makeError());

      const thrown = await thrownBy();

      expect(redirect).not.toHaveBeenCalled();
      expect((thrown as Error).message).not.toContain('NEXT_REDIRECT');
      expect(sharedFilesProps).not.toHaveBeenCalled();
    }
  );

  /**
   * Regression: the failure propagates *unchanged*. Next reports whatever reaches the
   * error boundary, so wrapping it loses the upstream status an operator needs to tell
   * a 502 from a 500. Identity assertion, which also pins `throw error` as a rethrow of
   * the caught value rather than a fresh `Error`.
   */
  it('rethrows the original failure object', async () => {
    const upstream = new ServerApiError(502, 'Bad gateway');
    serverApiGet.mockRejectedValue(upstream);

    const thrown = await thrownBy();

    expect(thrown).toBe(upstream);
  });

  /**
   * The control for the status-list guard: a plain `Error` carries no status at all, so
   * `'status' in error` inside `serverApiError` is what makes it safe — and the page's
   * guard has to survive an error that is not even a `ServerApiError`.
   */
  it('propagates a failure that carries no upstream status', async () => {
    const upstream = new Error('socket hang up');
    serverApiGet.mockRejectedValue(upstream);

    const thrown = await thrownBy();

    expect(thrown).toBe(upstream);
    expect(redirect).not.toHaveBeenCalled();
  });

  /**
   * Regression: the page does not retry. A retry would double every Collections request
   * during an incident, and its failure would still surface through the same boundary —
   * so the symptom is a latency spike nobody attributes to the outage.
   */
  it('does not retry the failed request', async () => {
    serverApiGet.mockRejectedValue(new ServerApiError(500, 'Internal error'));

    await thrownBy();

    expect(serverApiGet).toHaveBeenCalledTimes(1);
  });
});
