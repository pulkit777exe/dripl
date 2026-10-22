/**
 * Canonical internal HTTP API base for Next.js BFF routes.
 *
 * `HTTP_SERVER_URL` is shared with ws-server and is now the only documented
 * setting. `API_SERVER_URL` remains as a compatibility fallback for existing
 * deployments, but should not be added to new environment files.
 */
export function apiBaseUrl(): string {
  const configured =
    process.env.HTTP_SERVER_URL ??
    process.env.API_SERVER_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:3002';
  const base = configured.replace(/\/$/, '');
  return base.endsWith('/api') ? base : `${base}/api`;
}
