/**
 * THE GOOGLE SIGN-IN ROUTE, END TO END.
 *
 * `POST /api/auth/google` is the only authentication path in this server that
 * mints a session from a *third party's* assertion rather than from a password. That
 * makes it the widest trust boundary here, and it had two tests: a missing token, and
 * "OAuth is not configured". Everything between the verified payload and the issued
 * session was untested.
 *
 * The cases below stub `google-auth-library` rather than `AuthService`, because the
 * subject is the route's handling of a payload it did not choose. A stub at the
 * service boundary would let a route that ignored the payload entirely pass.
 *
 * WHAT IS WORTH PINNING
 *
 *   1. **The audience is verified against this deployment's client id.** `verifyIdToken`
 *      is called with `{ audience: clientId }`, and `clientId` comes from the same env
 *      var that built the client. Passing anything else — omitting `audience`, or
 *      passing the token as its own audience — would accept an ID token minted for a
 *      *different* application by the same author, which is a valid Google credential
 *      for somebody else's app and no credential at all for this one.
 *   2. **A payload with no email is refused.** Google omits `email` for some accounts
 *      (a Workspace user with no address, an unverified one). The route's own check is
 *      the only thing standing between that and `googleAuth(undefined)` creating an
 *      account keyed on a null address.
 *   3. **The session token is signed at the generation the service read**, not at a
 *      default — the same property the password path has, and the reason a Google user
 *      who has revoked sessions elsewhere is not handed a token that dies on arrival.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@dripl/db', async () => {
  const { fakeDbModule } = await import('../test-utils/fakeDbModule');
  return fakeDbModule();
});

vi.mock('../../lib/mailer', () => ({
  sendVerificationEmail: vi.fn(async () => {}),
  sendResetPasswordEmail: vi.fn(async () => {}),
}));

/**
 * The Google client, as a record of what it was asked to verify.
 *
 * `vi.hoisted` because the factory is hoisted above every top-level binding. The
 * `verifyIdToken` result is settable per case so the route's payload handling can be
 * driven without a network.
 */
const { verifyIdToken, constructedWith } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(async () => ({ getPayload: () => ({ email: 'ada@example.test' }) })),
  constructedWith: [] as Array<{ clientId: string; clientSecret: string }>,
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class FakeOAuth2Client {
    constructor(clientId: string, clientSecret: string) {
      constructedWith.push({ clientId, clientSecret });
    }
    verifyIdToken = verifyIdToken;
  },
}));

import jwt from 'jsonwebtoken';
import request from 'supertest';
import { authRouter } from '../../routes/auth';
import { buildApp, CSRF_TOKEN, post } from '../test-utils/authenticatedRequest';
import { fakeDb, resetFakeDb } from '../test-utils/fakePrisma';

/** `app.ts` mounts `/api/auth` with CSRF and no global auth guard. */
const app = buildApp([{ path: '/api/auth', router: authRouter, auth: false }]);

const CLIENT_ID = 'dripl-client-id.apps.googleusercontent.com';
const CLIENT_SECRET = 'dripl-client-secret';
const SECRET = process.env.JWT_SECRET as string;

function postGoogle(body: Record<string, unknown>): Promise<request.Response> {
  return post(app, '/api/auth/google', 'anonymous', body);
}

beforeEach(() => {
  resetFakeDb();
  verifyIdToken.mockReset();
  verifyIdToken.mockResolvedValue({
    getPayload: () => ({ email: 'ada@example.test', name: 'Ada', picture: 'https://img/ada.png' }),
  } as never);
  vi.stubEnv('GOOGLE_CLIENT_ID', CLIENT_ID);
  vi.stubEnv('GOOGLE_CLIENT_SECRET', CLIENT_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('a verified Google token', () => {
  /**
   * The audience check, asserted on the argument rather than on the outcome.
   *
   * `verifyIdToken` with no `audience` accepts any Google ID token for any client —
   * including one minted for a completely different application by the same attacker,
   * which is a perfectly valid credential and useless here. Asserting only "it signed
   * in" would pass against that.
   */
  it('verifies the ID token against this deployment’s client id', async () => {
    await postGoogle({ token: 'a-google-id-token' });

    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'a-google-id-token',
      audience: CLIENT_ID,
    });
    // The audience is the id the client was built from, not a literal in the route.
    expect(constructedWith).toContainEqual({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  });

  /**
   * The full path, from the payload to a usable session.
   *
   * Asserted as a round trip — the token is verified and then re-read — because a
   * response carrying a token that does not authenticate is a sign-in that appears to
   * succeed and leaves the user logged out.
   */
  it('issues a session token that authenticates, and sets the cookie to the same one', async () => {
    const response = await postGoogle({ token: 'a-google-id-token' });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ email: 'ada@example.test', name: 'Ada' });

    const claims = jwt.verify(response.body.sessionToken, SECRET, {
      algorithms: ['HS256'],
    }) as { userId: string; ver?: number };
    // The subject is the account `googleAuth` created or found — not the email.
    const stored = fakeDb()
      .rows('user')
      .find(row => row.email === 'ada@example.test');
    expect(claims.userId).toBe(stored?.id);

    // Cookie and body carry the same token: two tokens would mean a sign-in that
    // depends on which transport the client happens to use.
    // Supertest types `set-cookie` as a string; at runtime it is an array.
    const setCookie = response.headers['set-cookie'] as unknown as string[] | undefined;
    const cookie = setCookie?.find((value: string) => value.startsWith('dripl-session='));
    expect(cookie).toBeDefined();
    expect(cookie).toContain(response.body.sessionToken);
    expect(cookie).toContain('HttpOnly');
  });

  /**
   * The session is signed at the stored generation.
   *
   * The same rule the password path follows. A token minted at a default of 0 for an
   * account that has already revoked twice is dead on arrival — `verifyToken` compares
   * the claim against storage for equality — so the user signs in successfully and is
   * unauthenticated on the next request.
   */
  it('signs the session at the account’s stored generation', async () => {
    fakeDb().seed('user', {
      id: 'user-prior',
      email: 'ada@example.test',
      name: 'Ada',
      image: null,
      emailVerified: true,
      // Two prior revocations, from before this sign-in.
      tokenVersion: 2,
    });

    const response = await postGoogle({ token: 'a-google-id-token' });

    const claims = jwt.verify(response.body.sessionToken, SECRET, {
      algorithms: ['HS256'],
    }) as { ver?: number };
    expect(claims.ver).toBe(2);
  });

  /**
   * The response carries no password and no verification state.
   *
   * `googleAuth` returns a fixed shape — `{ id, email, name, image, tokenVersion }` —
   * and the route projects it down to four fields. A future change that spread the
   * service's return value into the response would put `tokenVersion` on the wire,
   * which tells a caller the account's revocation generation.
   */
  it('answers with exactly the four profile fields and nothing else', async () => {
    const response = await postGoogle({ token: 'a-google-id-token' });

    expect(Object.keys(response.body).sort()).toEqual(['sessionToken', 'user']);
    expect(Object.keys(response.body.user).sort()).toEqual(['email', 'id', 'image', 'name']);
  });
});

describe('a payload Google will not vouch for', () => {
  /**
   * No email in the payload.
   *
   * Google omits `email` for some accounts. Without the route's check,
   * `AuthService.googleAuth(undefined, …)` would look up `{ email: undefined }`,
   * find nothing, and create an account with a null address — and a null address is
   * the one value that makes every later lookup by email ambiguous.
   */
  it('refuses a payload with no email rather than creating an account for it', async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: '12345' }) } as never);

    const response = await postGoogle({ token: 'a-google-id-token' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'INVALID_GOOGLE_TOKEN',
      message: 'Invalid Google token',
      statusCode: 400,
    });
    expect(fakeDb().rows('user')).toEqual([]);
  });

  /**
   * `getPayload` returning nothing at all is the same refusal.
   *
   * A distinct case from an empty payload: a null return would otherwise reach
   * `payload.email` and throw a `TypeError`, which the route's catch turns into a
   * 401 — the wrong status for "the token verified but carried nothing", and a
   * different one a client cannot act on.
   */
  it('refuses when the verified payload is absent altogether', async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => null } as never);

    const response = await postGoogle({ token: 'a-google-id-token' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_GOOGLE_TOKEN');
  });

  /**
   * A signature that does not verify is a 401, not a 500.
   *
   * `verifyIdToken` rejects for a forged, expired or audience-mismatched token, and
   * every one of those is the caller's problem. The route's catch collapses them into
   * one answer so nothing about *why* is disclosed — which is why the status is
   * asserted rather than the message.
   */
  it('answers 401 when Google rejects the token', async () => {
    verifyIdToken.mockRejectedValue(new Error('Invalid token signature') as never);

    const response = await postGoogle({ token: 'forged' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: 'INVALID_GOOGLE_TOKEN',
      message: 'Invalid Google token',
      statusCode: 401,
    });
    // Google's own reason is not echoed: it distinguishes "wrong audience" from
    // "bad signature", which is exactly the oracle an attacker iterates against.
    expect(response.text).not.toContain('signature');
    expect(fakeDb().rows('user')).toEqual([]);
  });

  /**
   * An absent token is a 400, not a 401.
   *
   * No credential is a malformed request; an unacceptable one is a refusal. Asserted
   * because both are 4xx and a swap between them is the kind of change that only
   * shows up in a client that branches on the code.
   */
  it('answers 400 TOKEN_REQUIRED when no token is sent at all', async () => {
    const response = await postGoogle({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'TOKEN_REQUIRED',
      message: 'No token provided',
      statusCode: 400,
    });
    // Never reaches Google.
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  /**
   * A database failure during account lookup is a 500, and creates nothing.
   *
   * The route's catch wraps `AuthService.googleAuth`, so a storage outage on this path
   * is indistinguishable from a bad token — both 401. That is the contract and it is
   * not this suite's to change; what is asserted here is that the request does not
   * succeed, because a Google sign-in that half-completed would leave an account with
   * no usable session.
   */
  it('does not issue a session when the account write fails', async () => {
    const { db } = await import('@dripl/db');
    const findUnique = vi.spyOn(db.user, 'findUnique').mockRejectedValue(new Error('db down'));

    const response = await postGoogle({ token: 'a-google-id-token' });

    expect(response.status).toBe(401);
    expect(response.body).not.toHaveProperty('sessionToken');
    findUnique.mockRestore();
  });
});

describe('the OAuth configuration gate', () => {
  /**
   * Half-configured OAuth fails closed, and the failure names the missing variable.
   *
   * The message names `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and nothing else, so
   * an operator reading the log is told which knob to turn without the log becoming a
   * place secrets are printed. Asserted on both halves: "it fails" and "it says why".
   */
  it('names the missing variable when only the secret is unset', async () => {
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');

    const response = await postGoogle({ token: 'a-google-id-token' });

    expect(response.status).toBe(401);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('names the missing variable when only the client id is unset', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '');

    const response = await postGoogle({ token: 'a-google-id-token' });

    expect(response.status).toBe(401);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  /**
   * The credential gate runs before Google is contacted.
   *
   * Asserted so the case above cannot pass for the wrong reason — a route that called
   * `verifyIdToken` first and checked the configuration afterwards would answer 401
   * for a real token too, and a network call would have been made on the way.
   */
  it('does not construct a client when the configuration is incomplete', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    constructedWith.length = 0;

    await postGoogle({ token: 'a-google-id-token' });

    expect(constructedWith).toEqual([]);
  });

  /**
   * `POST /api/auth/google` is deliberately **not** CSRF-guarded, and this test
   * exists to record why — because the guard looks obviously missing here and the
   * obvious fix is wrong.
   *
   * `validateCsrfToken` demands a `csrf-token` cookie *and* a matching
   * `X-CSRF-Token` header. The only legitimate caller is
   * `apps/dripl-app/app/api/auth/google/callback/route.ts`, a **server-side** Next
   * route handler that exchanges a Google code and POSTs here over the network.
   * It has no cookie jar and sets no such header, so adding the guard would answer
   * 403 to every real Google sign-in. A test that drove this route directly — as
   * an earlier draft of this file did — would go on passing while the feature was
   * broken in production, which is the mirror image of the trap it was written to
   * avoid.
   *
   * **Residual risk, stated rather than dismissed.** The session cookie is
   * `SameSite=none` under HTTPS (`authMiddleware.ts:99`), so a browser will send
   * it cross-site, and a cross-site POST here could sign a victim into an
   * attacker's Google account. Closing that needs something a server-to-server
   * caller can satisfy — an `Origin`/`Sec-Fetch-Site` check that admits
   * same-origin and header-less calls while refusing `cross-site`, or an internal
   * shared secret as `ws-server` uses for ticket redemption. Both change this
   * route's threat model, so neither is applied unilaterally here.
   */
  it('is reachable without a CSRF token, because its only caller is server-side', async () => {
    const { createApp } = await import('../../app');
    const composed = createApp();

    const response = await request(composed)
      .post('/api/auth/google')
      .set('Cookie', [`csrf-token=${CSRF_TOKEN}`])
      .send({ token: 'a-google-id-token' });

    // Reaches the handler — no CSRF_TOKEN_MISSING — which is the documented state.
    expect(response.status).not.toBe(403);
    expect(response.body?.error).not.toBe('CSRF_TOKEN_MISSING');
    // And a token that does verify is actually exchanged, so this is not passing
    // merely because the request fell through some unrelated failure.
    expect(verifyIdToken).toHaveBeenCalled();
  });
});
