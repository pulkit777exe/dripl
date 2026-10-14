/**
 * CSRF COVERAGE OF EVERY STATE-CHANGING ROUTE, AS A COMPLETENESS ARGUMENT.
 *
 * `app.ts` guards `/api/auth/*` with an explicit list of paths rather than with one
 * `app.use('/api/auth', validateCsrfToken)`. An explicit list is defensible — login
 * and register need no session, so guarding the whole prefix would be noise — but it
 * has a failure mode an allowlist always has: a route added to `authRouter` and not
 * added here is unguarded, and nothing says so. The list is read top to bottom against
 * `routes/auth.ts` by a human, once.
 *
 * This file replaces that review with a test. It enumerates every state-changing
 * method `authRouter` exposes and requires the composed app to refuse each one when
 * the request carries the CSRF cookie but not the header — which is exactly what a
 * cross-site POST looks like, since an attacker can make a victim's browser send a
 * cookie and can never set a header.
 *
 * A route added to the router without a CSRF mount fails here by name.
 *
 * WHAT THIS FILE FOUND
 *
 * `POST /api/auth/google` is **not** in the CSRF list in `app.ts`, and answers
 * without a 403 to a cookie-only cross-site POST. See the named case below; it is
 * characterised as a defect-with-a-reason, not asserted as intended: its only
 * legitimate caller is the server-side Next callback
 * (`apps/dripl-app/app/api/auth/google/callback/route.ts`), which holds no CSRF
 * cookie or header, so the double-submit guard cannot apply there.
 *
 * `POST /api/auth/verify-email` and `PUT /api/auth/profile` were in the same
 * state and are now guarded: both are called only through `ApiClient`
 * (`apps/dripl-app/lib/api.ts`), which attaches `x-csrf-token` on every unsafe
 * method, so the guard breaks no legitimate caller. Their named cases below
 * assert the 403.
 */

import { afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('@upstash/redis', () => ({ Redis: class FakeRedis {} }));
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class FakeRatelimit {
    static slidingWindow() {
      return {};
    }
    async limit() {
      return { success: true, remaining: 999, reset: Date.now() + 60_000 };
    }
  },
}));

vi.mock('@dripl/db', async () => {
  const { fakeDbModule } = await import('./test-utils/fakeDbModule');
  return fakeDbModule();
});

vi.mock('../lib/mailer', () => ({
  sendVerificationEmail: vi.fn(async () => {}),
  sendResetPasswordEmail: vi.fn(async () => {}),
}));

import { createApp } from '../app';
import { authRouter } from '../routes/auth';
import { CSRF_TOKEN } from './test-utils/authenticatedRequest';

const app = createApp();

/**
 * Every state-changing method `authRouter` exposes, with a body its handler will
 * accept far enough to be interesting.
 *
 * The bodies are not the subject — the CSRF gate runs before the handler, so almost
 * any body would do. They are chosen to be plausible so that if the gate ever *stops*
 * working, the route answers something other than 403 rather than accidentally
 * producing the same status for its own reasons.
 */
const STATE_CHANGING: ReadonlyArray<readonly [method: string, path: string, body: unknown]> = [
  ['post', '/api/auth/register', { email: 'a@example.com', password: 'password123' }],
  ['post', '/api/auth/login', { email: 'a@example.com', password: 'x' }],
  ['post', '/api/auth/logout', {}],
  ['post', '/api/auth/google', { token: 'an-id-token' }],
  ['post', '/api/auth/forgot-password', { email: 'a@example.com' }],
  ['post', '/api/auth/reset-password', { token: 't', password: 'password123' }],
  ['post', '/api/auth/verify-email', { token: 't' }],
  ['post', '/api/auth/resend-verification', { email: 'a@example.com' }],
  ['post', '/api/auth/change-password', { currentPassword: 'x', newPassword: 'password123' }],
  ['post', '/api/auth/ws-ticket', {}],
  ['put', '/api/auth/profile', { name: 'Renamed' }],
  // `POST /api/auth/google` is NOT in `app.ts`'s CSRF list. It is handled by a named
  // case further down rather than here, because it needs its own severity argument
  // and a loop assertion cannot carry one.
];

/**
 * Cross-site requests: the CSRF cookie travels, the header cannot.
 *
 * Both halves matter. Sending the header too would test the wrong thing — a browser
 * will not add it — and omitting the cookie would let a route pass for the wrong
 * reason, since `validateCsrfToken` refuses when *either* is missing.
 */
function crossSite(method: string, path: string, body: unknown): request.Test {
  const pending = request(app)[method as 'post' | 'put'](path);
  return pending.set('Cookie', [`csrf-token=${CSRF_TOKEN}`]).send(body as object);
}

describe('every state-changing auth route refuses a cross-site POST', () => {
  for (const [method, path, body] of STATE_CHANGING) {
    // The named gap, with its own case and its own explanation, so it is
    // not lost inside a loop. It is characterised as a defect-with-a-reason:
    // the assertion records what the server does, because the contract cannot
    // be changed here and a green suite must not depend on a fix landing.
    if (path === '/api/auth/google') continue;
    it(`refuses ${method.toUpperCase()} ${path} without the CSRF header`, async () => {
      const response = await crossSite(method, path, body);

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ error: 'CSRF_TOKEN_MISSING' });
    });
  }

  /**
   * The control: with the header the request is past the gate.
   *
   * Without it, "everything is 403" would pass for a server where the CSRF middleware
   * rejected all requests regardless.
   */
  it('accepts the same request shape once the header is present', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Cookie', [`csrf-token=${CSRF_TOKEN}`])
      .set('x-csrf-token', CSRF_TOKEN)
      .send({ email: 'nobody@example.test', password: 'x' });

    // Past the gate: 401 from the route, not 403 from the middleware.
    expect(response.status).not.toBe(403);
  });

  /**
   * A GET is not subject to the check at all, whatever it carries.
   *
   * The gate is method-scoped because the attack is: a cross-site GET is a navigation
   * or an image, and neither can set a body. Asserted so the method list above cannot
   * be satisfied by a check that refuses reads too — which would break the whole API.
   */
  it('does not require CSRF on a safe method', async () => {
    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(401);
  });
});

describe('DEFECT: POST /api/auth/google is not CSRF-guarded', () => {
  /**
   * Recorded as it behaves, verified against `createApp()` rather than a hand-built
   * mount — the gap is in the composition root's path list, so only the composed app
   * can show it.
   *
   * `app.ts`'s CSRF list covers eight paths under `/api/auth` and `/google` is not
   * one of them. `validateCsrfToken` is never applied to it on any other path either, so a
   * cross-site POST carrying the victim's `csrf-token` cookie reaches the handler and
   * is answered 200.
   *
   * The impact is login CSRF: an attacker with their own Google account obtains an ID
   * token for this client id on their own origin and posts it from a page the victim
   * visits. The server verifies it — it is a genuine token — and sets
   * `dripl-session` on the *victim's* browser, silently signing the victim into the
   * attacker's account. Canvases the victim then creates belong to the attacker, who
   * can read them through the ordinary file API. The victim sees a working session and
   * no error at any point.
   *
   * The obvious fix — `app.use('/api/auth/google', validateCsrfToken)` — is **wrong**,
   * and this comment used to call it only "one line". `validateCsrfToken` requires a
   * `csrf-token` cookie *and* a matching `X-CSRF-Token` header, and the only
   * legitimate caller is `apps/dripl-app/app/api/auth/google/callback/route.ts`: a
   * server-side Next route handler that exchanges a Google code and POSTs here over
   * the network, with no cookie jar and no such header. That guard would 403 every
   * real Google sign-in — and a test driving this route directly would keep passing
   * while the feature was broken in production.
   *
   * What actually closes it must be satisfiable by a server-to-server caller: an
   * `Origin`/`Sec-Fetch-Site` check admitting same-origin and header-less requests
   * while refusing `cross-site`, or an internal shared secret as `ws-server` uses for
   * ticket redemption. Either changes this route's threat model, so it is a
   * maintainer decision and is not applied here. See the matching case in
   * `routes/authGoogle.test.ts`.
   */
  it('answers 200 to a cross-site POST, which is the defect', async () => {
    const response = await crossSite('post', '/api/auth/google', { token: 'an-id-token' });

    // Not 403. The CSRF gate never ran.
    expect(response.status).not.toBe(403);
  });
});

describe('PUT /api/auth/profile is CSRF-guarded', () => {
  /**
   * The 403 comes from `validateCsrfToken`, before `authMiddleware` runs.
   *
   * `PUT /api/auth/profile` is called only through `ApiClient.updateProfile`,
   * which goes through `sendRequest` and attaches `x-csrf-token` on every
   * unsafe method — so the guard breaks no legitimate caller, unlike the
   * Google route below whose caller is server-side.
   */
  it('refuses a cross-site PUT without the CSRF header', async () => {
    const response = await crossSite('put', '/api/auth/profile', { name: 'Renamed' });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: 'CSRF_TOKEN_MISSING' });
  });

  /**
   * The control: the very same request with a valid session *and* the header
   * succeeds, proving the guard admits the legitimate caller rather than
   * refusing all PUTs regardless.
   */
  it('accepts the same PUT once the header is present', async () => {
    const { signToken } = await import('@dripl/utils/auth');
    const { fakeDb } = await import('./test-utils/fakePrisma');
    fakeDb().seed('user', {
      id: 'user-guarded',
      email: 'guarded@example.test',
      name: 'Original',
      image: null,
      emailVerified: true,
      tokenVersion: 0,
    });

    const response = await request(app)
      .put('/api/auth/profile')
      .set('Cookie', [`csrf-token=${CSRF_TOKEN}`, `dripl-session=${signToken('user-guarded', 0)}`])
      .set('x-csrf-token', CSRF_TOKEN)
      .send({ name: 'Renamed with a header' });

    expect(response.status).toBe(200);
    expect(response.body.user.name).toBe('Renamed with a header');
  });
});

describe('POST /api/auth/verify-email is CSRF-guarded', () => {
  /**
   * The 403 comes from `validateCsrfToken`, before the handler runs.
   *
   * `POST /api/auth/verify-email` is called only through
   * `ApiClient.verifyEmail`, which attaches `x-csrf-token` on every unsafe
   * method — so the guard breaks no legitimate caller. The severity of the
   * former gap was lower than the Google case (the body is a verification
   * token delivered to an inbox), but the route is no longer reachable
   * cross-site at all.
   */
  it('refuses a cross-site POST without the CSRF header', async () => {
    const response = await crossSite('post', '/api/auth/verify-email', { token: 'guessed' });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: 'CSRF_TOKEN_MISSING' });
  });

  /**
   * The control: with the header the request reaches the handler, which answers
   * its own validation error — proving the gate admits the legitimate caller
   * rather than refusing all POSTs regardless.
   */
  it('reaches the handler once the header is present', async () => {
    const response = await request(app)
      .post('/api/auth/verify-email')
      .set('Cookie', [`csrf-token=${CSRF_TOKEN}`])
      .set('x-csrf-token', CSRF_TOKEN)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VERIFICATION_TOKEN_REQUIRED');
  });
});

describe('the other routers are guarded at the mount, not by a list', () => {
  /**
   * `/api/files`, `/api/folders`, `/api/rooms`, `/api/share` and `/api/images` are
   * each mounted as `app.use(path, validateCsrfToken, …)`, so a route added to any of
   * those routers inherits the guard without anyone listing it.
   *
   * Asserted so the contrast with the `/api/auth` list stays true: if one of these
   * mounts ever lost its `validateCsrfToken`, this fails — and it fails for the right
   * reason, because the guard was structural rather than enumerated.
   */
  for (const path of ['/api/files', '/api/folders', '/api/rooms', '/api/share', '/api/images']) {
    it(`refuses a cross-site POST to ${path}`, async () => {
      const response = await request(app)
        .post(path)
        .set('Cookie', [`csrf-token=${CSRF_TOKEN}`])
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('CSRF_TOKEN_MISSING');
    });
  }

  /**
   * A GET to the same routers is unaffected, for the reason given above: the guard is
   * method-scoped and reads must keep working for every client.
   */
  it('leaves reads on those routers alone', async () => {
    const response = await request(app).get('/api/files');

    expect(response.status).toBe(401);
  });
});

/**
 * The routes this file knows are NOT CSRF-guarded, each with a named case above.
 *
 * Currently exactly one: `POST /api/auth/google`, whose only legitimate caller
 * is server-side and cannot present a double-submit token. Declared here so the
 * completeness argument below can be exhaustive: it compares the router's own
 * route table against `STATE_CHANGING` plus this list, and requires the two to
 * account for every state-changing method `authRouter` exposes. A route added
 * to `routes/auth.ts` and to neither list fails by name, which is the entire
 * point — it is the failure mode an explicit path list in `app.ts` cannot
 * report on its own.
 */
const KNOWN_UNGUARDED = ['/api/auth/google'] as const;

describe('the enumeration above accounts for every state-changing route', () => {
  it('matches the router’s own route table exactly', () => {
    const onRouter: string[] = [];

    // Walk the router's stack rather than re-reading its source, so this check cannot
    // drift from the code it is describing.
    for (const layer of authRouter.stack) {
      const route = layer.route;
      if (!route) continue;
      const methods = (route as unknown as { methods?: Record<string, boolean> }).methods ?? {};
      for (const method of Object.keys(methods)) {
        if (method === 'get' || method === 'head' || method === 'options') continue;
        // `route.path` is relative to the router's own mount and already carries a
        // leading slash: `post` + `/login` is `/api/auth/login`.
        onRouter.push(`/api/auth${route.path}`);
      }
    }

    // Deduped: `STATE_CHANGING` already enumerates every state-changing route the
    // router exposes, including the unguarded one — which is why the loop above
    // skips `/google` rather than omitting it. Unioning `KNOWN_UNGUARDED` in as
    // well counted that path twice and made this check report a phantom
    // duplicate route.
    const accounted = [
      ...new Set([...STATE_CHANGING.map(([, path]) => path), ...KNOWN_UNGUARDED]),
    ].sort();
    expect(accounted).toEqual([...onRouter].sort());
  });

  /**
   * Every declared gap really is a gap.
   *
   * Without this, `KNOWN_UNGUARDED` could name a path that somebody has since guarded,
   * and the file would go on describing a fixed defect. The named cases above assert
   * each one's behaviour directly; this asserts the *list* has not gone stale.
   */
  it('still describes exactly the routes the composition root leaves unguarded', async () => {
    for (const path of KNOWN_UNGUARDED) {
      const method = path.endsWith('/profile') ? 'put' : 'post';
      const response = await crossSite(method, path, {});
      // Never the 403 `validateCsrfToken` would answer.
      expect(response.status, `${method.toUpperCase()} ${path}`).not.toBe(403);
    }
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});
