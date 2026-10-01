import jwt from 'jsonwebtoken';
import { requiredEnv } from './env';

const getJwtSecret = () => requiredEnv('JWT_SECRET');

export interface JwtPayload {
  userId: string;
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload & JwtPayload;
    if (!decoded.userId) return null;
    return { userId: decoded.userId };
  } catch {
    return null;
  }
}

export function signToken(userId: string): string {
  return jwt.sign({ userId }, getJwtSecret(), { expiresIn: '7d', algorithm: 'HS256' });
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  // RFC 7235: the auth-scheme is case-insensitive ("bearer <tok>" is valid),
  // one or more spaces separate scheme from token, and token68 contains no
  // whitespace. Rejects non-Bearer schemes outright.
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authHeader);
  return match?.[1] ?? null;
}
