import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { signToken } from '@dripl/utils/auth';

/**
 * The gaps in `/api/ai/generate` that `ai-generate.test.ts` and
 * `ai-rate-limit.test.ts` leave open. That file is about prompts and element
 * shapes; this one is about the ordering of the gates in front of a *paid* call
 * — configuration, declared size, retry policy and upstream classification —
 * because each of those gates decides whether money is spent, and a gate that
 * is skipped fails silently rather than loudly.
 */

const mockGenerateContent = vi.fn();
const mockLimit = vi.fn();

const { limiterState } = vi.hoisted(() => ({
  limiterState: {
    /** When true, `new Ratelimit(...)` throws, standing in for a bad provider. */
    constructionFails: false,
    constructions: 0,
  },
}));

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

    constructor() {
      if (limiterState.constructionFails) throw new Error('redis is misconfigured');
      limiterState.constructions += 1;
    }

    limit = mockLimit;
  },
}));

vi.mock('@upstash/redis', () => ({ Redis: class {} }));

const KNOWN_USERS = ['user-123', 'long-subject-user'];

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

const TEST_JWT_SECRET = 'test-jwt-secret-for-ai-generate-gaps';
const MAX_PROMPT_LENGTH = 2_000;
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_AI_ELEMENTS = 100;

/** One valid element, as the model is expected to emit it. */
const GOOD_ELEMENT = '{"type":"rectangle","x":100,"y":100,"width":120,"height":80}';

/** `n` copies of a malformed arrow appended to one good rectangle. */
function modelOutputWithBadArrows(count: number): string {
  const bad = Array.from(
    { length: count },
    () => '{"type":"arrow","x":1,"y":2,"points":[["x",1]]}'
  );
  return `[${GOOD_ELEMENT},${bad.join(',')}]`;
}

function makeRequest(
  body: BodyInit,
  options?: { headers?: Record<string, string>; userId?: string; signal?: AbortSignal }
) {
  const userId = options?.userId ?? 'user-123';
  return new NextRequest('http://localhost:3000/api/ai/generate', {
    method: 'POST',
    body,
    signal: options?.signal,
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
      cookie: `dripl-session=${signToken(userId, 0)}`,
      ...options?.headers,
    },
  });
}

describe('/api/ai/generate — gate ordering, retry and upstream classification', () => {
  let routeModule: {
    POST: (request: NextRequest) => Promise<Response>;
    clearAiRateLimitState: () => void;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockLimit.mockReset();
    mockGenerateContent.mockReset();
    mockGenerateContent.mockResolvedValue({
      response: { text: () => `[${GOOD_ELEMENT}]` },
    });
    mockLimit.mockResolvedValue({ success: true, reset: Date.now() + 60_000 });
    vi.resetModules();
    vi.stubEnv('JWT_SECRET', TEST_JWT_SECRET);
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    routeModule = await import('@/app/api/ai/generate/route');
    routeModule.clearAiRateLimitState();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('JWT_SECRET', TEST_JWT_SECRET);
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
  });

  /* ------------------------------------------------------------------ *
   * Configuration gates, in order
   * ------------------------------------------------------------------ */

  it('answers 503 AUTH_CONFIG_ERROR with no JWT secret, before authenticating anyone', async () => {
    const request = makeRequest(JSON.stringify({ prompt: 'hello' }));
    vi.stubEnv('JWT_SECRET', '');

    const response = await routeModule.POST(request);

    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('AUTH_CONFIG_ERROR');
    // Regression: with no secret, `verifyToken` cannot succeed, so a signed-in
    // user is answered 401 AUTH_REQUIRED — a message that says their session
    // ended. That is precisely the outcome the function's own docstring rejects:
    // it hides a deployment outage behind an auth error, and users log out.
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('answers 503 CONFIG_ERROR with no Gemini key and never calls the model', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');

    const response = await routeModule.POST(makeRequest(JSON.stringify({ prompt: 'hello' })));

    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('CONFIG_ERROR');
    // Regression: without this gate the route constructs a Gemini client with an
    // empty key and spends a round trip per request to be told the key is
    // invalid. Distinct from AUTH_ERROR (502) so an operator can tell a missing
    // variable from a rejected one.
  });

  it('answers 503 RATE_LIMIT_UNAVAILABLE, and spends nothing, when the limiter cannot be built', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token');
    mockLimit.mockRejectedValue(new Error('redis unreachable'));

    const response = await routeModule.POST(makeRequest(JSON.stringify({ prompt: 'hello' })));

    // Regression: this is the money path. If a configured-but-failing limiter
    // fell through to Gemini, an attacker drives unbounded spend during a Redis
    // outage — the outage being the ideal moment to do it. Fail closed.
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('RATE_LIMIT_UNAVAILABLE');
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('spends the call when the shared limiter approves it', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token');
    mockLimit.mockResolvedValue({ success: true, reset: Date.now() + 60_000 });

    const response = await routeModule.POST(makeRequest(JSON.stringify({ prompt: 'hello' })));

    // Regression: the success arm of the shared limiter is the one that has to
    // reach Gemini. A mutation that returns `{allowed:false}` or falls through to
    // the local window on success would 429 every user on a healthy Redis.
    expect(response.status).toBe(200);
    expect(mockLimit).toHaveBeenCalledWith('user:user-123');
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  /* ------------------------------------------------------------------ *
   * Size and shape of the request
   * ------------------------------------------------------------------ */

  it('refuses a declared content-length over 32 kB even when the body is small', async () => {
    const response = await routeModule.POST(
      makeRequest(JSON.stringify({ prompt: 'hello' }), {
        headers: { 'content-length': String(MAX_REQUEST_BYTES + 1) },
      })
    );

    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe('PAYLOAD_TOO_LARGE');
    // Regression: the declared-length fast path is a separate branch from the
    // streaming reader. `new Request(...)` does not set Content-Length, so no
    // test that builds a request the ordinary way ever enters it — meaning it
    // could be deleted (or its bound loosened) without anything failing.
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON without calling the model', async () => {
    const response = await routeModule.POST(makeRequest('{"prompt": '));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('VALIDATION_ERROR');
    // Regression: a truncated JSON body must be refused as a validation error,
    // not forwarded as a prompt. Every downstream read assumes a parsed object.
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('refuses a prompt over the 2000-character cap without calling the model', async () => {
    const overLimit = await routeModule.POST(
      makeRequest(JSON.stringify({ prompt: 'a'.repeat(MAX_PROMPT_LENGTH + 1) }))
    );

    expect(overLimit.status).toBe(400);
    expect((await overLimit.json()).code).toBe('VALIDATION_ERROR');
    // Regression: the cap is the only bound on what is sent upstream. The
    // existing suite covers the schema refusing, but not that nothing is spent
    // on the way to the refusal.
    expect(mockGenerateContent).not.toHaveBeenCalled();

    mockGenerateContent.mockResolvedValue({
      response: { text: () => `[${GOOD_ELEMENT}]` },
    });
    const atLimit = await routeModule.POST(
      makeRequest(JSON.stringify({ prompt: 'a'.repeat(MAX_PROMPT_LENGTH) }))
    );
    // Regression: and the cap is inclusive — one character more must fail while
    // exactly 2000 must pass. An off-by-one that rejected the boundary would
    // silently shorten every real prompt.
    expect(atLimit.status).toBe(200);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('refuses a token whose subject is longer than 200 characters', async () => {
    const response = await routeModule.POST(
      makeRequest(JSON.stringify({ prompt: 'hello' }), { userId: 'u'.repeat(201) })
    );

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('AUTH_REQUIRED');
    // Regression: the bound is what keeps an arbitrary-length claim out of the
    // rate-limit key and the log line. Widening it is invisible until a 10 kB
    // "user id" is being used as a Redis key.
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  /* ------------------------------------------------------------------ *
   * Retry policy
   * ------------------------------------------------------------------ */

  it('retries once on a transient upstream 503 and succeeds', async () => {
    mockGenerateContent
      .mockRejectedValueOnce({ status: 503, message: 'The service is currently unavailable' })
      .mockResolvedValueOnce({ response: { text: () => `[${GOOD_ELEMENT}]` } });

    const response = await routeModule.POST(makeRequest(JSON.stringify({ prompt: 'hello' })));

    // Regression: 503 is in the retryable set. Without the retry a single blip
    // becomes a user-visible failure, and without the `MAX_GEMINI_RETRIES` bound
    // it becomes a spend amplification against Gemini.
    expect(response.status).toBe(200);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('gives up on a second transient failure instead of retrying again', async () => {
    mockGenerateContent.mockRejectedValue({ status: 503, message: 'The service is unavailable' });

    const response = await routeModule.POST(makeRequest(JSON.stringify({ prompt: 'hello' })));

    // Regression: the retry is bounded at exactly one. An unbounded loop would
    // turn one upstream incident into unbounded spend per request.
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(502);
  });

  it('stops a pending retry backoff with 499 when the client disconnects mid-wait', async () => {
    const controller = new AbortController();
    mockGenerateContent.mockRejectedValue({ status: 503, message: 'The service is unavailable' });

    const pending = routeModule.POST(
      makeRequest(JSON.stringify({ prompt: 'hello' }), { signal: controller.signal })
    );
    await vi.waitFor(() => expect(mockGenerateContent).toHaveBeenCalledTimes(1));
    controller.abort();

    const response = await pending;

    // Regression: the backoff sleep is itself abortable. Without that, a user who
    // closes the tab still has an in-flight retry that will call Gemini and bill
    // for a diagram nobody will ever read.
    expect(response.status).toBe(499);
    expect((await response.json()).code).toBe('REQUEST_ABORTED');
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  /* ------------------------------------------------------------------ *
   * Upstream error classification (the 502/429 split)
   * ------------------------------------------------------------------ */

  it('classifies an upstream API-key failure as 502 AUTH_ERROR', async () => {
    mockGenerateContent.mockRejectedValue({ status: 400, message: 'API key not valid' });

    const response = await routeModule.POST(makeRequest(JSON.stringify({ prompt: 'hello' })));

    // Regression: a rejected key is an operator problem, not a transient one.
    // Collapsing it into INTERNAL_ERROR sends the on-call to a network graph
    // when the answer is "rotate GOOGLE_CLIENT_SECRET".
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe('AUTH_ERROR');
  });

  it.each([
    ['quota exhaustion', 'Quota exceeded for quota metric: GenerateContent'],
    ['a resource-exhausted code', 'RESOURCE_EXHAUSTED: token count limit'],
    ['a billing problem', 'Billing account is inactive'],
  ])('classifies %s as 429 QUOTA_ERROR rather than an upstream rate limit', async (_l, message) => {
    mockGenerateContent.mockRejectedValue({ status: 429, message });

    const response = await routeModule.POST(makeRequest(JSON.stringify({ prompt: 'hello' })));

    // Regression: quota and 429 share a status code but not a remedy. QUOTA_ERROR
    // tells the user to wait for billing; UPSTREAM_RATE_LIMIT tells them to retry
    // now. Getting this backwards invites a retry storm that spends more.
    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe('QUOTA_ERROR');
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('classifies an upstream 429 with no quota wording as UPSTREAM_RATE_LIMIT', async () => {
    mockGenerateContent.mockRejectedValue({ status: 429, message: 'Too many requests' });

    const response = await routeModule.POST(makeRequest(JSON.stringify({ prompt: 'hello' })));

    // Regression: the two 429 arms are both required. A mutation that removed
    // `errorStatus(error) === 429` would report a plain upstream throttle as a
    // quota problem, telling a paying user their account is out of quota.
    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe('UPSTREAM_RATE_LIMIT');
  });

  it('classifies an unrecognised upstream failure as 502 INTERNAL_ERROR', async () => {
    mockGenerateContent.mockRejectedValue(new Error('socket hang up for prompt "top secret"'));

    const response = await routeModule.POST(makeRequest(JSON.stringify({ prompt: 'top secret' })));
    const raw = await response.text();

    // Regression: the catch-all arm. It must carry a stable code and must not
    // echo the upstream message, which routinely quotes the request it failed on.
    expect(response.status).toBe(502);
    expect(JSON.parse(raw).code).toBe('INTERNAL_ERROR');
    expect(raw).not.toContain('socket hang up');
    expect(raw).not.toContain('top secret');
  });

  /* ------------------------------------------------------------------ *
   * What the client is told about its own output
   * ------------------------------------------------------------------ */

  it('refuses a diagram the model returned as an empty array', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => '[]' } });

    const response = await routeModule.POST(makeRequest(JSON.stringify({ prompt: 'hello' })));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await response.json()).code).toBe('AI_RESPONSE_ERROR');
    // Regression: `[]` parses cleanly, so without the emptiness guard the route
    // answers 200 with zero elements. The client writes that over the user's
    // canvas and reports success — a silent data loss with a success toast.
  });

  it('reports how many elements the model produced badly', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => modelOutputWithBadArrows(3) },
    });

    const response = await routeModule.POST(makeRequest(JSON.stringify({ prompt: 'arrows' })));

    const body = await response.json();
    // Regression: the count and its pluralisation are both user-facing. The
    // existing suite covers the singular; nothing covers the plural, so a
    // dropped-element count of "1 elements" or a hardcoded count would pass.
    expect(body.warnings[0]).toBe('3 elements could not be rendered. Try rephrasing your prompt.');
  });

  it('says the diagram was simplified when the model exceeded the element cap', async () => {
    const tooMany = `[${Array.from({ length: MAX_AI_ELEMENTS + 5 }, () => GOOD_ELEMENT).join(',')}]`;
    mockGenerateContent.mockResolvedValue({ response: { text: () => tooMany } });

    const response = await routeModule.POST(makeRequest(JSON.stringify({ prompt: 'big' })));
    const body = await response.json();

    // Regression: silent truncation. The 5 discarded elements are gone from the
    // user's canvas either way; without the warning the user has no way to know
    // and cannot prompt for the missing part.
    expect(body.elements).toHaveLength(MAX_AI_ELEMENTS);
    expect(body.warnings).toContain(
      'The diagram was simplified because it contained too many elements.'
    );
  });
});
