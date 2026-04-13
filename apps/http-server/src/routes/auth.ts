import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { db } from '@dripl/db';
import {
  authMiddleware,
  clearSessionCookie,
  setSessionCookie,
  signSessionToken,
  type AuthenticatedRequest,
} from '../middleware/auth';
import { OAuth2Client } from 'google-auth-library';
import { sendResetPasswordEmail } from '../lib/mailer';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
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
    const existing = await db.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true },
    });

    if (existing) {
      res.status(409).json({ error: 'Email is already registered' });
      return;
    }

    const hashedPassword = await bcrypt.hash(parsed.data.password, 10);

    const user = await db.user.create({
      data: {
        id: randomUUID(),
        email: parsed.data.email,
        name: parsed.data.name ?? null,
        password: hashedPassword,
      },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
      },
    });

    const token = signSessionToken(user.id);
    setSessionCookie(res, token);

    res.status(201).json({ user });
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
    const user = await db.user.findUnique({
      where: { email: parsed.data.email },
    });

    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const isValid = user.password && (await bcrypt.compare(parsed.data.password, user.password));
    if (!isValid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = signSessionToken(user.id);
    setSessionCookie(res, token);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
      },
    });
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
    const user = await db.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
      },
    });

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

    const email = payload.email;
    const name = payload.name;
    const image = payload.picture;

    let user = await db.user.findUnique({
      where: { email },
    });

    if (!user) {
      user = await db.user.create({
        data: {
          id: randomUUID(),
          email,
          name: name ?? null,
          image: image ?? null,
        },
      });
    }

    const sessionToken = signSessionToken(user.id);
    setSessionCookie(res, sessionToken);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
      },
    });
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

authRouter.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: 'Email is required' });
    return;
  }

  try {
    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      // Return ok to not leak emails
      res.json({ ok: true });
      return;
    }

    const resetToken = randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    await db.passwordResetToken.create({
      data: {
        token: resetToken,
        email,
        expiresAt,
      },
    });

    await sendResetPasswordEmail(email, resetToken);

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
    const resetEntry = await db.passwordResetToken.findUnique({
      where: { token },
    });

    if (!resetEntry || resetEntry.expiresAt < new Date()) {
      res.status(400).json({ error: 'Invalid or expired reset token' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.user.update({
      where: { email: resetEntry.email },
      data: { password: hashedPassword },
    });

    await db.passwordResetToken.delete({
      where: { id: resetEntry.id },
    });

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

export { authRouter };
