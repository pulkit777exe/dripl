import { Request, Response, NextFunction } from 'express';
import { verifyToken, signToken, type JwtPayload } from '@dripl/utils/auth';
import { sendError } from '../lib/response';

const SESSION_COOKIE = 'dripl-session';

export interface AuthRequest extends Request {
  userId?: string;
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction): void => {
  try {
    const token =
      req.cookies?.['dripl-session'] ||
      req.headers.authorization?.split(' ')[1];

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
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'auth_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    sendError(res, 401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
};

export const generateToken = signToken;

export type { JwtPayload };

export function signSessionToken(userId: string): string {
  return signToken(userId);
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

export function extractToken(req: Request): string | null {
  const cookieToken = req.cookies?.[SESSION_COOKIE];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }

  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length);
  }

  return null;
}

export type AuthenticatedRequest = AuthRequest;
