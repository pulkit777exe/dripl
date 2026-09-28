import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getGoogleOAuthConfig } from '../google-config';

const configuredHttpServerUrl = process.env.HTTP_SERVER_URL || 'http://localhost:3002';
const HTTP_SERVER_URL = configuredHttpServerUrl.replace(/\/$/, '').replace(/\/api$/, '');

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const error = request.nextUrl.searchParams.get('error');

  const cookieStore = await cookies();
  const cookieState = cookieStore.get('oauth_state')?.value;
  const cookieNext = cookieStore.get('oauth_next')?.value;
  const nextPath =
    cookieNext?.startsWith('/') && !cookieNext.startsWith('//') ? cookieNext : '/dashboard';

  // Clear the state cookies regardless of outcome
  cookieStore.delete('oauth_state');
  cookieStore.delete('oauth_next');

  if (error) {
    return NextResponse.redirect(new URL(`/login?error=google_${error}`, request.url));
  }

  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(new URL('/login?error=invalid_state', request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', request.url));
  }

  let oauth: { clientId: string; clientSecret: string; frontendUrl: string; redirectUri: string };
  try {
    oauth = getGoogleOAuthConfig();
  } catch {
    // eslint-disable-next-line no-console -- server-side auth failure telemetry
    console.error(JSON.stringify({ level: 'error', event: 'google_oauth_not_configured' }));
    return NextResponse.redirect(new URL('/login?error=oauth_not_configured', request.url));
  }

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        redirect_uri: oauth.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();

      // Google's error class is the only thing that distinguishes the three real
      // causes, so surface it instead of collapsing them into one string.
      let googleError: string | undefined;
      try {
        googleError = (JSON.parse(errorBody) as { error?: string }).error;
      } catch {
        // A non-JSON body (proxy error page, for example) is itself the signal.
      }

      // `hasClientSecret` used to be reported here and was worse than useless: it
      // is true for a secret that is present and rejected, so it read as a
      // success signal. Length and the Google prefix shape actually tell you
      // something.
      const secretLooksRight = /^GOCSPX-/.test(oauth.clientSecret ?? '');

      // eslint-disable-next-line no-console -- server-side auth failure telemetry
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'google_token_exchange_failed',
          status: tokenResponse.status,
          googleError,
          body: errorBody,
          redirectUri: oauth.redirectUri,
          clientIdPresent: !!oauth.clientId,
          clientSecretLength: oauth.clientSecret?.length ?? 0,
          clientSecretLooksWellFormed: secretLooksRight,
        })
      );

      // Keep the generic query param the UI already handles, and put the specific
      // reason in the log so a failure is diagnosable without a code change.
      return NextResponse.redirect(new URL('/login?error=token_exchange_failed', request.url));
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
      // eslint-disable-next-line no-console -- server-side auth failure telemetry
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'http_server_google_auth_failed',
          status: authResponse.status,
        })
      );
      return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
    }

    const { sessionToken } = (await authResponse.json()) as { sessionToken: string };

    const redirectUrl = new URL(nextPath, request.url);
    const response = NextResponse.redirect(redirectUrl);

    // Set session cookie on the Vercel domain (non-httpOnly so client can read it
    // and send as Authorization header for cross-origin requests to http-server)
    const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const secureCookie =
      request.nextUrl.protocol === 'https:' ||
      forwardedProtocol === 'https' ||
      oauth.frontendUrl.startsWith('https://');
    response.cookies.set('dripl-session', sessionToken, {
      httpOnly: false,
      secure: secureCookie,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return response;
  } catch (err) {
    // eslint-disable-next-line no-console -- server-side auth failure telemetry
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'google_oauth_callback_error',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return NextResponse.redirect(new URL('/login?error=google_failed', request.url));
  }
}
