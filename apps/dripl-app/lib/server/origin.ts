import type { NextRequest } from 'next/server';
import { normalizeOrigin, parseAllowedOrigins } from '@dripl/utils/origin';

export { normalizeOrigin };

/**
 * Single origin policy for all dripl-app BFF routes. Previously each route
 * hand-rolled its own: the AI route had a multi-origin allowlist with no Host
 * trust, while snapshots/rooms allowed a missing Origin outside production.
 * A missing Origin on a cookie-authenticated POST is exactly the case an
 * origin check exists to catch (browsers always send it on same-origin
 * POSTs), so all routes now enforce presence. In development the allowed set
 * falls back to the request's own origin (i.e. localhost), never to the
 * Host header in production.
 *
 * `normalizeOrigin` itself lives in `@dripl/utils/origin` (re-exported
 * above) alongside the http-server CORS allowlist so the two cannot drift;
 * this module owns only the Next-specific allowlist policy around it.
 */
export function getAllowedOrigins(request: NextRequest): Set<string> {
  const configured = parseAllowedOrigins([
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.FRONTEND_URL,
  ]);

  if (configured.length > 0) return new Set(configured);

  // Development fallback only. Production should always set one of the
  // explicit public origins above; trusting a request Host header in
  // production would make the CSRF check attacker-controlled.
  if (process.env.NODE_ENV === 'production') return new Set();
  const requestOrigin = normalizeOrigin(request.nextUrl.origin);
  return requestOrigin ? new Set([requestOrigin]) : new Set();
}

export function hasAllowedOrigin(request: NextRequest): boolean {
  const origin = normalizeOrigin(request.headers.get('origin'));
  return origin !== null && getAllowedOrigins(request).has(origin);
}
