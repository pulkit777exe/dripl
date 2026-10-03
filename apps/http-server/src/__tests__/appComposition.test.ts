import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// The real composition root hard-imported Upstash at module load; mock both
// providers so createApp() can be exercised offline under either rate-limiter
// implementation (HEAD's direct Ratelimit and the createRateLimiter wrapper).
vi.mock('@upstash/redis', () => ({ Redis: class FakeRedis {} }));
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class FakeRatelimit {
    static slidingWindow() {
      return {};
    }
    async limit() {
      return { success: true, remaining: 999, reset: Date.now() + 60_000 };
    }
  },
}));

// `vi.mock` is hoisted above every top-level statement, so the spy has to be
// hoisted with it rather than declared next to the factories. `/health` is the
// only handler that reaches the database; the spy keeps this suite deterministic
// without a live PostgreSQL and lets the liveness test prove it reached nothing.
const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn(async () => [{ ok: 1 }]) }));

vi.mock('@dripl/db', () => ({
  db: {
    $queryRaw: queryRaw,
  },
  initializeDb: async () => {},
}));

import { createApp } from '../app';
import { logger } from '../logger';

// Card-6 middleware composition: nothing else exercises createApp(), so these
// assertions pin the security chain as a client observes it. Only invariants
// that hold regardless of in-flight app.ts work are asserted: open health,
// helmet + CORS + auth on API reads, CSRF ordered before auth on state-changing
// mounts, and the terminal error handler. Rate limiting passes requests through
// in every tested configuration and is intentionally not behaviorally pinned
// here (its provider differs across implementations).
const app = createApp();

describe('app middleware composition', () => {
  it('keeps /health open in front of every guard', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('rejects unauthenticated API reads behind helmet and CORS', async () => {
    const res = await request(app).get('/api/files').set('Origin', 'http://localhost:3000');

    expect(res.status).toBe(401);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('enforces CSRF before auth on state-changing API mounts', async () => {
    const res = await request(app).post('/api/files').send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CSRF_TOKEN_MISSING');
  });

  it('guards state-changing auth endpoints with CSRF', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.c', password: 'x' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CSRF_TOKEN_MISSING');
  });

  it('routes unhandled errors to the terminal error handler', async () => {
    const res = await request(app)
      .post('/api/files')
      .set('Content-Type', 'application/json')
      .send('{ not json');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('INTERNAL_ERROR');
  });
});

describe('liveness vs readiness', () => {
  afterEach(() => {
    queryRaw.mockClear();
  });

  it('answers /live without reaching the database', async () => {
    queryRaw.mockClear();
    const res = await request(app).get('/live');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
    // The whole reason this endpoint exists separately from /health: a
    // supervisor that can restart this process must not be able to do it
    // because Postgres is slow.
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('still uses /health as a readiness probe', async () => {
    queryRaw.mockRejectedValueOnce(new Error('connection refused') as never);

    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
  });
});

describe('operational vs programmer errors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function classificationFor(send: () => Promise<unknown>): Promise<string | undefined> {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    await send();
    const client = warn.mock.calls.map(call => (call[0] as { event?: string } | undefined)?.event);
    expect(client).toContain('http_client_error');
    // The point of the split: an operational error must not be logged as a
    // server fault, or the error level stops being a signal.
    expect(
      error.mock.calls.map(call => (call[0] as { event?: string } | undefined)?.event)
    ).not.toContain('http_server_error');
    return client[0];
  }

  it("classifies an unparseable body as the client's, not a server fault", async () => {
    await classificationFor(() =>
      request(app).post('/api/files').set('Content-Type', 'application/json').send('{ not json')
    );
  });

  it("classifies a body over the parser limit as the client's", async () => {
    await classificationFor(() =>
      request(app)
        .post('/api/files')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ name: 'x'.repeat(6 * 1024 * 1024) }))
    );
  });

  it("classifies a rejected CORS origin as the client's", async () => {
    await classificationFor(() => request(app).get('/').set('Origin', 'http://evil.example'));
  });

  it('still treats a thrown route error as a server fault', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    // `/api/share/:token` reaches the database directly, outside every
    // service try/catch, so this is the app-level handler's own path.
    const res = await request(app).get('/api/share/nope/ws-ticket');

    expect(res.status).toBe(500);
    expect(
      error.mock.calls.map(call => (call[0] as { event?: string } | undefined)?.event)
    ).toContain('http_server_error');
    expect(warn).not.toHaveBeenCalled();
  });
});
