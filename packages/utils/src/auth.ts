import jwt from 'jsonwebtoken';
import { requiredEnv } from './env';

const getJwtSecret = () => requiredEnv('JWT_SECRET');

export interface JwtPayload {
  userId: string;
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload & JwtPayload;
    if (!decoded.userId) return null;
    return { userId: decoded.userId };
  } catch {
    return null;
  }
}

export function signToken(userId: string): string {
  return jwt.sign({ userId }, getJwtSecret(), { expiresIn: '7d' });
}

export function extractBearerToken(
  authHeader: string | undefined,
): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}
