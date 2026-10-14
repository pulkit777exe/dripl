/**
 * AUTH RATE-LIMIT COVERAGE OF EVERY UNAUTHENTICATED CREDENTIAL ROUTE.
 *
 * `app.ts` mounts `authRateLimitMiddleware` (10 requests / 15 min / IP) on an
 * explicit list of paths rather than on the whole `/api/auth` prefix. An
 * explicit list has the failure mode an allowlist always has: a route that
 * guesses a credential but is not listed gets no throttle, and nothing says
 * so. That is exactly what happened — `POST /api/auth/google` (an expensive
 * `verifyIdToken` call) and `POST /api/auth/reset-password` (a random-token
 * guess) were unlisted while `login`, `register`, `forgot-password`,
 * `verify-email` and `resend-verification` were covered.
 *
 * This file pins the fix twice: statically (the exported
 * `AUTH_RATE_LIMITED_PATHS` accounts for every unauthenticated credential
 * route `authRouter` exposes) and behaviorally (eleven rapid requests to
 * each listed path end in a 429 with a usable Retry-After, against the
 * composed app, with a fresh module registry per route so the shared
 * per-IP budget cannot leak between cases).
 *
 * Deliberately NOT limited: `POST /api/auth/logout` (grants nothing — it
 * clears a cookie and best-effort revokes, so there is no oracle to throttle)
 * and the routes that carry their own `authMiddleware` (`change-password`,
 * `ws-ticket`, `profile`, `me`: a session is already required, so they are
 * not guessing oracles, and charging them against the per-IP auth budget
 * would let one device lock out a shared egress).
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@dripl/db', async () => {
  const { fakeDbModule } = await import('./test-utils/fakeDbModule');
  return fakeDbModule();
});

vi.mock('../lib/mailer', () => ({
  sendVerificationEmail: vi.fn(async () => {}),
  sendResetPasswordEmail: vi.fn(async () => {}),
}));

import request from 'supertest';
import { AUTH_RATE_LIMITED_PATHS } from '../app';
import { authRouter } from '../routes/auth';
import { CSRF_TOKEN } from './test-utils/authenticatedRequest';

const EXPECTED_PATHS = [
  '/api/auth/login',
  '/api/auth/forgot-password',
  '/api/auth/register',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
  '/api/auth/google',
  '/api/auth/reset-password',
] as const;

describe('AUTH_RATE_LIMITED_PATHS accounts for every credential-guessing route', () => {
  it('lists exactly the seven unauthenticated credential routes', () => {
    expect([...AUTH_RATE_LIMITED_PATHS].sort()).toEqual([...EXPECTED_PATHS].sort());
  });

  it('leaves no unauthenticated POST on authRouter uncovered except logout', () => {
    for (const layer of authRouter.stack) {
      const route = (layer as unknown as { route?: { path?: string; methods?: Record<string, boolean>; stack?: Array<{ name?: string; handle?: { name?: string } }> } }).route;
      if (!route || !route.methods?.post) continue;
      const full = `/api/auth${route.path}`;
      const carriesOwnAuth = (route.stack ?? []).some(
        entry => entry.name === 'authMiddleware' || entry.handle?.name === 'authMiddleware'
      );
      // Authenticated routes are not guessing oracles; see the header.
      if (carriesOwnAuth) continue;
      // Logout grants nothing; throttling it has no guessing-oracle to protect.
      if (full === '/api/auth/logout') continue;
      expect(
        (AUTH_RATE_LIMITED_PATHS as readonly string[]).includes(full),
        `${full} guesses a credential without a throttle`
      ).toBe(true);
    }
  });
});

/**
 * One plausible body per route. The bodies are chosen to travel *past* the
 * CSRF gate (cookie + header are attached by the helper) and *into* the
 * handler, so the 11th request is refused by the rate limiter rather than
 * by an earlier guard — which is what distinguishes "throttled" from
 * "rejected for another reason".
 */
const PROBES: ReadonlyArray<readonly [path: string, body: Record<string, unknown>]> = [
  ['/api/auth/login', { email: 'probe-login@example.test', password: 'wrong' }],
  ['/api/auth/register', { email: 'probe-register@example.test', password: 'password123' }],
  ['/api/auth/forgot-password', { email: 'probe-forgot@example.test' }],
  ['/api/auth/reset-password', { token: 'probe-token', password: 'password123' }],
  ['/api/auth/verify-email', { token: 'probe-token' }],
  ['/api/auth/resend-verification', { email: 'probe-resend@example.test' }],
  ['/api/auth/google', { token: 'probe-token' }],
];

describe('the composed app throttles every listed route', () => {
  for (const [path, body] of PROBES) {
    it(`answers 429 on the 11th rapid POST to ${path}`, async () => {
      // Fresh registry per route: the limiter is a module-level singleton
      // keyed by IP, so without this every case after the first would start
      // with an exhausted budget and prove nothing about its own path.
      vi.resetModules();
      const { createApp } = await import('../app');
      const app = createApp();

      let eleventh: request.Response | undefined;
      for (let attempt = 0; attempt < 11; attempt += 1) {
        const response = await request(app)
          .post(path)
          .set('Cookie', [`csrf-token=${CSRF_TOKEN}`])
          .set('x-csrf-token', CSRF_TOKEN)
          .send(body);
        if (attempt < 10) {
          // Inside budget: whatever the handler answers, it is not a refusal.
          expect(response.status, `attempt ${attempt + 1} to ${path}`).not.toBe(429);
        } else {
          eleventh = response;
        }
      }

      expect(eleventh?.status).toBe(429);
      expect(eleventh?.body).toEqual({
        error: 'RATE_LIMITED',
        message: 'Too many attempts, please try again later.',
        statusCode: 429,
      });
      const retryAfter = Number(eleventh?.headers['retry-after']);
      expect(Number.isFinite(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
    });
  }
});
