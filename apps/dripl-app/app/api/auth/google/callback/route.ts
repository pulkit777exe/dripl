import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { signToken } from '@dripl/utils/auth';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const FRONTEND_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const HTTP_SERVER_URL = process.env.HTTP_SERVER_URL || 'http://localhost:3002';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const error = request.nextUrl.searchParams.get('error');

  const cookieStore = await cookies();
  const cookieState = cookieStore.get('oauth_state')?.value;

  // Clear the state cookie regardless of outcome
  cookieStore.delete('oauth_state');

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=google_${error}`, request.url)
    );
  }

  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(
      new URL('/login?error=invalid_state', request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/login?error=missing_code', request.url)
    );
  }

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${FRONTEND_URL}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'google_token_exchange_failed',
          status: tokenResponse.status,
        })
      );
      return NextResponse.redirect(
        new URL('/login?error=token_exchange_failed', request.url)
      );
    }

    const tokens = await tokenResponse.json();
    const idToken = tokens.id_token as string;

    // Call http-server to verify the token and create/get the user
    const authResponse = await fetch(`${HTTP_SERVER_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: idToken }),
    });

    if (!authResponse.ok) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'http_server_google_auth_failed',
          status: authResponse.status,
        })
      );
      return NextResponse.redirect(
        new URL('/login?error=auth_failed', request.url)
      );
    }

    const { user } = (await authResponse.json()) as { user: { id: string } };

    // Sign a session token for the dripl-app domain
    const sessionToken = signToken(user.id);

    // Set session cookie on dripl-app's domain (same-site, works immediately)
    cookieStore.set('dripl-session', sessionToken, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    return NextResponse.redirect(new URL('/dashboard', request.url));
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'google_oauth_callback_error',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return NextResponse.redirect(
      new URL('/login?error=google_failed', request.url)
    );
  }
}
