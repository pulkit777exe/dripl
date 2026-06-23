import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { sendError } from '../lib/response';
import {
  authMiddleware,
  clearSessionCookie,
  setSessionCookie,
  signSessionToken,
  type AuthenticatedRequest,
} from '../middlewares/authMiddleware';
import { OAuth2Client } from 'google-auth-library';
import { AuthService } from '../services/authService';

const wsTicketStore = new Map<string, { userId: string; expiresAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [ticket, data] of wsTicketStore.entries()) {
    if (data.expiresAt < now) wsTicketStore.delete(ticket);
  }
}, 60_000);

const googleClientId = process.env.GOOGLE_CLIENT_ID!;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET!;
const frontendUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002/api';

const googleClient = new OAuth2Client(googleClientId, googleClientSecret);

function getGoogleOAuthClient() {
  return new OAuth2Client(
    googleClientId,
    googleClientSecret,
    `${apiUrl}/auth/google/callback`
  );
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
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
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'register_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
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
      case 'success': {
        const token = signSessionToken(result.user!.id);
        setSessionCookie(res, token);
        res.json({ user: result.user });
        break;
      }
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'login_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to login');
  }
});

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
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
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'me_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
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
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
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

    const sessionToken = signSessionToken(user.id);
    setSessionCookie(res, sessionToken);

    res.json({ user });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'google_auth_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    sendError(res, 401, 'INVALID_GOOGLE_TOKEN', 'Invalid Google token');
  }
});

authRouter.get('/google', (_req, res) => {
  const oauth2Client = getGoogleOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    prompt: 'consent',
  });
  res.redirect(url);
});

authRouter.get('/google/callback', async (req, res) => {
  const code = req.query.code as string | undefined;
  if (!code) {
    sendError(res, 400, 'MISSING_TOKEN', 'Missing authorization code');
    return;
  }

  try {
    const oauth2Client = getGoogleOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token!,
      audience: googleClientId,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      res.redirect(`${frontendUrl}/login?error=google_failed`);
      return;
    }

    const user = await AuthService.googleAuth(
      payload.email,
      payload.name ?? null,
      payload.picture ?? null
    );

    const sessionToken = signSessionToken(user.id);
    setSessionCookie(res, sessionToken);
    res.redirect(`${frontendUrl}/dashboard`);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'google_oauth_callback_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    res.redirect(`${frontendUrl}/login?error=google_failed`);
  }
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
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
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'forgot_password_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
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
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'reset_password_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
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
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'verify_email_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to verify email');
  }
});

authRouter.post('/resend-verification', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    sendError(res, 400, 'EMAIL_REQUIRED', 'Email is required');
    return;
  }

  try {
    const result = await AuthService.resendVerification(email);
    if (!result) {
      sendError(res, 400, 'INVALID_PAYLOAD', 'Email is already verified');
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'resend_verification_error',
        error: error instanceof Error ? error.message : String(error),
      })
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
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'update_profile_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
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
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'change_password_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to change password');
  }
});

authRouter.post('/ws-ticket', authMiddleware, (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const ticket = randomUUID();
  wsTicketStore.set(ticket, { userId: req.userId, expiresAt: Date.now() + 30_000 });
  res.json({ ticket });
});

export { authRouter, wsTicketStore };

export function createInternalRouter(): Router {
  const internalRouter = Router();

  function requireInternalSecret(req: any, res: any, next: any): void {
    if (req.headers['x-internal-secret'] !== process.env.INTERNAL_SECRET) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  }

  internalRouter.post('/validate-ticket', requireInternalSecret, (req, res) => {
    const { ticket } = req.body;
    if (!ticket || typeof ticket !== 'string') {
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
    res.json({ userId: entry.userId });
  });

  return internalRouter;
}
