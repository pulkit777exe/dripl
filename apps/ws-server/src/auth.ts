import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || '';

function log(level: string, event: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ level, event, ...data }));
}

export function resolveTokenFromUrl(reqUrl: string | undefined, host: string | undefined): string | null {
  if (!reqUrl || !host) return null;
  try {
    const url = new URL(reqUrl, `http://${host}`);
    return url.searchParams.get('token');
  } catch {
    log('warn', 'token_parse_failed');
    return null;
  }
}

export function resolveUserFromToken(token: string | null): string | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId?: string };
    return decoded.userId ?? null;
  } catch {
    log('warn', 'token_verification_failed');
    return null;
  }
}
