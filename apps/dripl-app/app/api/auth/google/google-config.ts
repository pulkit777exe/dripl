/**
 * Single source for Google OAuth configuration on the Next.js side.
 *
 * Reads are lazy (per call, not module load) and validated: the previous
 * code captured `process.env.GOOGLE_CLIENT_ID!` at import time, so a missing
 * variable became the literal string "undefined" in the Google request and
 * surfaced as a cryptic `invalid_client` instead of a startup error.
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
  const frontendUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

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
