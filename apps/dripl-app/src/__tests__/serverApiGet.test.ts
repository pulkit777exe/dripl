import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerApiError, serverApiError, serverApiGet } from '@/lib/server/api';

/**
 * `lib/server/api.ts`: the single authenticated, uncached fetch every Server
 * Component uses to reach `http-server`.
 *
 * The module documents two guarantees, and both are security properties rather
 * than plumbing:
 *
 *   1. The session is forwarded *explicitly*. A server-side fetch has no ambient
 *      cookie jar, so the token must ride on `Authorization: Bearer`. Silently
 *      dropping it turns an authenticated page into an anonymous one and the
 *      upstream answers 401 -- or worse, answers an anonymous body that the page
 *      renders as if it were the user's own. The `null` token case is the
 *      deliberate exception (the share endpoint authenticates on its own token),
 *      so it must produce a request with *no* Authorization header, not an empty
 *      one.
 *   2. Caching is a caller decision, and `no-store` is the only value the type
 *      admits. The Next data cache is shared across visitors, so a cached
 *      personalized body is one user's files handed to the next requester. The
 *      policy is passed straight through to `fetch` rather than defaulted, so it
 *      is asserted as an observed argument.
 *
 * Errors are also worth separating carefully. `ServerApiError` carries the
 * upstream `status` and *only* the status -- the upstream body is a
 * service-shaped payload that must not reach a rendered page. And `errorMessage`
 * has three distinct fallbacks, which is why its branches are worth testing: a
 * 401 and a 500 must not collapse into the same message, because
 * `serverApiError` is what tells a page to redirect instead of raising.
 */

/** A real `Response`, so `ok`/`status`/`json()` behave as they do in production. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3002/api';

describe('serverApiGet', () => {
  beforeEach(() => {
    // Reset *all* observable state: the call log, the default body, and the
    // global spy. A default left over from a previous test makes the next
    // assertion about arguments pass for the wrong reason.
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the session as a bearer header and returns the parsed body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ files: [{ id: 'f1' }] }));

    const body = await serverApiGet<{ files: Array<{ id: string }> }>('/files', {
      token: 'token-abc',
      cache: 'no-store',
    });

    expect(body).toEqual({ files: [{ id: 'f1' }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${API_BASE}/files`);
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer token-abc');
    expect(headers.get('Accept')).toBe('application/json');
  });

  // Regression: the shared-cache property. `no-store` is the only thing stopping
  // the Next data cache from serving this body to the next visitor, and it is a
  // caller-supplied value, so it has to be asserted as observed rather than
  // assumed from the type.
  it('passes the caller cache policy through to fetch', async () => {
    await serverApiGet('/files', { token: 't', cache: 'no-store' });

    expect(fetchMock.mock.calls[0]?.[1]?.cache).toBe('no-store');
  });

  it('forwards the abort signal when one is given', async () => {
    const controller = new AbortController();

    await serverApiGet('/files', { token: 't', cache: 'no-store', signal: controller.signal });

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it('omits the signal entirely when none is given', async () => {
    await serverApiGet('/files', { token: 't', cache: 'no-store' });

    // `signal: undefined` and an absent key are equivalent to fetch, so this is
    // asserted only to pin that the option is genuinely optional.
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeUndefined();
  });

  // Regression: the anonymous path. `token: null` means "make the anonymous call"
  // (the share endpoint). Sending `Authorization: Bearer null` would be a real
  // credential-shaped string built from a null, so the header must be absent
  // rather than empty.
  it('makes an anonymous request with no Authorization header when the token is null', async () => {
    await serverApiGet<{ readOnly: boolean }>('/share/abc', { token: null, cache: 'no-store' });

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.has('Authorization')).toBe(false);
  });

  it('appends the path to the configured API base exactly once', async () => {
    await serverApiGet('/folders/1/files?page=2', { token: 't', cache: 'no-store' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API_BASE}/folders/1/files?page=2`);
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('//folders');
  });

  // Regression: the refusal path. The status is copied so a route can answer 401
  // the way the API answered it; the body is not forwarded, because it is a
  // service-shaped payload rather than something to hand to a page.
  it('throws a ServerApiError carrying the upstream status but not its body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'unauthorized', message: 'Session expired', stack: '/srv/app.ts' }, 401)
    );

    const error = await serverApiGet('/files', { token: 't', cache: 'no-store' }).then(
      () => null,
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(ServerApiError);
    const apiError = error as ServerApiError;
    expect(apiError.status).toBe(401);
    expect(apiError.message).toBe('Session expired');
    // No upstream internals leak into the message.
    expect(apiError.message).not.toContain('/srv/app.ts');
    expect(apiError.name).toBe('ServerApiError');
    expect(apiError).toBeInstanceOf(Error);
  });

  it('keeps a 5xx distinct from a 4xx so a page can tell an outage from a refusal', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'boom' }, 500));

    const error = (await serverApiGet('/files', { token: 't', cache: 'no-store' }).then(
      () => null,
      (e: unknown) => e
    )) as ServerApiError;

    expect(error.status).toBe(500);
    expect(serverApiError(error, [401, 403])).toBe(false);
    expect(serverApiError(error, [500])).toBe(true);
  });

  // `errorMessage` has three fallbacks, in priority order. Each is a distinct
  // observable: which one fires is what decides whether a page says "your session
  // expired" or shows a generic failure.
  it.each([
    [
      'prefers message over error',
      { message: 'from message', error: 'from error' },
      'from message',
    ],
    ['falls back to error', { error: 'from error' }, 'from error'],
    ['falls back to a generic line when neither is present', { status: 'nope' }, 'Request failed'],
  ])('%s', async (_label, body, expected) => {
    fetchMock.mockResolvedValue(jsonResponse(body, 400));

    const error = (await serverApiGet('/files', { token: 't', cache: 'no-store' }).then(
      () => null,
      (e: unknown) => e
    )) as ServerApiError;

    expect(error.message).toBe(expected);
  });

  // Regression: a non-JSON error body (an HTML proxy page, a bare 502) must not
  // throw out of the message reader, because that would replace the useful 502
  // with an unrelated parse error and the page would report the wrong failure.
  it('reports a generic message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    const error = (await serverApiGet('/files', { token: 't', cache: 'no-store' }).then(
      () => null,
      (e: unknown) => e
    )) as ServerApiError;

    expect(error.status).toBe(502);
    expect(error.message).toBe('Request failed');
  });

  it('reports a generic message when the error body is an empty string', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));

    const error = (await serverApiGet('/files', { token: 't', cache: 'no-store' }).then(
      () => null,
      (e: unknown) => e
    )) as ServerApiError;

    expect(error.status).toBe(503);
    expect(error.message).toBe('Request failed');
  });

  it('does not call errorMessage on a successful response', async () => {
    const json = vi.spyOn(Response.prototype, 'json');
    fetchMock.mockResolvedValue(jsonResponse({ files: [] }));

    await serverApiGet('/files', { token: 't', cache: 'no-store' });

    // Exactly one read: the success path consumes the body once.
    expect(json).toHaveBeenCalledTimes(1);
    json.mockRestore();
  });
});

describe('serverApiError', () => {
  it('matches only a ServerApiError whose status is in the list', () => {
    expect(serverApiError(new ServerApiError(401, 'x'), [401, 403])).toBe(true);
    expect(serverApiError(new ServerApiError(403, 'x'), [401, 403])).toBe(true);
    expect(serverApiError(new ServerApiError(404, 'x'), [401, 403])).toBe(false);
  });

  // A transport failure is not a refusal. Treating one as a 401 would redirect a
  // working user to /login because the network blipped, so an unrelated throw --
  // including another `Error` with a `status` field -- must not match.
  it.each([
    ['a plain Error', new Error('socket hang up')],
    ['a non-Error value', 'unauthorized'],
    ['null', null],
    ['undefined', undefined],
    ['an object with a status field', Object.assign(new Error('x'), { status: 401 })],
  ])('does not match %s', (_label, thrown) => {
    expect(serverApiError(thrown, [401, 403])).toBe(false);
  });

  it('requires a non-empty status list to match anything', () => {
    expect(serverApiError(new ServerApiError(401, 'x'), [])).toBe(false);
  });

  it('accepts a readonly tuple of statuses', () => {
    const statuses = [401, 403, 500] as const;
    expect(serverApiError(new ServerApiError(500, 'x'), statuses)).toBe(true);
  });
});
