import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
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
import { AuthService } from '../services/authService';
import { logger } from '../logger';

export type WsTicketPrincipal =
  | { kind: 'user'; userId: string }
  | { kind: 'share'; fileId: string; token: string; permission: 'view' | 'edit' };

export const wsTicketStore = new Map<string, { principal: WsTicketPrincipal; expiresAt: number }>();

export function issueWsTicket(principal: WsTicketPrincipal): string {
  const ticket = randomUUID();
  if (wsTicketStore.size >= 10_000) {
    const oldest = wsTicketStore.keys().next().value;
    if (oldest) wsTicketStore.delete(oldest);
  }
  wsTicketStore.set(ticket, {
    principal,
    expiresAt: Date.now() + 30_000,
  });
  return ticket;
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
  password: z.string().min(1),
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
  const { token } = req.body;
  if (!token) {
    sendError(res, 400, 'TOKEN_REQUIRED', 'No token provided');
    return;
  }

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
  if (!token || !password) {
    sendError(res, 400, 'PASSWORDS_REQUIRED', 'Token and password are required');
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
  if (!token) {
    sendError(res, 400, 'VERIFICATION_TOKEN_REQUIRED', 'Verification token is required');
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

authRouter.put('/profile', authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  const { name, image } = req.body;

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

  if (!currentPassword || !newPassword) {
    sendError(res, 400, 'PASSWORDS_REQUIRED', 'Current and new password are required');
    return;
  }

  if (newPassword.length < 8) {
    sendError(res, 400, 'VALIDATION_ERROR', 'New password must be at least 8 characters');
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

authRouter.post('/ws-ticket', authMiddleware, (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const ticket = issueWsTicket({ kind: 'user', userId: req.userId });
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

  internalRouter.post('/validate-ticket', requireInternalSecret, (req, res) => {
    const { ticket } = req.body;
    if (!ticket || typeof ticket !== 'string' || ticket.length > 512) {
      res.status(400).json({ error: 'Ticket is required' });
      return;
    }
    const entry = wsTicketStore.get(ticket);
    if (!entry || entry.expiresAt < Date.now()) {
      wsTicketStore.delete(ticket);
      res.status(401).json({ error: 'Invalid or expired ticket' });
      return;
    }
    wsTicketStore.delete(ticket);
    res.json(entry.principal);
  });

  return internalRouter;
}
