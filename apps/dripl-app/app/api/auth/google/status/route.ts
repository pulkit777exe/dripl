import { NextResponse } from 'next/server';
import { getGoogleOAuthConfig, googleOAuthStatus } from '../google-config';

/**
 * Public-safe OAuth diagnostics. Returns the client ID prefix (client IDs
 * are public by design — they appear in the authorize URL) and the redirect
 * URI the running process derives, so a stale server (edited .env, forgot
 * restart) is distinguishable from bad console values in seconds. The
 * secret is never included; a test asserts that.
 */
export async function GET() {
  try {
    return NextResponse.json(googleOAuthStatus(getGoogleOAuthConfig()));
  } catch {
    return NextResponse.json(
      { configured: false, clientIdPrefix: null, redirectUri: null },
      { status: 503 }
    );
  }
}
