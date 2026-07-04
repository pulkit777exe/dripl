import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGenerateContent = vi.fn();

let mockModel: { generateContent: typeof mockGenerateContent } | null = null;
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      if (!mockModel) mockModel = { generateContent: mockGenerateContent };
      return mockModel;
    }
  },
}));

vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');

describe('/api/ai/generate', () => {
  let routeModule: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    routeModule = await import('@/app/api/ai/generate/route');
  });

  function makeRequest(body: object, headers?: Record<string, string>) {
    return new NextRequest('http://localhost:3000/api/ai/generate', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        origin: 'http://localhost:3000',
        ...headers,
      },
    });
  }

  it('returns 400 when prompt is missing', async () => {
    const res = await routeModule.POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when prompt exceeds 2000 characters', async () => {
    const res = await routeModule.POST(makeRequest({ prompt: 'a'.repeat(2001) }));
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

    const res = await routeModule.POST(makeRequest({ prompt: 'A simple box' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.elements)).toBe(true);
    expect(body.elements[0]).toHaveProperty('id');
  });

  it('returns 500 when AI returns invalid JSON', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'not valid json [' },
    });

    const res = await routeModule.POST(makeRequest({ prompt: 'test' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('PARSE_ERROR');
  });

  it('returns 500 when AI response is not an array', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '{"id":"box1","type":"rectangle"}' },
    });

    const res = await routeModule.POST(makeRequest({ prompt: 'test' }));
    expect(res.status).toBe(500);
  });

  it('applies default values to elements', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '[{"type":"rectangle"}]' },
    });

    const res = await routeModule.POST(makeRequest({ prompt: 'test' }));
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

    for (let i = 0; i < 10; i++) {
      await routeModule.POST(makeRequest({ prompt: 'test' }));
    }

    const res = await routeModule.POST(makeRequest({ prompt: 'test' }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe('RATE_LIMIT');
  });

  it('rejects requests from unknown origins', async () => {
    const res = await routeModule.POST(makeRequest({ prompt: 'test' }, { origin: 'https://evil.com' }));
    expect(res.status).toBe(403);
  });
});
