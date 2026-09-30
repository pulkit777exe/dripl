import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from '../../app/api/canvas/snapshots/route';

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

describe('canvas snapshot listing', () => {
  beforeEach(() => {
    globalThis.__driplCanvasSnapshots?.clear();
  });

  function post(data: string, canvasId?: string) {
    return POST(
      new NextRequest('http://localhost:3000/api/canvas/snapshots', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify(canvasId === undefined ? { data } : { data, canvasId }),
      })
    );
  }

  function list(canvasId?: string) {
    const url =
      canvasId === undefined
        ? 'http://localhost:3000/api/canvas/snapshots'
        : `http://localhost:3000/api/canvas/snapshots?canvasId=${canvasId}`;
    return GET(new NextRequest(url));
  }

  it('lists scoped snapshots newest-first, metadata only', async () => {
    const scene = JSON.stringify([element]);
    const first = (await (await post(scene, 'canvas-a')).json()) as { id: string };
    await new Promise(resolve => setTimeout(resolve, 5));
    const second = (await (await post(scene, 'canvas-a')).json()) as { id: string };
    await post(scene, 'canvas-b');

    const response = await list('canvas-a');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      snapshots: Array<{ id: string; canvasId: string; createdAt: number; expiresAt: number }>;
    };
    expect(body.snapshots.map(s => s.id)).toEqual([second.id, first.id]);
    for (const snapshot of body.snapshots) {
      expect(snapshot.canvasId).toBe('canvas-a');
      expect(snapshot).not.toHaveProperty('data');
      expect(snapshot.expiresAt).toBeGreaterThan(snapshot.createdAt);
    }
  });

  it('requires canvasId and rejects other canvases plus expired records', async () => {
    expect((await list()).status).toBe(400);

    const scene = JSON.stringify([element]);
    await post(scene, 'canvas-a');
    const other = await list('canvas-b');
    expect(((await other.json()) as { snapshots: unknown[] }).snapshots).toEqual([]);

    // Expired records are swept on read, never listed.
    const store = globalThis.__driplCanvasSnapshots;
    expect(store).toBeDefined();
    for (const [, record] of store!) record.expiresAt = Date.now() - 1;
    const gone = await list('canvas-a');
    expect(((await gone.json()) as { snapshots: unknown[] }).snapshots).toEqual([]);
    expect(store!.size).toBe(0);
  });

  it('keeps unscoped legacy snapshots out of filtered lists', async () => {
    await post(JSON.stringify([element]));
    const response = await list('canvas-a');
    expect(((await response.json()) as { snapshots: unknown[] }).snapshots).toEqual([]);
  });

  it('rejects invalid canvasId values on write', async () => {
    const scene = JSON.stringify([element]);
    const tooLong = await post(scene, 'x'.repeat(201));
    expect(tooLong.status).toBe(400);
  });
});
