import { Request, Response, NextFunction } from 'express';
import { verifyToken, signToken, extractBearerToken, type JwtPayload } from '@dripl/utils/auth';
import { sendError } from '../lib/response';
import { logger } from '../logger';

const SESSION_COOKIE = 'dripl-session';

export interface AuthRequest extends Request {
  userId?: string;
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction): void => {
  try {
    const token = extractToken(req);

    if (!token) {
      sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
      return;
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      sendError(res, 401, 'UNAUTHORIZED', 'Invalid or expired token');
      return;
    }
    req.userId = decoded.userId;
    next();
  } catch (error) {
    logger.error({ event: 'auth_error', error }, 'Auth middleware error');
    sendError(res, 401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
};

export const generateToken = signToken;

export type { JwtPayload };

export function signSessionToken(userId: string): string {
  return signToken(userId);
}

function sessionCookieSecurity(): { secure: boolean; sameSite: 'lax' | 'none' } {
  const configuredFrontend = process.env.FRONTEND_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '';
  const isLocalFrontend = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(
    configuredFrontend
  );
  const secure =
    configuredFrontend.startsWith('https://') ||
    (process.env.NODE_ENV === 'production' && !isLocalFrontend);
  return { secure, sameSite: secure ? 'none' : 'lax' };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    ...sessionCookieSecurity(),
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    ...sessionCookieSecurity(),
    path: '/',
  });
}

export function extractToken(req: Request): string | null {
  const cookieToken = req.cookies?.[SESSION_COOKIE];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }
  return extractBearerToken(req.headers.authorization);
}

export type AuthenticatedRequest = AuthRequest;
