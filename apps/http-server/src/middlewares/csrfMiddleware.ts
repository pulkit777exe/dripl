import crypto from 'crypto';
import { type Request, type Response } from 'express';

const CSRF_TOKEN_BYTES = 32;
const CSRF_HEADER = 'x-csrf-token';

export function generateCsrfToken(res: Response): string {
  const token = crypto.randomBytes(CSRF_TOKEN_BYTES).toString('hex');
  res.cookie('csrf-token', token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
  });
  return token;
}

export function validateCsrfToken(req: Request, res: Response, next: Function): void {
  const isSafeMethod = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';

  if (isSafeMethod) {
    return next();
  }

  const csrfCookie = req.cookies?.['csrf-token'];
  const csrfHeader = req.headers[CSRF_HEADER] as string | undefined;

  if (!csrfCookie || !csrfHeader) {
    res.status(403).json({ error: 'CSRF token missing' });
    return;
  }

  const a = Buffer.from(csrfCookie);
  const b = Buffer.from(csrfHeader);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(403).json({ error: 'CSRF token invalid' });
    return;
  }

  next();
}