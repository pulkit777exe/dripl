import { normalizeOrigin } from '@dripl/utils/origin';

/**
 * Single source for Google OAuth configuration on the Next.js side.
 *
 * Reads are lazy (per call, not module load) and validated: the previous
 * code captured `process.env.GOOGLE_CLIENT_ID!` at import time, so a missing
 * variable became the literal string "undefined" in the Google request and
 * surfaced as a cryptic `invalid_client` instead of a startup error.
 *
 * `NEXT_PUBLIC_APP_URL` is normalized through the shared origin parser before
 * it is interpolated into the redirect URI: Google matches that URI against a
 * registered list *exactly*, so a trailing slash in the env var used to yield
 * `https://host//api/auth/google/callback` — a `redirect_uri_mismatch` that
 * only reproduced with a sloppy production value. An unparseable value now
 * falls back to the local origin instead of reaching Google at all.
 */
export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  frontendUrl: string;
  redirectUri: string;
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const frontendUrl = normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL) ?? 'http://localhost:3000';

  const missing = [!clientId && 'GOOGLE_CLIENT_ID', !clientSecret && 'GOOGLE_CLIENT_SECRET'].filter(
    Boolean
  );
  if (missing.length > 0) {
    throw new Error(`Google OAuth is not configured (missing: ${missing.join(', ')})`);
  }

  const redirectUri = `${frontendUrl}/api/auth/google/callback`;
  return { clientId: clientId!, clientSecret: clientSecret!, frontendUrl, redirectUri };
}

/** Public-safe summary for the status endpoint. Never includes the secret. */
export function googleOAuthStatus(config: GoogleOAuthConfig): {
  configured: boolean;
  clientIdPrefix: string;
  redirectUri: string;
} {
  return {
    configured: true,
    clientIdPrefix: config.clientId.slice(0, 12),
    redirectUri: config.redirectUri,
  };
}
