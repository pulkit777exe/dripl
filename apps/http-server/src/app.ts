import cookieParser from 'cookie-parser';
import compression from 'compression';
import cors from 'cors';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';
import { validateCsrfToken, generateCsrfToken } from './middlewares/csrfMiddleware';
import { authMiddleware } from './middlewares/authMiddleware';
import { sendError } from './lib/response';
import { logger } from './logger';
import { createRateLimiter } from './lib/rateLimiter';
import { authRouter, createInternalRouter } from './routes/auth';
import { filesRouter } from './routes/files';
import { foldersRouter } from './routes/folders';
import { shareRouter } from './routes/share';
import { imagesRouter } from './routes/images';
import roomRoutes from './routes/roomRoutes';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
  });
}

export const generalRateLimit = createRateLimiter({
  limit: 250,
  windowMs: 15 * 60 * 1000,
  prefix: 'dripl:http:general',
});

const authRateLimit = createRateLimiter({
  limit: 10,
  windowMs: 15 * 60 * 1000,
  prefix: 'dripl:http:auth',
});

function setRetryAfter(res: Response, resetAt: number): void {
  res.setHeader('Retry-After', String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
}

export async function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (req.path === '/health' || req.path === '/metrics') {
    next();
    return;
  }
  const identifier =
    (req as Request & { session?: { userId?: string } }).session?.userId ?? req.ip ?? 'anonymous';
  const { success, remaining, resetAt } = await generalRateLimit.limit(identifier);
  if (!success) {
    setRetryAfter(res, resetAt);
    sendError(res, 429, 'RATE_LIMITED', 'Rate limit exceeded');
    return;
  }
  res.setHeader('X-RateLimit-Remaining', remaining);
  next();
}

export async function authRateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const identifier = req.ip ?? 'anonymous';
  const { success, resetAt } = await authRateLimit.limit(identifier);
  if (!success) {
    setRetryAfter(res, resetAt);
    sendError(res, 429, 'RATE_LIMITED', 'Too many attempts, please try again later.');
    return;
  }
  next();
}

export function createApp(): Application {
  const app = express();

  app.get('/health', async (_req, res) => {
    try {
      const { db } = await import('@dripl/db');
      await db.$queryRaw`SELECT 1`;
      res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        ts: Date.now(),
      });
    } catch {
      res.status(503).json({ status: 'error', message: 'Database unreachable', ts: Date.now() });
    }
  });

  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
  app.use(helmet());
  app.use(compression());
  app.use(rateLimitMiddleware);

  const normalizeOrigin = (value: string | undefined): string | null => {
    if (!value) return null;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return parsed.origin;
    } catch {
      return null;
    }
  };
  const allowedOrigins = [process.env.FRONTEND_URL, process.env.NEXT_PUBLIC_APP_URL]
    .flatMap(value => value?.split(',') ?? [])
    .map(normalizeOrigin)
    .filter((value): value is string => value !== null);

  if (process.env.NODE_ENV !== 'production' && !allowedOrigins.includes('http://localhost:3000')) {
    allowedOrigins.push('http://localhost:3000');
  }

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.some(o => origin === o)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS: origin ${origin} not allowed`));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token'],
    })
  );
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(cookieParser());

  app.get('/', (_req, res) => {
    res.json({ service: 'dripl-http', status: 'ok' });
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
  app.use('/api/auth/ws-ticket', validateCsrfToken);

  app.use('/api/auth/login', authRateLimitMiddleware);
  app.use('/api/auth/forgot-password', authRateLimitMiddleware);
  app.use('/api/auth/register', authRateLimitMiddleware);
  app.use('/api/auth/verify-email', authRateLimitMiddleware);
  app.use('/api/auth/resend-verification', authRateLimitMiddleware);
  app.use('/api/auth', authRouter);
  app.use('/api/share', validateCsrfToken, shareRouter);
  app.use('/api/files', validateCsrfToken, authMiddleware, filesRouter);
  app.use('/api/folders', validateCsrfToken, authMiddleware, foldersRouter);
  // roomRoutes exposes the capability-link GET before its internal auth guard.
  app.use('/api/rooms', validateCsrfToken, roomRoutes);
  // Image uploads require auth at the route; downloads are capability-URL
  // based so shared canvases can render their unguessable image assets.
  app.use('/api/images', validateCsrfToken, imagesRouter);

  app.use('/internal', createInternalRouter());

  Sentry.setupExpressErrorHandler(app);

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error(
      { event: 'http_server_error', error: error.message, stack: error.stack },
      'Unhandled HTTP server error'
    );
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  });

  return app;
}
