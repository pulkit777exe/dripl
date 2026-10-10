import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';

/**
 * `app/share/[token]/page.tsx` had **not one of its 7 statements covered**.
 *
 * It is the server half of a capability link: the recipient opens `/share/:token`,
 * this component resolves the token *before* the HTML is produced, and hands the
 * result to `SharedCanvasRoute`, which finishes the job in the browser.
 *
 * Every decision in it is security-relevant, and two of them are decisions that
 * cannot be observed from the rendered output alone:
 *
 *   which failures are refusals — 404 and 410 both mean "this link does not
 *     work", and both render the same not-found, so a revoked link and an
 *     expired one are indistinguishable from outside. Every *other* failure has to
 *     reach `app/error.tsx`: answering a 500 with "link not found" tells the
 *     recipient they did something wrong during somebody else's outage.
 *
 *   what is sent upstream — the call is made with `token: null`. The share token
 *     is the capability; forwarding the visitor's session cookie alongside it
 *     would widen what the API learns about an anonymous request for no benefit.
 *
 *   how the token is put in the path — `encodeURIComponent` is load-bearing, not
 *     tidiness. `serverApiGet` builds `API_BASE_URL + path` and hands it to
 *     `fetch`, which normalises `..` segments and truncates at `#`. An unencoded
 *     token could therefore climb out of `/share/` and turn a share link into a
 *     request for an arbitrary API route. The tests below assert the resulting
 *     URL, not merely that an encoder is mentioned.
 *
 * `ServerApiError` is the real class — it is what splits a refusal from a
 * transport failure, and mocking it would let the `instanceof` guard invert
 * silently. Only the transport is replaced. `SharedCanvasRoute` is stubbed
 * because it is the whole editor; what this page decides is the `token`/`share`
 * pair it hands across, and that is what gets asserted.
 */

const notFound = vi.hoisted(() =>
  vi.fn((): never => {
    throw new Error('NEXT_NOT_FOUND');
  })
);

const serverApiGet = vi.hoisted(() =>
  vi.fn<
    (
      path: string,
      options: { token: string | null; cache: 'no-store'; signal?: AbortSignal }
    ) => Promise<unknown>
  >()
);

const routeProps = vi.hoisted(() =>
  vi.fn<
    (props: {
      token: string;
      share: {
        file: { id: string; name: string; updatedAt: string };
        permission: 'view' | 'edit';
        encryptedPayload: { iv: string; data: string } | null;
        elements: unknown[] | null;
      };
    }) => void
  >()
);

vi.mock('next/navigation', () => ({ notFound }));

vi.mock('@/lib/server/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/server/api')>();
  return { ...actual, serverApiGet };
});

vi.mock('@/components/canvas/SharedCanvasRoute', () => ({
  SharedCanvasRoute: (props: Parameters<typeof routeProps>[0]) => {
    routeProps(props);
    return <div data-testid="shared-canvas-route" />;
  },
}));

import { ServerApiError } from '@/lib/server/api';
import SharedCanvasPage from '@/app/share/[token]/page';
import type { SharedFileResponse } from '@/lib/api';

/** A capability that looks like an opaque base64url secret, as a real one does. */
const TOKEN = 'K7xQm2pR9tZ4vLbN6hJd1sWc';

/**
 * A share response in both of the shapes the upstream can answer with.
 *
 * `encryptedPayload` non-null means the client must decrypt; `null` with
 * `elements` means a plaintext share. Both are legitimate, and the page must
 * pass either through untouched — it does no interpretation of its own.
 */
function share(overrides: Partial<SharedFileResponse> = {}): SharedFileResponse {
  return {
    file: {
      id: 'file-1',
      name: 'Q3 architecture',
      updatedAt: '2026-02-03T10:00:00.000Z',
    },
    permission: 'view',
    encryptedPayload: null,
    elements: [{ id: 'shared-1', type: 'ellipse' }],
    ...overrides,
  };
}

/** Runs the page and renders whatever it returned, or fails loudly. */
async function renderPage(token = TOKEN): Promise<void> {
  const node = await SharedCanvasPage({ params: Promise.resolve({ token }) });
  if (!React.isValidElement(node)) throw new Error('the page returned no element');
  render(node);
}

/** The rejection a page threw, for the paths that are not a not-found. */
async function thrownBy(token = TOKEN): Promise<unknown> {
  try {
    await SharedCanvasPage({ params: Promise.resolve({ token }) });
  } catch (error) {
    return error;
  }
  throw new Error('the page did not throw');
}

/** Whether the page refused by rendering the not-found, whatever the upstream said. */
async function refusedWith(_error: unknown): Promise<boolean> {
  try {
    await SharedCanvasPage({ params: Promise.resolve({ token: TOKEN }) });
  } catch (thrown) {
    // Identity, not message: `notFound()` in the real build throws a framework
    // sentinel, and `notFound` is mocked to throw its own. Matching on the text
    // would also match the upstream's own error, which is what a build that
    // fell through to `throw error` produces.
    return thrown === NOT_FOUND_THROWN;
  }
  return false;
}

/** The single object the mocked `notFound` throws, so refusals are comparable. */
const NOT_FOUND_THROWN = (() => {
  try {
    notFound();
  } catch (error) {
    return error;
  }
  throw new Error('the notFound stub did not throw');
})();

beforeEach(() => {
  vi.clearAllMocks();
  serverApiGet.mockResolvedValue(share());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/share/[token] — a working link', () => {
  /**
   * Regression: the working direction, stated first so the refusal assertions
   * below are read against a positive. The recipient must see the shared canvas,
   * not an empty shell — the whole point of resolving the token here is that the
   * file name and permission are in the *first* HTML response.
   */
  it('renders the shared scene for a valid token', async () => {
    await renderPage();

    expect(routeProps).toHaveBeenCalledTimes(1);
    expect(routeProps.mock.calls.at(-1)?.[0].share.file.name).toBe('Q3 architecture');
  });

  /**
   * Regression: the raw token goes *down* to the client, not the encoded form.
   * `SharedCanvasRoute` hands it to the client, which redeems it for a WebSocket
   * ticket; handing over `encodeURIComponent`'s output would ask the API for a
   * ticket for a token that does not exist. Asserted against the upstream path,
   * which uses the encoded form, so the two are provably different.
   */
  it('hands the client the raw token while the API path carries the encoded one', async () => {
    const token = 'a token with spaces/and#hashes';

    await renderPage(token);

    expect(routeProps.mock.calls.at(-1)?.[0].token).toBe(token);
    expect(serverApiGet.mock.calls.at(-1)?.[0]).toBe(`/share/${encodeURIComponent(token)}`);
  });

  /**
   * Regression: no session is forwarded. The share token *is* the capability, and
   * a visitor following a link may well have a `dripl-session` cookie — sending it
   * turns an anonymous share request into an authenticated one and hands the API
   * an identity it did not need. Asserted as an exact `null`, not falsiness, so a
   * build that passed `''` or `undefined` does not slip through.
   */
  it('makes the call anonymously, with no session token', async () => {
    await renderPage();

    expect(serverApiGet.mock.calls.at(-1)?.[1].token).toBeNull();
  });

  /**
   * Regression: the Next data cache is shared across visitors, and this body is
   * somebody's file. A cached response would be served to the next requester —
   * and, for a link that is later revoked, outlive the revocation.
   */
  it('asks for an uncached response', async () => {
    await renderPage();

    expect(serverApiGet.mock.calls.at(-1)?.[1].cache).toBe('no-store');
  });

  /**
   * Regression: one upstream read per render. This is a server component with no
   * effects, so a second call would double every share-link visit.
   */
  it('resolves the token exactly once', async () => {
    await renderPage();

    expect(serverApiGet).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression: the response crosses unmodified. The page does no interpretation
   * — `SharedCanvasRoute` decides view-vs-edit and decrypts — so a page that
   * reshaped, defaulted or re-wrapped the payload would render something other
   * than what the client then adopts, and the scene would change under the
   * recipient on hydration. Asserted by identity on the nested values.
   */
  it('passes the upstream payload across unchanged', async () => {
    const response = share({
      permission: 'edit',
      encryptedPayload: { iv: 'iv-value', data: 'cipher' },
      elements: null,
    });
    serverApiGet.mockResolvedValue(response);

    await renderPage();

    const props = routeProps.mock.calls.at(-1)?.[0];
    expect(props?.share).toBe(response);
    expect(props?.share.file).toBe(response.file);
    expect(props?.share.permission).toBe('edit');
    expect(props?.share.encryptedPayload).toBe(response.encryptedPayload);
  });

  /**
   * Regression: an *encrypted* share is the common case and is handed over with
   * its payload intact. This is the control for the identity assertion above —
   * without it, a build that dropped `encryptedPayload` and always seeded a
   * plaintext scene would still look identical for the fixture above.
   */
  it('hands over an encrypted share without losing the ciphertext', async () => {
    const response = share({
      permission: 'view',
      encryptedPayload: { iv: 'aes-iv', data: 'aes-ciphertext' },
      elements: null,
    });
    serverApiGet.mockResolvedValue(response);

    await renderPage();

    expect(routeProps.mock.calls.at(-1)?.[0].share.encryptedPayload).toEqual({
      iv: 'aes-iv',
      data: 'aes-ciphertext',
    });
  });
});

describe('/share/[token] — the token in the path', () => {
  /**
   * Regression: `encodeURIComponent` is a security control here, so this asserts
   * the *URL the fetch would receive* rather than that an encoder appears in the
   * source. `serverApiGet` concatenates `API_BASE_URL + path` and `fetch`
   * normalises the result: `..` segments collapse, and everything from `#` on is
   * dropped as a fragment. A token of `../../files?all=true#x` is therefore a
   * working request for somebody else's file list if it is not encoded — issued
   * from the server, to a recipient who only ever held a share link.
   */
  it('cannot be made to escape the share route', async () => {
    const hostile = '../../files?all=true#fragment';

    await renderPage(hostile);

    const path = serverApiGet.mock.calls.at(-1)?.[0] ?? '';
    // Derived from the hostile input rather than restated, so the expectation
    // cannot drift from the string the test feeds in.
    expect(path).toBe(`/share/${encodeURIComponent(hostile)}`);
    expect(path).not.toContain('..');
    expect(path).not.toContain('?');
    expect(path).not.toContain('#');
    expect(path).not.toContain('/files');
  });

  /**
   * The control for the assertion above: a well-formed opaque token is the
   * overwhelmingly common case, and encoding must not corrupt it. Without this,
   * a build that encoded unconditionally with something lossy (or double-encoded)
   * would still pass the hostile-token test.
   */
  it('leaves an opaque token untouched in the path', async () => {
    await renderPage();

    expect(serverApiGet.mock.calls.at(-1)?.[0]).toBe(`/share/${TOKEN}`);
  });
});

describe('/share/[token] — a link that does not work', () => {
  it.each([404, 410])(
    /**
     * Regression: 404 (absent) and 410 (expired) are the two the upstream defines
     * for "this link does not work", and both are a missing resource from here.
     * They must be indistinguishable from outside — a recipient who can tell a
     * revoked link from an expired one learns something about the sharer's
     * account, which is exactly what a capability link is meant not to leak.
     */
    'renders the not-found on a %i',
    async status => {
      serverApiGet.mockRejectedValue(new ServerApiError(status, 'No such share'));

      expect(await refusedWith(new ServerApiError(status, 'No such share'))).toBe(true);
      expect(notFound).toHaveBeenCalledTimes(1);
      expect(routeProps).not.toHaveBeenCalled();
    }
  );

  /**
   * Regression: the refusal is *the not-found*, not the upstream error escaping.
   * `notFound()` throws, so a build that fell through to the `throw error` below
   * would also refuse — but it would hand `app/error.tsx` a 404-shaped incident,
   * and Next would log and report a broken link as a server fault. Asserted on
   * the identity of the thrown value, since message text would match either.
   */
  it('does not let the upstream refusal escape as an error', async () => {
    const upstream = new ServerApiError(404, 'No such share');
    serverApiGet.mockRejectedValue(upstream);

    const thrown = await thrownBy();

    expect(thrown).not.toBe(upstream);
    expect((thrown as Error).message).toBe('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression: the working direction of the refusal path. "Renders nothing" is
   * also what a build that never attempted the fetch would produce, so the fetch
   * is asserted to have happened — once, on the right path. Without this, a page
   * that refused *before* asking would pass every other assertion in this block,
   * including the two above.
   */
  it('asks the API before refusing, rather than refusing blind', async () => {
    serverApiGet.mockRejectedValue(new ServerApiError(404, 'No such share'));

    await thrownBy();

    expect(serverApiGet).toHaveBeenCalledTimes(1);
    expect(serverApiGet.mock.calls.at(-1)?.[0]).toBe(`/share/${TOKEN}`);
  });

  /**
   * Regression: 403 is a refusal but it is *not* the upstream's "this link does
   * not work". A share endpoint does not authenticate a session, so a 403 means
   * the request was refused for a different reason — most likely that a session
   * *was* forwarded. Rendering the not-found there would tell a visitor holding a
   * perfectly good link that the link is broken.
   */
  it('does not disguise a 403 as a dead link', async () => {
    const upstream = new ServerApiError(403, 'Forbidden');
    serverApiGet.mockRejectedValue(upstream);

    const thrown = await thrownBy();

    expect(notFound).not.toHaveBeenCalled();
    expect(thrown).toBe(upstream);
    expect(routeProps).not.toHaveBeenCalled();
  });
});

describe('/share/[token] — an upstream failure that is not a dead link', () => {
  it.each([
    ['a 500', () => new ServerApiError(500, 'Internal error')],
    ['a 502', () => new ServerApiError(502, 'Bad gateway')],
    ['a 429', () => new ServerApiError(429, 'Too many requests')],
    ['a transport failure', () => new TypeError('fetch failed')],
  ])(
    /**
     * Regression: everything that is not "this link does not work" is an
     * incident, and belongs in `app/error.tsx`. Answering a 500 with "link not
     * found" is both a lie — the recipient's link may be fine — and the one
     * failure mode that hides an outage behind a working-looking app.
     *
     * The 429 and 502 cases are here because a build that widened the refusal
     * list to include 500s would still pass the 404 case above.
     *
     * The transport case pins `instanceof ServerApiError`: a rejected fetch is
     * not a refusal, and a guard reading `error.status` without the `instanceof`
     * would type-error on it.
     */
    'propagates %s to the error boundary instead of rendering a dead link',
    async (_label, makeError) => {
      const upstream = makeError();
      serverApiGet.mockRejectedValue(upstream);

      const thrown = await thrownBy();

      expect(notFound).not.toHaveBeenCalled();
      // By identity: a build that wrapped the failure in a generic `Error`
      // would lose the status an operator needs to tell a 502 from a 500.
      expect(thrown).toBe(upstream);
      expect(routeProps).not.toHaveBeenCalled();
    }
  );

  /**
   * Regression: the failed lookup is not retried. A retry inside the page would
   * double every share request during an incident, and the retry's failure would
   * surface through the same error boundary, so the user-visible outcome would be
   * identical while the load on a struggling API is not.
   */
  it('does not retry the failed lookup', async () => {
    serverApiGet.mockRejectedValue(new ServerApiError(500, 'Internal error'));

    await thrownBy();

    expect(serverApiGet).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression: a resolution of `undefined` is a 200 with no body, which the
   * typed contract forbids. The page has no validity check, so `undefined` would
   * reach `SharedCanvasRoute` and be read as "no permission, no elements" — a
   * blank canvas presented as a working share link. Asserted so that the day
   * someone adds a guard, this is the behaviour they have to beat.
   */
  it('hands an empty body to the route rather than inventing a scene', async () => {
    serverApiGet.mockResolvedValue(undefined);

    await renderPage();

    expect(routeProps).toHaveBeenCalledTimes(1);
    expect(routeProps.mock.calls.at(-1)?.[0].share).toBeUndefined();
  });
});

describe('/share/[token] — the token does not escape into a log', () => {
  /**
   * Regression: a share token is a bearer credential. Anything that writes it to
   * a console, a log aggregator or an error report has published the capability,
   * because the whole model is "whoever holds the string may read the file".
   *
   * Asserted over every console level with the argument list stringified, so a
   * leak through any argument position — or through an Error's own message — is
   * caught, not just a bare `console.log(token)`.
   */
  it('writes the token nowhere on a successful resolution', async () => {
    const levels = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level =>
      vi.spyOn(console, level).mockImplementation(() => undefined)
    );

    await renderPage();

    for (const spy of levels) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(TOKEN);
      }
    }
  });

  /**
   * The control for the assertion above, and the case that matters more: a
   * *refused* link is the one an engineer is most likely to reach for when
   * debugging, so it is where a `console.warn('bad share', token)` would be
   * written — and where the recipient's revoked credential would end up in a log
   * pipeline that a different set of people can read.
   */
  it('writes the token nowhere when the link is refused', async () => {
    const levels = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level =>
      vi.spyOn(console, level).mockImplementation(() => undefined)
    );
    serverApiGet.mockRejectedValue(new ServerApiError(410, 'Share link expired'));

    await thrownBy();

    expect(notFound).toHaveBeenCalledTimes(1);
    for (const spy of levels) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(TOKEN);
      }
    }
  });

  /**
   * Regression: the token reaches the client only as a prop, and never as
   * rendered text or markup. `SharedCanvasRoute` is stubbed here, so anything
   * this page itself put on screen — a `<code>{token}</code>` in an error state,
   * a `data-token` attribute for debugging — would show up in the DOM and fail
   * this. The prop is asserted separately so "the token went somewhere" is not
   * satisfied by simply not using it.
   */
  it('keeps the token out of the rendered markup', async () => {
    const { container } = render(
      (await SharedCanvasPage({ params: Promise.resolve({ token: TOKEN }) })) as React.ReactElement
    );

    expect(container.textContent).not.toContain(TOKEN);
    expect(container.innerHTML).not.toContain(TOKEN);
    expect(routeProps.mock.calls.at(-1)?.[0].token).toBe(TOKEN);
  });
});
