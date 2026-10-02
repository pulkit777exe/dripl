import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';

// Rate limiting is a separate control and is not what this suite observes. The
// providers are mocked so a developer's real Upstash credentials in the root
// `.env` cannot decide the outcome of these assertions.
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

vi.mock('@dripl/db', () => ({
  db: {
    user: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(),
      update: vi.fn(),
    },
    emailVerificationToken: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(async () => ({})),
      delete: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    $queryRaw: vi.fn(async () => [{ ok: 1 }]),
  },
  initializeDb: vi.fn(async () => {}),
}));

vi.mock('../../lib/mailer', () => ({
  sendVerificationEmail: vi.fn(async () => {}),
  sendResetPasswordEmail: vi.fn(async () => {}),
}));

import { db } from '@dripl/db';
import { sendVerificationEmail } from '../../lib/mailer';
import { createApp } from '../../app';
import { authRouter } from '../../routes/auth';
import { AuthService } from '../../services/authService';

/**
 * Two apps, because the two controls under test live in two different places.
 * The zod gate belongs to the route, so it is exercised on a router-only mount
 * where nothing can mask it; the CSRF mount belongs to the composition root, so
 * that one has to go through `createApp()` -- a hand-built app would happily
 * pass a route that the real server never guarded.
 */
function createRouterOnlyApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

const composedApp = createApp();
const routerOnlyApp = createRouterOnlyApp();

const CSRF_TOKEN = 'e'.repeat(64);

const mockFindUser = vi.mocked(db.user.findUnique);
const mockSendVerificationEmail = vi.mocked(sendVerificationEmail);

let resendVerificationSpy: MockInstance<typeof AuthService.resendVerification>;

/**
 * The double-submit pattern needs the token twice -- as a readable cookie and
 * as the `x-csrf-token` header -- so each half is settable independently.
 * Omitting the header is what a cross-site request looks like: an attacker can
 * make the victim's browser send the cookie, but can never set the header.
 */
function postResend(
  body: Record<string, unknown>,
  csrf: { header?: string; cookie?: string } = { header: CSRF_TOKEN, cookie: CSRF_TOKEN }
) {
  const pending = request(composedApp).post('/api/auth/resend-verification');
  if (csrf.header) pending.set('x-csrf-token', csrf.header);
  if (csrf.cookie) pending.set('Cookie', [`csrf-token=${csrf.cookie}`]);
  return pending.send(body);
}

function postResendUnguarded(body: Record<string, unknown>) {
  return request(routerOnlyApp).post('/api/auth/resend-verification').send(body);
}

/** Asserts a rejected request never got far enough to touch user data or mail. */
function expectNoServiceOrMailerCall() {
  expect(resendVerificationSpy).not.toHaveBeenCalled();
  expect(mockFindUser).not.toHaveBeenCalled();
  expect(mockSendVerificationEmail).not.toHaveBeenCalled();
}

describe('POST /api/auth/resend-verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUser.mockResolvedValue(null);
    resendVerificationSpy = vi.spyOn(AuthService, 'resendVerification').mockResolvedValue(true);
  });

  afterEach(() => {
    resendVerificationSpy.mockRestore();
  });

  describe('input validation', () => {
    it('rejects a malformed email with 400 and never reaches the service or mailer', async () => {
      const res = await postResendUnguarded({ email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'EMAIL_REQUIRED',
        message: 'Valid email is required',
        statusCode: 400,
      });
      expectNoServiceOrMailerCall();
    });

    it('rejects an oversized but regex-shaped address before it can reach the mailer', async () => {
      // A bare `z.string().email()` accepts this: the local part matches, so the
      // value would have reached `AuthService.resendVerification` and nodemailer's
      // address parser unbounded.
      const res = await postResendUnguarded({ email: `${'a'.repeat(4096)}@example.com` });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('EMAIL_REQUIRED');
      expectNoServiceOrMailerCall();
    });

    it('rejects an oversized unstructured payload', async () => {
      const res = await postResendUnguarded({ email: 'a'.repeat(100_000) });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('EMAIL_REQUIRED');
      expectNoServiceOrMailerCall();
    });

    it('rejects a non-string email, which used to be forwarded as if it were a string', async () => {
      const res = await postResendUnguarded({ email: { $ne: null } });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('EMAIL_REQUIRED');
      expectNoServiceOrMailerCall();
    });

    it('still reports a missing email as EMAIL_REQUIRED', async () => {
      const res = await postResendUnguarded({});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'EMAIL_REQUIRED',
        message: 'Valid email is required',
        statusCode: 400,
      });
      expectNoServiceOrMailerCall();
    });

    it('accepts a well-formed address and forwards it to the service unchanged', async () => {
      const res = await postResendUnguarded({ email: 'user@example.com' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      // The service still receives a plain string, so nothing downstream of
      // validation changed shape.
      expect(resendVerificationSpy).toHaveBeenCalledWith('user@example.com');
    });
  });

  describe('CSRF protection on the composed app', () => {
    it('rejects a cross-site style POST that can carry the cookie but not the header', async () => {
      const res = await postResend({ email: 'user@example.com' }, { cookie: CSRF_TOKEN });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('CSRF_TOKEN_MISSING');
      expectNoServiceOrMailerCall();
    });

    it('rejects a POST with no token at all', async () => {
      const res = await request(composedApp)
        .post('/api/auth/resend-verification')
        .send({ email: 'user@example.com' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('CSRF_TOKEN_MISSING');
      expectNoServiceOrMailerCall();
    });

    it('rejects a POST whose header and cookie tokens disagree', async () => {
      const res = await postResend(
        { email: 'user@example.com' },
        { header: 'attacker-token', cookie: CSRF_TOKEN }
      );

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('CSRF_TOKEN_INVALID');
      expectNoServiceOrMailerCall();
    });

    it('accepts a POST carrying a matching token, the shape the web client sends', async () => {
      const res = await postResend({ email: 'user@example.com' });

      expect(res.status).toBe(200);
      expect(resendVerificationSpy).toHaveBeenCalledWith('user@example.com');
    });
  });
});
