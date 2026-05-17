import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { authMiddleware } from '../middlewares/authMiddleware';
import { generateCsrfToken, validateCsrfToken } from '../middlewares/csrfMiddleware';

function createTestApp(middleware: express.RequestHandler) {
  const app = express();
  app.use(cookieParser());
  app.use(middleware);
  app.get('/protected', (req, res) => {
    res.json({ userId: (req as any).userId });
  });
  app.post('/mutation', (req, res) => {
    res.json({ success: true });
  });
  return app;
}

// ===== authMiddleware =====

describe('authMiddleware', () => {
  const VALID_JWT =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyLTEyMyIsImlhdCI6MTcwMDAwMDAwMH0.test-signature';

  beforeEach(() => {
    vi.spyOn(require('jsonwebtoken'), 'verify').mockImplementation(() => ({
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
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${VALID_JWT}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user-123');
  });

  it('returns 401 when no token provided', async () => {
    const app = createTestApp(authMiddleware);
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Authentication required');
  });

  it('returns 401 when token is invalid', async () => {
    vi.spyOn(require('jsonwebtoken'), 'verify').mockImplementation(() => {
      throw new Error('invalid token');
    });
    const app = createTestApp(authMiddleware);
    const res = await request(app)
      .get('/protected')
      .set('Cookie', ['dripl-session=invalid-token']);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired token');
  });

  it('returns 401 when token is expired', async () => {
    vi.spyOn(require('jsonwebtoken'), 'verify').mockImplementation(() => {
      const err = new Error('jwt expired') as any;
      err.name = 'TokenExpiredError';
      throw err;
    });
    const app = createTestApp(authMiddleware);
    const res = await request(app)
      .get('/protected')
      .set('Cookie', [`dripl-session=${VALID_JWT}`]);
    expect(res.status).toBe(401);
  });
});

// ===== csrfMiddleware =====

describe('csrfMiddleware', () => {
  describe('generateCsrfToken', () => {
    it('generates a 64-character hex token', () => {
      const res = { cookie: vi.fn() } as any;
      const token = generateCsrfToken(res);
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[0-9a-f]+$/);
    });

    it('sets cookie with correct options', () => {
      const res = { cookie: vi.fn() } as any;
      generateCsrfToken(res);
      expect(res.cookie).toHaveBeenCalledWith(
        'csrf-token',
        expect.any(String),
        expect.objectContaining({
          httpOnly: false,
          sameSite: 'strict',
          path: '/',
        })
      );
    });
  });

  describe('validateCsrfToken', () => {
    function createCsrfApp() {
      const app = express();
      app.use(cookieParser());
      app.post('/mutation', validateCsrfToken, (req, res) => {
        res.json({ success: true });
      });
      app.get('/safe', validateCsrfToken, (req, res) => {
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
      const res = await request(app)
        .post('/mutation')
        .set('x-csrf-token', 'some-token');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('CSRF token missing');
    });

    it('rejects POST without CSRF header', async () => {
      const app = createCsrfApp();
      const res = await request(app)
        .post('/mutation')
        .set('Cookie', ['csrf-token=some-token']);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('CSRF token missing');
    });

    it('rejects POST with mismatched CSRF tokens', async () => {
      const app = createCsrfApp();
      const res = await request(app)
        .post('/mutation')
        .set('Cookie', ['csrf-token=cookie-value'])
        .set('x-csrf-token', 'header-value');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('CSRF token invalid');
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
