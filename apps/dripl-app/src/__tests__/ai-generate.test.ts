import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { signToken } from '@dripl/utils/auth';

const mockGenerateContent = vi.fn();
let mockModel: { generateContent: typeof mockGenerateContent } | null = null;
let modelParams: unknown = null;

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel(params: unknown) {
      modelParams = params;
      if (!mockModel) mockModel = { generateContent: mockGenerateContent };
      return mockModel;
    }
  },
}));

const TEST_JWT_SECRET = 'test-jwt-secret-for-ai-route-tests';
vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
vi.stubEnv('JWT_SECRET', TEST_JWT_SECRET);
vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');

const userToken = (userId = 'user-123') => signToken(userId);

describe('/api/ai/generate', () => {
  let routeModule: { POST: (request: NextRequest) => Promise<Response> };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockModel = null;
    modelParams = null;
    vi.resetModules();
    routeModule = await import('@/app/api/ai/generate/route');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    vi.stubEnv('JWT_SECRET', TEST_JWT_SECRET);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
  });

  function makeRequest(
    body: object,
    headers?: Record<string, string>,
    token = userToken(),
    signal?: AbortSignal
  ) {
    return new NextRequest('http://localhost:3000/api/ai/generate', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
      headers: {
        origin: 'http://localhost:3000',
        cookie: `dripl-session=${token}`,
        ...headers,
      },
    });
  }

  it('returns 400 when prompt is missing or blank', async () => {
    const missing = await routeModule.POST(makeRequest({}));
    expect(missing.status).toBe(400);
    expect((await missing.json()).code).toBe('VALIDATION_ERROR');

    const blank = await routeModule.POST(makeRequest({ prompt: '   ' }));
    expect(blank.status).toBe(400);
    expect((await blank.json()).code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for a non-string prompt instead of crashing', async () => {
    const response = await routeModule.POST(makeRequest({ prompt: { text: 'hello' } }));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('VALIDATION_ERROR');
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('returns 400 when prompt exceeds 2000 characters', async () => {
    const response = await routeModule.POST(makeRequest({ prompt: 'a'.repeat(2001) }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('requires a valid signed session and ignores body identity claims', async () => {
    const missingSession = await routeModule.POST(
      makeRequest({ prompt: 'test' }, { cookie: '' }, '')
    );
    expect(missingSession.status).toBe(401);
    expect((await missingSession.json()).code).toBe('AUTH_REQUIRED');

    const invalidSession = await routeModule.POST(makeRequest({ prompt: 'test' }, {}, 'not-a-jwt'));
    expect(invalidSession.status).toBe(401);
    expect((await invalidSession.json()).code).toBe('AUTH_REQUIRED');

    mockGenerateContent.mockResolvedValue({
      response: { text: () => '[{"type":"rectangle","x":100,"y":100}]' },
    });
    const forgedBody = await routeModule.POST(
      makeRequest({ prompt: 'test', userId: 'attacker-controlled-id' })
    );
    expect(forgedBody.status).toBe(200);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized request bodies before invoking Gemini', async () => {
    const response = await routeModule.POST(
      new NextRequest('http://localhost:3000/api/ai/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt: 'a'.repeat(40_000) }),
        headers: {
          origin: 'http://localhost:3000',
          cookie: `dripl-session=${userToken()}`,
          'content-type': 'application/json',
        },
      })
    );

    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe('PAYLOAD_TOO_LARGE');
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('uses an exact configured origin, not a prefix match', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '[{"type":"rectangle","x":100,"y":100}]' },
    });

    const response = await routeModule.POST(
      makeRequest({ prompt: 'test' }, { origin: 'http://localhost:3000.attacker.example' })
    );

    expect(response.status).toBe(403);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('returns valid elements for a valid prompt and requests JSON from Gemini', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '[{"id":"box1","type":"rectangle","x":100,"y":100,"width":120,"height":80}]',
      },
    });

    const response = await routeModule.POST(makeRequest({ prompt: 'A simple box' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.elements)).toBe(true);
    expect(body.elements[0]).toHaveProperty('id');
    expect(modelParams).toEqual(
      expect.objectContaining({
        model: 'gemini-2.5-flash',
        generationConfig: expect.objectContaining({ responseMimeType: 'application/json' }),
      })
    );
    expect(mockGenerateContent.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ timeout: 15_000 })
    );
  });

  it('stops an upstream request when the client aborts', async () => {
    const controller = new AbortController();
    mockGenerateContent.mockImplementation(() => new Promise(() => {}));

    const pending = routeModule.POST(
      makeRequest({ prompt: 'cancel me' }, {}, userToken(), controller.signal)
    );
    await vi.waitFor(() => expect(mockGenerateContent).toHaveBeenCalled());
    controller.abort();

    const response = await pending;
    expect(response.status).toBe(499);
    expect((await response.json()).code).toBe('REQUEST_ABORTED');
  });

  it('preserves explicit model coordinates instead of shifting every element', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '[{"type":"rectangle","x":100,"y":100},{"type":"rectangle","x":400,"y":200}]',
      },
    });

    const response = await routeModule.POST(makeRequest({ prompt: 'layout' }));
    const body = await response.json();

    expect(
      body.elements.map((element: { x: number; y: number }) => [element.x, element.y])
    ).toEqual([
      [100, 100],
      [400, 200],
    ]);
  });

  it('normalizes valid tuple points and drops malformed linear elements safely', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          '[{"type":"arrow","x":10,"y":20,"points":[[0,0],[100,50]]},{"type":"arrow","x":1,"y":2,"points":[[0,"not-a-number"],[2,3]]}]',
      },
    });

    const response = await routeModule.POST(makeRequest({ prompt: 'flow' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.elements).toHaveLength(1);
    expect(body.elements[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);
    expect(body.warnings[0]).toMatch(/could not be rendered/i);
  });

  it('turns shape text into a bound text element so labels remain renderable', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '[{"type":"rectangle","x":100,"y":100,"width":200,"height":80,"text":"Login"}]',
      },
    });

    const response = await routeModule.POST(makeRequest({ prompt: 'login flow' }));
    const body = await response.json();
    const shape = body.elements.find((element: { type: string }) => element.type === 'rectangle');
    const label = body.elements.find((element: { type: string }) => element.type === 'text');

    expect(shape).toBeDefined();
    expect(label).toEqual(
      expect.objectContaining({
        type: 'text',
        text: 'Login',
        boundElementId: shape.id,
      })
    );
    expect(shape).toEqual(
      expect.objectContaining({
        labelId: label.id,
        boundElements: [{ id: label.id, type: 'text' }],
      })
    );
  });

  it('accepts fenced JSON with surrounding explanation but rejects non-arrays', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          'Here is the diagram:\n```json\n[{"type":"rectangle","x":100,"y":100}]\n```\nDone.',
      },
    });
    const fenced = await routeModule.POST(makeRequest({ prompt: 'test' }));
    expect(fenced.status).toBe(200);

    mockGenerateContent.mockResolvedValue({
      response: { text: () => '{"id":"box1","type":"rectangle"}' },
    });
    const object = await routeModule.POST(makeRequest({ prompt: 'test' }));
    expect(object.status).toBeGreaterThanOrEqual(400);
    expect((await object.json()).code).toBe('AI_RESPONSE_ERROR');
  });

  it('handles adversarial unmatched-bracket output without a retry loop', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '['.repeat(20_000) },
    });

    const response = await routeModule.POST(makeRequest({ prompt: 'test' }));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.code).toBe('AI_RESPONSE_ERROR');
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('does not retry an upstream 429 quota response', async () => {
    mockGenerateContent.mockRejectedValue({ status: 429, message: 'quota exhausted' });

    const response = await routeModule.POST(makeRequest({ prompt: 'test' }));
    expect(response.status).toBe(429);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('preserves a distinct blocked/incomplete response code', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [{ finishReason: 'MAX_TOKENS' }],
        text: () => '',
      },
    });

    const response = await routeModule.POST(makeRequest({ prompt: 'test' }));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.code).toBe('AI_INCOMPLETE');
  });

  it('returns a safe upstream error for malformed or blocked model output', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'not valid json [' },
    });

    const response = await routeModule.POST(makeRequest({ prompt: 'test' }));
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = await response.json();
    expect(body.code).toBe('AI_RESPONSE_ERROR');
    expect(body.error).not.toContain('not valid json');

    mockGenerateContent.mockResolvedValue({
      response: {
        promptFeedback: { blockReason: 'SAFETY' },
        text: () => '',
      },
    });
    const blocked = await routeModule.POST(makeRequest({ prompt: 'test' }));
    expect(blocked.status).toBeGreaterThanOrEqual(400);
    expect((await blocked.json()).code).toBe('CONTENT_BLOCKED');
  });

  it('returns 500 when AI returns invalid JSON', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'not valid json [' },
    });

    const response = await routeModule.POST(makeRequest({ prompt: 'test' }));
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = await response.json();
    expect(body.code).toBe('AI_RESPONSE_ERROR');
  });

  it('uses fillColor as the canonical background for static rendering', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '[{"type":"rectangle","fillColor":"#ff0000"}]',
      },
    });

    const response = await routeModule.POST(makeRequest({ prompt: 'filled shape' }));
    const body = await response.json();
    expect(body.elements[0]).toMatchObject({
      fillColor: '#ff0000',
      backgroundColor: '#ff0000',
    });
  });

  it('applies safe default values to elements', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '[{"type":"rectangle"}]' },
    });

    const response = await routeModule.POST(makeRequest({ prompt: 'test' }));
    const body = await response.json();
    const element = body.elements[0];
    expect(element.x).toBe(100);
    expect(element.y).toBe(100);
    expect(element.width).toBe(120);
    expect(element.strokeColor).toBe('#6965db');
  });

  it('rate limits authenticated users by their verified identity', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '[{"type":"rectangle","x":100,"y":100}]' },
    });

    for (let i = 0; i < 10; i++) {
      await routeModule.POST(makeRequest({ prompt: 'test' }));
    }
    const response = await routeModule.POST(makeRequest({ prompt: 'test' }));
    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe('RATE_LIMIT');
  });
});
