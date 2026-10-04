import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * `POST /api/share` and `POST /api/canvas/rooms` are authenticated BFF proxies:
 * they hold no credentials of their own, forward the caller's cookie/Authorization
 * to `http-server`, and are the only place a browser-supplied payload is narrowed
 * before it reaches the room/share service.
 *
 * Both files carry their own copy of `apiBaseUrl()` and `forwardedCookie()`
 * (there is no shared module for them), so each is exercised separately here: a
 * mutation in one copy is invisible to a test that only drives the other.
 */

const APP_ORIGIN = 'http://localhost:3000';
const API_ORIGIN = 'http://api.test:3002';

const fetchMock = vi.fn();

/** A stand-in for a `http-server` reply. */
function upstream(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Which URLs the route asked for, in order. */
function calledUrls(): string[] {
  return fetchMock.mock.calls.map(call => String(call[0]));
}

/** The JSON body of the single call made to `url`. */
function bodyFor(url: string): unknown {
  const call = fetchMock.mock.calls.find(entry => String(entry[0]).includes(url));
  if (!call) throw new Error(`no fetch call matched ${url}; saw ${calledUrls().join(', ')}`);
  return JSON.parse(String(call[1]?.body ?? 'null'));
}

function headersFor(url: string): Headers {
  const call = fetchMock.mock.calls.find(entry => String(entry[0]).includes(url));
  if (!call) throw new Error(`no fetch call matched ${url}; saw ${calledUrls().join(', ')}`);
  return new Headers(call[1]?.headers as HeadersInit);
}

/** `csrf-token` values present in a forwarded `cookie` header, in order. */
function forwardedCsrfCookies(cookieHeader: string): string[] {
  return cookieHeader
    .split(';')
    .map(part => part.trim())
    .filter(part => part.startsWith('csrf-token='))
    .map(part => part.slice('csrf-token='.length));
}

function shareRequest(options?: {
  origin?: string | null;
  cookie?: string;
  body?: string;
  headers?: Record<string, string>;
}) {
  const headers: Record<string, string> = { ...options?.headers };
  const origin = options?.origin === undefined ? APP_ORIGIN : options.origin;
  if (origin !== null) headers.origin = origin;
  if (options?.cookie) headers.cookie = options.cookie;
  return new NextRequest('http://localhost:3000/api/share', {
    method: 'POST',
    body: options?.body ?? JSON.stringify({ fileId: 'file-1', permission: 'view' }),
    headers,
  });
}

function roomsRequest(options?: {
  origin?: string | null;
  body?: string;
  headers?: Record<string, string>;
}) {
  const headers: Record<string, string> = { ...options?.headers };
  const origin = options?.origin === undefined ? APP_ORIGIN : options.origin;
  if (origin !== null) headers.origin = origin;
  return new NextRequest('http://localhost:3000/api/canvas/rooms', {
    method: 'POST',
    body: options?.body ?? JSON.stringify({ content: '[]' }),
    headers,
  });
}

describe('BFF proxy routes: /api/share and /api/canvas/rooms', () => {
  let shareRoute: typeof import('@/app/api/share/route');
  let roomsRoute: typeof import('@/app/api/canvas/rooms/route');
  let shareByTokenRoute: typeof import('@/app/api/share/[token]/route');

  beforeEach(async () => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.resetModules();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('API_SERVER_URL', API_ORIGIN);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_ORIGIN);
    vi.stubEnv('NODE_ENV', 'production');

    fetchMock.mockImplementation(async (url: string) => {
      const target = String(url);
      if (target.endsWith('/api/csrf-token')) return upstream({ token: 'issued-csrf' });
      if (target.endsWith('/api/rooms')) return upstream({ room: { slug: 'room-7' } });
      if (target.endsWith('/share')) return upstream({ token: 'share-token-1' });
      if (target.includes('/api/share/')) return upstream({ token: 'share-token-1' });
      return upstream({ error: `unexpected upstream call: ${target}` }, 500);
    });

    shareRoute = await import('@/app/api/share/route');
    roomsRoute = await import('@/app/api/canvas/rooms/route');
    shareByTokenRoute = await import('@/app/api/share/[token]/route');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  /* ------------------------------------------------------------------ *
   * POST /api/share — origin gate
   * ------------------------------------------------------------------ */

  it('refuses a production share POST with no Origin and never reaches http-server', async () => {
    const response = await shareRoute.POST(shareRequest({ origin: null }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden origin' });
    // Regression: browsers always send Origin on a same-origin POST, so its
    // absence is the signature of a non-browser CSRF POST. Passing it through
    // would hand the service a forged, cookie-authenticated write.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a production share POST from a foreign origin', async () => {
    const response = await shareRoute.POST(
      shareRequest({ origin: 'https://attacker.example', cookie: 'dripl-session=t' })
    );

    expect(response.status).toBe(403);
    // Regression: the cross-origin CSRF POST. A cookie is present, so without
    // this gate the victim's session would create a share for the attacker's page.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a production share POST when no app origin is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined);
    vi.stubEnv('APP_URL', undefined);

    const response = await shareRoute.POST(shareRequest({ origin: APP_ORIGIN }));

    expect(response.status).toBe(403);
    // Regression: an unconfigured deployment must fail closed. If a missing
    // `NEXT_PUBLIC_APP_URL` resolved to "allow everything", the origin gate
    // would silently vanish in exactly the deployments that forgot to set it.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('admits a production share POST from the configured origin', async () => {
    const response = await shareRoute.POST(
      shareRequest({ origin: APP_ORIGIN, cookie: 'dripl-session=t' })
    );

    // Regression: guards the gate itself. A mutation that made the origin check
    // unconditionally refuse would still pass every refusal test above.
    expect(response.status).toBe(200);
    expect(calledUrls()).toContain(`${API_ORIGIN}/api/csrf-token`);
  });

  /* ------------------------------------------------------------------ *
   * POST /api/share - the non-production origin branch
   * ------------------------------------------------------------------ */

  // The origin gate has two arms, and every test above pins only the
  // production one, because NODE_ENV is stubbed to 'production' for the whole
  // file. The dev arm is a genuinely different predicate: outside production a
  // *missing* Origin is allowed (a same-origin curl or a server-side call has
  // none, and refusing it would break local development), while a *mismatched*
  // Origin is still refused so a page on another origin cannot drive a
  // cookie-authenticated write even in dev. Both halves are asserted, because
  // loosening either one is a CSRF hole rather than a dev inconvenience.

  async function sharePostAsNodeEnv(nodeEnv: string, origin: string | null) {
    vi.stubEnv('NODE_ENV', nodeEnv);
    vi.resetModules();
    vi.stubGlobal('fetch', fetchMock);
    // Re-import so the module reads the newly stubbed NODE_ENV.
    const route = await import('@/app/api/share/route');
    return route.POST(shareRequest({ origin }));
  }

  it('admits a share POST with no Origin outside production', async () => {
    const response = await sharePostAsNodeEnv('development', null);
    expect(response.status).toBe(200);
  });

  it('still refuses a foreign Origin outside production', async () => {
    const response = await sharePostAsNodeEnv('development', 'https://attacker.example');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden origin' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('admits a same-origin POST outside production', async () => {
    const response = await sharePostAsNodeEnv('development', APP_ORIGIN);
    expect(response.status).toBe(200);
  });

  /* ------------------------------------------------------------------ *
   * POST /api/share — size and payload validation
   * ------------------------------------------------------------------ */

  it('refuses a share POST whose declared content-length exceeds the 10 kB cap', async () => {
    const response = await shareRoute.POST(
      shareRequest({ headers: { 'content-length': '10001' }, body: '{"fileId":"f"}' })
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Payload too large' });
    // Regression: the declared-length fast path. Losing it costs nothing
    // functionally but silently removes the cheap rejection of a hostile length.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a share POST whose streamed body exceeds the cap with no declared length', async () => {
    const response = await shareRoute.POST(
      shareRequest({ body: JSON.stringify({ fileId: 'f'.repeat(11_000), permission: 'view' }) })
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Payload too large' });
    // Regression: a chunked request that omits Content-Length is exactly what
    // the streaming reader exists for. Without the in-flight byte cap, an
    // undeclared multi-megabyte body would be buffered before validation.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a share POST whose body is not JSON', async () => {
    const response = await shareRoute.POST(shareRequest({ body: 'not json at all' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid request payload' });
    // Regression: unparseable input must be refused at the edge rather than
    // forwarded to the share service as a stringified non-object.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing permission', { fileId: 'file-1' }],
    ['an unknown permission', { fileId: 'file-1', permission: 'admin' }],
    ['a blank fileId', { fileId: '   ', permission: 'view' }],
    ['an over-long fileId', { fileId: 'f'.repeat(101), permission: 'view' }],
    ['an expiry beyond one year', { fileId: 'file-1', permission: 'view', expiresInHours: 8761 }],
    ['a non-positive expiry', { fileId: 'file-1', permission: 'view', expiresInHours: 0 }],
    ['a fractional expiry', { fileId: 'file-1', permission: 'view', expiresInHours: 1.5 }],
  ])('refuses %s before contacting the share service', async (_label, payload) => {
    const response = await shareRoute.POST(shareRequest({ body: JSON.stringify(payload) }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'fileId and permission are required' });
    // Regression: this Zod object is the whole narrowing boundary for the share
    // service. A dropped `.max(8760)` or a widened `permission` enum would let a
    // caller mint a permanent or write-capable link the product never offers.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /* ------------------------------------------------------------------ *
   * POST /api/share — CSRF bootstrap and upstream failure modes
   * ------------------------------------------------------------------ */

  it('answers 503 and skips the share call when the CSRF bootstrap itself fails', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/csrf-token') ? upstream({ error: 'down' }, 502) : upstream({})
    );

    const response = await shareRoute.POST(shareRequest({ cookie: 'dripl-session=t' }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Unable to initialize security token' });
    // Regression: a 2xx-shaped failure here must not fall through to the share
    // call. It would send an empty `x-csrf-token`, i.e. a write the service can
    // only reject — while the caller sees a confusing 4xx instead of a 503.
    expect(calledUrls()).toEqual([`${API_ORIGIN}/api/csrf-token`]);
  });

  it('answers 503 when the CSRF bootstrap returns a body with no token', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/csrf-token') ? upstream({ token: '' }) : upstream({})
    );

    const response = await shareRoute.POST(shareRequest({ cookie: 'dripl-session=t' }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Unable to initialize security token' });
    // Regression: `!csrfResponse.ok` alone is not enough — a 200 carrying
    // `{ token: '' }` must be treated as a failed bootstrap, or the share call
    // goes out with an empty double-submit token.
    expect(calledUrls()).toEqual([`${API_ORIGIN}/api/csrf-token`]);
  });

  it('answers 503 when the share service is unreachable', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/csrf-token')) return upstream({ token: 'issued-csrf' });
      throw new TypeError('fetch failed');
    });

    const response = await shareRoute.POST(shareRequest({ cookie: 'dripl-session=t' }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Share service unavailable' });
    // Regression: a transport failure has to surface as 503. Left to propagate,
    // the client sees a 500 and the operator sees an unhandled rejection in the
    // BFF rather than a dependency outage.
  });

  /* ------------------------------------------------------------------ *
   * POST /api/share — what is forwarded (negative space)
   * ------------------------------------------------------------------ */

  it('forwards only permission and expiresInHours, never the caller-supplied id or extra fields', async () => {
    await shareRoute.POST(
      shareRequest({
        cookie: 'dripl-session=t',
        body: JSON.stringify({
          fileId: 'file-1',
          permission: 'edit',
          expiresInHours: 24,
          content: '[]',
          name: 'renamed by caller',
          userId: 'attacker-controlled-id',
        }),
      })
    );

    expect(bodyFor('/share')).toEqual({ permission: 'edit', expiresInHours: 24 });
    // Regression: the module's stated contract is that it forwards the
    // authenticated request and "never accepts scene content or names". Extra
    // body keys reaching `POST /files/:id/share` are pass-through of caller
    // input into the durable share record.
  });

  it('omits expiresInHours entirely when the caller did not send one', async () => {
    await shareRoute.POST(
      shareRequest({
        cookie: 'dripl-session=t',
        body: JSON.stringify({ fileId: 'file-1', permission: 'view', expiresInHours: undefined }),
      })
    );

    // Regression: `expiresInHours: undefined` collapses out of `JSON.stringify`,
    // so the key must be absent — not present-and-null, which the service would
    // read as "expires at the epoch".
    expect(bodyFor('/share')).toEqual({ permission: 'view' });
    expect(Object.keys(bodyFor('/share') as object)).not.toContain('expiresInHours');
  });

  it('percent-encodes the fileId so it cannot escape the share path segment', async () => {
    await shareRoute.POST(
      shareRequest({
        cookie: 'dripl-session=t',
        body: JSON.stringify({ fileId: '../../admin/other-user-file', permission: 'view' }),
      })
    );

    const [shareUrl] = calledUrls().filter(url => url.includes('/files/'));
    // Regression: `fileId` is caller-supplied and unvalidated for path syntax
    // (only length and non-emptiness are checked). Without encoding, `../`
    // segments would re-target the request at a different `http-server` route.
    expect(shareUrl).toBe(`${API_ORIGIN}/api/files/..%2F..%2Fadmin%2Fother-user-file/share`);
  });

  it('replaces a client-supplied csrf-token cookie with the issued one', async () => {
    await shareRoute.POST(
      shareRequest({
        cookie: 'dripl-session=t; csrf-token=attacker-chosen; other=keep-me',
      })
    );

    const forwarded = headersFor('/files/');
    // Regression: the double-submit check compares the header against the
    // cookie. Forwarding both a stale and the issued token would let a caller
    // pin whichever value the service reads first, defeating the CSRF binding.
    expect(forwardedCsrfCookies(forwarded.get('cookie') ?? '')).toEqual(['issued-csrf']);
    expect(forwarded.get('x-csrf-token')).toBe('issued-csrf');
    expect(forwarded.get('cookie')).toContain('other=keep-me');
  });

  it('passes a downstream refusal status through instead of flattening it', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/csrf-token')
        ? upstream({ token: 'issued-csrf' })
        : upstream({ error: 'Forbidden origin' }, 403)
    );

    const response = await shareRoute.POST(shareRequest({ cookie: 'dripl-session=t' }));

    // Regression: the proxy forwards `response.status` verbatim. Replacing it
    // with a fixed status would turn "you may not share this file" into an
    // indistinguishable server error for the client.
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden origin' });
  });

  it('keeps the upstream status when the share service answers with a non-JSON body', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/csrf-token')) return upstream({ token: 'issued-csrf' });
      return new Response('<html>502 Bad Gateway</html>', { status: 502 });
    });

    const response = await shareRoute.POST(shareRequest({ cookie: 'dripl-session=t' }));

    // Regression: the `.catch(() => ({}))` fallback exists so an HTML error page
    // from a proxy does not throw. It must not also lose the status — a caller
    // cannot distinguish "share service is down" from "share was created".
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({});
  });

  it('builds the upstream URL once per /api segment, from whichever env var is set', async () => {
    vi.stubEnv('API_SERVER_URL', undefined);
    vi.stubEnv('HTTP_SERVER_URL', 'http://from-http-server.test:3002/');
    await shareRoute.POST(shareRequest({ cookie: 'dripl-session=t' }));
    expect(calledUrls()).toContain('http://from-http-server.test:3002/api/csrf-token');

    fetchMock.mockClear();
    vi.stubEnv('API_SERVER_URL', 'http://from-api-server.test:3002/api');
    await shareRoute.POST(shareRequest({ cookie: 'dripl-session=t' }));
    // Regression: the base URL is assembled from a four-way `??` chain plus a
    // `/api` suffix. A deployment that configures only `NEXT_PUBLIC_API_URL`, or
    // one whose base already ends in `/api`, must not end up on
    // `localhost:3002/api/api` — every share silently 404s at the proxy.
    expect(calledUrls()).toContain('http://from-api-server.test:3002/api/csrf-token');
    expect(calledUrls().some(url => url.includes('/api/api'))).toBe(false);
  });

  it('omits the cookie and authorization headers entirely when the caller sent neither', async () => {
    await shareRoute.POST(shareRequest());

    const csrfHeaders = headersFor('/csrf-token');
    const shareHeaders = headersFor('/files/');
    // Regression: with no credential at all the CSRF bootstrap must go out bare.
    // Emitting `cookie: ''` or `authorization: ''` instead changes what
    // `http-server` sees from "anonymous" to "malformed credential".
    expect(csrfHeaders.get('cookie')).toBeNull();
    expect(csrfHeaders.get('authorization')).toBeNull();
    expect(shareHeaders.get('authorization')).toBeNull();
    // Regression: with no existing cookie, the issued token must be the whole
    // header value. A stray leading `; ` here is what a naive concatenation
    // produces and some cookie parsers reject.
    expect(shareHeaders.get('cookie')).toBe('csrf-token=issued-csrf');
  });

  /* ------------------------------------------------------------------ *
   * POST /api/canvas/rooms
   * ------------------------------------------------------------------ */

  it('refuses a rooms POST with no Origin at all', async () => {
    const response = await roomsRoute.POST(roomsRequest({ origin: null }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden origin' });
    // Regression: `hasAllowedOrigin` deliberately requires *presence*, unlike
    // the share route's dev-mode leniency. If this route ever went back to
    // treating a missing Origin as acceptable, a non-browser CSRF POST through.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a rooms POST from a foreign origin', async () => {
    const response = await roomsRoute.POST(roomsRequest({ origin: 'https://attacker.example' }));

    expect(response.status).toBe(403);
    // Regression: cross-origin room creation billed to the victim's session.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a rooms POST whose declared content-length exceeds the canvas cap', async () => {
    const response = await roomsRoute.POST(
      roomsRequest({ headers: { 'content-length': String(2 * 1024 * 1024 + 16_384 + 1) } })
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Canvas content too large.' });
    // Regression: the declared-length fast path, which keeps a hostile
    // Content-Length from being streamed in full before the cap is noticed.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a rooms POST whose streamed body exceeds the cap with no declared length', async () => {
    const response = await roomsRoute.POST(
      roomsRequest({ body: JSON.stringify({ content: '['.repeat(2 * 1024 * 1024 + 1) }) })
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Canvas content too large.' });
    // Regression: the in-flight byte cap is the only thing bounding an
    // undeclared chunked body. Remove it and a 2 MB room body is buffered in
    // full before anything decides it is too big.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a rooms POST whose body is not JSON', async () => {
    const response = await roomsRoute.POST(roomsRequest({ body: 'not json at all' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid canvas payload.' });
    // Regression: a garbage body must not reach the room service as an empty
    // scene, which would look like a successful "created an empty room".
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', JSON.stringify({})],
    ['numeric', JSON.stringify({ content: 42 })],
    ['an object', JSON.stringify({ content: { elements: [] } })],
    ['null', JSON.stringify({ content: null })],
  ])('substitutes an empty scene for %s content', async (_label, body) => {
    const response = await roomsRoute.POST(roomsRequest({ body }));

    expect(response.status).toBe(200);
    // Regression: `content` is written to the durable scene column. Forwarding a
    // number or an object instead of `'[]'` would store a non-array in the
    // canvas JSON and break every reader downstream of it.
    expect(bodyFor('/rooms')).toEqual({ content: '[]' });
  });

  it('maps a downstream 401 to 401, distinct from the 503 CSRF failure', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/csrf-token')
        ? upstream({ token: 'issued-csrf' })
        : upstream({ error: 'Unauthorized' }, 401)
    );

    const response = await roomsRoute.POST(roomsRequest());

    // Regression: the 401 pass-through is a separate branch from the CSRF 503
    // and from the `!response.ok` passthrough. Collapsing them would tell a
    // signed-out caller that the service is broken, which is the one distinction
    // that makes them retry the right thing.
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('preserves a downstream non-ok status other than 401', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/csrf-token')
        ? upstream({ token: 'issued-csrf' })
        : upstream({ error: 'slow down' }, 429)
    );

    const response = await roomsRoute.POST(roomsRequest());

    // Regression: an upstream 429 must reach the client as 429 with its
    // Retry-After semantics intact, not be rewritten into the generic
    // 'Unable to create room.' 200-adjacent answer.
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'Unable to create room.' });
  });

  it('answers 500 when the room service reports success without a slug', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/csrf-token')
        ? upstream({ token: 'issued-csrf' })
        : upstream({ room: {} })
    );

    const response = await roomsRoute.POST(roomsRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Invalid room response.' });
    // Regression: without this guard the client receives `{roomId: undefined}`
    // with a 200 and stores a broken room id. The failure has to be loud.
  });

  it('answers 500 when the room service is unreachable', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/csrf-token')) return upstream({ token: 'issued-csrf' });
      throw new TypeError('fetch failed');
    });

    const response = await roomsRoute.POST(roomsRequest());

    // Regression: the broad catch exists precisely so a transport failure does
    // not escape as an unhandled rejection from the route handler.
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Unable to create room.' });
  });

  it('answers 503 for both CSRF bootstrap failure shapes', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/api/csrf-token') ? upstream({ error: 'down' }, 502) : upstream({})
    );
    const bootstrapFailed = await roomsRoute.POST(roomsRequest());

    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/api/csrf-token') ? upstream({ token: '' }) : upstream({})
    );
    const tokenMissing = await roomsRoute.POST(roomsRequest());

    // Regression: the rooms route had no coverage of either CSRF failure. Both
    // must be 503 *before* `POST /rooms`, and the two must not be confused with
    // the downstream 401/500 answers — a caller cannot otherwise tell "this
    // deployment is broken" from "your session expired".
    expect(bootstrapFailed.status).toBe(503);
    expect(tokenMissing.status).toBe(503);
    expect(await bootstrapFailed.json()).toEqual({ error: 'Unable to initialize security token' });
    expect(await tokenMissing.json()).toEqual({ error: 'Unable to initialize security token' });
    expect(calledUrls()).toEqual([`${API_ORIGIN}/api/csrf-token`]);
  });

  it('returns the room slug as roomId and forwards the session cookie', async () => {
    const response = await roomsRoute.POST(
      roomsRequest({ body: JSON.stringify({ content: '[{"id":"e1"}]' }) })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ roomId: 'room-7' });
    expect(bodyFor('/rooms')).toEqual({ content: '[{"id":"e1"}]' });
    // Regression: the caller's credential has to survive the hop, or every
    // authenticated room creation would be refused downstream.
    expect(headersFor('/rooms').get('cookie')).toContain('csrf-token=issued-csrf');
    expect(calledUrls()).toEqual([`${API_ORIGIN}/api/csrf-token`, `${API_ORIGIN}/api/rooms`]);
  });

  /* ------------------------------------------------------------------ *
   * GET /api/share/[token] — public read side of the same surface
   * ------------------------------------------------------------------ */

  it('serves a share read with no-store and the upstream payload', async () => {
    const response = await shareByTokenRoute.GET(
      new Request('http://localhost:3000/api/share/t1'),
      {
        params: Promise.resolve({ token: 't1' }),
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ token: 'share-token-1' });
    // Regression: a share payload is private scene content. Without `no-store` an
    // intermediary or the browser disk cache can retain it after the link is
    // revoked.
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('keeps a 404 for an unknown share token rather than inventing one', async () => {
    fetchMock.mockImplementation(async () => upstream({ error: 'Not found' }, 404));

    const response = await shareByTokenRoute.GET(
      new Request('http://localhost:3000/api/share/t1'),
      {
        params: Promise.resolve({ token: 't1' }),
      }
    );

    // Regression: the read path forwards `response.status` verbatim. A rewritten
    // status would make a revoked link indistinguishable from a transient error,
    // and the client would keep retrying a share that will never resolve.
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  it('answers 503 when the share service is unreachable on the read path', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('fetch failed');
    });

    const response = await shareByTokenRoute.GET(
      new Request('http://localhost:3000/api/share/t1'),
      {
        params: Promise.resolve({ token: 't1' }),
      }
    );

    // Regression: the catch is what keeps an http-server outage from surfacing
    // as an unhandled rejection in the share page's server render.
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Share service unavailable' });
  });
});
