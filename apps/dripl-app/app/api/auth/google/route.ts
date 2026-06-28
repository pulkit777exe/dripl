import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const FRONTEND_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export async function GET() {
  const state = crypto.randomUUID();

  const cookieStore = await cookies();
  cookieStore.set('oauth_state', state, {
    httpOnly: true,
    maxAge: 600, // 10 minutes
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  const redirectUri = `${FRONTEND_URL}/api/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
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
