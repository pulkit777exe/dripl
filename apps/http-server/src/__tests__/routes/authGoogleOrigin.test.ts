/**
 * THE SAME-ORIGIN CHECK ON `POST /api/auth/google`.
 *
 * The route cannot take the double-submit CSRF guard — its only legitimate
 * caller is the server-side Next callback, which holds no CSRF cookie or
 * header — so it enforces the next best thing: a request carrying an `Origin`
 * header must carry *this deployment's* origin, or it answers 403 and never
 * reaches Google. A request with no `Origin` at all is admitted, because the
 * callback sends none and only a non-browser caller can omit it.
 *
 * WHAT IS WORTH PINNING
 *
 *   1. **A foreign origin is refused before Google is contacted.**
 *      `verifyIdToken` is a network call; the 403 must not depend on it.
 *   2. **Absence is admitted.** The Next callback `fetch`es with
 *      `Content-Type` only. Rejecting header-less calls would 403 every real
 *      Google sign-in while every test driving this route directly kept
 *      passing — the mirror image of the trap the CSRF exemption documents.
 *   3. **Presence is enforced, not just parsed.** Garbage and the literal
 *      `null` a sandboxed iframe sends are refused: no legitimate caller
 *      sends either, so admitting them would reopen the exact login-CSRF
 *      shape (victim signed into the attacker's account) through the
 *      "absent" arm.
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

const { verifyIdToken } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(async () => ({ getPayload: () => ({ email: 'ada@example.test' }) })),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class FakeOAuth2Client {
    verifyIdToken = verifyIdToken;
  },
}));

import request from 'supertest';
import { authRouter } from '../../routes/auth';
import { buildApp, CSRF_TOKEN } from '../test-utils/authenticatedRequest';
import { resetFakeDb } from '../test-utils/fakePrisma';

/** `app.ts` mounts `/api/auth` with CSRF and no global auth guard. */
const app = buildApp([{ path: '/api/auth', router: authRouter, auth: false }]);

const FRONTEND = 'https://app.example.test';

function postGoogle(body: Record<string, unknown>, origin?: string): request.Test {
  const pending = request(app)
    .post('/api/auth/google')
    .set('Cookie', [`csrf-token=${CSRF_TOKEN}`])
    .set('x-csrf-token', CSRF_TOKEN);
  if (origin !== undefined) pending.set('Origin', origin);
  return pending.send(body);
}

beforeEach(() => {
  resetFakeDb();
  verifyIdToken.mockReset();
  verifyIdToken.mockResolvedValue({
    getPayload: () => ({ email: 'ada@example.test' }),
  } as never);
  vi.stubEnv('GOOGLE_CLIENT_ID', 'dripl-client-id.apps.googleusercontent.com');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'dripl-client-secret');
  // `vitest.config.ts` defaults FRONTEND_URL to localhost; pin the allowlist
  // per case so the assertions below are about the header, not the runner.
  vi.stubEnv('FRONTEND_URL', FRONTEND);
  vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/auth/google — same-origin check', () => {
  it('refuses a foreign Origin with 403 before Google is contacted', async () => {
    const response = await postGoogle({ token: 'a-google-id-token' }, 'https://evil.example');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: 'FORBIDDEN_ORIGIN',
      message: 'Request origin is not allowed',
      statusCode: 403,
    });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('admits the configured frontend origin', async () => {
    const response = await postGoogle({ token: 'a-google-id-token' }, FRONTEND);

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ email: 'ada@example.test' });
    expect(verifyIdToken).toHaveBeenCalled();
  });

  it('admits a missing Origin, which is how the server-side callback calls', async () => {
    // The Next callback posts with Content-Type only — no Origin, no CSRF
    // pair — so this is the production sign-in path, not a gap.
    const response = await postGoogle({ token: 'a-google-id-token' });

    expect(response.status).toBe(200);
    expect(verifyIdToken).toHaveBeenCalled();
  });

  it('refuses a present-but-unparseable Origin', async () => {
    const response = await postGoogle({ token: 'a-google-id-token' }, 'not-an-origin');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('FORBIDDEN_ORIGIN');
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('refuses the opaque `null` origin a sandboxed iframe sends', async () => {
    const response = await postGoogle({ token: 'a-google-id-token' }, 'null');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('FORBIDDEN_ORIGIN');
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('matches origins, not prefixes: a superstring of the allowlist is foreign', async () => {
    const response = await postGoogle(
      { token: 'a-google-id-token' },
      'https://app.example.test.evil.example'
    );

    expect(response.status).toBe(403);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });
});
