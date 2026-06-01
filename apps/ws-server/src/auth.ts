import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || '';

export function resolveTokenFromUrl(reqUrl: string | undefined, host: string | undefined): string | null {
  if (!reqUrl || !host) return null;
  try {
    const url = new URL(reqUrl, `http://${host}`);
    return url.searchParams.get('token');
  } catch {
    return null;
  }
}

export function resolveUserFromToken(token: string | null): string | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId?: string };
    return decoded.userId ?? null;
  } catch {
    return null;
  }
}
