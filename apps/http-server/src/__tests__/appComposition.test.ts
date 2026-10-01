import { describe, expect, it, vi } from 'vitest';
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

// /health is the only handler that reaches the database; keep the suite
// deterministic without a live PostgreSQL.
vi.mock('@dripl/db', () => ({
  db: {
    $queryRaw: async () => [{ ok: 1 }],
  },
  initializeDb: async () => {},
}));

import { createApp } from '../app';

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
