import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthRequest } from '../../middlewares/authMiddleware';

// Mock the rate limiter so tests don't hit a real Redis instance.
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow() {
      return {};
    }
    async limit() {
      return { success: true };
    }
  },
}));
vi.mock('@upstash/redis', () => ({
  Redis: class {},
}));

vi.mock('@dripl/db', () => ({
  db: {
    file: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { db } from '@dripl/db';
import { shareRouter } from '../../routes/share';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';

const mockFindFirst = vi.mocked(db.file.findFirst);
const mockFindUnique = vi.mocked(db.file.findUnique);
const mockUpdate = vi.mocked(db.file.update);
const mockUpdateMany = vi.mocked(db.file.updateMany);

const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    (req as AuthRequest).userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/share', shareRouter);
  return app;
}

function createPublicShareApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/share', shareRouter);
  return app;
}

function tokenFor(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fileMock = (overrides: Record<string, unknown>): any => ({
  id: 'file-1',
  userId: 'user-1',
  shareToken: null,
  sharePermission: null,
  ...overrides,
});

describe('POST /api/share', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('returns 401 when the request has no auth token', async () => {
    const app = createTestApp();
    const res = await request(app)
      .post('/api/share')
      .send({ fileId: 'file-1', permission: 'view' });
    expect(res.status).toBe(401);
  });

  it('does not rely on the outer mount for share creation auth', async () => {
    const response = await request(createPublicShareApp())
      .post('/api/share')
      .send({ fileId: 'file-1', permission: 'view' });
    expect(response.status).toBe(401);
  });

  it('returns 400 when the body is missing fileId or permission', async () => {
    const app = createTestApp();
    const res = await request(app)
      .post('/api/share')
      .set('Authorization', `Bearer ${tokenFor('user-1')}`)
      .send({ fileId: 'file-1' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when the permission is not view or edit', async () => {
    const app = createTestApp();
    const res = await request(app)
      .post('/api/share')
      .set('Authorization', `Bearer ${tokenFor('user-1')}`)
      .send({ fileId: 'file-1', permission: 'admin' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the file does not exist', async () => {
    mockFindFirst.mockResolvedValue(null);
    const app = createTestApp();
    const res = await request(app)
      .post('/api/share')
      .set('Authorization', `Bearer ${tokenFor('user-1')}`)
      .send({ fileId: 'missing', permission: 'view' });
    expect(res.status).toBe(404);
  });

  it('returns 403 when the user does not own the file', async () => {
    mockFindFirst.mockResolvedValue(fileMock({ userId: 'someone-else' }));
    const app = createTestApp();
    const res = await request(app)
      .post('/api/share')
      .set('Authorization', `Bearer ${tokenFor('user-1')}`)
      .send({ fileId: 'file-1', permission: 'view' });
    expect(res.status).toBe(403);
  });

  it('returns 200 with a token when the file has no share state yet', async () => {
    mockFindFirst.mockResolvedValue(fileMock({ shareToken: null }));
    mockUpdate.mockResolvedValue({ id: 'file-1' } as never);

    const app = createTestApp();
    const res = await request(app)
      .post('/api/share')
      .set('Authorization', `Bearer ${tokenFor('user-1')}`)
      .send({ fileId: 'file-1', permission: 'edit' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: expect.any(String) });
    expect(res.body.token.length).toBeGreaterThanOrEqual(24);
  });

  it('returns 200 with the existing token when the permission is unchanged', async () => {
    mockFindFirst.mockResolvedValue(
      fileMock({ shareToken: 'kept-token-xyz', sharePermission: 'view' })
    );

    const app = createTestApp();
    const res = await request(app)
      .post('/api/share')
      .set('Authorization', `Bearer ${tokenFor('user-1')}`)
      .send({ fileId: 'file-1', permission: 'view' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: 'kept-token-xyz' });
    // No rotation: no DB update
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('rotates the token when the permission changes', async () => {
    mockFindFirst.mockResolvedValue(fileMock({ shareToken: 'old-view', sharePermission: 'view' }));
    mockUpdate.mockResolvedValue({ id: 'file-1' } as never);

    const app = createTestApp();
    const res = await request(app)
      .post('/api/share')
      .set('Authorization', `Bearer ${tokenFor('user-1')}`)
      .send({ fileId: 'file-1', permission: 'edit' });

    expect(res.status).toBe(200);
    expect(res.body.token).not.toBe('old-view');
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'file-1', userId: 'user-1' }),
        data: expect.objectContaining({ sharePermission: 'edit', shareExpiresAt: null }),
      })
    );
  });
});

describe('GET /api/share/:token/ws-ticket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('issues a scoped ticket without requiring a session', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'file-1',
      sharePermission: 'edit',
      shareExpiresAt: null,
    } as never);

    const res = await request(createPublicShareApp()).get('/api/share/share-token/ws-ticket');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      ticket: expect.any(String),
      fileId: 'file-1',
      permission: 'edit',
    });
  });

  it('rejects unknown and expired share tokens', async () => {
    mockFindUnique.mockResolvedValue(null);
    const missing = await request(createPublicShareApp()).get('/api/share/missing/ws-ticket');
    expect(missing.status).toBe(404);

    mockFindUnique.mockResolvedValue({
      id: 'file-1',
      sharePermission: 'view',
      shareExpiresAt: new Date(Date.now() - 1_000),
    } as never);
    const expired = await request(createPublicShareApp()).get('/api/share/expired/ws-ticket');
    expect(expired.status).toBe(410);
  });
});
