import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signToken } from '@dripl/utils/auth';

const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

describe('image routes', () => {
  let storageDir: string;
  let app: express.Express;

  beforeEach(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'dripl-images-'));
    vi.stubEnv('IMAGE_STORAGE_DIR', storageDir);
    vi.stubEnv('JWT_SECRET', 'image-route-test-secret');
    vi.resetModules();
    const { imagesRouter } = await import('../../routes/images');
    app = express();
    app.use('/api/images', imagesRouter);
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('serves capability-style image downloads without requiring a session', async () => {
    await writeFile(join(storageDir, 'abcdef12.png'), PNG_BYTES);
    const response = await request(app).get('/api/images/abcdef12.png');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers['access-control-allow-origin']).toBe('*');
  });

  it('rejects traversal-shaped ids instead of reading arbitrary files', async () => {
    const response = await request(app).get('/api/images/..%2Fsecret.png');
    expect(response.status).toBe(400);
  });

  it('requires authentication and validates image signatures on upload', async () => {
    const unauthenticated = await request(app)
      .post('/api/images')
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);
    expect(unauthenticated.status).toBe(401);

    const invalid = await request(app)
      .post('/api/images')
      .set('Authorization', `Bearer ${signToken('user-1')}`)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('not a png'));
    expect(invalid.status).toBe(400);

    const uploaded = await request(app)
      .post('/api/images')
      .set('Authorization', `Bearer ${signToken('user-1')}`)
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.id).toMatch(/^[a-f0-9-]+\.png$/);
  });
});
