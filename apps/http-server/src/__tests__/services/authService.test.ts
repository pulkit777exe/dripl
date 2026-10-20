import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../../services/authService';

vi.mock('@dripl/db', () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    emailVerificationToken: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    passwordResetToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../lib/mailer', () => ({
  sendVerificationEmail: vi.fn(),
  sendResetPasswordEmail: vi.fn(),
}));

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('returns email_already_registered for verified user', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: 'user-1',
        emailVerified: new Date(),
      } as never);

      const result = await AuthService.register('test@example.com', 'password123');
      expect(result.type).toBe('email_already_registered');
    });

    it('returns pending_verification for unverified user with valid token', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: 'user-1',
        emailVerified: null,
      } as never);
      vi.mocked(db.emailVerificationToken.findFirst).mockResolvedValue({
        id: 'token-1',
        expiresAt: new Date(Date.now() + 86400000),
      } as never);

      const result = await AuthService.register('test@example.com', 'password123');
      expect(result.type).toBe('pending_verification');
    });

    it('creates new user and sends verification email', async () => {
      const { db } = await import('@dripl/db');
      const { sendVerificationEmail } = await import('../../lib/mailer');

      vi.mocked(db.user.findUnique).mockResolvedValue(null);
      vi.mocked(db.user.create).mockResolvedValue({ id: 'new-user' } as never);
      vi.mocked(db.emailVerificationToken.create).mockResolvedValue({} as never);

      const result = await AuthService.register('new@example.com', 'password123', 'Test User');
      expect(result.type).toBe('registered');
      expect(db.user.create).toHaveBeenCalled();
      expect(sendVerificationEmail).toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('returns not_found for non-existent user', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.user.findUnique).mockResolvedValue(null);

      const result = await AuthService.login('nonexistent@example.com', 'password');
      expect(result.type).toBe('not_found');
    });

    it('returns needs_verification for unverified user', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: 'user-1',
        emailVerified: null,
        password: 'hashed-password',
      } as never);

      const result = await AuthService.login('test@example.com', 'password');
      expect(result.type).toBe('needs_verification');
    });

    it('performs the bcrypt comparison even when no account exists', async () => {
      // not_found and invalid_password share one 401; skipping bcrypt for an
      // unknown address would make response time distinguish them.
      const { db } = await import('@dripl/db');
      const bcrypt = (await import('bcryptjs')).default;
      vi.mocked(db.user.findUnique).mockResolvedValue(null);
      const compare = vi.spyOn(bcrypt, 'compare');

      const result = await AuthService.login('nonexistent@example.com', 'password');

      expect(result.type).toBe('not_found');
      expect(compare).toHaveBeenCalledTimes(1);
      compare.mockRestore();
    });
  });

  describe('verifyEmail', () => {
    it('returns false for invalid token', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.emailVerificationToken.findUnique).mockResolvedValue(null);

      const result = await AuthService.verifyEmail('invalid-token');
      expect(result).toBe(false);
    });

    it('returns false for expired token', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.emailVerificationToken.findUnique).mockResolvedValue({
        id: 'token-1',
        email: 'test@example.com',
        expiresAt: new Date(Date.now() - 86400000),
      } as never);

      const result = await AuthService.verifyEmail('expired-token');
      expect(result).toBe(false);
    });

    it('treats a lost single-use race as an invalid token, not a 500', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.emailVerificationToken.findUnique).mockResolvedValue({
        id: 'token-1',
        email: 'test@example.com',
        expiresAt: new Date(Date.now() + 60_000),
      } as never);
      vi.mocked(db.$transaction).mockRejectedValue({ code: 'P2025' });

      const result = await AuthService.verifyEmail('live-token');

      expect(result).toBe(false);
    });
  });

  describe('forgotPassword', () => {
    it('does not leak email existence', async () => {
      const { db } = await import('@dripl/db');
      const { sendResetPasswordEmail } = await import('../../lib/mailer');

      vi.mocked(db.user.findUnique).mockResolvedValue(null);

      await AuthService.forgotPassword('nonexistent@example.com');
      expect(sendResetPasswordEmail).not.toHaveBeenCalled();
      expect(db.passwordResetToken.deleteMany).not.toHaveBeenCalled();
    });

    it('retires every earlier token so only the newest one is live', async () => {
      // Minting without deleting let an arbitrary number of tokens stay live
      // until their own expiry — a stale link from a week ago, or one an
      // attacker observed, still reset the password after the user requested a
      // fresh one. One live token per address is the contract, and it is
      // established by deleting the old rows before the new one is created.
      const { db } = await import('@dripl/db');
      const { sendResetPasswordEmail } = await import('../../lib/mailer');

      vi.mocked(db.user.findUnique).mockResolvedValue({ id: 'user-1' } as never);
      vi.mocked(db.passwordResetToken.create).mockResolvedValue({} as never);
      vi.mocked(sendResetPasswordEmail).mockResolvedValue(undefined as never);

      await AuthService.forgotPassword('known@example.com');

      expect(db.passwordResetToken.deleteMany).toHaveBeenCalledWith({
        where: { email: 'known@example.com' },
      });
      // The delete must precede the mint: a reordered pair would still leave
      // two live tokens for one request. The fallbacks bias the comparison to
      // fail if either call never happened.
      const deleteOrder =
        vi.mocked(db.passwordResetToken.deleteMany).mock.invocationCallOrder[0] ?? Infinity;
      const createOrder =
        vi.mocked(db.passwordResetToken.create).mock.invocationCallOrder[0] ?? -Infinity;
      expect(deleteOrder).toBeLessThan(createOrder);
    });
  });

  describe('resetPassword', () => {
    it('treats a lost single-use race as an invalid token, not a 500', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.passwordResetToken.findUnique).mockResolvedValue({
        id: 'reset-1',
        email: 'owner@example.com',
        expiresAt: new Date(Date.now() + 60_000),
      } as never);
      vi.mocked(db.user.findUnique).mockResolvedValue({ id: 'user-1' } as never);
      vi.mocked(db.$transaction).mockRejectedValue({ code: 'P2025' });

      const result = await AuthService.resetPassword('live-token', 'a-new-password');

      expect(result).toBe(false);
    });
  });
});
