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

vi.mock('@dripl/db', async () => {
  const { fakeRevocation } = await import('../test-utils/fakeDbModule');
  const db = {
    file: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    // `shareRouter` mounts `authMiddleware`, which resolves the token's stored
    // generation through this before the route runs.
    user: { findUnique: vi.fn(async () => ({ tokenVersion: 0 })) },
  };
  return { db, ...(await fakeRevocation(db as never)) };
});

import { db, type Prisma } from '@dripl/db';
import { shareRouter } from '../../routes/share';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';

const mockFindFirst = vi.mocked(db.file.findFirst);
const mockFindUnique = vi.mocked(db.file.findUnique);
const mockUpdateMany = vi.mocked(db.file.updateMany);
const mockUserFindUnique = vi.mocked(db.user.findUnique);

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

// `POST /api/share` delegates to `ShareService.upsertShareToken`, so the row
// `findFirst` is stubbed with is the `upsertShareToken` select -- six columns out
// of a 12-column `File`. Deriving it from the select (rather than from
// `db.file.findFirst`, whose generic erases to the full row) means changing that
// select is a compile error here instead of a runtime `undefined`.
type UpsertShareFileRow = Prisma.FileGetPayload<{
  select: {
    id: true;
    userId: true;
    shareToken: true;
    sharePermission: true;
    shareExpiresAt: true;
    updatedAt: true;
  };
}>;

// The ws-ticket route has its own, narrower `findUnique` select.
type WsTicketFileRow = Prisma.FileGetPayload<{
  select: { id: true; sharePermission: true; shareExpiresAt: true };
}>;

// Fixed so the optimistic-concurrency fence is assertable by value rather than
// only by type. Must be a real Date: the service puts it in the `where` clause.
const UPDATED_AT = new Date('2026-01-01T00:00:00.000Z');

// Complete rows: every selected column has a default, so nothing reaches the code
// under test as `undefined` by accident.
const fileMock = (overrides: Partial<UpsertShareFileRow> = {}): UpsertShareFileRow => ({
  id: 'file-1',
  userId: 'user-1',
  shareToken: null,
  sharePermission: null,
  shareExpiresAt: null,
  updatedAt: UPDATED_AT,
  ...overrides,
});

/**
 * `vi.mocked()` erases each Prisma method's generic to its no-select constraint,
 * so `mockResolvedValue` still demands the full 12-column `File` row even when
 * the code under test selected three or six. These are the single places that
 * gap is bridged: each cast widens the selected columns back to the full row,
 * and the selected subset is all the code under test reads.
 */
const givenFile = (row: UpsertShareFileRow | null): void => {
  mockFindFirst.mockResolvedValue(row as Awaited<ReturnType<typeof db.file.findFirst>>);
};

const givenWsTicketFile = (row: WsTicketFileRow | null): void => {
  mockFindUnique.mockResolvedValue(row as Awaited<ReturnType<typeof db.file.findUnique>>);
};

describe('POST /api/share', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateMany.mockResolvedValue({ count: 1 });
    // Re-asserted after `clearAllMocks`, which drops the `vi.fn` implementation.
    // The token these cases present is signed at generation 0.
    // `select` narrows the row Prisma returns, so the stub has to carry the whole
    // shape the revocation check reads back -- not just the column under test.
    mockUserFindUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user-1@example.com',
      name: null,
      image: null,
      password: null,
      emailVerified: true,
      tokenVersion: 0,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
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
    givenFile(null);
    const app = createTestApp();
    const res = await request(app)
      .post('/api/share')
      .set('Authorization', `Bearer ${tokenFor('user-1')}`)
      .send({ fileId: 'missing', permission: 'view' });
    expect(res.status).toBe(404);
  });

  it('returns 403 when the user does not own the file', async () => {
    givenFile(fileMock({ userId: 'someone-else' }));
    const app = createTestApp();
    const res = await request(app)
      .post('/api/share')
      .set('Authorization', `Bearer ${tokenFor('user-1')}`)
      .send({ fileId: 'file-1', permission: 'view' });
    expect(res.status).toBe(403);
  });

  it('returns 200 with a token when the file has no share state yet', async () => {
    givenFile(fileMock({ shareToken: null }));
    const app = createTestApp();
    const res = await request(app)
      .post('/api/share')
      .set('Authorization', `Bearer ${tokenFor('user-1')}`)
      .send({ fileId: 'file-1', permission: 'edit' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: expect.any(String) });
    expect(res.body.token.length).toBeGreaterThanOrEqual(24);
    // The rotate path is fenced on the row it read.
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'file-1',
          userId: 'user-1',
          updatedAt: UPDATED_AT,
        }),
      })
    );
  });

  it('returns 200 with the existing token when the permission is unchanged', async () => {
    givenFile(fileMock({ shareToken: 'kept-token-xyz', sharePermission: 'view' }));

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
    givenFile(fileMock({ shareToken: 'old-view', sharePermission: 'view' }));
    const app = createTestApp();
    const res = await request(app)
      .post('/api/share')
      .set('Authorization', `Bearer ${tokenFor('user-1')}`)
      .send({ fileId: 'file-1', permission: 'edit' });

    expect(res.status).toBe(200);
    expect(res.body.token).not.toBe('old-view');
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'file-1',
          userId: 'user-1',
          updatedAt: UPDATED_AT,
        }),
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
    givenWsTicketFile({ id: 'file-1', sharePermission: 'edit', shareExpiresAt: null });

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
    givenWsTicketFile(null);
    const missing = await request(createPublicShareApp()).get('/api/share/missing/ws-ticket');
    expect(missing.status).toBe(404);

    givenWsTicketFile({
      id: 'file-1',
      sharePermission: 'view',
      shareExpiresAt: new Date(Date.now() - 1_000),
    });
    const expired = await request(createPublicShareApp()).get('/api/share/expired/ws-ticket');
    expect(expired.status).toBe(410);
  });
});
