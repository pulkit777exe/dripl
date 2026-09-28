import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '../../app/api/auth/google/status/route';
import { getGoogleOAuthConfig } from '../../app/api/auth/google/google-config';

const ORIGINAL_ENV = { ...process.env };

describe('/api/auth/google/status', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'test-id-1234567890.apps.googleusercontent.com');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'GOCSPX-testsecretvalue1234567890');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllEnvs();
  });

  it('reports the redirect URI and only a client ID prefix', async () => {
    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.configured).toBe(true);
    expect(body.redirectUri).toBe('http://localhost:3000/api/auth/google/callback');
    expect(typeof body.clientIdPrefix).toBe('string');
  });

  it('never leaks the secret', async () => {
    const response = await GET();
    const raw = JSON.stringify(await response.json());
    expect(raw).not.toContain('GOCSPX-testsecretvalue1234567890');
    expect(raw).not.toContain('testsecretvalue');
  });

  it('returns 503 when unconfigured', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.configured).toBe(false);
  });
});

describe('getGoogleOAuthConfig', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllEnvs();
  });

  it('throws on missing values instead of sending undefined to Google', () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'x');
    expect(() => getGoogleOAuthConfig()).toThrow(/GOOGLE_CLIENT_ID/);
  });
});
