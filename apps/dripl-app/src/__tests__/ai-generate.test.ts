import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGenerateContent = vi.fn();

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  })),
}));

vi.stubEnv('GEMINI_API_KEY', 'test-api-key');

describe('/api/ai/generate', () => {
  let routeModule: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    routeModule = await import('@/app/api/ai/generate/route');
  });

  it('returns 400 when prompt is missing', async () => {
    const req = new Request('http://localhost:3000/api/ai/generate', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await routeModule.POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when prompt exceeds 2000 characters', async () => {
    const longPrompt = 'a'.repeat(2001);
    const req = new Request('http://localhost:3000/api/ai/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: longPrompt }),
    });

    const res = await routeModule.POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns valid elements for valid prompt', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '[{"id":"box1","type":"rectangle","x":100,"y":100,"width":120,"height":80}]',
      },
    });

    const req = new Request('http://localhost:3000/api/ai/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'A simple box' }),
    });

    const res = await routeModule.POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.elements)).toBe(true);
    expect(body.elements[0]).toHaveProperty('id');
  });

  it('returns 500 when AI returns invalid JSON', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => 'not valid json [',
      },
    });

    const req = new Request('http://localhost:3000/api/ai/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'test' }),
    });

    const res = await routeModule.POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('PARSE_ERROR');
  });

  it('returns 500 when AI response is not an array', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '{"id":"box1","type":"rectangle"}',
      },
    });

    const req = new Request('http://localhost:3000/api/ai/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'test' }),
    });

    const res = await routeModule.POST(req);
    expect(res.status).toBe(500);
  });

  it('applies default values to elements', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '[{"type":"rectangle"}]',
      },
    });

    const req = new Request('http://localhost:3000/api/ai/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'test' }),
    });

    const res = await routeModule.POST(req);
    const body = await res.json();
    const el = body.elements[0];
    expect(el.x).toBe(100);
    expect(el.y).toBe(100);
    expect(el.width).toBe(120);
    expect(el.strokeColor).toBe('#6965db');
  });

  it('handles rate limiting', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '[{"id":"box1","type":"rectangle","x":100,"y":100}]',
      },
    });

    const makeRequest = () => new Request('http://localhost:3000/api/ai/generate', {
      method: 'POST',
      headers: { 'x-forwarded-for': 'test-ip' },
      body: JSON.stringify({ prompt: 'test' }),
    });

    for (let i = 0; i < 10; i++) {
      await routeModule.POST(makeRequest());
    }

    const res = await routeModule.POST(makeRequest());
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe('RATE_LIMIT');
  });
});