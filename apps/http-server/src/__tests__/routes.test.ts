import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express, { Express, type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { authRouter } from '../routes/auth';
import { filesRouter } from '../routes/files';
import { foldersRouter } from '../routes/folders';
import roomRoutes from '../routes/roomRoutes';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';

const testAuthMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    (req as any).userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

function createTestApp(): Express {
  const app: Express = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(cookieParser());
  app.use(
    cors({
      origin: '*',
      credentials: true,
    })
  );
  app.use('/api/auth', authRouter);
  app.use('/api/files', testAuthMiddleware, filesRouter);
  app.use('/api/folders', testAuthMiddleware, foldersRouter);
  app.use('/api/rooms', testAuthMiddleware, roomRoutes);
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });
  return app;
}

function createAuthToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h' });
}

const app = createTestApp();

describe('HTTP Server Routes', () => {
  describe('GET /health', () => {
    it('should return 200 with status ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });

  describe('POST /api/auth/register', () => {
    it('should return 400 when email is missing', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ password: 'testpassword123' });
      expect(res.status).toBe(400);
    });

    it('should return 400 when password is too short', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'test@example.com', password: 'short' });
      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid email format', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'invalid-email', password: 'testpassword123' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should return 400 when email is missing', async () => {
      const res = await request(app).post('/api/auth/login').send({ password: 'testpassword123' });
      expect(res.status).toBe(400);
    });

    it('should return 400 when password is missing', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: 'test@example.com' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/files', () => {
    it('should return 401 without auth token', async () => {
      const res = await request(app).get('/api/files');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/files', () => {
    it('should return 401 without auth token', async () => {
      const res = await request(app).post('/api/files').send({ name: 'Test' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/folders', () => {
    it('should return 401 without auth token', async () => {
      const res = await request(app).get('/api/folders');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/folders', () => {
    it('should return 401 without auth token', async () => {
      const res = await request(app).post('/api/folders').send({ name: 'Test' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/rooms', () => {
    it('should return 401 without auth token', async () => {
      const res = await request(app).get('/api/rooms');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/rooms/:slug', () => {
    it('should return 401 without auth token', async () => {
      const res = await request(app).get('/api/rooms/testslug');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/rooms', () => {
    it('should return 401 without auth token', async () => {
      const res = await request(app).post('/api/rooms').send({ name: 'Test Room' });
      expect(res.status).toBe(401);
    });
  });
});
