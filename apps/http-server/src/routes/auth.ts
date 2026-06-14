import { Router } from 'express';
import { z } from 'zod';
import {
  authMiddleware,
  clearSessionCookie,
  setSessionCookie,
  signSessionToken,
  type AuthenticatedRequest,
} from '../middlewares/authMiddleware';
import { OAuth2Client } from 'google-auth-library';
import { AuthService } from '../services/authService';

const googleClientId = process.env.GOOGLE_CLIENT_ID!;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET!;
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
const httpServerUrl = process.env.HTTP_SERVER_URL || 'http://localhost:3002';

const googleClient = new OAuth2Client(googleClientId, googleClientSecret);

function getGoogleOAuthClient() {
  return new OAuth2Client(
    googleClientId,
    googleClientSecret,
    `${httpServerUrl}/api/auth/google/callback`
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
      error: 'Invalid registration payload',
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
        res.status(409).json({ error: 'Email is already registered' });
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
    res.status(500).json({ error: 'Failed to register user' });
  }
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid login payload',
      details: parsed.error.flatten(),
    });
    return;
  }

  try {
    const result = await AuthService.login(parsed.data.email, parsed.data.password);

    switch (result.type) {
      case 'not_found':
        res.status(401).json({ error: 'Invalid email or password' });
        break;
      case 'needs_verification':
        res.status(401).json({
          error: 'Please verify your email before logging in',
          needsVerification: true,
        });
        break;
      case 'invalid_password':
        res.status(401).json({ error: 'Invalid email or password' });
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
    res.status(500).json({ error: 'Failed to login' });
  }
});

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const user = await AuthService.getUser(req.userId);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
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
    res.status(500).json({ error: 'Failed to load user profile' });
  }
});

authRouter.post('/google', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    res.status(400).json({ error: 'No token provided' });
    return;
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      res.status(400).json({ error: 'Invalid Google token' });
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
    res.status(401).json({ error: 'Invalid Google token' });
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
    res.status(400).json({ error: 'Missing authorization code' });
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
    res.status(400).json({ error: 'Valid email is required' });
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
    res.status(500).json({ error: 'Failed to process request' });
  }
});

authRouter.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    res.status(400).json({ error: 'Token and password are required' });
    return;
  }

  try {
    const success = await AuthService.resetPassword(token, password);
    if (!success) {
      res.status(400).json({ error: 'Invalid or expired reset token' });
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
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

authRouter.post('/verify-email', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    res.status(400).json({ error: 'Verification token is required' });
    return;
  }

  try {
    const success = await AuthService.verifyEmail(token);
    if (!success) {
      res.status(400).json({ error: 'Invalid or expired verification token' });
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
    res.status(500).json({ error: 'Failed to verify email' });
  }
});

authRouter.post('/resend-verification', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: 'Email is required' });
    return;
  }

  try {
    const result = await AuthService.resendVerification(email);
    if (!result) {
      res.status(400).json({ error: 'Email is already verified' });
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
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
});

authRouter.put('/profile', authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
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
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

authRouter.post('/change-password', authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'Current and new password are required' });
    return;
  }

  if (newPassword.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters' });
    return;
  }

  try {
    const success = await AuthService.changePassword(req.userId, currentPassword, newPassword);
    if (!success) {
      res.status(400).json({ error: 'Cannot change password for this account' });
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
    res.status(500).json({ error: 'Failed to change password' });
  }
});

export { authRouter };
