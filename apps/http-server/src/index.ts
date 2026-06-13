import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '../../.env') });
config({ path: resolve(process.cwd(), '../../.env.local'), override: true });

import cookieParser from 'cookie-parser';
import compression from 'compression';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { initializeDb } from '@dripl/db';
import { authMiddleware } from './middlewares/authMiddleware';
import { validateCsrfToken, generateCsrfToken } from './middlewares/csrfMiddleware';
import { authRouter } from './routes/auth';
import { filesRouter } from './routes/files';
import { foldersRouter } from './routes/folders';
import { shareRouter } from './routes/share';
import { imagesRouter } from './routes/images';
import roomRoutes from './routes/roomRoutes';

const app = express();
const port = Number(process.env.PORT ?? 3002);
const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

app.set('trust proxy', 1);
app.use(helmet());
app.use(compression());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 250,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Stricter limiter for brute-force-sensitive auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' },
});
app.use(
  cors({
    origin: frontendUrl,
    credentials: true,
  })
);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/metrics', (_req, res) => {
  res.json({
    uptime: process.uptime(),
    memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  });
});

app.get('/csrf-token', (_req, res) => {
  const token = generateCsrfToken(res);
  res.json({ token });
});

app.use('/api/auth/login', validateCsrfToken);
app.use('/api/auth/forgot-password', validateCsrfToken);
app.use('/api/auth/register', validateCsrfToken);
app.use('/api/auth/reset-password', validateCsrfToken);
app.use('/api/auth/change-password', validateCsrfToken);
app.use('/api/auth/logout', validateCsrfToken);

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth', authRouter);
app.use('/api/share', validateCsrfToken, shareRouter);
app.use('/api/files', validateCsrfToken, authMiddleware, filesRouter);
app.use('/api/folders', validateCsrfToken, authMiddleware, foldersRouter);
app.use('/api/rooms', validateCsrfToken, authMiddleware, roomRoutes);
app.use('/api/images', validateCsrfToken, authMiddleware, imagesRouter);

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'http_server_error',
      error: error.message,
      stack: error.stack,
    })
  );
  res.status(500).json({
    error: 'Internal server error',
  });
});

async function start() {
  try {
    await initializeDb();
    console.log(JSON.stringify({ level: 'info', event: 'db_connected' }));
  } catch (err: unknown) {
    console.error(
      JSON.stringify({ level: 'error', event: 'db_connection_failed', error: err instanceof Error ? err.message : String(err) })
    );
    process.exit(1);
  }

  const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const cleanupInterval = setInterval(async () => {
    try {
      const db = (await import('@dripl/db')).db;
      const result = await db.shareLink.deleteMany({
        where: {
          expiresAt: { lt: new Date() },
        },
      });
      console.log(JSON.stringify({ level: 'info', event: 'expired_links_cleaned', count: result.count }));
    } catch (err) {
      console.error(
        JSON.stringify({ level: 'error', event: 'cleanup_failed', error: err instanceof Error ? err.message : String(err) })
      );
    }
  }, CLEANUP_INTERVAL_MS);

  const httpServer = app.listen(port, () => {
    console.log(JSON.stringify({ level: 'info', event: 'http_server_started', port }));
  });

  function shutdown() {
    clearInterval(cleanupInterval);
    httpServer.close(() => {
      console.log(JSON.stringify({ level: 'info', event: 'http_server_closed' }));
      process.exit(0);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
