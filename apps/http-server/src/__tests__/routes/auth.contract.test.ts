/**
 * The HTTP contract of the auth routes: the login/register/reset/verify state
 * machine, and the guarded routes behind `authMiddleware`.
 *
 * `authResendVerification.test.ts` and `internal-auth.test.ts` already own the
 * CSRF composition and the internal secret. This file covers what they do not:
 * every other branch of every other handler.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@dripl/db', async () => {
  const { fakeDb } = await import('../test-utils/fakePrisma');
  return { db: fakeDb().db, initializeDb: vi.fn(async () => {}) };
});

vi.mock('../../lib/mailer', () => ({
  sendVerificationEmail: vi.fn(async () => {}),
  sendResetPasswordEmail: vi.fn(async () => {}),
}));

import jwt from 'jsonwebtoken';
import { db } from '@dripl/db';
import { authRouter, wsTicketStore } from '../../routes/auth';
import {
  buildApp,
  get,
  malformedCredentials,
  OWNER_ID,
  post,
  put,
  raw,
} from '../test-utils/authenticatedRequest';
import { fakeDb, resetFakeDb } from '../test-utils/fakePrisma';

const app = buildApp([{ path: '/api/auth', router: authRouter }]);
const unguardedApp = buildApp([{ path: '/api/auth', router: authRouter }], {
  csrf: false,
  auth: false,
});

const SECRET = process.env.JWT_SECRET as string;
const PASSWORD = 'correct-horse';

/** A real bcrypt hash of PASSWORD at cost 4 — low, so the suite stays fast. */
const PASSWORD_HASH = '$2b$04$jRnHNEwukQCuXZTtSW20GeSjtn6tdWrElVvPBYi8MqWY2RHiKsuT.';

/**
 * `AuthService` keeps its lockout counters in a module-level map keyed by
 * email, and that map survives `resetFakeDb`. So every login case uses its own
 * address: sharing one would let a lockout test silently turn the next test
 * into a 429, which is exactly the failure mode this comment exists to stop.
 */
let emailCounter = 0;
function nextEmail(): string {
  emailCounter += 1;
  return `login-case-${emailCounter}@example.com`;
}

function seedUser(overrides: Record<string, unknown> = {}): void {
  fakeDb().seed('user', {
    id: OWNER_ID,
    email: 'owner@example.com',
    name: 'Owner',
    image: null,
    emailVerified: true,
    password: PASSWORD_HASH,
    ...overrides,
  });
}

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    resetFakeDb();
  });

  it('creates an unverified account and answers 201', async () => {
    const response = await post(app, '/api/auth/register', 'anonymous', {
      email: 'new@example.com',
      password: 'longenough1',
      name: 'New',
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      message: 'Registration successful. Please verify your email to login.',
      pendingVerification: true,
    });
    const created = fakeDb()
      .rows('user')
      .find(user => user.email === 'new@example.com');
    expect(created?.emailVerified).toBe(false);
    expect(fakeDb().rows('emailVerificationToken')).toHaveLength(1);
  });

  it('answers 409 CONFLICT when the address is already verified', async () => {
    seedUser();

    const response = await post(app, '/api/auth/register', 'anonymous', {
      email: 'owner@example.com',
      password: 'longenough1',
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'CONFLICT',
      message: 'Email is already registered',
      statusCode: 409,
    });
  });

  it('re-issues a token for an unverified address rather than failing', async () => {
    seedUser({ emailVerified: false });
    fakeDb().seed('emailVerificationToken', {
      id: 'tok-old',
      token: 'old',
      email: 'owner@example.com',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const response = await post(app, '/api/auth/register', 'anonymous', {
      email: 'owner@example.com',
      password: 'longenough1',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: 'Verification email already sent. Please check your inbox.',
      pendingVerification: true,
    });
  });

  it('rotates an expired verification token', async () => {
    seedUser({ emailVerified: false });
    fakeDb().seed('emailVerificationToken', {
      id: 'tok-stale',
      token: 'stale',
      email: 'owner@example.com',
      expiresAt: new Date(Date.now() - 1_000),
    });

    const response = await post(app, '/api/auth/register', 'anonymous', {
      email: 'owner@example.com',
      password: 'longenough1',
    });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Verification email sent. Please check your inbox.');
    // The stale row is replaced, not accumulated.
    expect(fakeDb().rows('emailVerificationToken')).toHaveLength(1);
    expect(fakeDb().rows('emailVerificationToken')[0]?.token).not.toBe('stale');
  });

  it('answers 400 INVALID_PAYLOAD with zod details for a short password', async () => {
    const response = await post(app, '/api/auth/register', 'anonymous', {
      email: 'new@example.com',
      password: 'short',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_PAYLOAD');
    expect(response.body.details.fieldErrors.password).toBeDefined();
    expect(fakeDb().rows('user')).toHaveLength(0);
  });

  it('answers 500 when the service throws', async () => {
    const create = vi.spyOn(db.user, 'create').mockRejectedValueOnce(new Error('db down'));

    const response = await post(app, '/api/auth/register', 'anonymous', {
      email: 'new@example.com',
      password: 'longenough1',
    });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to register user');
    create.mockRestore();
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    // The counter is deliberately NOT reset here: it must be monotonic across
    // the whole file, because the lockout map it feeds is.
    resetFakeDb();
  });

  it('answers 401 INVALID_CREDENTIALS for an unknown address', async () => {
    const response = await post(app, '/api/auth/login', 'anonymous', {
      email: nextEmail(),
      password: PASSWORD,
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
      statusCode: 401,
    });
  });

  it('answers 401 NEEDS_VERIFICATION for an unverified account', async () => {
    const email = nextEmail();
    seedUser({ email, emailVerified: false });

    const response = await post(app, '/api/auth/login', 'anonymous', {
      email,
      password: PASSWORD,
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: 'NEEDS_VERIFICATION',
      message: 'Please verify your email before logging in',
      statusCode: 401,
      needsVerification: true,
    });
  });

  it('answers 401 INVALID_CREDENTIALS for a wrong password', async () => {
    const email = nextEmail();
    seedUser({ email });

    const response = await post(app, '/api/auth/login', 'anonymous', {
      email,
      password: 'wrong-horse',
    });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('INVALID_CREDENTIALS');
  });

  it('answers 401 INVALID_CREDENTIALS for an account with no password set', async () => {
    // The Google-OAuth shape: a row exists, but there is nothing to compare.
    const email = nextEmail();
    seedUser({ email, password: null });

    const response = await post(app, '/api/auth/login', 'anonymous', {
      email,
      password: PASSWORD,
    });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('INVALID_CREDENTIALS');
  });

  it('answers 429 ACCOUNT_LOCKED after repeated failures, even with the right password', async () => {
    const email = nextEmail();
    seedUser({ email });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await post(app, '/api/auth/login', 'anonymous', { email, password: 'wrong-horse' });
    }

    const response = await post(app, '/api/auth/login', 'anonymous', {
      email,
      password: PASSWORD,
    });

    expect(response.status).toBe(429);
    expect(response.body).toEqual({
      error: 'ACCOUNT_LOCKED',
      message: 'Too many failed attempts. Try again later.',
      statusCode: 429,
    });
  });

  it('issues a session token and cookie on success', async () => {
    const email = nextEmail();
    seedUser({ email });

    const response = await post(app, '/api/auth/login', 'anonymous', {
      email,
      password: PASSWORD,
    });

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({
      id: OWNER_ID,
      email,
      name: 'Owner',
      image: null,
    });
    const sessionCookie = (response.headers['set-cookie'] as unknown as string[]).find(cookie =>
      cookie.startsWith('dripl-session=')
    );
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');

    // The returned token is the one that was signed: verifying it must yield
    // the same user id the cookie carries. A token that does not round-trip is a
    // silently unusable login.
    const token = response.body.sessionToken as string;
    expect(jwt.verify(token, SECRET, { algorithms: ['HS256'] })).toMatchObject({
      userId: OWNER_ID,
    });
  });

  it('answers 400 INVALID_PAYLOAD for a malformed body', async () => {
    const response = await post(app, '/api/auth/login', 'anonymous', { email: 'nope' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_PAYLOAD');
    expect(response.body.details.fieldErrors.email).toBeDefined();
  });

  it('answers 500 when the service throws', async () => {
    const email = nextEmail();
    seedUser({ email });
    const findUnique = vi.spyOn(db.user, 'findUnique').mockRejectedValueOnce(new Error('db down'));

    const response = await post(app, '/api/auth/login', 'anonymous', {
      email,
      password: PASSWORD,
    });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to login');
    findUnique.mockRestore();
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    const response = await post(app, '/api/auth/logout', OWNER_ID);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    const cookie = (response.headers['set-cookie'] as unknown as string[]).find(entry =>
      entry.startsWith('dripl-session=')
    );
    expect(cookie).toBeDefined();
    // An expired Max-Age is how Express signals "delete this cookie".
    expect(cookie).toMatch(/dripl-session=;/);
  });
});

describe('GET /api/auth/me', () => {
  beforeEach(() => {
    resetFakeDb();
    seedUser();
  });

  it('returns the profile for the token subject', async () => {
    const response = await get(app, '/api/auth/me', OWNER_ID);

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({
      id: OWNER_ID,
      email: 'owner@example.com',
      name: 'Owner',
      image: null,
    });
  });

  it('answers 404 when the token subject no longer exists', async () => {
    const response = await get(app, '/api/auth/me', 'user-deleted');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'NOT_FOUND',
      message: 'User not found',
      statusCode: 404,
    });
  });

  for (const credentials of malformedCredentials()) {
    it(`rejects ${credentials.label}`, async () => {
      const response = await raw('get', app, '/api/auth/me', credentials);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('UNAUTHORIZED');
    });
  }

  it('the route carries its own guard behind the middleware', async () => {
    const response = await get(unguardedApp, '/api/auth/me');

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Authentication required');
  });

  it('answers 500 when the service throws', async () => {
    const findUnique = vi.spyOn(db.user, 'findUnique').mockRejectedValueOnce(new Error('db down'));

    const response = await get(app, '/api/auth/me', OWNER_ID);

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to load user profile');
    findUnique.mockRestore();
  });
});

describe('PUT /api/auth/profile', () => {
  beforeEach(() => {
    resetFakeDb();
    seedUser();
  });

  it('updates only the fields the caller sent', async () => {
    const response = await put(app, '/api/auth/profile', OWNER_ID, { name: 'Renamed' });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ id: OWNER_ID, name: 'Renamed' });
    expect(fakeDb().rows('user')[0]?.email).toBe('owner@example.com');
  });

  it('cannot retarget the update at another user', async () => {
    fakeDb().seed('user', { id: 'user-victim', email: 'victim@example.com', name: 'Victim' });
    const update = vi.spyOn(db.user, 'update');

    const response = await put(app, '/api/auth/profile', OWNER_ID, {
      name: 'Renamed',
      id: 'user-victim',
    });

    expect(response.status).toBe(200);
    // The id in the body is ignored; the only writer target is the token
    // subject. A route that spread `req.body` into `data` would show up here.
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: OWNER_ID } }));
    expect(
      fakeDb()
        .rows('user')
        .find(user => user.id === 'user-victim')?.name
    ).toBe('Victim');
    update.mockRestore();
  });

  it('rejects an unsigned token', async () => {
    const response = await raw(
      'put',
      app,
      '/api/auth/profile',
      { header: 'Bearer a.b.c' },
      {
        name: 'Renamed',
      }
    );

    expect(response.status).toBe(401);
    expect(fakeDb().rows('user')[0]?.name).toBe('Owner');
  });

  it('the route carries its own guard behind the middleware', async () => {
    const response = await raw('put', unguardedApp, '/api/auth/profile', {}, { name: 'Renamed' });

    expect(response.status).toBe(401);
    expect(fakeDb().rows('user')[0]?.name).toBe('Owner');
  });

  it('answers 500 when the service throws', async () => {
    const update = vi.spyOn(db.user, 'update').mockRejectedValueOnce(new Error('db down'));

    const response = await put(app, '/api/auth/profile', OWNER_ID, { name: 'x' });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to update profile');
    update.mockRestore();
  });
});

describe('POST /api/auth/change-password', () => {
  beforeEach(() => {
    resetFakeDb();
    seedUser();
  });

  it('changes the password when the current one is right', async () => {
    const response = await post(app, '/api/auth/change-password', OWNER_ID, {
      currentPassword: PASSWORD,
      newPassword: 'a-new-password',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(String(fakeDb().rows('user')[0]?.password)).not.toBe(PASSWORD_HASH);
  });

  it('answers 400 PASSWORDS_REQUIRED when a field is missing', async () => {
    const response = await post(app, '/api/auth/change-password', OWNER_ID, {
      currentPassword: PASSWORD,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('PASSWORDS_REQUIRED');
  });

  it('answers 400 VALIDATION_ERROR for a short new password', async () => {
    const response = await post(app, '/api/auth/change-password', OWNER_ID, {
      currentPassword: PASSWORD,
      newPassword: 'short',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'VALIDATION_ERROR',
      message: 'New password must be at least 8 characters',
      statusCode: 400,
    });
  });

  it('answers 400 INVALID_PAYLOAD when the current password is wrong', async () => {
    const response = await post(app, '/api/auth/change-password', OWNER_ID, {
      currentPassword: 'wrong-horse',
      newPassword: 'a-new-password',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'INVALID_PAYLOAD',
      message: 'Cannot change password for this account',
      statusCode: 400,
    });
    expect(String(fakeDb().rows('user')[0]?.password)).toBe(PASSWORD_HASH);
  });

  it('cannot change another account password', async () => {
    fakeDb().seed('user', {
      id: 'user-victim',
      email: 'victim@example.com',
      emailVerified: true,
      password: 'irrelevant',
    });
    const update = vi.spyOn(db.user, 'update');

    await post(app, '/api/auth/change-password', OWNER_ID, {
      currentPassword: PASSWORD,
      newPassword: 'a-new-password',
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: OWNER_ID } }));
    expect(
      fakeDb()
        .rows('user')
        .find(user => user.id === 'user-victim')?.password
    ).toBe('irrelevant');
    update.mockRestore();
  });

  it('answers 500 when the service throws', async () => {
    const findUnique = vi.spyOn(db.user, 'findUnique').mockRejectedValueOnce(new Error('db down'));

    const response = await post(app, '/api/auth/change-password', OWNER_ID, {
      currentPassword: PASSWORD,
      newPassword: 'a-new-password',
    });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to change password');
    findUnique.mockRestore();
  });
});

describe('POST /api/auth/ws-ticket', () => {
  beforeEach(() => {
    resetFakeDb();
    wsTicketStore.clear();
  });

  it('issues a ticket bound to the token subject', async () => {
    const response = await post(app, '/api/auth/ws-ticket', OWNER_ID);

    expect(response.status).toBe(200);
    expect(response.body.ticket).toEqual(expect.any(String));
    const entry = wsTicketStore.get(response.body.ticket);
    expect(entry?.principal).toEqual({ kind: 'user', userId: OWNER_ID });
    // 30s TTL: long enough to open a socket, short enough that a leaked
    // ticket is not a durable credential.
    expect(entry!.expiresAt - Date.now()).toBeLessThanOrEqual(30_000);
  });

  it('rejects an unsigned token', async () => {
    const response = await raw('post', app, '/api/auth/ws-ticket', { header: 'Bearer a.b.c' });

    expect(response.status).toBe(401);
    expect(wsTicketStore.size).toBe(0);
  });
});

describe('POST /api/auth/forgot-password', () => {
  beforeEach(() => {
    resetFakeDb();
  });

  it('answers the same 200 for a known and an unknown address', async () => {
    seedUser();

    const known = await post(app, '/api/auth/forgot-password', 'anonymous', {
      email: 'owner@example.com',
    });
    const unknown = await post(app, '/api/auth/forgot-password', 'anonymous', {
      email: 'nobody@example.com',
    });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual({ ok: true });
    expect(unknown.body).toEqual({ ok: true });
    // Only the real address got a token — but the wire answer is identical, so
    // the endpoint does not enumerate accounts.
    expect(fakeDb().rows('passwordResetToken')).toHaveLength(1);
  });

  it('answers 400 EMAIL_REQUIRED for a malformed address', async () => {
    const response = await post(app, '/api/auth/forgot-password', 'anonymous', { email: 'x' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'EMAIL_REQUIRED',
      message: 'Valid email is required',
      statusCode: 400,
    });
  });

  it('answers 500 when the service throws', async () => {
    const findUnique = vi.spyOn(db.user, 'findUnique').mockRejectedValueOnce(new Error('db down'));

    const response = await post(app, '/api/auth/forgot-password', 'anonymous', {
      email: 'owner@example.com',
    });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to process request');
    findUnique.mockRestore();
  });
});

describe('POST /api/auth/reset-password', () => {
  beforeEach(() => {
    resetFakeDb();
    seedUser();
  });

  it('answers 400 PASSWORDS_REQUIRED when the token is missing', async () => {
    const response = await post(app, '/api/auth/reset-password', 'anonymous', {
      password: 'a-new-password',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('PASSWORDS_REQUIRED');
  });

  it('answers 400 INVALID_PAYLOAD for an unknown token', async () => {
    const response = await post(app, '/api/auth/reset-password', 'anonymous', {
      token: 'nope',
      password: 'a-new-password',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'INVALID_PAYLOAD',
      message: 'Invalid or expired reset token',
      statusCode: 400,
    });
  });

  it('answers 400 INVALID_PAYLOAD for an expired token', async () => {
    fakeDb().seed('passwordResetToken', {
      id: 'reset-1',
      token: 'expired',
      email: 'owner@example.com',
      expiresAt: new Date(Date.now() - 1_000),
    });

    const response = await post(app, '/api/auth/reset-password', 'anonymous', {
      token: 'expired',
      password: 'a-new-password',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_PAYLOAD');
  });

  it('sets the new password and consumes the token', async () => {
    fakeDb().seed('passwordResetToken', {
      id: 'reset-1',
      token: 'live',
      email: 'owner@example.com',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const response = await post(app, '/api/auth/reset-password', 'anonymous', {
      token: 'live',
      password: 'a-new-password',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(fakeDb().rows('passwordResetToken')).toHaveLength(0);
  });

  it('answers 500 when the service throws', async () => {
    const findUnique = vi
      .spyOn(db.passwordResetToken, 'findUnique')
      .mockRejectedValueOnce(new Error('db down'));

    const response = await post(app, '/api/auth/reset-password', 'anonymous', {
      token: 'live',
      password: 'a-new-password',
    });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to reset password');
    findUnique.mockRestore();
  });
});

describe('POST /api/auth/verify-email', () => {
  beforeEach(() => {
    resetFakeDb();
    seedUser({ emailVerified: false });
  });

  it('answers 400 VERIFICATION_TOKEN_REQUIRED when the token is missing', async () => {
    const response = await post(app, '/api/auth/verify-email', 'anonymous', {});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'VERIFICATION_TOKEN_REQUIRED',
      message: 'Verification token is required',
      statusCode: 400,
    });
  });

  it('answers 400 INVALID_PAYLOAD for an unknown token', async () => {
    const response = await post(app, '/api/auth/verify-email', 'anonymous', { token: 'nope' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'INVALID_PAYLOAD',
      message: 'Invalid or expired verification token',
      statusCode: 400,
    });
  });

  it('marks the account verified and consumes the token', async () => {
    fakeDb().seed('emailVerificationToken', {
      id: 'tok-1',
      token: 'live',
      email: 'owner@example.com',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const response = await post(app, '/api/auth/verify-email', 'anonymous', { token: 'live' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: 'Email verified successfully. You can now log in.',
    });
    expect(fakeDb().rows('user')[0]?.emailVerified).toBe(true);
    expect(fakeDb().rows('emailVerificationToken')).toHaveLength(0);
  });

  it('answers 500 when the service throws', async () => {
    const findUnique = vi
      .spyOn(db.emailVerificationToken, 'findUnique')
      .mockRejectedValueOnce(new Error('db down'));

    const response = await post(app, '/api/auth/verify-email', 'anonymous', { token: 'live' });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to verify email');
    findUnique.mockRestore();
  });
});

describe('POST /api/auth/google', () => {
  beforeEach(() => {
    resetFakeDb();
  });

  it('answers 400 TOKEN_REQUIRED when no token is sent', async () => {
    const response = await post(app, '/api/auth/google', 'anonymous', {});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'TOKEN_REQUIRED',
      message: 'No token provided',
      statusCode: 400,
    });
  });

  it('answers 401 INVALID_GOOGLE_TOKEN when OAuth is not configured', async () => {
    // The configuration error is reported as a bad token rather than a 500:
    // the caller learns nothing about the server's configuration state.
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');

    const response = await post(app, '/api/auth/google', 'anonymous', { token: 'id-token' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: 'INVALID_GOOGLE_TOKEN',
      message: 'Invalid Google token',
      statusCode: 401,
    });
    expect(JSON.stringify(response.body)).not.toContain('GOOGLE_CLIENT');
    vi.unstubAllEnvs();
  });
});
