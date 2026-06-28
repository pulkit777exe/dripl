import { test, expect } from '@playwright/test';

test.describe('Google OAuth Flow', () => {
  test.describe('Login Page - Google Button', () => {
    test('Google button links to local API route', async ({ page }) => {
      await page.goto('/login');

      const googleButton = page.getByRole('link', { name: /continue with google/i });
      await expect(googleButton).toBeVisible();

      const href = await googleButton.getAttribute('href');
      expect(href).toBe('/api/auth/google');
    });

    test('Google button is an anchor tag (navigation link)', async ({ page }) => {
      await page.goto('/login');

      const googleButton = page.getByRole('link', { name: /continue with google/i });
      const tagName = await googleButton.evaluate(el => el.tagName);
      expect(tagName).toBe('A');
    });
  });

  test.describe('Signup Page - Google Button', () => {
    test('Google button links to local API route', async ({ page }) => {
      await page.goto('/signup');

      const googleButton = page.getByRole('link', { name: /continue with google/i });
      await expect(googleButton).toBeVisible();

      const href = await googleButton.getAttribute('href');
      expect(href).toBe('/api/auth/google');
    });
  });

  test.describe('GET /api/auth/google', () => {
    test('redirects to Google OAuth with correct params', async ({ request }) => {
      const response = await request.get('http://localhost:3000/api/auth/google', {
        maxRedirects: 0,
      });

      // The response should be a redirect (302 or 307)
      expect([302, 307]).toContain(response.status());

      const location = response.headers()['location'] || '';
      expect(location).toContain('accounts.google.com');

      const googleUrl = new URL(location);
      expect(googleUrl.searchParams.get('client_id')).toBeTruthy();
      expect(googleUrl.searchParams.get('redirect_uri')).toContain('/api/auth/google/callback');
      expect(googleUrl.searchParams.get('response_type')).toBe('code');
      expect(googleUrl.searchParams.get('scope')).toContain('email');
      expect(googleUrl.searchParams.get('state')).toBeTruthy();
    });

    test('sets oauth_state cookie with correct attributes', async ({ page }) => {
      await page.route('**/accounts.google.com/o/oauth2/v2/auth**', async route => {
        await route.abort();
      });

      await page.goto('/api/auth/google');

      const cookies = await page.context().cookies();
      const stateCookie = cookies.find(c => c.name === 'oauth_state');
      expect(stateCookie).toBeTruthy();
      expect(stateCookie!.httpOnly).toBe(true);
      expect(stateCookie!.path).toBe('/');
    });

    test('generates unique state tokens per request', async ({ page, request }) => {
      // Use API requests instead of full page navigations to avoid redirect chain issues
      const response1 = await request.get('http://localhost:3000/api/auth/google', {
        maxRedirects: 0,
      });
      const setCookie1 = response1.headers()['set-cookie'] || '';
      const state1Match = setCookie1.match(/oauth_state=([^;]+)/);
      expect(state1Match).toBeTruthy();

      const response2 = await request.get('http://localhost:3000/api/auth/google', {
        maxRedirects: 0,
      });
      const setCookie2 = response2.headers()['set-cookie'] || '';
      const state2Match = setCookie2.match(/oauth_state=([^;]+)/);
      expect(state2Match).toBeTruthy();

      expect(state1Match![1]).not.toBe(state2Match![1]);
    });
  });

  test.describe('GET /api/auth/google/callback', () => {
    test('redirects to login on missing state', async ({ page }) => {
      await page.goto(
        '/api/auth/google/callback?code=test_code&state=test_state'
      );

      const url = new URL(page.url());
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('error')).toBe('invalid_state');
    });

    test('redirects to login on state mismatch', async ({ page }) => {
      await page.context().addCookies([
        {
          name: 'oauth_state',
          value: 'correct_state_value',
          domain: 'localhost',
          path: '/',
        },
      ]);

      await page.goto(
        '/api/auth/google/callback?code=test_code&state=wrong_state_value'
      );

      const url = new URL(page.url());
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('error')).toBe('invalid_state');
    });

    test('redirects to login on missing code', async ({ page }) => {
      await page.context().addCookies([
        {
          name: 'oauth_state',
          value: 'test_state',
          domain: 'localhost',
          path: '/',
        },
      ]);

      await page.goto('/api/auth/google/callback?state=test_state');

      const url = new URL(page.url());
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('error')).toBe('missing_code');
    });

    test('redirects to login on Google error response', async ({ page }) => {
      await page.context().addCookies([
        {
          name: 'oauth_state',
          value: 'test_state',
          domain: 'localhost',
          path: '/',
        },
      ]);

      await page.goto(
        '/api/auth/google/callback?state=test_state&error=access_denied'
      );

      const url = new URL(page.url());
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('error')).toBe('google_access_denied');
    });

    test('clears oauth_state cookie after callback', async ({ page }) => {
      await page.context().addCookies([
        {
          name: 'oauth_state',
          value: 'test_state',
          domain: 'localhost',
          path: '/',
        },
      ]);

      await page.goto(
        '/api/auth/google/callback?code=test&state=test_state'
      );

      const cookies = await page.context().cookies();
      const stateCookie = cookies.find(c => c.name === 'oauth_state');
      expect(stateCookie).toBeFalsy();
    });

    test('redirects to login on token exchange failure', async ({ page }) => {
      await page.context().addCookies([
        {
          name: 'oauth_state',
          value: 'test_state',
          domain: 'localhost',
          path: '/',
        },
      ]);

      await page.goto(
        '/api/auth/google/callback?code=fake_auth_code&state=test_state'
      );

      const url = new URL(page.url());
      expect(url.pathname).toBe('/login');
    });
  });

  test.describe('Session cookie after successful auth', () => {
    test('redirects to login with error when http-server is unreachable', async ({
      page,
    }) => {
      await page.context().addCookies([
        {
          name: 'oauth_state',
          value: 'test_state',
          domain: 'localhost',
          path: '/',
        },
      ]);

      // Without http-server, the token exchange may succeed but the
      // http-server call will fail, redirecting to login with error
      await page.goto(
        '/api/auth/google/callback?code=valid_code&state=test_state'
      );

      const url = new URL(page.url());
      expect(url.pathname).toBe('/login');

      // oauth_state cookie should be cleared
      const cookies = await page.context().cookies();
      const stateCookie = cookies.find(c => c.name === 'oauth_state');
      expect(stateCookie).toBeFalsy();
    });

    test('redirects to login with error when code is invalid', async ({ page }) => {
      await page.context().addCookies([
        {
          name: 'oauth_state',
          value: 'integration_test_state',
          domain: 'localhost',
          path: '/',
        },
      ]);

      await page.goto(
        '/api/auth/google/callback?code=integration_code&state=integration_test_state'
      );

      const url = new URL(page.url());
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('error')).toBeTruthy();
    });
  });
});
