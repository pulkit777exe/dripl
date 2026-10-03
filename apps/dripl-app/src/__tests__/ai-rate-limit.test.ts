import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { signToken } from '@dripl/utils/auth';

const mockGenerateContent = vi.fn();
const mockLimit = vi.fn();
const mockLimiterOptions: unknown[] = [];

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

    constructor(options: unknown) {
      mockLimiterOptions.push(options);
    }

    limit = mockLimit;
  },
}));
vi.mock('@upstash/redis', () => ({ Redis: class {} }));

/**
 * `/api/ai/generate` identifies its caller by resolving the token's stored
 * generation through `@dripl/db`, before it will accept a request at all. Every
 * user id this file signs a token for is listed below at generation 0; an unlisted
 * subject is refused, which is the behaviour `accepts a valid bearer token when a
 * cookie is not available` and its two siblings depend on.
 */
const KNOWN_USERS = [
  'user-a',
  'user-b',
  'real-user',
  'bearer-user',
  'expiring-user',
  'distributed-user',
];

const { sessionStore } = vi.hoisted(() => ({
  sessionStore: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        KNOWN_USERS.includes(where.id) ? { tokenVersion: 0 } : null,
      update: async () => ({ tokenVersion: 0 }),
    },
  },
}));

vi.mock('@dripl/db', async () => {
  const { revocationExports } = await import('./helpers/revocation');
  return { ...(await revocationExports(sessionStore as never)) };
});

const TEST_JWT_SECRET = 'test-jwt-secret-for-ai-rate-limit-tests';
vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
vi.stubEnv('JWT_SECRET', TEST_JWT_SECRET);
vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');

function successAI() {
  mockGenerateContent.mockResolvedValue({
    response: { text: () => '[{"type":"rectangle","x":100,"y":100}]' },
  });
}

function makeRequest(
  prompt = 'test',
  opts?: { token?: string; userId?: string; ip?: string; authorization?: string }
) {
  const headers: Record<string, string> = { origin: 'http://localhost:3000' };
  const token = opts?.token ?? signToken('user-a', 0);
  if (token) headers.cookie = `dripl-session=${token}`;
  if (opts?.authorization) headers.authorization = opts.authorization;
  if (opts?.ip) headers['x-forwarded-for'] = opts.ip;
  return new NextRequest('http://localhost:3000/api/ai/generate', {
    method: 'POST',
    body: JSON.stringify({ prompt, ...(opts?.userId ? { userId: opts.userId } : {}) }),
    headers,
  });
}

describe('AI rate limiting and identity enforcement', () => {
  let routeModule: {
    POST: (request: NextRequest) => Promise<Response>;
    clearAiRateLimitState: () => void;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockLimiterOptions.length = 0;
    mockLimit.mockResolvedValue({ success: true, reset: Date.now() + 60_000 });
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    vi.resetModules();
    routeModule = await import('@/app/api/ai/generate/route');
    routeModule.clearAiRateLimitState();
    successAI();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    vi.stubEnv('JWT_SECRET', TEST_JWT_SECRET);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
  });

  it('uses the verified JWT user as the local rate-limit key', async () => {
    const token = signToken('user-a', 0);
    for (let i = 0; i < 10; i++) {
      const response = await routeModule.POST(makeRequest('test', { token }));
      expect(response.status).toBe(200);
    }

    const response = await routeModule.POST(makeRequest('test', { token }));
    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe('RATE_LIMIT');
  });

  it('does not let a client-supplied userId rotate the rate-limit bucket', async () => {
    const token = signToken('real-user', 0);
    for (let i = 0; i < 10; i++) {
      await routeModule.POST(makeRequest('test', { token }));
    }

    const response = await routeModule.POST(
      makeRequest('test', { token, userId: 'attacker-user' })
    );
    expect(response.status).toBe(429);
    expect(mockGenerateContent).toHaveBeenCalledTimes(10);
  });

  it('gives different signed users independent buckets', async () => {
    const tokenA = signToken('user-a', 0);
    const tokenB = signToken('user-b', 0);
    for (let i = 0; i < 10; i++) {
      await routeModule.POST(makeRequest('test', { token: tokenA }));
    }

    const response = await routeModule.POST(makeRequest('test', { token: tokenB }));
    expect(response.status).toBe(200);
  });

  it('rejects missing and invalid sessions instead of falling back to an IP bucket', async () => {
    const missing = await routeModule.POST(makeRequest('test', { token: '' }));
    const invalid = await routeModule.POST(makeRequest('test', { token: 'not-a-jwt' }));
    const spoofedIp = await routeModule.POST(
      makeRequest('test', { token: '', ip: '203.0.113.10' })
    );

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(spoofedIp.status).toBe(401);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('accepts a valid bearer token when a cookie is not available', async () => {
    const token = signToken('bearer-user', 0);
    const response = await routeModule.POST(
      makeRequest('test', { token: '', authorization: `Bearer ${token}` })
    );

    expect(response.status).toBe(200);
  });

  it('expires local buckets and cleans their state without a long-lived timer', async () => {
    const token = signToken('expiring-user', 0);
    for (let i = 0; i < 10; i++) {
      await routeModule.POST(makeRequest('test', { token }));
    }
    expect((await routeModule.POST(makeRequest('test', { token }))).status).toBe(429);

    vi.advanceTimersByTime(60 * 60 * 1_000 + 1);
    expect((await routeModule.POST(makeRequest('test', { token }))).status).toBe(200);

    routeModule.clearAiRateLimitState();
    expect((await routeModule.POST(makeRequest('test', { token }))).status).toBe(200);
  });

  it('uses the verified user ID, not the raw JWT, as the distributed limiter identifier', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token');
    routeModule.clearAiRateLimitState();
    mockLimit.mockResolvedValue({ success: false, reset: Date.now() + 60_000 });

    const token = signToken('distributed-user', 0);
    const response = await routeModule.POST(makeRequest('test', { token, userId: 'forged-user' }));

    expect(response.status).toBe(429);
    expect(mockLimit).toHaveBeenCalledWith('user:distributed-user');
    expect(mockLimit).not.toHaveBeenCalledWith(expect.stringContaining(token));
  });

  it('fails closed when the configured distributed limiter is unavailable', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token');
    routeModule.clearAiRateLimitState();
    mockLimit.mockRejectedValue(new Error('redis unavailable'));

    const response = await routeModule.POST(makeRequest('test'));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('RATE_LIMIT_UNAVAILABLE');
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });
});
