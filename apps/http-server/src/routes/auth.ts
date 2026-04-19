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
} from '../middlewares/authMiddleware';
import { OAuth2Client } from 'google-auth-library';
import { sendResetPasswordEmail, sendVerificationEmail } from '../lib/mailer';

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
      select: { id: true, emailVerified: true },
    });

    if (existing) {
      if (existing.emailVerified) {
        res.status(409).json({ error: 'Email is already registered' });
      } else {
        // User exists but not verified - resend verification
        const existingToken = await db.emailVerificationToken.findFirst({
          where: { email: parsed.data.email },
        });

        if (existingToken && existingToken.expiresAt > new Date()) {
          // Token exists and valid, just inform user
          res.json({
            message: 'Verification email already sent. Please check your inbox.',
            pendingVerification: true,
          });
        } else {
          // Create new token
          await db.emailVerificationToken.deleteMany({
            where: { email: parsed.data.email },
          });

          const verifyToken = randomUUID();
          const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 hours

          await db.emailVerificationToken.create({
            data: {
              token: verifyToken,
              email: parsed.data.email,
              expiresAt,
            },
          });

          await sendVerificationEmail(parsed.data.email, verifyToken);
          res.json({
            message: 'Verification email sent. Please check your inbox.',
            pendingVerification: true,
          });
        }
      }
      return;
    }

    const hashedPassword = await bcrypt.hash(parsed.data.password, 10);

    const user = await db.user.create({
      data: {
        id: randomUUID(),
        email: parsed.data.email,
        name: parsed.data.name ?? null,
        password: hashedPassword,
        emailVerified: false,
      },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
      },
    });

    // Create and send verification token
    const verifyToken = randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 hours

    await db.emailVerificationToken.create({
      data: {
        token: verifyToken,
        email: parsed.data.email,
        expiresAt,
      },
    });

    await sendVerificationEmail(parsed.data.email, verifyToken);

    // Don't create session - require email verification first
    res.status(201).json({
      message: 'Registration successful. Please verify your email to login.',
      pendingVerification: true,
    });
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

    // Check if email is verified (except for Google OAuth users who have no password)
    if (!user.emailVerified && user.password) {
      res.status(401).json({
        error: 'Please verify your email before logging in',
        needsVerification: true,
      });
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

authRouter.post('/verify-email', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    res.status(400).json({ error: 'Verification token is required' });
    return;
  }

  try {
    const verification = await db.emailVerificationToken.findUnique({
      where: { token },
    });

    if (!verification || verification.expiresAt < new Date()) {
      res.status(400).json({ error: 'Invalid or expired verification token' });
      return;
    }

    await db.user.update({
      where: { email: verification.email },
      data: { emailVerified: true },
    });

    await db.emailVerificationToken.delete({
      where: { id: verification.id },
    });

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
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, emailVerified: true },
    });

    if (!user) {
      // Don't leak if user exists
      res.json({ ok: true });
      return;
    }

    if (user.emailVerified) {
      res.status(400).json({ error: 'Email is already verified' });
      return;
    }

    // Delete any existing tokens
    await db.emailVerificationToken.deleteMany({
      where: { email },
    });

    const verifyToken = randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 hours

    await db.emailVerificationToken.create({
      data: {
        token: verifyToken,
        email,
        expiresAt,
      },
    });

    await sendVerificationEmail(email, verifyToken);

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
  const { name, image } = req.body;

  try {
    const updatedUser = await db.user.update({
      where: { id: req.userId },
      data: {
        ...(name !== undefined && { name }),
        ...(image !== undefined && { image }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
      },
    });

    res.json({ user: updatedUser });
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
    const user = await db.user.findUnique({
      where: { id: req.userId },
    });

    if (!user || !user.password) {
      res.status(400).json({ error: 'Cannot change password for this account' });
      return;
    }

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.user.update({
      where: { id: req.userId },
      data: { password: hashedPassword },
    });

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
