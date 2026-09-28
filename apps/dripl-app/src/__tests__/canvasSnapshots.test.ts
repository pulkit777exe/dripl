import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { POST } from '../../app/api/canvas/snapshots/route';

const element = {
  id: 'snapshot-element',
  type: 'rectangle' as const,
  x: 0,
  y: 0,
  width: 20,
  height: 20,
};

function request(data: string, headers: HeadersInit = {}) {
  // Browsers always send Origin on same-origin POSTs; the route requires it.
  return new NextRequest('http://localhost:3000/api/canvas/snapshots', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', ...headers },
    body: JSON.stringify({ data }),
  });
}

describe('canvas snapshot capability route', () => {
  beforeEach(() => {
    globalThis.__driplCanvasSnapshots?.clear();
  });

  it('stores only a bounded, valid element scene', async () => {
    const response = await POST(request(JSON.stringify([element])));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(globalThis.__driplCanvasSnapshots?.get(body.id)?.data).toContain('snapshot-element');
  });

  it('rejects malformed snapshot elements', async () => {
    const response = await POST(request(JSON.stringify([{ id: 'bad' }])));
    expect(response.status).toBe(400);
  });

  it('rejects chunked payloads over the size limit while reading', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
        controller.close();
      },
    });
    const chunkedRequest = new NextRequest('http://localhost:3000/api/canvas/snapshots', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body,
    } as ConstructorParameters<typeof NextRequest>[1]);

    const response = await POST(chunkedRequest);
    expect(response.status).toBe(413);
  });

  it('rejects requests with a missing origin', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/canvas/snapshots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: JSON.stringify([element]) }),
      })
    );
    expect(response.status).toBe(403);
  });

  it('rejects declared payloads over the size limit before reading', async () => {
    const response = await POST(
      request(JSON.stringify([element]), {
        'content-length': String(2 * 1024 * 1024 + 20_000),
      })
    );
    expect(response.status).toBe(413);
  });
});
