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
      } as any);

      const result = await AuthService.register('test@example.com', 'password123');
      expect(result.type).toBe('email_already_registered');
    });

    it('returns pending_verification for unverified user with valid token', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: 'user-1',
        emailVerified: null,
      } as any);
      vi.mocked(db.emailVerificationToken.findFirst).mockResolvedValue({
        id: 'token-1',
        expiresAt: new Date(Date.now() + 86400000),
      } as any);

      const result = await AuthService.register('test@example.com', 'password123');
      expect(result.type).toBe('pending_verification');
    });

    it('creates new user and sends verification email', async () => {
      const { db } = await import('@dripl/db');
      const { sendVerificationEmail } = await import('../../lib/mailer');

      vi.mocked(db.user.findUnique).mockResolvedValue(null);
      vi.mocked(db.user.create).mockResolvedValue({ id: 'new-user' } as any);
      vi.mocked(db.emailVerificationToken.create).mockResolvedValue({} as any);

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
      } as any);

      const result = await AuthService.login('test@example.com', 'password');
      expect(result.type).toBe('needs_verification');
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
      } as any);

      const result = await AuthService.verifyEmail('expired-token');
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
    });
  });
});
