import { Request, Response, NextFunction } from 'express';
import { verifyToken, signToken, extractBearerToken, type JwtPayload } from '@dripl/utils/auth';
import { loadStoredTokenVersion } from '@dripl/db';
import { sendError } from '../lib/response';
import { logger } from '../logger';

const SESSION_COOKIE = 'dripl-session';

export interface AuthRequest extends Request {
  userId?: string;
}

/**
 * The account every request is authenticated as, or `null`.
 *
 * Asynchronous because `verifyToken` checks the account's token generation and
 * that check needs storage. Express 5 forwards a rejected handler promise to the
 * error middleware, and the `catch` below turns anything that escapes the read
 * into the same 401 an unverifiable token gets -- a database that cannot answer
 * must not become an authenticated request, and it must not become a 500 that
 * tells a caller its token is fine.
 *
 * This is the only place in http-server that accepts a session token, so it is
 * also the only place that has to reject a revoked one: every authenticated
 * router is mounted behind it (`app.ts`), and the two routes that carry their own
 * guard are `GET /api/auth/me`, `PUT /api/auth/profile`,
 * `POST /api/auth/change-password` and `POST /api/auth/ws-ticket`, all of which
 * sit behind the same function.
 */
export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = extractToken(req);

    if (!token) {
      sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
      return;
    }

    const decoded = await verifyToken(token, loadStoredTokenVersion);
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

/**
 * Who the request is authenticated as, without failing it.
 *
 * The counterpart to `authMiddleware` for the one route that must answer
 * something useful without a usable credential: logout. `authMiddleware` treats
 * an unverifiable token as a refusal, which is right for every route that grants
 * something, but logout grants nothing -- it clears a cookie and moves a counter
 * -- so a stale, expired or already-revoked token still deserves the cookie
 * cleared and a 200.
 *
 * Split out here, and named for what it returns, so that "refuse unless the token
 * verifies" stays the default everywhere else: a route that wants identity has to
 * ask for this by name.
 */
export async function identifySession(req: Request): Promise<JwtPayload | null> {
  const token = extractToken(req);
  if (!token) return null;
  try {
    return await verifyToken(token, loadStoredTokenVersion);
  } catch (error) {
    // Deliberately not `logger.error`: a logout with an unreadable token is not
    // an incident, it is somebody clearing a cookie.
    logger.warn({ event: 'session_identify_failed', error }, 'Could not identify session');
    return null;
  }
}

export const generateToken = signToken;

export type { JwtPayload };

export function signSessionToken(userId: string, tokenVersion: number): string {
  return signToken(userId, tokenVersion);
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
