/**
 * THE IMAGE UPLOAD GUARD CHAIN, AND THE FOUR SIGNATURES IT ACCEPTS.
 *
 * `images.test.ts` covers the routes against both storage drivers, and pins the
 * filesystem path end to end. What it does not cover is the middle of the upload
 * handler, and that middle is where an upload becomes a stored file:
 *
 *   - the 10 MB ceiling, which is enforced *while streaming* rather than after, and
 *     which has to destroy the request rather than merely refuse it;
 *   - the four magic-number checks, which are the only thing standing between "a
 *     caller said `image/png`" and "these bytes are a PNG".
 *
 * WHY THE SIGNATURES MATTER MORE THAN THE CONTENT-TYPE HEADER
 *
 * The declared type is attacker-chosen. `hasValidImageSignature` is the check that
 * the bytes are what the server will later serve back with that type's
 * `Content-Type`, and it is the boundary against serving attacker-controlled bytes
 * as `image/svg+xml` — which browsers execute as script when a URL points at one, and
 * which this route's `ALLOWED_TYPES` correctly excludes. So the interesting cases are
 * the near-misses: bytes that *look* like another format, and truncated headers.
 *
 * Mounted on a bare app with no session required, because the capability of interest
 * is reachable by anyone who can reach the route — the auth assertion belongs to
 * `images.test.ts` and duplicating it would only slow that suite down.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signToken } from '@dripl/utils/auth';

// `authMiddleware` resolves the token's stored generation through `@dripl/db`; the
// image router never queries anything else, so this `user` stub is the only query.
const { userFind } = vi.hoisted(() => ({
  userFind: vi.fn(async () => ({ tokenVersion: 0 })),
}));

vi.mock('@dripl/db', async () => {
  const { fakeRevocation } = await import('../test-utils/fakeDbModule');
  const db = { user: { findUnique: userFind } };
  return { db, ...(await fakeRevocation(db as never)) };
});

let storageDir = '';
let app: express.Express;

/** Bytes carrying each format's magic number, plus trailing bytes. */
const SIGNATURES = {
  png: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  gif: Buffer.from('GIF89a......', 'ascii'),
  webp: Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x1a, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'ascii'),
  ]),
} as const;

beforeEach(async () => {
  storageDir = await mkdtemp(join(tmpdir(), 'dripl-img-guard-'));
  vi.stubEnv('IMAGE_STORAGE_DIR', storageDir);
  vi.stubEnv('JWT_SECRET', 'image-guard-secret');
  vi.resetModules();
  const { imagesRouter } = await import('../../routes/images');
  app = express();
  app.use('/api/images', imagesRouter);
});

afterEach(async () => {
  await rm(storageDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  userFind.mockResolvedValue({ tokenVersion: 0 });
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function auth(): string {
  return `Bearer ${signToken('user-1', 0)}`;
}

async function upload(body: Buffer, contentType: string): Promise<request.Response> {
  return request(app)
    .post('/api/images')
    .set('Authorization', auth())
    .set('Content-Type', contentType)
    .send(body);
}

/** Everything currently on disk in the storage directory. */
async function stored(): Promise<string[]> {
  const { readdir: read } = await import('node:fs/promises');
  return read(storageDir);
}

describe('the content-type allowlist is matched on the base type only', () => {
  /**
   * A charset parameter must not change the verdict.
   *
   * Browsers and `curl` both append parameters, and a check on the raw header would
   * reject every legitimate `image/png; charset=binary` upload while still accepting
   * the attack it exists to stop.
   */
  it('accepts an allowed type carrying a parameter', async () => {
    const response = await upload(SIGNATURES.png, 'image/png; charset=binary');

    expect(response.status).toBe(201);
    expect(response.body.id).toMatch(/\.png$/);
  });

  /**
   * And the extension follows the *declared* type, not the bytes.
   *
   * Asserted because the id is what the download route derives `Content-Type` from:
   * an id ending in the wrong extension would serve PNG bytes as `image/gif` to every
   * viewer, which is a rendering bug at best.
   */
  it('names the stored file after the declared type', async () => {
    for (const [type, bytes] of Object.entries(SIGNATURES)) {
      const response = await upload(bytes, `image/${type === 'jpeg' ? 'jpeg' : type}`);
      expect(response.status, type).toBe(201);
      const extension = type === 'jpeg' ? 'jpg' : type;
      expect(response.body.id, type).toMatch(new RegExp(`\\.${extension}$`));
    }
  });
});

describe('the signature check refuses bytes that are not the declared type', () => {
  /**
   * Cross-format substitution, which is the actual attack.
   *
   * A caller that declares `image/png` and uploads GIF bytes gets a file the server
   * will later serve as `image/png`. The reverse direction is worse: declaring a type
   * outside `ALLOWED_TYPES` is already refused, so what remains is bytes whose magic
   * number belongs to a *different allowed* format — which some browsers and image
   * pipelines sniff regardless of the declared type.
   *
   * Asserted as a matrix rather than a spot check, because the check is a `switch` with
   * one arm per format and a per-arm omission is invisible from any single case.
   */
  it('refuses every pairing of a declared type with another format’s bytes', async () => {
    const contentTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    const accepted: Array<[string, string]> = [];

    for (const declared of contentTypes) {
      for (const [format, bytes] of Object.entries(SIGNATURES)) {
        const response = await upload(bytes, declared);
        if (response.status === 201) accepted.push([declared, format]);
        else expect(response.status, `${declared} + ${format}`).toBe(400);
      }
    }

    // Exactly the four honest pairings survived. Anything else here is a signature
    // check that accepted the wrong bytes.
    expect(accepted.sort()).toEqual(
      [
        ['image/png', 'png'],
        ['image/jpeg', 'jpeg'],
        ['image/gif', 'gif'],
        ['image/webp', 'webp'],
      ].sort()
    );
  });

  /**
   * A truncated header is refused, not accepted on a partial match.
   *
   * Each check is `length >= N && ...`, and the length guards are the part that is easy
   * to drop: `buffer[0] === 0xff && buffer[1] === 0xd8` without a length guard reads
   * `undefined` past the end and is falsy anyway — but `subarray(0, 6).toString()` on a
   * 3-byte buffer does *not* throw, it yields a short string, so the GIF and WEBP arms
   * are the ones where a missing length guard turns into a real accept.
   */
  it('refuses a body too short to carry the declared format’s header', async () => {
    for (const [declared, bytes] of [
      ['image/png', SIGNATURES.png.subarray(0, 4)],
      ['image/jpeg', SIGNATURES.jpeg.subarray(0, 2)],
      ['image/gif', SIGNATURES.gif.subarray(0, 4)],
      ['image/webp', SIGNATURES.webp.subarray(0, 8)],
    ] as Array<[string, Buffer]>) {
      const response = await upload(bytes, declared);
      expect(response.status, `${declared} with ${bytes.length} bytes`).toBe(400);
      expect(response.body.error).toBe('INVALID_IMAGE');
    }
  });

  /**
   * An empty body is refused, and nothing is written.
   *
   * The `buffer.length >= N` guards are all false for a zero-length buffer, so every
   * declared type is refused — which is the one case where the `default:` arm of the
   * switch is *not* what answers. Asserted against the whole allowlist so a future
   * format added to `ALLOWED_TYPES` without a signature check is caught here.
   */
  it('refuses an empty body for every allowed type, writing nothing', async () => {
    for (const declared of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      const response = await upload(Buffer.alloc(0), declared);
      expect(response.status, declared).toBe(400);
    }
    expect(await stored()).toEqual([]);
  });

  /**
   * A body of plain text is refused for every allowed type.
   *
   * The control for the case above: an empty body is refused by the length guards, so
   * a signature check that returned `true` for everything non-image would also pass it.
   */
  it('refuses a text body for every allowed type', async () => {
    const text = '<svg onload=alert(1)>';
    for (const declared of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      const response = await upload(Buffer.from(text, 'utf8'), declared);
      expect(response.status, declared).toBe(400);
    }
    expect(await stored()).toEqual([]);
  });
});

describe('the 10 MB ceiling is enforced while streaming', () => {
  /**
   * The refusal itself, and that it is a 413 rather than a 400.
   *
   * The size check is a different failure from the signature check — "too big to
   * store" versus "not what you said it was" — and the client needs to tell them
   * apart, because one is worth retrying smaller and the other is not.
   */
  it('refuses a body over the ceiling with 413 PAYLOAD_TOO_LARGE', async () => {
    // A real PNG header followed by enough bytes to cross 10 MB, so the request is
    // rejected for its size and not for its content.
    const oversized = Buffer.concat([SIGNATURES.png, Buffer.alloc(10 * 1024 * 1024, 0)]);

    const response = await upload(oversized, 'image/png');

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: 'PAYLOAD_TOO_LARGE',
      message: 'Image too large. Maximum size is 10MB.',
      statusCode: 413,
    });
    expect(await stored()).toEqual([]);
  });

  /**
   * The boundary: a body under the ceiling with a valid header is stored.
   *
   * Without this the case above would pass for a handler that refuses everything, and
   * the size check would be untested rather than proven.
   */
  it('stores a body just under the ceiling', async () => {
    const large = Buffer.concat([SIGNATURES.png, Buffer.alloc(9 * 1024 * 1024, 0)]);

    const response = await upload(large, 'image/png');

    expect(response.status).toBe(201);
    expect(response.body.size).toBe(large.length);
  });
});

describe('the upload URL is derived from the configured API base', () => {
  /**
   * The URL the client is handed back.
   *
   * The response `url` is what a client pastes into a canvas. Derived from
   * `NEXT_PUBLIC_API_URL`, with `/api` appended when the configured value does not
   * already end in it — so a configuration change here silently produces 404s on every
   * uploaded image, with the upload itself reporting 201.
   *
   * Asserted on the exact string rather than a shape, and across both the
   * already-suffixed and not-suffixed configurations, because the two go through
   * different halves of that expression.
   */
  it('produces a URL under /api/images for either form of the configured base', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test/api');
    const withSuffix = await upload(SIGNATURES.png, 'image/png');
    expect(withSuffix.body.url).toBe(`https://api.example.test/api/images/${withSuffix.body.id}`);

    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test');
    const withoutSuffix = await upload(SIGNATURES.png, 'image/png');
    expect(withoutSuffix.body.url).toBe(
      `https://api.example.test/api/images/${withoutSuffix.body.id}`
    );
  });

  /**
   * A configured base with a trailing slash still yields one `/api`.
   *
   * The `.replace(/\/$/, '')` exists for this. Dropped, the URL becomes `//api/images`,
   * which some proxies normalise and some do not — an intermittent 404 on uploads
   * that depends on the CDN in front.
   */
  it('does not double the slash for a base with a trailing one', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test/');

    const response = await upload(SIGNATURES.png, 'image/png');

    expect(response.body.url).toBe(`https://api.example.test/api/images/${response.body.id}`);
  });
});
