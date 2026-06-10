import { verifyToken } from '@dripl/utils/auth';

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
  const payload = verifyToken(token);
  if (!payload) {
    log('warn', 'token_verification_failed');
    return null;
  }
  return payload.userId;
}
