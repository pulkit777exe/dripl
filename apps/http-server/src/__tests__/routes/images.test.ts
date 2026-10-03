import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signToken } from '@dripl/utils/auth';
import type { StructuredLogger } from '@dripl/utils/logger';

// `authMiddleware` resolves the token's stored generation through `@dripl/db`.
// The image router never touches the database itself, so this `user` stub is the
// only query involved -- but answering it is what keeps an upload test from
// depending on a live PostgreSQL. `fakeRevocation` supplies the production
// resolution itself, so this suite is not running its own version arithmetic.
// `vi.hoisted` rather than a plain `vi.fn`, because both `vi.mock` factories and
// the suite's `beforeEach` (which calls `vi.restoreAllMocks()`) are hoisted above
// ordinary top-level bindings. The alternative -- re-asserting the resolved value
// in every `beforeEach` -- is how `clearAllMocks` silently turns a version check
// into a 401 three assertions later.
const { userFind } = vi.hoisted(() => ({
  userFind: vi.fn(async () => ({ tokenVersion: 0 })),
}));

vi.mock('@dripl/db', async () => {
  const { fakeRevocation } = await import('../test-utils/fakeDbModule');
  const db = { user: { findUnique: userFind } };
  return { db, ...(await fakeRevocation(db as never)) };
});

const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

// Signed lazily inside each test, after `JWT_SECRET` is stubbed: a token
// minted at module load would be signed with whatever secret the runner had,
// and every authenticated case would answer 401.
const auth = (): string => `Bearer ${signToken('user-1', 0)}`;

/**
 * The three pre-existing tests below are the route's original contract, kept
 * byte-for-byte: same assertions, same stubs, same `IMAGE_STORAGE_DIR` fixture.
 * They are the regression guard for "the default path still works", and they are
 * only meaningful because the S3 driver was added alongside them rather than
 * in place of them.
 */
describe('image routes — filesystem driver (the default)', () => {
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
    // `restoreAllMocks` also resets the hoisted `userFind` stub above, so the
    // generation the revocation check reads is re-asserted here. Without it every
    // authenticated case in this file answers 401.
    userFind.mockResolvedValue({ tokenVersion: 0 });
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
      .set('Authorization', auth())
      .set('Content-Type', 'image/png')
      .send(Buffer.from('not a png'));
    expect(invalid.status).toBe(400);

    const uploaded = await request(app)
      .post('/api/images')
      .set('Authorization', auth())
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.id).toMatch(/^[a-f0-9-]+\.png$/);
  });

  it('returns 404 with the same body for a missing image', async () => {
    const response = await request(app).get('/api/images/abcdef12.png');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'NOT_FOUND',
      message: 'Image not found',
      statusCode: 404,
    });
  });

  it('returns 400 with the same body for an invalid id', async () => {
    const response = await request(app).get('/api/images/not-an-id.txt');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'INVALID_IMAGE_ID',
      message: 'Invalid image id',
      statusCode: 400,
    });
  });

  it('returns 400 for a disallowed content type without writing anything', async () => {
    const response = await request(app)
      .post('/api/images')
      .set('Authorization', auth())
      .set('Content-Type', 'image/svg+xml')
      .send(PNG_BYTES);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_CONTENT_TYPE');
    expect(existsSync(storageDir) ? await readdir(storageDir) : []).toEqual([]);
  });

  it('sends the exact bytes, length and headers it always sent', async () => {
    await writeFile(join(storageDir, 'abcdef12.png'), PNG_BYTES);
    const response = await request(app).get('/api/images/abcdef12.png');

    expect(response.status).toBe(200);
    expect(Buffer.from(response.body)).toEqual(PNG_BYTES);
    expect(response.headers['content-length']).toBe(String(PNG_BYTES.length));
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('does not create the storage directory until an image is written', async () => {
    // `mkdtemp` already created the parent, so assert on a directory the store
    // is pointed at rather than on the fixture itself.
    const unwritten = join(storageDir, 'images');
    vi.stubEnv('IMAGE_STORAGE_DIR', unwritten);

    await request(app).get('/api/images/abcdef12.png');
    expect(existsSync(unwritten)).toBe(false);

    const uploaded = await request(app)
      .post('/api/images')
      .set('Authorization', auth())
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);

    expect(uploaded.status).toBe(201);
    expect(await readdir(unwritten)).toEqual([uploaded.body.id]);
  });

  it('round-trips an upload through a download', async () => {
    const uploaded = await request(app)
      .post('/api/images')
      .set('Authorization', auth())
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);

    const downloaded = await request(app).get(`/api/images/${uploaded.body.id}`);

    expect(downloaded.status).toBe(200);
    expect(Buffer.from(downloaded.body)).toEqual(PNG_BYTES);
    expect(downloaded.body.length).toBe(uploaded.body.size);
  });

  it('returns the same response shape, including the URL form, as before', async () => {
    const uploaded = await request(app)
      .post('/api/images')
      .set('Authorization', auth())
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);

    expect(Object.keys(uploaded.body).sort()).toEqual(['id', 'size', 'url']);
    expect(uploaded.body.url).toMatch(/^http:\/\/localhost:3002\/api\/images\/[a-f0-9-]+\.png$/);
  });
});

/**
 * The same route against the S3 driver, with `globalThis.fetch` replaced by a
 * recorder. Nothing about the HTTP surface changes; only where the bytes went.
 */
describe('image routes — S3 driver', () => {
  const ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE';
  const SECRET = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';

  let storageDir: string;
  let app: express.Express;
  let logger: StructuredLogger;
  let requests: Array<{ url: string; init: { method: string; headers: Record<string, string> } }>;
  let responses: Array<{ status: number; body?: Buffer } | Error>;

  const fetchStub = vi.fn(
    (url: string, init: { method: string; headers: Record<string, string> }) => {
      requests.push({ url, init });
      const next = responses.shift();
      const step: { status: number; body?: Buffer } | Error | undefined =
        next ?? new Error(`unexpected request: ${init.method} ${url}`);
      if (step instanceof Error) return Promise.reject(step);
      const bytes = Uint8Array.from(step.body ?? Buffer.alloc(0));
      return Promise.resolve({
        status: step.status,
        arrayBuffer: () => Promise.resolve(bytes.buffer),
      });
    }
  );

  beforeEach(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'dripl-images-s3-'));
    requests = [];
    responses = [];
    vi.stubEnv('JWT_SECRET', 'image-route-test-secret');
    vi.stubEnv('IMAGE_STORAGE_DIR', storageDir);
    vi.stubEnv('IMAGE_S3_BUCKET', 'dripl-images');
    vi.stubEnv('IMAGE_S3_REGION', 'eu-west-1');
    vi.stubEnv('IMAGE_S3_ENDPOINT', 'https://s3.eu-west-1.amazonaws.com');
    vi.stubEnv('IMAGE_S3_ACCESS_KEY_ID', ACCESS_KEY);
    vi.stubEnv('IMAGE_S3_SECRET_ACCESS_KEY', SECRET);
    vi.stubGlobal('fetch', fetchStub);
    vi.resetModules();
    // The logger must come from the SAME fresh module registry the route will
    // load, otherwise the spy sits on a different instance than the one that
    // writes the line under test.
    ({ logger } = await import('../../logger'));
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    const { imagesRouter } = await import('../../routes/images');
    app = express();
    app.use('/api/images', imagesRouter);
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    // Same reason as the filesystem suite: `restoreAllMocks` resets the hoisted
    // stub the revocation check reads through.
    userFind.mockResolvedValue({ tokenVersion: 0 });
  });

  it('uploads to the bucket and returns the identical response body', async () => {
    responses.push({ status: 200 });

    const uploaded = await request(app)
      .post('/api/images')
      .set('Authorization', auth())
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);

    expect(uploaded.status).toBe(201);
    expect(Object.keys(uploaded.body).sort()).toEqual(['id', 'size', 'url']);
    expect(uploaded.body.id).toMatch(/^[a-f0-9-]+\.png$/);
    expect(uploaded.body.url).toMatch(/\/api\/images\/[a-f0-9-]+\.png$/);

    // The image went to the bucket, and to nothing else.
    expect(requests).toHaveLength(1);
    expect(requests[0]!.init.method).toBe('PUT');
    expect(requests[0]!.url).toBe(
      `https://s3.eu-west-1.amazonaws.com/dripl-images/${uploaded.body.id}`
    );
    expect(await readdir(storageDir)).toEqual([]);
  });

  it('downloads from the bucket and serves the same headers', async () => {
    responses.push({ status: 200, body: PNG_BYTES });

    const response = await request(app).get('/api/images/abcdef12.png');

    expect(response.status).toBe(200);
    expect(Buffer.from(response.body)).toEqual(PNG_BYTES);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers['content-length']).toBe(String(PNG_BYTES.length));
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(requests[0]!.init.method).toBe('GET');
  });

  it('maps a bucket 404 to the same 404 body as an empty directory', async () => {
    responses.push({ status: 404 });

    const response = await request(app).get('/api/images/abcdef12.png');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'NOT_FOUND',
      message: 'Image not found',
      statusCode: 404,
    });
  });

  it('maps an unreachable bucket to 500 and does not fall back to local disk', async () => {
    responses.push(new TypeError('fetch failed'));

    const response = await request(app).get('/api/images/abcdef12.png');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'INTERNAL_ERROR',
      message: 'Failed to read image',
      statusCode: 500,
    });
    // One attempt at the bucket, zero reads of the local directory. A silent
    // fallback would answer 200 or 404 from local disk here and leave the
    // operator with two sources of truth and no error.
    expect(requests).toHaveLength(1);
  });

  it('maps an unreachable bucket on upload to the same 500 body', async () => {
    responses.push(new TypeError('fetch failed'));

    const response = await request(app)
      .post('/api/images')
      .set('Authorization', auth())
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'INTERNAL_ERROR',
      message: 'Failed to save image',
      statusCode: 500,
    });
    expect(await readdir(storageDir)).toEqual([]);
  });

  it('warns with a typed storage failure that names no credential', async () => {
    responses.push(new TypeError('fetch failed'));
    const warn = vi.mocked(logger.warn);

    await request(app).get('/api/images/abcdef12.png');

    const storageFailure = warn.mock.calls.find(
      call => (call[0] as { event?: string }).event === 'image_store_failure'
    );
    expect(storageFailure).toBeDefined();
    // Serializing the whole call, not just the record: an interpolated secret
    // in the message argument would be caught here too.
    const record = JSON.stringify(storageFailure);
    expect(record).toContain('unreachable');
    expect(record).not.toContain(SECRET);
    expect(record).not.toContain(ACCESS_KEY);
  });

  it('still rejects a traversal-shaped id before any bucket request', async () => {
    const response = await request(app).get('/api/images/..%2Fsecret.png');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_IMAGE_ID');
    expect(requests).toHaveLength(0);
  });

  it('still rejects a disallowed content type before any bucket request', async () => {
    const response = await request(app)
      .post('/api/images')
      .set('Authorization', auth())
      .set('Content-Type', 'image/svg+xml')
      .send(PNG_BYTES);

    expect(response.status).toBe(400);
    expect(requests).toHaveLength(0);
  });

  it('still rejects a body whose bytes do not match its declared type', async () => {
    const response = await request(app)
      .post('/api/images')
      .set('Authorization', auth())
      .set('Content-Type', 'image/png')
      .send(Buffer.from('<svg onload=alert(1)>'));

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_IMAGE');
    expect(requests).toHaveLength(0);
  });

  it('still requires authentication to upload', async () => {
    const response = await request(app)
      .post('/api/images')
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);

    expect(response.status).toBe(401);
    expect(requests).toHaveLength(0);
  });

  it('signs every bucket request, so the URL never carries a credential', async () => {
    responses.push({ status: 200 }, { status: 200, body: PNG_BYTES });

    const uploaded = await request(app)
      .post('/api/images')
      .set('Authorization', auth())
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);
    await request(app).get(`/api/images/${uploaded.body.id}`);

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.url).not.toContain(SECRET);
      expect(request.url).not.toContain(ACCESS_KEY);
      expect(request.init.headers.authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/eu-west-1\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/
      );
    }
  });
});
