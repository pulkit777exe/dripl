import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

// `authMiddleware` resolves the token's stored generation through `@dripl/db`, so
// the middleware is not exercisable without a `User` table behind it. The shared
// factory supplies the production revocation function over in-memory storage.
vi.mock('@dripl/db', async () => {
  const { fakeDbModule } = await import('./test-utils/fakeDbModule');
  return fakeDbModule();
});

import { authMiddleware, type AuthRequest } from '../middlewares/authMiddleware';
import { fakeDb, resetFakeDb } from './test-utils/fakePrisma';
import { generateCsrfToken, validateCsrfToken } from '../middlewares/csrfMiddleware';

function createTestApp(middleware: express.RequestHandler) {
  const app = express();
  app.use(cookieParser());
  app.use(middleware);
  app.get('/protected', (req, res) => {
    res.json({ userId: (req as AuthRequest).userId });
  });
  app.post('/mutation', (_req, res) => {
    res.json({ success: true });
  });
  return app;
}

// ===== authMiddleware =====

describe('authMiddleware', () => {
  const VALID_JWT =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyLTEyMyIsImlhdCI6MTcwMDAwMDAwMH0.test-signature';

  beforeEach(() => {
    resetFakeDb();
    // The account the mocked `jwt.verify` below claims to be. Without this row the
    // revocation check has nothing to compare against and every case answers 401 --
    // which is the correct behaviour, but not the one these cases are about.
    fakeDb().seed('user', { id: 'user-123', email: 'user-123@example.com', tokenVersion: 0 });
    vi.spyOn(jwt, 'verify').mockImplementation(() => ({
      userId: 'user-123',
      iat: 1700000000,
    }));
  });

  it('passes with valid dripl-session cookie', async () => {
    const app = createTestApp(authMiddleware);
    const res = await request(app)
      .get('/protected')
      .set('Cookie', [`dripl-session=${VALID_JWT}`]);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user-123');
  });

  it('passes with valid Authorization header', async () => {
    const app = createTestApp(authMiddleware);
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${VALID_JWT}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user-123');
  });

  it('rejects an Authorization header with a non-Bearer scheme', async () => {
    const app = createTestApp(authMiddleware);
    // Scheme confusion: the old inline `split(' ')[1]` accepted any scheme,
    // so "Basic <jwt>" authenticated. The unified extractor requires Bearer.
    const res = await request(app).get('/protected').set('Authorization', `Basic ${VALID_JWT}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 when no token provided', async () => {
    const app = createTestApp(authMiddleware);
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('returns 401 when token is invalid', async () => {
    vi.spyOn(jwt, 'verify').mockImplementation(() => {
      throw new Error('invalid token');
    });
    const app = createTestApp(authMiddleware);
    const res = await request(app).get('/protected').set('Cookie', ['dripl-session=invalid-token']);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('returns 401 when token is expired', async () => {
    vi.spyOn(jwt, 'verify').mockImplementation(() => {
      const err = new Error('jwt expired');
      err.name = 'TokenExpiredError';
      throw err;
    });
    const app = createTestApp(authMiddleware);
    const res = await request(app)
      .get('/protected')
      .set('Cookie', [`dripl-session=${VALID_JWT}`]);
    expect(res.status).toBe(401);
  });

  /**
   * The revocation check, at the one place every http-server request passes
   * through. The mocked `jwt.verify` above returns no `ver` claim, so this
   * token reads as the initial generation and is compared against storage --
   * which is what makes these three cases meaningful rather than an artefact of
   * a claim that happens to be absent.
   */
  describe('a token the account has revoked', () => {
    it('is refused once the stored generation has moved past it', async () => {
      fakeDb().seed('user', {
        id: 'user-123',
        email: 'user-123@example.com',
        tokenVersion: 1,
      });
      const app = createTestApp(authMiddleware);

      const res = await request(app)
        .get('/protected')
        .set('Cookie', [`dripl-session=${VALID_JWT}`]);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });

    it('is refused when the account no longer exists at all', async () => {
      resetFakeDb();
      const app = createTestApp(authMiddleware);

      const res = await request(app)
        .get('/protected')
        .set('Cookie', [`dripl-session=${VALID_JWT}`]);

      expect(res.status).toBe(401);
    });

    it('is refused when the revocation check itself cannot be performed', async () => {
      // Failing closed: a database that cannot answer must not produce an
      // authenticated request, and must not produce a 500 that tells the caller
      // its credential is fine.
      const { db } = await import('@dripl/db');
      const findUnique = vi
        .spyOn(db.user, 'findUnique')
        .mockRejectedValueOnce(new Error('connection terminated'));
      const app = createTestApp(authMiddleware);

      const res = await request(app)
        .get('/protected')
        .set('Cookie', [`dripl-session=${VALID_JWT}`]);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
      findUnique.mockRestore();
    });
  });
});

// ===== csrfMiddleware =====

describe('csrfMiddleware', () => {
  describe('generateCsrfToken', () => {
    it('generates a 64-character hex token', () => {
      const res = { cookie: vi.fn() } as unknown as express.Response;
      const token = generateCsrfToken(res);
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[0-9a-f]+$/);
    });

    it('sets cookie with correct options', () => {
      const res = { cookie: vi.fn() } as unknown as express.Response;
      generateCsrfToken(res);
      expect(res.cookie).toHaveBeenCalledWith(
        'csrf-token',
        expect.any(String),
        expect.objectContaining({
          httpOnly: false,
          sameSite: 'lax',
          secure: false,
          path: '/',
        })
      );
    });
  });

  describe('validateCsrfToken', () => {
    function createCsrfApp() {
      const app = express();
      app.use(cookieParser());
      app.post('/mutation', validateCsrfToken, (_req, res) => {
        res.json({ success: true });
      });
      app.get('/safe', validateCsrfToken, (_req, res) => {
        res.json({ ok: true });
      });
      return app;
    }

    it('allows GET requests without CSRF token', async () => {
      const app = createCsrfApp();
      const res = await request(app).get('/safe');
      expect(res.status).toBe(200);
    });

    it('allows HEAD requests without CSRF token', async () => {
      const app = createCsrfApp();
      const res = await request(app).head('/safe');
      expect(res.status).toBe(200);
    });

    it('allows OPTIONS requests without CSRF token', async () => {
      const app = createCsrfApp();
      const res = await request(app).options('/safe');
      expect(res.status).toBe(200);
    });

    it('rejects POST without CSRF cookie', async () => {
      const app = createCsrfApp();
      const res = await request(app).post('/mutation').set('x-csrf-token', 'some-token');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('CSRF_TOKEN_MISSING');
    });

    it('rejects POST without CSRF header', async () => {
      const app = createCsrfApp();
      const res = await request(app).post('/mutation').set('Cookie', ['csrf-token=some-token']);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('CSRF_TOKEN_MISSING');
    });

    it('rejects POST with mismatched CSRF tokens', async () => {
      const app = createCsrfApp();
      const res = await request(app)
        .post('/mutation')
        .set('Cookie', ['csrf-token=cookie-value'])
        .set('x-csrf-token', 'header-value');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('CSRF_TOKEN_INVALID');
    });

    it('accepts POST with matching CSRF tokens', async () => {
      const app = createCsrfApp();
      const token = 'abc123';
      const res = await request(app)
        .post('/mutation')
        .set('Cookie', [`csrf-token=${token}`])
        .set('x-csrf-token', token);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
