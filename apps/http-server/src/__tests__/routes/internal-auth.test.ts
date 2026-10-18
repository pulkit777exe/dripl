import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInternalRouter } from '../../routes/auth';

function internalApp() {
  const app = express();
  app.use(express.json());
  app.use('/internal', createInternalRouter());
  return app;
}

describe('internal ticket validation authentication', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails closed when the internal secret is missing', async () => {
    vi.stubEnv('INTERNAL_SECRET', '');
    const response = await request(internalApp())
      .post('/internal/validate-ticket')
      .send({ ticket: 'ticket' });
    expect(response.status).toBe(403);
  });

  it('rejects a missing or incorrect secret', async () => {
    vi.stubEnv('INTERNAL_SECRET', 'expected-secret');
    const app = internalApp();

    await request(app).post('/internal/validate-ticket').send({ ticket: 'ticket' }).expect(403);
    await request(app)
      .post('/internal/validate-ticket')
      .set('x-internal-secret', 'wrong-secret')
      .send({ ticket: 'ticket' })
      .expect(403);
  });

  it('allows the correctly configured secret to reach ticket validation', async () => {
    vi.stubEnv('INTERNAL_SECRET', 'expected-secret');
    const response = await request(internalApp())
      .post('/internal/validate-ticket')
      .set('x-internal-secret', 'expected-secret')
      .send({ ticket: 'missing-ticket' });

    expect(response.status).toBe(401);
  });

  it('answers a malformed ticket with 400 before the store is touched', async () => {
    vi.stubEnv('INTERNAL_SECRET', 'expected-secret');
    const app = internalApp();
    const secret = { 'x-internal-secret': 'expected-secret' };

    // Absent, empty, overlong, and non-string are all one answer: this
    // endpoint's wire says only "no", and none of them reaches the store.
    for (const body of [{}, { ticket: '' }, { ticket: 't'.repeat(513) }, { ticket: 42 }]) {
      const response = await request(app).post('/internal/validate-ticket').set(secret).send(body);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Ticket is required' });
    }
  });
});
