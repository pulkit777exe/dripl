import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { db, revokeIssuedTokens } from '@dripl/db';
import { sendResetPasswordEmail, sendVerificationEmail } from '../lib/mailer';

const VERIFICATION_TOKEN_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const RESET_TOKEN_TTL_MS = 1000 * 60 * 60; // 1 hour
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 1000 * 60 * 15; // 15 minutes

const loginAttempts = new Map<string, { attempts: number; lockedUntil: number }>();
const MAX_LOGIN_ATTEMPT_ENTRIES = 10_000;

function pruneLoginAttempts(): void {
  const now = Date.now();
  for (const [email, record] of loginAttempts) {
    if (record.lockedUntil <= now && record.attempts === 0) loginAttempts.delete(email);
  }
  while (loginAttempts.size >= MAX_LOGIN_ATTEMPT_ENTRIES) {
    const oldest = loginAttempts.keys().next().value;
    if (oldest === undefined) break;
    loginAttempts.delete(oldest);
  }
}

export interface RegisterResult {
  type: 'email_already_registered' | 'pending_verification' | 'verification_sent' | 'registered';
  message?: string;
}

export interface LoginResult {
  type: 'not_found' | 'needs_verification' | 'invalid_password' | 'account_locked' | 'success';
  user?: { id: string; email: string; name: string | null; image: string | null };
  /**
   * The account's current token generation, and so the `ver` claim the session
   * token minted for this login must carry. Deliberately a sibling of `user`
   * rather than a field on it: `user` is serialized straight into the login
   * response, and a session's revocation counter is not part of a profile.
   */
  sessionTokenVersion?: number;
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
        return {
          type: 'pending_verification',
          message: 'Verification email already sent. Please check your inbox.',
        };
      }

      await db.emailVerificationToken.deleteMany({ where: { email } });
      const verifyToken = randomUUID();
      const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);

      await db.emailVerificationToken.create({
        data: { token: verifyToken, email, expiresAt },
      });

      await sendVerificationEmail(email, verifyToken);
      return {
        type: 'verification_sent',
        message: 'Verification email sent. Please check your inbox.',
      };
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
    pruneLoginAttempts();
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
      // Read from the row `login` already fetched, so signing the session token
      // costs no extra query and cannot race ahead of the stored value.
      sessionTokenVersion: user.tokenVersion,
    };
  }

  /**
   * Sign in with Google, or create the account on first sight.
   *
   * Returns the same `{ id, ..., tokenVersion }` shape as `login` for the same
   * reason: the route has to stamp the session token with the account's current
   * generation, and reading it here keeps that read adjacent to the row that
   * decided the account's identity.
   */
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

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      tokenVersion: user.tokenVersion,
    };
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

    const account = await db.user.findUnique({
      where: { email: resetEntry.email },
      select: { id: true },
    });

    // A live reset token for an address with no account. Answering `false` (a
    // 400) rather than letting the write below fail is the same refusal an
    // unknown or expired token gets, so the endpoint still cannot be used to
    // learn which addresses have accounts.
    if (!account) {
      return false;
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // The password change and the revocation are ONE `UPDATE`, not two statements
    // in a transaction.
    //
    // A reset is the path a user takes when they think somebody else has the
    // account, so leaving the tokens minted under the old password alive would
    // defeat the one action most likely to be taken in response to a compromise.
    // Folding `{ increment: 1 }` into the same statement that rewrites the hash
    // means there is no window at all in which the new password is stored and the
    // old sessions still authenticate -- which a separate write would leave open,
    // and which a `$transaction` array cannot close either, because
    // `revokeIssuedTokens` is a plain promise rather than a Prisma one.
    await db.$transaction([
      db.user.update({
        where: { id: account.id },
        data: { password: hashedPassword, tokenVersion: { increment: 1 } },
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

  /**
   * Change a password, and revoke every session token issued under the old one.
   *
   * Both halves in one transaction, so there is no instant at which the new
   * password is stored and a token minted against the old one still
   * authenticates. A user changing their password is usually doing it *because*
   * they do not trust the current session set -- on a shared machine, after a
   * suspected capture -- and that is exactly the set this kills.
   *
   * Which means the caller's own session dies with it: the client is holding one
   * of the tokens being revoked and has to sign in again. See `revokeAllTokens`
   * for why logout and this share one mechanism rather than two.
   */
  static async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<boolean> {
    const user = await db.user.findUnique({ where: { id: userId } });

    if (!user || !user.password) return false;

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) return false;

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    // One statement, for the reason `resetPassword` gives in full: no window in
    // which the new password is stored and the old sessions still authenticate.
    await db.user.update({
      where: { id: userId },
      data: { password: hashedPassword, tokenVersion: { increment: 1 } },
    });

    return true;
  }

  /**
   * Revoke every session token an account holds, in one write.
   *
   * Named for the effect rather than for the mechanism so that a caller picks it
   * knowing what it costs: this is sign-out-everywhere. A second device, a shared
   * machine, and a token captured from a network log all stop working together,
   * because there is no way to revoke one session without revoking the account's
   * generation -- and pretending otherwise would mean a deny list, a row per
   * token, and an expiry sweep to keep it honest.
   *
   * Logout and the two password-changing paths all funnel through here so that
   * "what invalidates a token" has one answer in the codebase.
   *
   * @returns the new generation, or `null` when there was nothing to revoke.
   */
  static async revokeAllTokens(userId: string): Promise<number | null> {
    const existing = await db.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!existing) return null;
    return revokeIssuedTokens(userId);
  }
}
