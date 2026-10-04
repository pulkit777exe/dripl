import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * `GET /api/auth/google` mints the OAuth `state`; `GET /api/auth/google/callback`
 * is the only place that `state` is checked. Together they are the CSRF boundary
 * for Google sign-in, and the only app route that handles a third-party
 * authorization code.
 *
 * The negative space matters more than the happy path here: nothing about a
 * refused callback should reach the browser URL, and no `next` value from the
 * request or from a cookie should be able to choose the post-login destination.
 */

const APP_ORIGIN = 'http://localhost:3000';
const API_ORIGIN = 'http://api.test:3002';
const GOOGLE_AUTH_HOST = 'accounts.google.com';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

const CLIENT_ID = 'client-id-abc.apps.googleusercontent.com';
const CLIENT_SECRET = 'GOCSPX-super-secret-value';

/**
 * `next/headers`' `cookies()` throws outside a request scope, so the two OAuth
 * routes need a stand-in store. It is a plain Map because both routes read and
 * write it (`set` on the way out, `delete` on the way back) and the assertions
 * below read the same object.
 */
interface RecordedCookie {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

const { cookieJar, cookieCalls } = vi.hoisted(() => {
  const jar = new Map<string, string>();
  const calls: { set: RecordedCookie[]; delete: string[] } = { set: [], delete: [] };
  return { cookieJar: jar, cookieCalls: calls };
});

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      cookieCalls.set.push({ name, value, options });
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieCalls.delete.push(name);
      cookieJar.delete(name);
    },
  }),
}));

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The `Set-Cookie` value for `name` on the redirect response, or undefined. */
function setCookie(response: Response, name: string): string | undefined {
  const all = response.headers.getSetCookie();
  return all.find(value => value.startsWith(`${name}=`));
}

function startRequest(search = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/auth/google${search}`);
}

function callbackRequest(search: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/auth/google/callback${search}`);
}

/** A callback request whose `oauth_state` cookie matches `state`. */
function goodCallbackRequest(state = 'the-expected-state'): NextRequest {
  cookieJar.set('oauth_state', state);
  return callbackRequest(`?code=auth-code-abc&state=${state}`);
}

describe('Google OAuth routes', () => {
  let startRoute: typeof import('@/app/api/auth/google/route');
  let callbackRoute: typeof import('@/app/api/auth/google/callback/route');

  beforeEach(async () => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.resetModules();
    cookieJar.clear();
    cookieCalls.set.length = 0;
    cookieCalls.delete.length = 0;
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_ORIGIN);
    vi.stubEnv('HTTP_SERVER_URL', API_ORIGIN);
    vi.stubEnv('GOOGLE_CLIENT_ID', CLIENT_ID);
    vi.stubEnv('GOOGLE_CLIENT_SECRET', CLIENT_SECRET);

    fetchMock.mockImplementation(async (url: string) => {
      if (String(url) === TOKEN_ENDPOINT) return jsonResponse({ id_token: 'google-id-token' });
      if (String(url) === `${API_ORIGIN}/api/auth/google`) {
        return jsonResponse({ sessionToken: 'dripl-session-token' });
      }
      return jsonResponse({ error: `unexpected upstream call: ${String(url)}` }, 500);
    });

    startRoute = await import('@/app/api/auth/google/route');
    callbackRoute = await import('@/app/api/auth/google/callback/route');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  /* ------------------------------------------------------------------ *
   * GET /api/auth/google — the state mint
   * ------------------------------------------------------------------ */

  it('redirects to Google with the configured client and binds state to an httpOnly cookie', async () => {
    const response = await startRoute.GET(startRequest());

    const location = new URL(response.headers.get('location') ?? '');
    // Regression: `getGoogleOAuthConfig` is read lazily per call. A capture at
    // import time (the bug this module documents) put the literal string
    // "undefined" in `client_id`, which Google answers with `invalid_client`.
    expect(location.host).toBe(GOOGLE_AUTH_HOST);
    expect(location.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(location.searchParams.get('redirect_uri')).toBe(
      `${APP_ORIGIN}/api/auth/google/callback`
    );
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('scope')).toBe('openid email profile');

    // Regression: the callback compares `state` against this cookie and nothing
    // else. If the two diverge the flow is either dead or, worse, unbound.
    const state = location.searchParams.get('state');
    expect(state).toMatch(/^[0-9a-f-]{36}$/i);
    expect(cookieJar.get('oauth_state')).toBe(state);
  });

  it('mints a fresh state on every request so a captured one cannot be replayed', async () => {
    await startRoute.GET(startRequest());
    const first = cookieJar.get('oauth_state');
    await startRoute.GET(startRequest());
    const second = cookieJar.get('oauth_state');

    // Regression: a constant state turns the callback's equality check into a
    // no-op, and a single intercepted callback URL would then authorize anyone.
    expect(second).not.toBe(first);
  });

  it('refuses to start a sign-in when Google OAuth is not configured', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', undefined);

    const response = await startRoute.GET(startRequest());

    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/login');
    expect(new URL(response.headers.get('location') ?? '').searchParams.get('error')).toBe(
      'oauth_not_configured'
    );
    // Regression: minting a state with no client id produces a Google error page
    // instead of a diagnosable in-app message, and leaves a stray oauth_state
    // cookie behind for the callback to trip over.
    expect(cookieCalls.set).toEqual([]);
  });

  it.each([
    ['a same-origin path', '/board/abc', '/board/abc'],
    ['an off-site absolute URL', 'https://attacker.example/steal', '/dashboard'],
    ['a protocol-relative URL', '//attacker.example/steal', '/dashboard'],
    ['no next at all', undefined, '/dashboard'],
  ])('turns %s into the oauth_next cookie', async (_label, next, expected) => {
    const search = next === undefined ? '' : `?next=${encodeURIComponent(next)}`;
    const response = await startRoute.GET(startRequest(search));

    expect(cookieJar.get('oauth_next')).toBe(expected);
    // Regression: `oauth_next` becomes the *post-login* destination once a
    // session cookie exists. Honouring an off-site or protocol-relative value
    // here is the classic open redirect, executed at the moment of highest trust.
    expect(response.status).toBe(307);
  });

  it('marks the oauth state cookies secure only for an https frontend url', async () => {
    await startRoute.GET(startRequest());
    const insecure = cookieCalls.set.slice();

    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://dripl.example');
    await startRoute.GET(startRequest());
    const secure = cookieCalls.set.slice(insecure.length);

    expect(insecure.map(entry => entry.name)).toEqual(['oauth_state', 'oauth_next']);
    expect(secure.map(entry => entry.name)).toEqual(['oauth_state', 'oauth_next']);
    // Regression: `secure` is derived from the frontend URL's scheme, and the
    // state cookie is what the callback trusts. Shipping it without `Secure` on
    // an https deployment exposes a live CSRF token to anything on the wire.
    for (const entry of insecure) expect(entry.options?.secure).toBe(false);
    for (const entry of secure) expect(entry.options?.secure).toBe(true);
  });

  /* ------------------------------------------------------------------ *
   * GET /api/auth/google/callback — the refusals
   * ------------------------------------------------------------------ */

  it('refuses a callback with no state and never contacts Google', async () => {
    const response = await callbackRoute.GET(callbackRequest('?code=auth-code-abc'));

    expect(new URL(response.headers.get('location') ?? '').searchParams.get('error')).toBe(
      'invalid_state'
    );
    // Regression: an absent `oauth_state` cookie is what a forced-login CSRF
    // looks like. Reaching the token endpoint here would let an attacker bind
    // their Google account to the victim's browser session.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a callback whose state does not match the cookie', async () => {
    cookieJar.set('oauth_state', 'the-real-state');

    const response = await callbackRoute.GET(callbackRequest('?code=auth-code-abc&state=guessed'));

    expect(new URL(response.headers.get('location') ?? '').searchParams.get('error')).toBe(
      'invalid_state'
    );
    // Regression: `state !== cookieState` is the whole binding. If it became a
    // presence check, any value would pass and the binding would be decorative.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a provider-side error as google_* even without a valid state', async () => {
    const response = await callbackRoute.GET(callbackRequest('?error=access_denied'));

    const location = new URL(response.headers.get('location') ?? '');
    // Regression: the provider-error branch runs before the state check on
    // purpose — a user who declined consent should see "denied", not a
    // CSRF error, or every genuine refusal looks like an attack.
    expect(location.searchParams.get('error')).toBe('google_access_denied');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a valid state with no authorization code and never contacts Google', async () => {
    cookieJar.set('oauth_state', 'the-expected-state');
    const response = await callbackRoute.GET(callbackRequest('?state=the-expected-state'));

    expect(new URL(response.headers.get('location') ?? '').searchParams.get('error')).toBe(
      'missing_code'
    );
    // Regression: `!code` must be checked before the exchange. Forwarding
    // `code=undefined` to Google turns a malformed callback into an opaque
    // `invalid_grant` 400 from a third party.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers oauth_not_configured before any network call when the secret is missing', async () => {
    vi.stubEnv('GOOGLE_CLIENT_SECRET', undefined);

    const response = await callbackRoute.GET(goodCallbackRequest());

    expect(new URL(response.headers.get('location') ?? '').searchParams.get('error')).toBe(
      'oauth_not_configured'
    );
    // Regression: the config check has to precede the token exchange, or the
    // route posts an empty `client_secret` to Google and reports the result as
    // `token_exchange_failed` — which sends the operator to the wrong cause.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears the single-use state cookies on every outcome', async () => {
    await callbackRoute.GET(callbackRequest('?code=abc'));
    expect(cookieCalls.delete).toEqual(expect.arrayContaining(['oauth_state', 'oauth_next']));
    expect(cookieJar.has('oauth_state')).toBe(false);

    cookieCalls.delete.length = 0;
    await callbackRoute.GET(goodCallbackRequest());
    // Regression: the state is single-use. If the delete ran only on the refusal
    // paths, a captured state cookie would stay in the jar and could be replayed
    // against a second, attacker-supplied authorization code.
    expect(cookieCalls.delete).toEqual(expect.arrayContaining(['oauth_state', 'oauth_next']));
    expect(cookieJar.has('oauth_state')).toBe(false);
  });

  /* ------------------------------------------------------------------ *
   * Callback — credential containment (negative space)
   * ------------------------------------------------------------------ */

  it('never puts the code, the client secret or the id token in the redirect on a failed exchange', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url) === TOKEN_ENDPOINT) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      }
      return jsonResponse({ sessionToken: 'dripl-session-token' });
    });

    const response = await callbackRoute.GET(goodCallbackRequest());

    const location = response.headers.get('location') ?? '';
    expect(new URL(location).searchParams.get('error')).toBe('token_exchange_failed');
    // Regression: a browser URL is durable — history, bookmarks, `Referer`, and
    // every extension on the page can read it. Any of these three values
    // appearing here is a credential disclosure to whoever opens the history.
    expect(location).not.toContain('auth-code-abc');
    expect(location).not.toContain(CLIENT_SECRET);
    expect(location).not.toContain('google-id-token');
  });

  it('fails the same way when Google returns a non-JSON error body', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url) === TOKEN_ENDPOINT) {
        return new Response('<html>502 from an egress proxy</html>', { status: 502 });
      }
      return jsonResponse({ sessionToken: 'dripl-session-token' });
    });

    const response = await callbackRoute.GET(goodCallbackRequest());

    // Regression: the `JSON.parse` of Google's error body is wrapped in its own
    // try/catch. Without it an HTML error page from a corporate proxy throws out
    // of the handler and the user gets a 500 instead of the login error page.
    expect(new URL(response.headers.get('location') ?? '').searchParams.get('error')).toBe(
      'token_exchange_failed'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('answers auth_failed and sets no session cookie when http-server refuses the id token', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url) === TOKEN_ENDPOINT) return jsonResponse({ id_token: 'google-id-token' });
      return jsonResponse({ error: 'invalid token' }, 401);
    });

    const response = await callbackRoute.GET(goodCallbackRequest());

    expect(new URL(response.headers.get('location') ?? '').searchParams.get('error')).toBe(
      'auth_failed'
    );
    // Regression: the session cookie must be minted only from a successful
    // verification. Setting it before the check would authenticate anybody who
    // can get any Google id token past the exchange.
    expect(setCookie(response, 'dripl-session')).toBeUndefined();
  });

  it('answers google_failed, without the code, when the token endpoint is unreachable', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('fetch failed');
    });

    const response = await callbackRoute.GET(goodCallbackRequest());

    const location = response.headers.get('location') ?? '';
    expect(new URL(location).searchParams.get('error')).toBe('google_failed');
    // Regression: same containment requirement as the `!ok` branch — an outage
    // must not echo the authorization code into a URL.
    expect(location).not.toContain('auth-code-abc');
  });

  /* ------------------------------------------------------------------ *
   * Callback — the success path
   * ------------------------------------------------------------------ */

  it('sets a same-origin next cookie as the post-login destination', async () => {
    cookieJar.set('oauth_next', '/board/abc');

    const response = await callbackRoute.GET(goodCallbackRequest());

    // Regression: the cookie, not a query parameter, carries the destination.
    // If the route stopped honouring it, every login would drop the user at
    // /dashboard and deep links would break.
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/board/abc');
    expect(setCookie(response, 'dripl-session')).toContain('dripl-session-token');
  });

  it.each([
    ['an off-site absolute URL', 'https://attacker.example/steal'],
    ['a protocol-relative URL', '//attacker.example/steal'],
    ['a bare host', 'attacker.example/steal'],
  ])('refuses %s in oauth_next and lands on /dashboard', async (_label, hostileNext) => {
    cookieJar.set('oauth_next', hostileNext);

    const response = await callbackRoute.GET(goodCallbackRequest());

    const location = new URL(response.headers.get('location') ?? '');
    // Regression: this redirect runs *after* the session cookie is minted, so it
    // is the strongest open redirect in the app. It must be pinned to the
    // request's own origin, not merely "a path-looking string".
    expect(location.origin).toBe(APP_ORIGIN);
    expect(location.pathname).toBe('/dashboard');
    expect(setCookie(response, 'dripl-session')).toContain('dripl-session-token');
  });

  it('sets a readable, same-site, 7-day session cookie', async () => {
    const response = await callbackRoute.GET(goodCallbackRequest());

    const cookie = setCookie(response, 'dripl-session') ?? '';
    // Regression: `httpOnly: false` is load-bearing — the client reads this token
    // and sends it as `Authorization` to http-server. `HttpOnly` here silently
    // signs every cross-origin request out, with no error anywhere.
    expect(cookie).not.toContain('HttpOnly');
    // Regression: `SameSite=Lax` on a cookie that is also sent cross-origin as a
    // header. `Strict` would break the http-server calls the app depends on.
    expect(cookie).toContain('SameSite=lax');
    expect(cookie).toContain('Max-Age=604800');
    expect(cookie).toContain('Path=/');
  });

  it('marks the session cookie Secure when the request arrived over https', async () => {
    cookieJar.set('oauth_state', 'the-expected-state');
    const httpsRequest = new NextRequest(
      'https://localhost:3000/api/auth/google/callback?code=auth-code-abc&state=the-expected-state'
    );

    const response = await callbackRoute.GET(httpsRequest);

    // Regression: an unflagged session cookie on an https deployment is readable
    // by anything that can observe plaintext on the wire.
    expect(setCookie(response, 'dripl-session')).toContain('Secure');
  });

  it('marks the session cookie Secure when only x-forwarded-proto says https', async () => {
    cookieJar.set('oauth_state', 'the-expected-state');
    const forwarded = new NextRequest(
      'http://localhost:3000/api/auth/google/callback?code=auth-code-abc&state=the-expected-state',
      { headers: { 'x-forwarded-proto': 'https, http' } }
    );

    const response = await callbackRoute.GET(forwarded);

    // Regression: behind a TLS-terminating proxy `request.nextUrl.protocol` is
    // http, so the forwarded header is the only signal. Dropping it ships a
    // non-Secure session cookie on every proxied deployment.
    expect(setCookie(response, 'dripl-session')).toContain('Secure');
  });

  it('sends the Google id token, not the authorization code, to http-server', async () => {
    await callbackRoute.GET(goodCallbackRequest());

    const authCall = fetchMock.mock.calls.find(
      call => String(call[0]) === `${API_ORIGIN}/api/auth/google`
    );
    expect(authCall).toBeDefined();
    expect(JSON.parse(String(authCall?.[1]?.body))).toEqual({ token: 'google-id-token' });
    // Regression: the verification call must carry the exchanged id token. An
    // implementation detail change that leaked the raw authorization code here
    // would send a single-use, one-minute credential to the wrong verifier.
  });
});
