/**
 * THE PUBLIC SHARE READ PATH, `GET /api/share/:token`.
 *
 * This route has no authentication at all — the token in the URL *is* the
 * credential — which makes it the widest disclosure surface in this server and the
 * one place where a wrong answer is a data leak rather than a wrong status code.
 * It also had no coverage: `shareRoute.test.ts` covers `POST /api/share` and the
 * `ws-ticket` bridge, and stops at the router.
 *
 * The properties worth pinning, and why each is a leak if lost:
 *
 *   1. **`no-store` on every answer**, including the errors. A shared canvas
 *      rendered from a cache is still rendered for the next person to open that
 *      URL, and an expired link cached as a 410 keeps saying 410 after the owner
 *      re-issues it.
 *   2. **Revocation is honoured.** A file whose `sharePermission` was cleared must
 *      answer 404, not the scene. This is what `DELETE /api/files/:id/share`
 *      promises.
 *   3. **Expiry is a distinct, non-revealing answer.** 410 rather than 404, because
 *      a viewer whose link expired needs to be told why; and 410 only for expiry,
 *      never for a file that never had a share.
 *   4. **An encrypted canvas never also serves its plaintext.** `resolveShare`
 *      nulls `elements` when the row carries an `encryptedPayload`, and this route
 *      must pass that through rather than substituting an empty list — which would
 *      look like a working share with nothing in it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow() {
      return {};
    }
    async limit() {
      return { success: true, remaining: 999, reset: Date.now() + 60_000 };
    }
  },
}));
vi.mock('@upstash/redis', () => ({ Redis: class {} }));

// The in-memory fake over the production revocation functions: `shareRouter` puts
// `authMiddleware` in front of `POST /` only, but the module still imports the
// revocation resolver, so it has to exist.
vi.mock('@dripl/db', async () => {
  const { fakeDbModule } = await import('../test-utils/fakeDbModule');
  return fakeDbModule();
});

import express from 'express';
import request from 'supertest';
import { shareRouter } from '../../routes/share';
import { ShareService } from '../../services/shareService';
import { fakeDb, resetFakeDb } from '../test-utils/fakePrisma';

/** No authentication in front: this is the route a share URL reaches. */
function app(): express.Express {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/share', shareRouter);
  return instance;
}

const OWNER_ID = 'user-owner';
const FILE_ID = 'file-1';
const TOKEN = 'share-token-value';

const ELEMENT = { id: 'el-1', type: 'rectangle', x: 0, y: 0, width: 100, height: 80 };

function seedFile(overrides: Record<string, unknown> = {}): void {
  fakeDb().seed('file', {
    id: FILE_ID,
    userId: OWNER_ID,
    name: 'Shared canvas',
    content: JSON.stringify([ELEMENT]),
    folderId: null,
    preview: null,
    shareToken: TOKEN,
    sharePermission: 'view',
    shareExpiresAt: null,
    ...overrides,
  });
}

beforeEach(() => {
  resetFakeDb();
  seedFile();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/share/:token — the resolved share', () => {
  /**
   * The whole point of the route, and the reason it needs authentication nowhere.
   *
   * Asserted field by field rather than on the body as a whole, because the fields
   * have different consequences: `permission` is the authorisation the viewer gets
   * and must be the *stored* one, not the schema's default; `file` must not carry
   * `content`, `userId` or `shareToken`, all of which this query does not select and
   * any of which would be a disclosure on a credential-free route.
   */
  it('serves the scene, the stored permission and no owner-side columns', async () => {
    const response = await request(app()).get(`/api/share/${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.permission).toBe('view');
    expect(response.body.elements).toEqual([ELEMENT]);
    expect(response.body.file).toEqual({
      id: FILE_ID,
      name: 'Shared canvas',
      updatedAt: expect.any(String),
    });
    expect(response.body.file).not.toHaveProperty('content');
    expect(response.body.file).not.toHaveProperty('userId');
    expect(response.body.file).not.toHaveProperty('shareToken');
  });

  /**
   * `no-store` on the success path.
   *
   * A shared canvas is served to a browser that a third party may be watching, and
   * a cached copy survives the session. The header is asserted on the body that
   * carries the scene, not merely on an error.
   */
  it('marks the scene as uncacheable', async () => {
    const response = await request(app()).get(`/api/share/${TOKEN}`);

    expect(response.headers['cache-control']).toBe('no-store');
  });

  /**
   * A revoked share stops answering with the scene.
   *
   * `sharePermission: null` is what `DELETE /api/files/:id/share` writes. If
   * `resolveShare` stopped treating it as absent, the revocation would be cosmetic
   * and every previously-issued URL would keep working forever.
   */
  it('answers 404 for a file whose share was revoked', async () => {
    seedFile({ shareToken: TOKEN, sharePermission: null });

    const response = await request(app()).get(`/api/share/${TOKEN}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'NOT_FOUND',
      message: 'Share link not found',
      statusCode: 404,
    });
    // Nothing about the canvas in the refusal.
    expect(response.text).not.toContain('el-1');
  });

  it('answers 404 for a token that matches no file', async () => {
    const response = await request(app()).get('/api/share/never-issued');

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Share link not found');
  });

  /**
   * Expiry is 410, and it is distinct from absence.
   *
   * The two answers say different things to the viewer — "come back later" versus
   * "ask the owner" — so collapsing them would strand people who could still be
   * helped by a re-share. Asserted as both the status and the exact body, because
   * `resolveShare` marks expiry on the *result* and the route maps it, and either
   * half could be dropped.
   */
  it('answers 410 EXPIRED for an elapsed expiry, and still serves the row it names', async () => {
    seedFile({ shareExpiresAt: new Date(Date.now() - 1_000) });

    const response = await request(app()).get(`/api/share/${TOKEN}`);

    expect(response.status).toBe(410);
    expect(response.body).toEqual({
      error: 'EXPIRED',
      message: 'Share link has expired',
      statusCode: 410,
    });
    // The expired answer carries no scene: the file id alone would confirm the
    // canvas exists to somebody holding a dead link.
    expect(response.body).not.toHaveProperty('elements');
    expect(response.body).not.toHaveProperty('file');
  });

  /**
   * An expiry in the future is not an expiry. A comparison inverted to `<=` would
   * expire every link at the instant it was issued, which looks exactly like a
   * working revocation and is invisible until a user reports their link is dead.
   */
  it('does not treat a future expiry as elapsed', async () => {
    seedFile({ shareExpiresAt: new Date(Date.now() + 3_600_000) });

    const response = await request(app()).get(`/api/share/${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.elements).toEqual([ELEMENT]);
  });

  /**
   * An encrypted canvas serves the ciphertext and *no* elements.
   *
   * `resolveShare` returns `elements: null` when the row carries an
   * `encryptedPayload`, because the client decrypts with a key that never reached
   * this server. If the route substituted an empty list instead, the share would
   * load as a blank canvas and the owner's "my link is broken" report would be
   * unactionable — the server would have nothing wrong with it.
   */
  it('serves the encrypted payload and withholds elements for an encrypted canvas', async () => {
    fakeDb().seed('file', {
      id: 'file-encrypted',
      userId: OWNER_ID,
      name: 'Encrypted canvas',
      content: JSON.stringify({
        elements: [],
        encryptedPayload: { iv: 'aXY=', data: 'Y2lwaGVy' },
        encryptedAt: '2026-01-01T00:00:00.000Z',
      }),
      folderId: null,
      preview: null,
      shareToken: 'encrypted-token',
      sharePermission: 'view',
      shareExpiresAt: null,
    });

    const response = await request(app()).get('/api/share/encrypted-token');

    expect(response.status).toBe(200);
    expect(response.body.encryptedPayload).toEqual({ iv: 'aXY=', data: 'Y2lwaGVy' });
    // Null, not `[]`: the distinction is what tells the client to decrypt rather
    // than to render an empty scene.
    expect(response.body.elements).toBeNull();
  });

  /**
   * A stored scene that is not a valid scene is not served as one.
   *
   * The `content` column is a serialised envelope from ADR-004, so a row written by
   * an older shape — or by anything that got the envelope wrong — must not reach a
   * viewer as a scene. `isValidSceneContent` in `resolveShare` is the filter;
   * dropping it would hand a client arbitrary JSON in the `elements` field.
   */
  it('withholds elements when the stored scene does not validate', async () => {
    seedFile({
      content: JSON.stringify({
        elements: [{ id: 'broken', type: 'not-a-real-type' }],
        encryptedPayload: null,
        encryptedAt: null,
      }),
    });

    const response = await request(app()).get(`/api/share/${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.elements).toEqual([]);
  });

  it('answers 500 rather than a partial body when the service throws', async () => {
    const boom = vi.spyOn(ShareService, 'resolveShare').mockRejectedValueOnce(new Error('db down'));

    const response = await request(app()).get(`/api/share/${TOKEN}`);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'INTERNAL_ERROR',
      message: 'Failed to load shared file',
      statusCode: 500,
    });
    // The database's message is not echoed to a credential-free route.
    expect(response.text).not.toContain('db down');
    boom.mockRestore();
  });
});

describe('GET /api/share/:token — the rate limiter on an unauthenticated route', () => {
  /**
   * The share limiter is 30 requests per 15 minutes, and this route is reachable
   * with no credential at all — so the limiter is the only thing standing between
   * an attacker and an unbounded enumeration of share tokens.
   *
   * Driven by exhausting the budget on a private app: the limiter is constructed at
   * module load, so exhausting the shared one would refuse every later request in
   * this file, including the cases above.
   */
  it('answers 429 with a usable Retry-After once the caller is over budget', async () => {
    vi.resetModules();
    const fresh = await import('../../routes/share');
    const instance = express();
    instance.use(express.json());
    instance.use('/api/share', fresh.shareRouter);

    let refusal: request.Response | undefined;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const res = await request(instance).get(`/api/share/${TOKEN}`);
      if (res.status === 429) {
        refusal = res;
        break;
      }
    }

    expect(refusal?.status).toBe(429);
    expect(refusal?.body).toEqual({
      error: 'RATE_LIMITED',
      message: 'Too many requests, please try again later.',
      statusCode: 429,
    });
    const retryAfter = Number(refusal?.headers['retry-after']);
    expect(Number.isFinite(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
  });

  /**
   * The control: an in-budget caller is served.
   *
   * Without it, "429 eventually" would also pass if the route simply always
   * answered 429.
   */
  it('serves a caller who is inside its budget', async () => {
    const response = await request(app()).get(`/api/share/${TOKEN}`);

    expect(response.status).toBe(200);
  });
});
