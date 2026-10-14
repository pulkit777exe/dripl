import { parseAllowedOrigins } from '@dripl/utils/origin';

/**
 * The one allowlist every HTTP boundary in http-server checks an `Origin`
 * against: the CORS policy in `app.ts` and the same-origin check on
 * `POST /api/auth/google` in `routes/auth.ts`.
 *
 * Previously the CORS allowlist lived inline in `app.ts`. Extracted — not
 * duplicated — so the two checks cannot drift: a frontend origin added here
 * is admitted by both, and one removed is refused by both.
 *
 * Sources mirror what CORS always used: `FRONTEND_URL` and
 * `NEXT_PUBLIC_APP_URL`, each optionally a comma-separated list, with
 * anything unparseable dropped. Outside production the local dev frontend is
 * admitted, exactly as before.
 */
export function getAllowedOrigins(): string[] {
  const allowed = parseAllowedOrigins([
    process.env.FRONTEND_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ]);

  if (process.env.NODE_ENV !== 'production' && !allowed.includes('http://localhost:3000')) {
    allowed.push('http://localhost:3000');
  }

  return allowed;
}
