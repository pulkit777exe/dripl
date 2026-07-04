import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGenerateContent = vi.fn();
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent: mockGenerateContent };
    }
  },
}));

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow() {
      return {};
    }
    limit = vi.fn().mockResolvedValue({ success: true, reset: Date.now() + 60000 });
  },
}));
vi.mock('@upstash/redis', () => ({ Redis: class {} }));

vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');

function successAI() {
  mockGenerateContent.mockResolvedValue({
    response: { text: () => '[{"type":"rectangle","x":100,"y":100}]' },
  });
}

function makeRequest(prompt = 'test', opts?: { cookie?: string; ip?: string }) {
  const headers: Record<string, string> = { origin: 'http://localhost:3000' };
  if (opts?.cookie) headers['cookie'] = `dripl-session=${opts.cookie}`;
  if (opts?.ip) headers['x-forwarded-for'] = opts.ip;
  return new NextRequest('http://localhost:3000/api/ai/generate', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
    headers,
  });
}

describe('AI rate-limit session-based userId enforcement', () => {
  let routeModule: { POST: (request: NextRequest) => Promise<Response> };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    routeModule = await import('@/app/api/ai/generate/route');
    successAI();
  });

  it('uses dripl-session cookie as the rate-limit key', async () => {
    const session = 'user-abc-123';
    for (let i = 0; i < 10; i++) {
      await routeModule.POST(makeRequest('test', { cookie: session }));
    }
    const res = await routeModule.POST(makeRequest('test', { cookie: session }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe('RATE_LIMIT');
  });

  it('different session cookies have independent rate limits', async () => {
    const sessionA = 'session-A';
    const sessionB = 'session-B';

    for (let i = 0; i < 10; i++) {
      await routeModule.POST(makeRequest('test', { cookie: sessionA }));
    }

    const resB = await routeModule.POST(makeRequest('test', { cookie: sessionB }));
    expect(resB.status).toBe(200);
  });

  it('client-supplied userId in body does not affect rate-limit key', async () => {
    const session = 'real-session';
    const hackerSession = 'hacker-session';
    // Exhaust rate limit for real session
    for (let i = 0; i < 10; i++) {
      await routeModule.POST(makeRequest('test', { cookie: session }));
    }
    // Request with real cookie but forged userId in body should still be rate-limited
    const headers: Record<string, string> = {
      origin: 'http://localhost:3000',
      cookie: `dripl-session=${session}`,
    };
    const forgedRequest = new NextRequest('http://localhost:3000/api/ai/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'test', userId: hackerSession }),
      headers,
    });
    const res = await routeModule.POST(forgedRequest);
    expect(res.status).toBe(429);
    // Verify hacker session is NOT rate-limited (proves cookie was used, not body userId)
    const resHacker = await routeModule.POST(makeRequest('test', { cookie: hackerSession }));
    expect(resHacker.status).toBe(200);
  });

  it('anonymous users fall back to IP-based rate limiting', async () => {
    const ip = '192.168.1.100';
    for (let i = 0; i < 10; i++) {
      await routeModule.POST(makeRequest('test', { ip }));
    }
    const res = await routeModule.POST(makeRequest('test', { ip }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe('RATE_LIMIT');
  });

  it('anonymous users with different IPs have independent rate limits', async () => {
    const ip1 = '10.0.0.1';
    const ip2 = '10.0.0.2';

    for (let i = 0; i < 10; i++) {
      await routeModule.POST(makeRequest('test', { ip: ip1 }));
    }

    const res = await routeModule.POST(makeRequest('test', { ip: ip2 }));
    expect(res.status).toBe(200);
  });

  it('anonymous user without x-forwarded-for gets "unknown" key', async () => {
    for (let i = 0; i < 10; i++) {
      await routeModule.POST(makeRequest('test'));
    }
    const res = await routeModule.POST(makeRequest('test'));
    expect(res.status).toBe(429);
  });

  it('session cookie takes precedence over x-forwarded-for', async () => {
    const session = 'priority-session';
    const ip = '172.16.0.1';

    for (let i = 0; i < 10; i++) {
      await routeModule.POST(makeRequest('test', { cookie: session, ip }));
    }

    const resNoCookie = await routeModule.POST(makeRequest('test', { ip }));
    expect(resNoCookie.status).toBe(200);
  });
});
