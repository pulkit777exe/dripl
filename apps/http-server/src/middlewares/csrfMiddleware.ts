import crypto from 'node:crypto';
import { type NextFunction, type Request, type Response } from 'express';
import { sendError } from '../lib/response';

const CSRF_TOKEN_BYTES = 32;
const CSRF_HEADER = 'x-csrf-token';

export function generateCsrfToken(res: Response): string {
  const token = crypto.randomBytes(CSRF_TOKEN_BYTES).toString('hex');
  const configuredFrontend = process.env.FRONTEND_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '';
  const isLocalFrontend = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(
    configuredFrontend
  );
  const secure =
    configuredFrontend.startsWith('https://') ||
    (process.env.NODE_ENV === 'production' && !isLocalFrontend);
  res.cookie('csrf-token', token, {
    httpOnly: false,
    secure,
    sameSite: secure ? 'none' : 'lax',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
  });
  return token;
}

export function validateCsrfToken(req: Request, res: Response, next: NextFunction): void {
  const isSafeMethod = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';

  if (isSafeMethod) {
    return next();
  }

  const csrfCookie = req.cookies?.['csrf-token'];
  const csrfHeader = req.headers[CSRF_HEADER] as string | undefined;

  if (!csrfCookie || !csrfHeader) {
    sendError(res, 403, 'CSRF_TOKEN_MISSING', 'CSRF token missing');
    return;
  }

  const a = Buffer.from(csrfCookie);
  const b = Buffer.from(csrfHeader);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    sendError(res, 403, 'CSRF_TOKEN_INVALID', 'CSRF token invalid');
    return;
  }

  next();
}
