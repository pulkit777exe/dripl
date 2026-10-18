/**
 * INPUT BOUNDS ON VALUES THAT REACH THE DATABASE, THE MAILER, OR BCRYPT.
 *
 * Each case below pins a ceiling (or floor) added in the API-security
 * hardening pass, and each names the sink it protects. The pattern follows
 * the `emailSchema` RFC 5321 precedent in `routes/auth.ts`: a bare
 * `z.string()` accepts a regex-shaped value of any length, and on these
 * routes that unbounded value reached storage, mail, or a CPU-heavy hash
 * before anything said no.
 *
 * WIRE CHANGES (all documented here, all garbage input only):
 * - login password >128 chars: 400 INVALID_PAYLOAD, was 401. Mirrors register.
 * - reset-password password <8 chars: 400 VALIDATION_ERROR, was success (the
 *   vuln fix — reset accepted a 1-character password while register and
 *   change-password require 8).
 * - reset-password password >128 / token >512, verify-email token >512:
 *   400 with the same code the route answers for an unknown token.
 * - google non-string token: 400 TOKEN_REQUIRED, was 401 from the throw.
 * - profile overlong/object name/image: 400 INVALID_PAYLOAD, was 500/200.
 * - change-password new password >128: 400 VALIDATION_ERROR, was a hash.
 * - folder parentId >100 chars: 400, was a 404 DB miss.
 *
 * WIRE-IDENTICAL (same status and body as a miss, DB simply never read):
 * - share token / room share token >512 chars: the same 404 a miss gets.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@dripl/db', async () => {
  const { fakeDbModule } = await import('../test-utils/fakeDbModule');
  return fakeDbModule();
});

vi.mock('../../lib/mailer', () => ({
  sendVerificationEmail: vi.fn(async () => {}),
  sendResetPasswordEmail: vi.fn(async () => {}),
}));

import { authRouter } from '../../routes/auth';
import { foldersRouter } from '../../routes/folders';
import { shareRouter } from '../../routes/share';
import roomRoutes from '../../routes/roomRoutes';
import {
  buildApp,
  get,
  OWNER_ID,
  post,
  put,
  seedSessionUser,
} from '../test-utils/authenticatedRequest';
import { fakeDb, resetFakeDb } from '../test-utils/fakePrisma';

const authApp = buildApp([{ path: '/api/auth', router: authRouter, auth: false }]);
const foldersApp = buildApp([{ path: '/api/folders', router: foldersRouter }]);
const shareApp = buildApp([{ path: '/api/share', router: shareRouter, auth: false }]);
const roomsApp = buildApp([{ path: '/api/rooms', router: roomRoutes, auth: false }]);

describe('credential-route bounds', () => {
  beforeEach(() => {
    resetFakeDb();
  });

  it('refuses an overlong login password with 400 instead of hashing it', async () => {
    const response = await post(authApp, '/api/auth/login', 'anonymous', {
      email: 'owner@example.com',
      password: 'x'.repeat(129),
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_PAYLOAD');
  });

  it('refuses a too-short reset password (the floor reset was missing)', async () => {
    fakeDb().seed('passwordResetToken', {
      id: 'reset-1',
      token: 'live',
      email: 'owner@example.com',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const response = await post(authApp, '/api/auth/reset-password', 'anonymous', {
      token: 'live',
      password: 'short',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'VALIDATION_ERROR',
      message: 'New password must be at least 8 characters',
      statusCode: 400,
    });
    // The token is not consumed by a refused reset.
    expect(fakeDb().rows('passwordResetToken')).toHaveLength(1);
  });

  it('answers an overlong reset token exactly like an unknown one', async () => {
    const response = await post(authApp, '/api/auth/reset-password', 'anonymous', {
      token: 't'.repeat(513),
      password: 'a-new-password',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'INVALID_PAYLOAD',
      message: 'Invalid or expired reset token',
      statusCode: 400,
    });
  });

  it('answers an overlong verify-email token exactly like an unknown one', async () => {
    const response = await post(authApp, '/api/auth/verify-email', 'anonymous', {
      token: 't'.repeat(513),
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'INVALID_PAYLOAD',
      message: 'Invalid or expired verification token',
      statusCode: 400,
    });
  });

  it('answers a non-string google token with 400 TOKEN_REQUIRED', async () => {
    const response = await post(authApp, '/api/auth/google', 'anonymous', {
      token: { nested: 'object' },
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('TOKEN_REQUIRED');
  });

  it('refuses an overlong change-password with 400 instead of hashing it', async () => {
    seedSessionUser(OWNER_ID);
    const response = await post(authApp, '/api/auth/change-password', OWNER_ID, {
      currentPassword: 'x',
      newPassword: 'y'.repeat(129),
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('answers an overlong reset password with the ceiling message', async () => {
    const response = await post(authApp, '/api/auth/reset-password', 'anonymous', {
      token: 'live',
      password: 'x'.repeat(129),
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'VALIDATION_ERROR',
      message: 'New password must be at most 128 characters',
      statusCode: 400,
    });
  });

  it('answers an EMPTY reset password as required, not as too short', async () => {
    // The wire splits the two: "" was "password missing" before any length
    // rule ran, while 1-7 characters is the floor. One `min(8)` issue cannot
    // tell them apart, which is why the schema keeps presence and floor as
    // separate rules.
    const response = await post(authApp, '/api/auth/reset-password', 'anonymous', {
      token: 'live',
      password: '',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('PASSWORDS_REQUIRED');
  });

  it('answers a non-string reset token as required, not as a Prisma error', async () => {
    const response = await post(authApp, '/api/auth/reset-password', 'anonymous', {
      token: { nested: 'object' },
      password: 'a-new-password',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('PASSWORDS_REQUIRED');
  });

  it('answers an overlong current password exactly like a wrong one', async () => {
    seedSessionUser(OWNER_ID);
    const response = await post(authApp, '/api/auth/change-password', OWNER_ID, {
      currentPassword: 'x'.repeat(1025),
      newPassword: 'a-new-password',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'INVALID_PAYLOAD',
      message: 'Cannot change password for this account',
      statusCode: 400,
    });
  });
});

describe('profile bounds', () => {
  beforeEach(() => {
    resetFakeDb();
    seedSessionUser(OWNER_ID);
  });

  it('refuses an overlong display name with 400 instead of writing it', async () => {
    const response = await put(authApp, '/api/auth/profile', OWNER_ID, {
      name: 'n'.repeat(101),
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_PAYLOAD');
  });

  it('refuses a non-string name with 400 instead of a Prisma 500', async () => {
    const response = await put(authApp, '/api/auth/profile', OWNER_ID, {
      name: { nested: 'object' },
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_PAYLOAD');
  });

  it('still ignores unknown fields and updates the name', async () => {
    const response = await put(authApp, '/api/auth/profile', OWNER_ID, {
      name: 'Renamed',
      id: 'user-victim',
    });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ id: OWNER_ID, name: 'Renamed' });
  });
});

describe('folder parentId bound', () => {
  beforeEach(() => {
    resetFakeDb();
    seedSessionUser(OWNER_ID);
  });

  it('refuses an overlong parentId with 400 instead of a DB lookup', async () => {
    const response = await post(foldersApp, '/api/folders', OWNER_ID, {
      name: 'Design',
      parentId: 'p'.repeat(101),
    });

    expect(response.status).toBe(400);
  });
});

describe('capability-token length guards (wire-identical 404s)', () => {
  beforeEach(() => {
    resetFakeDb();
  });

  it('answers an overlong file-share token exactly like a miss', async () => {
    // GET is a safe method so no CSRF pair is needed; the guard under test
    // runs before the database is even resolved.
    const response = await get(shareApp, `/api/share/${'t'.repeat(513)}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'NOT_FOUND',
      message: 'Share link not found',
      statusCode: 404,
    });
  });

  it('answers an overlong room share token exactly like a miss', async () => {
    const response = await get(roomsApp, `/api/rooms/share/${'t'.repeat(513)}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'NOT_FOUND',
      message: 'Share link not found',
      statusCode: 404,
    });
  });
});
