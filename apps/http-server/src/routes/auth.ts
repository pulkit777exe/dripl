import { Router, type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { sendError } from '../lib/response';
import {
  authMiddleware,
  clearSessionCookie,
  identifySession,
  setSessionCookie,
  signSessionToken,
  type AuthenticatedRequest,
} from '../middlewares/authMiddleware';
import { OAuth2Client } from 'google-auth-library';
import { Redis } from '@upstash/redis';
import { normalizeOrigin } from '@dripl/utils/origin';
import { AuthService } from '../services/authService';
import { getAllowedOrigins } from '../lib/allowedOrigins';
import { logger } from '../logger';
import {
  CryptoIds,
  SystemClock,
  WS_TICKET_TTL_MS,
  createMemoryTicketStore,
  createRedisTicketStore,
  resolveTicketConfig,
  type TicketPrincipal,
  type TicketStorePort,
} from '../ports';

/** The ticket principal shape lives on the port; this alias keeps existing imports working. */
export type WsTicketPrincipal = TicketPrincipal;

type WsTicketEntry = { principal: WsTicketPrincipal; expiresAt: number };

const ticketEntries = new Map<string, WsTicketEntry>();
const memoryTicketStore = createMemoryTicketStore(SystemClock, CryptoIds, {
  entries: ticketEntries,
});

/**
 * The selected ticket driver: the memory store above, unless the Upstash
 * variables resolve to Redis — the same Upstash-with-memory-fallback contract
 * `lib/rateLimiter.ts` uses. In memory mode this *is* `memoryTicketStore` (same
 * object, not a copy), so the memory path below behaves byte-for-byte as it
 * always did: same map, same TTL, same eviction, same sweep.
 *
 * `new Redis()` is constructed inside the `try` because it throws
 * synchronously on a malformed `UPSTASH_REDIS_REST_URL` (the ws-server Redis
 * module documents exactly that), and a typo in an env var must degrade to
 * process-local tickets rather than crash boot.
 */
function createTicketStorePort(): TicketStorePort {
  const config = resolveTicketConfig(process.env);
  if (config.kind === 'redis') {
    try {
      return createRedisTicketStore(
        new Redis({ url: config.url, token: config.token }),
        SystemClock,
        CryptoIds
      );
    } catch {
      return memoryTicketStore;
    }
  }
  return memoryTicketStore;
}

const ticketStorePort: TicketStorePort = createTicketStorePort();

/**
 * Compat shims over the ticket-store port. `wsTicketStore` is the memory
 * store's own backing map (same object, not a copy), so existing direct uses —
 * tests seeding entries, the sweep below — keep seeing live state.
 * `issueWsTicket` stays synchronous and delegates to the memory store's sync
 * core with the shared TTL.
 *
 * Both shims are memory-only by construction: a synchronous call cannot cross
 * the network. Production routes must use the async `issueTicket` /
 * `ticketStorePort` below, which reach the selected driver — in Redis mode a
 * ticket minted through these shims would be invisible to every other
 * instance, which is the split brain the Redis driver exists to remove. No
 * production caller uses them; they remain for the test suites that drive the
 * memory path directly.
 */
export const wsTicketStore: Map<string, WsTicketEntry> = ticketEntries;

export function issueWsTicket(principal: WsTicketPrincipal): string {
  return memoryTicketStore.issueSync(principal, WS_TICKET_TTL_MS);
}

/**
 * The one production minting path: through the selected driver, so a ticket
 * issued by this instance is redeemable on every instance behind the load
 * balancer. Same TTL, same principal — only the driver differs.
 */
export function issueTicket(principal: WsTicketPrincipal): Promise<string> {
  return ticketStorePort.issue(principal, WS_TICKET_TTL_MS);
}

const wsTicketCleanup = setInterval(() => {
  const now = Date.now();
  for (const [ticket, data] of wsTicketStore.entries()) {
    if (data.expiresAt < now) wsTicketStore.delete(ticket);
  }
}, 60_000);
wsTicketCleanup.unref();

function getGoogleAuth(): { client: OAuth2Client; clientId: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth is not configured (missing GOOGLE_CLIENT_ID/SECRET)');
  }
  return { client: new OAuth2Client(clientId, clientSecret), clientId };
}

/**
 * An email address, bounded.
 *
 * 254 is the RFC 5321 maximum, so no real address is affected. The cap is not
 * decoration: a bare `z.string().email()` accepts a regex-shaped local part of
 * any length, and on the routes below that unbounded value reaches a database
 * query and, for the ones that send mail, nodemailer's address parser.
 *
 * Defined once rather than per-schema. It previously existed only on
 * `resendVerificationSchema`, while its documented siblings `forgotPassword`,
 * `register` and `login` accepted any length — an inconsistency the code
 * itself flagged and this closes.
 */
const emailSchema = z.string().email().max(254);

const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(100).optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  // Max mirrors register: an unbounded password reaches bcrypt.compare, so a
  // multi-megabyte string (inside the 5mb body-parser budget) buys CPU per
  // request. Overlong now answers the same 400 as a malformed payload
  // instead of a 401 — documented wire change, garbage input only.
  password: z.string().min(1).max(128),
});

const authRouter: Router = Router();

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'INVALID_PAYLOAD',
      message: 'Invalid registration payload',
      statusCode: 400,
      details: parsed.error.flatten(),
    });
    return;
  }

  try {
    const result = await AuthService.register(
      parsed.data.email,
      parsed.data.password,
      parsed.data.name
    );

    switch (result.type) {
      case 'email_already_registered':
        sendError(res, 409, 'CONFLICT', 'Email is already registered');
        break;
      case 'pending_verification':
        res.json({ message: result.message, pendingVerification: true });
        break;
      case 'verification_sent':
        res.json({ message: result.message, pendingVerification: true });
        break;
      case 'registered':
        res.status(201).json({
          message: 'Registration successful. Please verify your email to login.',
          pendingVerification: true,
        });
        break;
    }
  } catch (error) {
    logger.error({ event: 'register_error', error }, 'Failed to register user');
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to register user');
  }
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'INVALID_PAYLOAD',
      message: 'Invalid login payload',
      statusCode: 400,
      details: parsed.error.flatten(),
    });
    return;
  }

  try {
    const result = await AuthService.login(parsed.data.email, parsed.data.password);

    switch (result.type) {
      case 'not_found':
        sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
        break;
      case 'needs_verification':
        res.status(401).json({
          error: 'NEEDS_VERIFICATION',
          message: 'Please verify your email before logging in',
          statusCode: 401,
          needsVerification: true,
        });
        break;
      case 'invalid_password':
        sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
        break;
      case 'account_locked':
        sendError(res, 429, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.');
        break;
      case 'success': {
        // The version comes from the row `login` just read, so the token is
        // minted at the account's current generation. Reading it here rather
        // than defaulting is what makes a revoked session unrecoverable: a
        // token signed below the stored generation is dead on arrival.
        const token = signSessionToken(result.user!.id, result.sessionTokenVersion!);
        setSessionCookie(res, token);
        res.json({ user: result.user, sessionToken: token });
        break;
      }
    }
  } catch (error) {
    logger.error({ event: 'login_error', error }, 'Failed to login');
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to login');
  }
});

/**
 * `POST /api/auth/logout` -- clear this device's cookie, and revoke this
 * account's session tokens.
 *
 * NOT behind `authMiddleware`, and the difference is the point. `authMiddleware`
 * answers 401 for a token it cannot accept, which is right for every route that
 * grants something, but logout grants nothing: it clears a cookie and moves a
 * counter. A user whose token has *already* been revoked, or who simply has no
 * token, must still get their cookie cleared and a 200 -- otherwise "log out"
 * is the one action that leaves the stale credential in place.
 *
 * So this route identifies the caller best-effort with `identifySession` and
 * revokes only if that succeeded. Which is complete, not merely convenient: a
 * token that fails the version check is already revoked, and a token that fails
 * the signature check names nobody, so there is no state left to change in
 * either case.
 *
 * PRODUCT DECISION, stated rather than assumed: revoking on logout is
 * sign-out-everywhere. Logging out on one device ends the sessions on all of
 * them, because the account has one generation and a token that outlives the
 * cookie is exactly what this change exists to prevent. The cost is that a
 * shared or family account signs everybody out, and that a user who logs out on
 * their phone has to sign in again on their laptop. Both are recoverable by
 * signing in; the alternative -- leaving logout cosmetic -- means a token
 * captured from a network log stays good for its remaining 6 days and 23 hours.
 */
authRouter.post('/logout', async (req: Request, res: Response) => {
  // Unconditional, and first: whatever else happens, this device stops sending
  // the cookie.
  clearSessionCookie(res);

  try {
    const caller = await identifySession(req);
    if (caller) await AuthService.revokeAllTokens(caller.userId);
  } catch (error) {
    // The cookie is already cleared, so the user's intent is satisfied. Failing
    // loudly here is still right -- a revocation that could not be written is
    // the one thing an operator needs to see.
    logger.error({ event: 'logout_revoke_failed', error }, 'Failed to revoke session tokens');
  }

  res.json({ ok: true });
});

authRouter.get('/me', authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  try {
    const user = await AuthService.getUser(req.userId);

    if (!user) {
      sendError(res, 404, 'NOT_FOUND', 'User not found');
      return;
    }

    res.json({ user });
  } catch (error) {
    logger.error({ event: 'me_error', error }, 'Failed to load user profile');
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to load user profile');
  }
});

authRouter.post('/google', async (req, res) => {
  // Same-origin check, the CSRF-equivalent for a route that cannot take the
  // double-submit guard. `POST /api/auth/google` mints a session from a
  // third-party assertion, and its only legitimate caller is the server-side
  // Next callback (`apps/dripl-app/app/api/auth/google/callback/route.ts`),
  // which `fetch`es here with no `Origin` header at all.
  //
  // So the rule is: enforce when present, admit when absent. Browsers always
  // send `Origin` on a POST — including a cross-site one, which is exactly
  // the login-CSRF shape this refuses — so a forged request from an attacker's
  // page always carries a foreign origin and answers 403 here. A missing
  // header can only come from a non-browser caller, which was never subject
  // to CSRF in the first place. Rate limiting still applies either way
  // (`AUTH_RATE_LIMITED_PATHS` in `app.ts`).
  //
  // A *present but unparseable* origin (garbage, or the literal `null` a
  // sandboxed iframe sends) is refused, not admitted: no legitimate caller
  // sends one — the callback sends none — so rejecting it breaks nothing and
  // keeps an opaque-origin login-CSRF attempt from slipping through the
  // "absent" arm. The allowlist is the same one CORS enforces
  // (`lib/allowedOrigins.ts`), so the two cannot drift.
  const rawOrigin = req.headers.origin;
  if (rawOrigin !== undefined) {
    const origin = normalizeOrigin(rawOrigin);
    if (origin === null || !getAllowedOrigins().includes(origin)) {
      sendError(res, 403, 'FORBIDDEN_ORIGIN', 'Request origin is not allowed');
      return;
    }
  }

  // Bounded before the value reaches `verifyIdToken` (a network call): an
  // ID token is ~1-2KB, so 8192 is generous and anything larger is hostile.
  // Non-string/missing still answers the same 400 TOKEN_REQUIRED as before.
  const parsed = z.object({ token: z.string().min(1).max(8192) }).safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'TOKEN_REQUIRED', 'No token provided');
    return;
  }
  const { token } = parsed.data;

  try {
    const { client, clientId } = getGoogleAuth();
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      sendError(res, 400, 'INVALID_GOOGLE_TOKEN', 'Invalid Google token');
      return;
    }

    const user = await AuthService.googleAuth(
      payload.email,
      payload.name ?? null,
      payload.picture ?? null
    );

    const sessionToken = signSessionToken(user.id, user.tokenVersion);
    setSessionCookie(res, sessionToken);

    res.json({
      user: { id: user.id, email: user.email, name: user.name, image: user.image },
      sessionToken,
    });
  } catch (error) {
    logger.error({ event: 'google_auth_error', error }, 'Failed to authenticate with Google');
    sendError(res, 401, 'INVALID_GOOGLE_TOKEN', 'Invalid Google token');
  }
});

const forgotPasswordSchema = z.object({
  email: emailSchema,
});

authRouter.post('/forgot-password', async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'EMAIL_REQUIRED', 'Valid email is required');
    return;
  }

  try {
    await AuthService.forgotPassword(parsed.data.email);
    res.json({ ok: true });
  } catch (error) {
    logger.error({ event: 'forgot_password_error', error }, 'Failed to process forgot password');
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to process request');
  }
});

authRouter.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (typeof token !== 'string' || typeof password !== 'string' || !token || !password) {
    sendError(res, 400, 'PASSWORDS_REQUIRED', 'Token and password are required');
    return;
  }
  // Token bound matches the internal ticket bound (512): overlong answers
  // the same 400 an unknown token gets, without a DB lookup. The password
  // floor is the vuln fix — reset previously accepted a 1-character password
  // while register and change-password require 8 — and the ceiling mirrors
  // register so an unbounded value never reaches bcrypt.hash.
  if (token.length > 512) {
    sendError(res, 400, 'INVALID_PAYLOAD', 'Invalid or expired reset token');
    return;
  }
  if (password.length < 8) {
    sendError(res, 400, 'VALIDATION_ERROR', 'New password must be at least 8 characters');
    return;
  }
  if (password.length > 128) {
    sendError(res, 400, 'VALIDATION_ERROR', 'New password must be at most 128 characters');
    return;
  }

  try {
    const success = await AuthService.resetPassword(token, password);
    if (!success) {
      sendError(res, 400, 'INVALID_PAYLOAD', 'Invalid or expired reset token');
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    logger.error({ event: 'reset_password_error', error }, 'Failed to reset password');
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to reset password');
  }
});

authRouter.post('/verify-email', async (req, res) => {
  const { token } = req.body;
  if (typeof token !== 'string' || !token) {
    sendError(res, 400, 'VERIFICATION_TOKEN_REQUIRED', 'Verification token is required');
    return;
  }
  // Bound before the DB lookup: overlong answers the same 400 an unknown
  // token gets, so the wire is unchanged and no huge string reaches Prisma.
  if (token.length > 512) {
    sendError(res, 400, 'INVALID_PAYLOAD', 'Invalid or expired verification token');
    return;
  }

  try {
    const success = await AuthService.verifyEmail(token);
    if (!success) {
      sendError(res, 400, 'INVALID_PAYLOAD', 'Invalid or expired verification token');
      return;
    }
    res.json({ message: 'Email verified successfully. You can now log in.' });
  } catch (error) {
    logger.error({ event: 'verify_email_error', error }, 'Failed to verify email');
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to verify email');
  }
});

/**
 * Sibling of `forgotPasswordSchema`: both are unauthenticated, email-only, and
 * non-enumerating, so both answer with the same `EMAIL_REQUIRED` contract. The
 * length cap is the one thing this route adds on purpose -- a bare
 * `z.string().email()` still accepts a regex-shaped local part of any length, and
 * the point of validating here is that no hostile value reaches
 * `AuthService.resendVerification` and nodemailer's address parser. 254 is the
 * RFC 5321 maximum, so no real address is affected. Shares `emailSchema` with
 * every other route that accepts an address.
 */
const resendVerificationSchema = z.object({
  email: emailSchema,
});

authRouter.post('/resend-verification', async (req, res) => {
  const parsed = resendVerificationSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'EMAIL_REQUIRED', 'Valid email is required');
    return;
  }

  try {
    const result = await AuthService.resendVerification(parsed.data.email);
    if (!result) {
      sendError(res, 400, 'INVALID_PAYLOAD', 'Email is already verified');
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    logger.error(
      { event: 'resend_verification_error', error },
      'Failed to resend verification email'
    );
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to resend verification email');
  }
});

/**
 * Profile update bounds. Previously `name`/`image` passed straight from the
 * body into `db.user.update`: an object `name` threw inside Prisma (500),
 * and an unbounded `image` string reached the `String` column. Caps mirror
 * the registration name bound (100) and the file-preview bound (2_000_000).
 * Garbage input now answers 400 instead of 500 — documented wire change.
 */
const profileSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  image: z.string().max(2_000_000).nullable().optional(),
});

authRouter.put('/profile', authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  const parsed = profileSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_PAYLOAD', 'Invalid profile payload');
    return;
  }
  const { name, image } = parsed.data;

  try {
    const user = await AuthService.updateProfile(req.userId, { name, image });
    res.json({ user });
  } catch (error) {
    logger.error({ event: 'update_profile_error', error }, 'Failed to update profile');
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to update profile');
  }
});

authRouter.post('/change-password', authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  const { currentPassword, newPassword } = req.body;

  if (
    typeof currentPassword !== 'string' ||
    typeof newPassword !== 'string' ||
    !currentPassword ||
    !newPassword
  ) {
    sendError(res, 400, 'PASSWORDS_REQUIRED', 'Current and new password are required');
    return;
  }

  if (newPassword.length < 8) {
    sendError(res, 400, 'VALIDATION_ERROR', 'New password must be at least 8 characters');
    return;
  }

  // Ceilings so unbounded values never reach bcrypt: the new password mirrors
  // register (128); the current one is a DoS bound only (1024) — any real
  // password is far shorter, and a wrong one still answers the same 400.
  if (newPassword.length > 128) {
    sendError(res, 400, 'VALIDATION_ERROR', 'New password must be at most 128 characters');
    return;
  }
  if (currentPassword.length > 1024) {
    sendError(res, 400, 'INVALID_PAYLOAD', 'Cannot change password for this account');
    return;
  }

  try {
    const success = await AuthService.changePassword(req.userId, currentPassword, newPassword);
    if (!success) {
      sendError(res, 400, 'INVALID_PAYLOAD', 'Cannot change password for this account');
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    logger.error({ event: 'change_password_error', error }, 'Failed to change password');
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to change password');
  }
});

authRouter.post('/ws-ticket', authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const ticket = await issueTicket({ kind: 'user', userId: req.userId });
  res.json({ ticket });
});

export { authRouter };

export function createInternalRouter(): Router {
  const internalRouter = Router();

  function requireInternalSecret(req: Request, res: Response, next: NextFunction): void {
    const expectedSecret = process.env.INTERNAL_SECRET;
    const providedSecret = req.get('x-internal-secret');
    if (
      !expectedSecret ||
      !providedSecret ||
      expectedSecret.length !== providedSecret.length ||
      !timingSafeEqual(Buffer.from(providedSecret), Buffer.from(expectedSecret))
    ) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  }

  internalRouter.post('/validate-ticket', requireInternalSecret, async (req, res) => {
    const { ticket } = req.body;
    if (!ticket || typeof ticket !== 'string' || ticket.length > 512) {
      res.status(400).json({ error: 'Ticket is required' });
      return;
    }
    // Through the selected driver, so a ticket minted by any instance is
    // spendable on this one. In memory mode this is the same store (and the
    // same single-threaded atomicity) the previous sync call provided.
    const principal = await ticketStorePort.consume(ticket);
    if (!principal) {
      res.status(401).json({ error: 'Invalid or expired ticket' });
      return;
    }
    res.json(principal);
  });

  return internalRouter;
}
