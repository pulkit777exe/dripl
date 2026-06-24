import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { db } from '@dripl/db';
import { sendResetPasswordEmail, sendVerificationEmail } from '../lib/mailer';

const VERIFICATION_TOKEN_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const RESET_TOKEN_TTL_MS = 1000 * 60 * 60; // 1 hour
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 1000 * 60 * 15; // 15 minutes

const loginAttempts = new Map<string, { attempts: number; lockedUntil: number }>();

export interface RegisterResult {
  type: 'email_already_registered' | 'pending_verification' | 'verification_sent' | 'registered';
  message?: string;
}

export interface LoginResult {
  type: 'not_found' | 'needs_verification' | 'invalid_password' | 'account_locked' | 'success';
  user?: { id: string; email: string; name: string | null; image: string | null };
}

export class AuthService {
  static async register(email: string, password: string, name?: string): Promise<RegisterResult> {
    const existing = await db.user.findUnique({
      where: { email },
      select: { id: true, emailVerified: true },
    });

    if (existing) {
      if (existing.emailVerified) {
        return { type: 'email_already_registered' };
      }

      const existingToken = await db.emailVerificationToken.findFirst({
        where: { email },
      });

      if (existingToken && existingToken.expiresAt > new Date()) {
        return { type: 'pending_verification', message: 'Verification email already sent. Please check your inbox.' };
      }

      await db.emailVerificationToken.deleteMany({ where: { email } });
      const verifyToken = randomUUID();
      const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);

      await db.emailVerificationToken.create({
        data: { token: verifyToken, email, expiresAt },
      });

      await sendVerificationEmail(email, verifyToken);
      return { type: 'verification_sent', message: 'Verification email sent. Please check your inbox.' };
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.user.create({
      data: {
        id: randomUUID(),
        email,
        name: name ?? null,
        password: hashedPassword,
        emailVerified: false,
      },
      select: { id: true },
    });

    const verifyToken = randomUUID();
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);

    await db.emailVerificationToken.create({
      data: { token: verifyToken, email, expiresAt },
    });

    await sendVerificationEmail(email, verifyToken);
    return { type: 'registered' };
  }

  static async login(email: string, password: string): Promise<LoginResult> {
    const record = loginAttempts.get(email);
    if (record && record.lockedUntil > Date.now()) {
      return { type: 'account_locked' };
    }

    const user = await db.user.findUnique({ where: { email } });

    if (!user) {
      return { type: 'not_found' };
    }

    if (!user.emailVerified) {
      return { type: 'needs_verification' };
    }

    if (!user.password) {
      return { type: 'invalid_password' };
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      const prev = loginAttempts.get(email);
      const attempts = (prev?.attempts ?? 0) + 1;
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        loginAttempts.set(email, { attempts: 0, lockedUntil: Date.now() + LOCKOUT_DURATION_MS });
      } else {
        loginAttempts.set(email, { attempts, lockedUntil: prev?.lockedUntil ?? 0 });
      }
      return { type: 'invalid_password' };
    }

    loginAttempts.delete(email);
    return {
      type: 'success',
      user: { id: user.id, email: user.email, name: user.name, image: user.image },
    };
  }

  static async googleAuth(email: string, name: string | null, image: string | null) {
    let user = await db.user.findUnique({ where: { email } });

    if (!user) {
      user = await db.user.create({
        data: {
          id: randomUUID(),
          email,
          name: name ?? null,
          image: image ?? null,
        },
      });
    } else {
      // Sync Google name/image on every login
      const updateData: { name?: string; image?: string } = {};
      if (name && !user.name) updateData.name = name;
      if (image && user.image !== image) updateData.image = image;
      if (Object.keys(updateData).length > 0) {
        user = await db.user.update({
          where: { id: user.id },
          data: updateData,
        });
      }
    }

    return { id: user.id, email: user.email, name: user.name, image: user.image };
  }

  static async getUser(userId: string) {
    return db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, image: true },
    });
  }

  static async forgotPassword(email: string): Promise<void> {
    const user = await db.user.findUnique({ where: { email } });
    if (!user) return; // Don't leak emails

    const resetToken = randomUUID();
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await db.passwordResetToken.create({
      data: { token: resetToken, email, expiresAt },
    });

    await sendResetPasswordEmail(email, resetToken);
  }

  static async resetPassword(token: string, newPassword: string): Promise<boolean> {
    const resetEntry = await db.passwordResetToken.findUnique({ where: { token } });

    if (!resetEntry || resetEntry.expiresAt < new Date()) {
      return false;
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.$transaction([
      db.user.update({
        where: { email: resetEntry.email },
        data: { password: hashedPassword },
      }),
      db.passwordResetToken.delete({ where: { id: resetEntry.id } }),
    ]);

    return true;
  }

  static async verifyEmail(token: string): Promise<boolean> {
    const verification = await db.emailVerificationToken.findUnique({ where: { token } });

    if (!verification || verification.expiresAt < new Date()) {
      return false;
    }

    await db.user.update({
      where: { email: verification.email },
      data: { emailVerified: true },
    });

    await db.emailVerificationToken.delete({ where: { id: verification.id } });
    return true;
  }

  static async resendVerification(email: string): Promise<boolean> {
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, emailVerified: true },
    });

    if (!user) return true; // Don't leak
    if (user.emailVerified) return false;

    await db.emailVerificationToken.deleteMany({ where: { email } });

    const verifyToken = randomUUID();
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);

    await db.emailVerificationToken.create({
      data: { token: verifyToken, email, expiresAt },
    });

    await sendVerificationEmail(email, verifyToken);
    return true;
  }

  static async updateProfile(userId: string, data: { name?: string; image?: string }) {
    return db.user.update({
      where: { id: userId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.image !== undefined && { image: data.image }),
      },
      select: { id: true, email: true, name: true, image: true },
    });
  }

  static async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
    const user = await db.user.findUnique({ where: { id: userId } });

    if (!user || !user.password) return false;

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) return false;

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return true;
  }
}
