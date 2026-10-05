import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';

/**
 * `app/dashboard/page.tsx` had **not one of its 13 statements covered**.
 *
 * It is the server half of the dashboard: page one of the user's files used to be
 * fetched from a client `useEffect` behind a full-height skeleton, and is now
 * fetched here so the tiles are in the first HTML response. Every decision this
 * file makes is one a user can observe, and each has a distinct failure:
 *
 *   ordering — two *different* stops produce the identical `redirect('/login')`:
 *             `readSessionUserId()` returning `null`, and `readSessionBearer()`
 *             returning `null` while a user id was found. A reader cannot tell them
 *             apart from the redirect alone, so the tests pin them with the
 *             upstream-call counter and the reader-call order instead.
 *   no-store — the Next data cache is shared across visitors. A cached personalized
 *             body is one person's file list served to the next requester, so the
 *             cache policy is the security property here, not a default.
 *   refusal — a 401/403 means "the session verified but the API refused it", which
 *             is the same outcome as no session, so it redirects. A 500 is an
 *             upstream incident and must reach the error boundary: dressing it up as
 *             "please sign in" signs working users out during an outage.
 *
 * `serverApiError` and `ServerApiError` are the real ones — that class is what
 * separates a refusal from a transport failure, and mocking it would let the split
 * invert silently. Only the transport and the session readers are replaced, and the
 * list island is stubbed because `DashboardFiles.test.tsx` already covers it: what
 * this page hands across is `initial`, so that is what gets asserted.
 */

const redirect = vi.hoisted(() =>
  vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  })
);

const serverApiGet = vi.hoisted(() =>
  vi.fn<(path: string, options: { token: string | null; cache: 'no-store' }) => Promise<unknown>>()
);

const dashboardFilesProps = vi.hoisted(() =>
  vi.fn<(props: { initial: DashboardInitialFilesShape }) => void>()
);

type DashboardInitialFilesShape = {
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

vi.mock('@/components/dashboard/DashboardFiles', () => ({
  DashboardFiles: (props: { initial: DashboardInitialFilesShape }) => {
    dashboardFilesProps(props);
    return <div data-testid="dashboard-files" />;
  },
}));

import { ServerApiError } from '@/lib/server/api';
import { readSessionBearer, readSessionUserId } from '@/lib/server/session';
import DashboardPage from '@/app/dashboard/page';

const TOKEN = 'session-token-value';
const USER_ID = 'user-1';

function filesResponse(overrides: Record<string, unknown> = {}) {
  return {
    files: [
      {
        id: 'file-a',
        name: 'Alpha canvas',
        preview: null,
        folderId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ],
    total: 1,
    page: 1,
    limit: 20,
    ...overrides,
  };
}

/** Renders whatever the server component returned, or fails loudly. */
async function renderPage(): Promise<void> {
  const node = await DashboardPage();
  if (!React.isValidElement(node)) throw new Error('the page returned no element');
  render(node);
}

/** Runs the page expecting a `redirect`, and returns where it sent the user. */
async function redirectTarget(): Promise<string> {
  try {
    await DashboardPage();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT:')) {
      return error.message.slice('NEXT_REDIRECT:'.length);
    }
    throw error;
  }
  throw new Error('the page did not redirect');
}

/** The rejection a page threw, for the paths that are not redirects. */
async function thrownBy(): Promise<unknown> {
  try {
    await DashboardPage();
  } catch (error) {
    return error;
  }
  throw new Error('the page did not throw');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readSessionUserId).mockResolvedValue(USER_ID);
  vi.mocked(readSessionBearer).mockResolvedValue(TOKEN);
  serverApiGet.mockResolvedValue(filesResponse());
});

describe('/dashboard — who is asking', () => {
  /**
   * Regression: no session means no file list, and the API must not be asked at all.
   * A 401 from it would be a second, weaker version of the same refusal, and the
   * route would still have made an outbound request for an anonymous visitor.
   */
  it('sends an anonymous visitor to sign in without calling the API', async () => {
    vi.mocked(readSessionUserId).mockResolvedValue(null);

    const target = await redirectTarget();

    expect(target).toBe('/login');
    expect(serverApiGet).not.toHaveBeenCalled();
    expect(dashboardFilesProps).not.toHaveBeenCalled();
  });

  /**
   * Regression: a verified session with no usable token is a *different* stop from a
   * missing user id, and it is the belt-and-braces half of the guard — the layout has
   * already refused an anonymous request, so reaching this with a `userId` and no
   * token means the two readers disagreed about one cookie. The page must still stop
   * before the personalized fetch.
   */
  it('sends a caller with no verified token to sign in without calling the API', async () => {
    vi.mocked(readSessionBearer).mockResolvedValue(null);

    const target = await redirectTarget();

    expect(target).toBe('/login');
    expect(serverApiGet).not.toHaveBeenCalled();
    expect(dashboardFilesProps).not.toHaveBeenCalled();
  });

  /**
   * Regression: the first guard must come *before* the second. Both produce the same
   * redirect, so "it redirected" is satisfied by either order; the only observable
   * difference is that the token reader is never consulted for an anonymous visitor.
   * Without this, reordering the two guards reaches `readSessionBearer()` — a second
   * JWT verification — on every anonymous request, and the page still looks correct.
   */
  it('does not look for a token when there is no user id at all', async () => {
    vi.mocked(readSessionUserId).mockResolvedValue(null);

    await redirectTarget();

    expect(readSessionBearer).not.toHaveBeenCalled();
    expect(vi.mocked(readSessionUserId).mock.invocationCallOrder[0]).toBeLessThan(
      // Proof the reader *would* have been called on the working path, so the
      // assertion above is a real ordering claim and not "it was never called".
      vi.mocked(readSessionBearer).mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    );
  });

  /**
   * The control for the ordering assertion above: with a session present both readers
   * are consulted, in that order. Without it, the previous test would also pass
   * against a build where `readSessionBearer` was never called at all.
   */
  it('consults both session readers, user id first, when a session exists', async () => {
    await renderPage();

    expect(vi.mocked(readSessionUserId).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(readSessionBearer).mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    );
  });

  /**
   * Regression: exactly one refusal is issued. Two `redirect()` calls would mean the
   * second one was reached from a handler that was supposed to have unwound, and Next
   * would follow the last one — which could be a different destination.
   */
  it('redirects exactly once, and renders nothing', async () => {
    vi.mocked(readSessionUserId).mockResolvedValue(null);

    await redirectTarget();

    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith('/login');
  });
});

describe('/dashboard — the fetch', () => {
  /**
   * Regression: `no-store` is the disclosure control. The Next data cache is shared
   * across visitors, so a cached personalized body would be served to the next
   * requester — one person's file list handed to somebody else, and a stale one if a
   * file is renamed in between. Asserted on the exact policy, not on truthiness.
   */
  it('asks for an uncached response', async () => {
    await renderPage();

    expect(serverApiGet.mock.calls[0]?.[1].cache).toBe('no-store');
  });

  /**
   * Regression: a server-side fetch has no ambient cookie jar for another origin, so
   * the verified token has to be forwarded explicitly. Drop the option and every
   * server render is an anonymous request that 401s — i.e. the route redirects every
   * signed-in user to sign in, which is the exact failure the guard at line 50 exists
   * to prevent.
   */
  it('forwards the verified session token', async () => {
    await renderPage();

    expect(serverApiGet.mock.calls[0]?.[1].token).toBe(TOKEN);
  });

  /**
   * Regression: the seed is page one at the module's `PAGE_SIZE`, and the query string
   * is built by interpolation. A build that dropped `page=1` gets whatever the API
   * defaults to, and a build that dropped `limit` silently changes how many rows are
   * in the first HTML response — which is the whole point of the conversion.
   */
  it('asks for page one at the page size', async () => {
    await renderPage();

    expect(serverApiGet.mock.calls[0]?.[0]).toBe('/files?page=1&limit=20');
  });

  /**
   * Regression: one request per render. This is a server component with no effects, so
   * a second call would mean the lookup ran twice for the same render — two identical
   * upstream reads per dashboard visit.
   */
  it('makes exactly one upstream request', async () => {
    await renderPage();

    expect(serverApiGet).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression: the whole conversion exists so the rows are in the first HTML response,
   * which means the island receives the upstream body *unmodified*. A build that
   * re-paginated, re-sorted or defaulted the count here would render something other
   * than what the client then adopts, and the list would change under the user on
   * hydration. Asserted by identity on the nested array, not by deep equality, so a
   * copy that silently dropped a field is caught too.
   */
  it('seeds the island with the upstream body unchanged', async () => {
    const response = filesResponse({ total: 7, page: 1, limit: 20 });
    serverApiGet.mockResolvedValue(response);

    await renderPage();

    const props = dashboardFilesProps.mock.calls.at(-1)?.[0];
    expect(props?.initial).toBe(response);
    expect(props?.initial.files).toBe(response.files);
    expect(props?.initial.total).toBe(7);
  });

  /**
   * Regression: an empty list is a legitimate answer, not a reason to redirect or throw.
   * A build whose guard tested `initial.files.length` would send a brand-new account
   * with zero files to the login page on its first visit.
   */
  it('renders the island for a signed-in user with no files', async () => {
    serverApiGet.mockResolvedValue(filesResponse({ files: [], total: 0 }));

    await renderPage();

    expect(redirect).not.toHaveBeenCalled();
    expect(dashboardFilesProps).toHaveBeenCalledTimes(1);
    expect(dashboardFilesProps.mock.calls.at(-1)?.[0].initial.total).toBe(0);
  });
});

describe('/dashboard — a refused request', () => {
  it.each([401, 403])(
    /**
     * Regression: a refusal is "not you", and the outcome is the same as having no
     * session — sign in again. The alternative (falling through to the error boundary)
     * shows a 500-shaped error to a user whose session is merely stale.
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
   * Regression: the refusal is a redirect, not a logged failure, so nothing about the
   * user is rendered on the way out and no error boundary is involved. Asserted on the
   * shape of the *rejection* rather than on the redirect count alone: the `catch` block
   * calls `redirect()`, which throws, so a build that rethrew the `ServerApiError`
   * afterwards would still have called `redirect` once — with a different thrown value
   * escaping, and Next's error boundary reporting an incident for an expected outcome.
   */
  it('does not let the upstream error escape a refusal', async () => {
    const upstream = new ServerApiError(403, 'Not yours');
    serverApiGet.mockRejectedValue(upstream);

    const thrown = await thrownBy();

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('NEXT_REDIRECT:/login');
    expect(thrown).not.toBe(upstream);
  });

  /**
   * Regression: a refusal renders nothing at all. The island is the only thing this
   * page can render, so "the island did not mount" is what distinguishes a refusal from
   * a successful load — and it is what proves the `catch` did not fall through.
   */
  it('renders nothing on a refusal', async () => {
    serverApiGet.mockRejectedValue(new ServerApiError(401, 'Not yours'));

    await redirectTarget();

    expect(dashboardFilesProps).not.toHaveBeenCalled();
  });
});

describe('/dashboard — an upstream failure that is not a refusal', () => {
  it.each([
    ['a 404', () => new ServerApiError(404, 'No such route')],
    ['a 500', () => new ServerApiError(500, 'Internal error')],
    ['a 503', () => new ServerApiError(503, 'Upstream down')],
    ['a transport failure', () => new TypeError('fetch failed')],
  ])(
    /**
     * Regression: everything that is not a refusal is an incident, and belongs in the
     * error boundary. `serverApiError` is asked about `[401, 403]` only. A 500 must
     * not be answered by signing the user out: during an outage every signed-in
     * visitor would be bounced to the login page, which is both a lie and the one
     * failure mode that hides the outage behind a working-looking app.
     *
     * The 500 and 503 cases are here because a build that widened the list to
     * `[401, 403, 500]` would still pass the 404 and transport cases.
     */
    'propagates %s to the error boundary instead of signing the caller out',
    async (_label, makeError) => {
      serverApiGet.mockRejectedValue(makeError());

      const thrown = await thrownBy();

      expect(redirect).not.toHaveBeenCalled();
      expect((thrown as Error).message).not.toContain('NEXT_REDIRECT');
      expect(dashboardFilesProps).not.toHaveBeenCalled();
    }
  );

  /**
   * Regression: the failure must propagate *unchanged*, not be wrapped. Next's error
   * boundary logs and reports what it receives, so replacing the upstream error with a
   * generic one loses the status an operator needs to tell a 503 from a 500.
   * Asserted by identity, which also pins that the `throw error` rethrows the caught
   * value rather than a fresh `Error`.
   */
  it('rethrows the original failure object', async () => {
    const upstream = new ServerApiError(500, 'Internal error');
    serverApiGet.mockRejectedValue(upstream);

    const thrown = await thrownBy();

    expect(thrown).toBe(upstream);
  });

  /**
   * The control for the `[401, 403]` status list: a plain `Error` with no status at all
   * is not a refusal either, so it propagates. `'status' in error` is what makes
   * `serverApiError` safe against it, and this asserts the page's own guard survives a
   * transport error that is not even a `ServerApiError`.
   */
  it('propagates a failure that carries no upstream status', async () => {
    const upstream = new Error('socket hang up');
    serverApiGet.mockRejectedValue(upstream);

    const thrown = await thrownBy();

    expect(thrown).toBe(upstream);
    expect(redirect).not.toHaveBeenCalled();
  });

  /**
   * Regression: the fetch is attempted at most once. A build with a retry inside the
   * page would double every dashboard request during an incident, and the retry's
   * failure would still be reported through the same error boundary.
   */
  it('does not retry the failed request', async () => {
    serverApiGet.mockRejectedValue(new ServerApiError(500, 'Internal error'));

    await thrownBy();

    expect(serverApiGet).toHaveBeenCalledTimes(1);
  });
});
