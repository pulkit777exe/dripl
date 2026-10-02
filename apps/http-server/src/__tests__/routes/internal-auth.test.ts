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
});
