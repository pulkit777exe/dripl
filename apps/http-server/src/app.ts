import cookieParser from 'cookie-parser';
import compression from 'compression';
import cors from 'cors';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { validateCsrfToken, generateCsrfToken } from './middlewares/csrfMiddleware';
import { authMiddleware } from './middlewares/authMiddleware';
import { sendError } from './lib/response';
import { authRouter, createInternalRouter } from './routes/auth';
import { filesRouter } from './routes/files';
import { foldersRouter } from './routes/folders';
import { shareRouter } from './routes/share';
import { imagesRouter } from './routes/images';
import roomRoutes from './routes/roomRoutes';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export const generalRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(250, '15 m'),
  prefix: 'dripl:http:general',
});

const authRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '15 m'),
  prefix: 'dripl:http:auth',
});

export async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const identifier = (req as Request & { session?: { userId?: string } }).session?.userId ?? req.ip ?? 'anonymous';
  const { success, remaining } = await generalRateLimit.limit(identifier);
  if (!success) {
    sendError(res, 429, 'RATE_LIMITED', 'Rate limit exceeded');
    return;
  }
  res.setHeader('X-RateLimit-Remaining', remaining);
  next();
}

export async function authRateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const identifier = req.ip ?? 'anonymous';
  const { success } = await authRateLimit.limit(identifier);
  if (!success) {
    sendError(res, 429, 'RATE_LIMITED', 'Too many attempts, please try again later.');
    return;
  }
  next();
}

export function createApp(): Application {
  const app = express();

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', ts: Date.now() });
  });

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(compression());
  app.use(rateLimitMiddleware);

  const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
  ].filter(Boolean) as string[];

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.some(o => origin.startsWith(o))) {
          callback(null, true);
        } else {
          callback(new Error(`CORS: origin ${origin} not allowed`));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
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

  app.use('/api/auth/login', authRateLimitMiddleware);
  app.use('/api/auth/forgot-password', authRateLimitMiddleware);
  app.use('/api/auth', authRouter);
  app.use('/api/share', validateCsrfToken, shareRouter);
  app.use('/api/files', validateCsrfToken, authMiddleware, filesRouter);
  app.use('/api/folders', validateCsrfToken, authMiddleware, foldersRouter);
  app.use('/api/rooms', validateCsrfToken, authMiddleware, roomRoutes);
  app.use('/api/images', validateCsrfToken, authMiddleware, imagesRouter);

  app.use('/internal', createInternalRouter());

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'http_server_error',
        error: error.message,
        stack: error.stack,
      }),
    );
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  });

  return app;
}
