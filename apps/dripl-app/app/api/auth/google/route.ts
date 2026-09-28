import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getGoogleOAuthConfig } from './google-config';

export async function GET(request: NextRequest) {
  let clientId: string;
  let redirectUri: string;
  let frontendUrl: string;
  try {
    ({ clientId, redirectUri, frontendUrl } = getGoogleOAuthConfig());
  } catch {
    // eslint-disable-next-line no-console -- server-side auth failure telemetry
    console.error(JSON.stringify({ level: 'error', event: 'google_oauth_not_configured' }));
    return NextResponse.redirect(new URL('/login?error=oauth_not_configured', request.url));
  }
  const state = crypto.randomUUID();
  const requestedNext = request.nextUrl.searchParams.get('next');
  const nextPath =
    requestedNext?.startsWith('/') && !requestedNext.startsWith('//')
      ? requestedNext
      : '/dashboard';

  const cookieStore = await cookies();
  cookieStore.set('oauth_state', state, {
    httpOnly: true,
    maxAge: 600, // 10 minutes
    path: '/',
    sameSite: 'lax',
    secure: frontendUrl.startsWith('https://'),
  });
  cookieStore.set('oauth_next', nextPath, {
    httpOnly: true,
    maxAge: 600,
    path: '/',
    sameSite: 'lax',
    secure: frontendUrl.startsWith('https://'),
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return NextResponse.redirect(googleAuthUrl);
}
