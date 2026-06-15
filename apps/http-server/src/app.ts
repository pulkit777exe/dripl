import cookieParser from 'cookie-parser';
import compression from 'compression';
import cors from 'cors';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { validateCsrfToken, generateCsrfToken } from './middlewares/csrfMiddleware';
import { authMiddleware } from './middlewares/authMiddleware';
import { authRouter } from './routes/auth';
import { filesRouter } from './routes/files';
import { foldersRouter } from './routes/folders';
import { shareRouter } from './routes/share';
import { imagesRouter } from './routes/images';
import roomRoutes from './routes/roomRoutes';

export function createApp(): Application {
  const app = express();
  const frontendUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(compression());
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 250,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

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
    }),
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
      }),
    );
    res.status(500).json({
      error: 'Internal server error',
    });
  });

  return app;
}
