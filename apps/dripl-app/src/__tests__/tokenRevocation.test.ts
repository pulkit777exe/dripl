/**
 * Revocation across dripl-app's three session readers.
 *
 * Each of these reads the `dripl-session` cookie itself and verifies the JWT
 * against `JWT_SECRET`, and none of them proxies to `http-server` first. So each is
 * a place a captured token is accepted, and each is covered here rather than assumed
 * to inherit the server's check:
 *
 *   1. `POST /api/ai/generate`            -- `app/api/ai/generate/route.ts`
 *   2. `GET/POST /api/canvas/snapshots`   -- `app/api/canvas/snapshots/_lib/session.ts`
 *   3. `lib/server/session.ts`            -- the Server Components' reader, driven here
 *                                            through its exported `userIdFromCandidates`
 *
 * The reader in (3) is what makes every dashboard page's authentication gate, so a
 * revoked token has to fail there too or a logged-out user's `/dashboard` would keep
 * rendering. It has no HTTP surface of its own, which is exactly why it is the one
 * most likely to be forgotten and the reason it is exercised directly.
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { signToken } from '@dripl/utils/auth';

/**
 * The stored generation, and the one store every reader resolves through.
 *
 * `vi.hoisted` because the mock factory is hoisted above ordinary bindings. The
 * production revocation functions are bound to this store by `revocationExports`,
 * so what is under test is the server's comparison rather than a suite's arithmetic.
 */
const { store, setGeneration } = vi.hoisted(() => {
  const generations = new Map<string, number>();
  return {
    store: {
      user: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          generations.has(where.id) ? { tokenVersion: generations.get(where.id) as number } : null,
        update: async ({ where }: { where: { id: string } }) => {
          const next = (generations.get(where.id) ?? 0) + 1;
          generations.set(where.id, next);
          return { tokenVersion: next };
        },
      },
    },
    setGeneration: (userId: string, generation: number) => generations.set(userId, generation),
  };
});

vi.mock('@dripl/db', async () => {
  const { revocationExports } = await import('./helpers/revocation');
  return {
    initializeDb: async () => snapshotClient,
    db: snapshotClient,
    ...(await revocationExports(store)),
  };
});

/**
 * The Prisma surface the snapshot collection route touches: one `File` lookup for
 * ownership, and the snapshot reads behind it.
 */
const snapshotClient = {
  file: {
    findFirst: async ({ where }: { where: { id: string; userId?: string } }) => {
      const row = files.get(where.id);
      if (!row) return null;
      // Mirrors `WHERE id = $1 AND user_id = $2`: somebody else's canvas and a
      // canvas that does not exist are the same empty result.
      if (where.userId !== undefined && row.userId !== where.userId) return null;
      return { id: row.id, userId: row.userId };
    },
  },
  canvasSnapshot: {
    findMany: async () => [],
    count: async () => 0,
  },
};

const JWT_SECRET = 'test-jwt-secret-for-dripl-app-revocation-tests';
vi.stubEnv('JWT_SECRET', JWT_SECRET);
vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
vi.stubEnv('TRUST_PROXY', 'true');

/** The caller under test, and the canvas it owns in the snapshot harness. */
const OWNER = 'user-revocation-owner';

const mockGenerateContent = vi.fn();
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent: mockGenerateContent };
    }
  },
}));

/**
 * Snapshot storage, enough for `GET /api/canvas/snapshots` to answer 200 rather
 * than 500. Without it the route gets past the identity gate -- which is what is
 * under test -- and then fails on storage, which would make every refusal here
 * ambiguous between "revoked" and "broken harness".
 */
const { files } = vi.hoisted(() => ({
  files: new Map<string, { id: string; userId: string | null }>(),
}));

const { POST: aiPost } = await import('../../app/api/ai/generate/route');
const { GET: snapshotsList } = await import('../../app/api/canvas/snapshots/route');
const { userIdFromCandidates } = await import('../../lib/server/session');

const CANVAS_ID = 'file-owned-by-owner';

/** A token for `OWNER` at `generation`, ready to go in a cookie or a header. */
const tokenAt = (generation: number): string => signToken(OWNER, generation);

/**
 * An HS256 token carrying only `userId` -- no `ver` claim at all.
 *
 * Hand-assembled rather than produced by `signToken`, because `signToken` requires a
 * version and that is the point: this is the shape every token in circulation had
 * before the column existed, and it has to be expressible to be tested.
 * `jsonwebtoken` is not a dependency of this app (the boundaries gate enforces it),
 * so the three segments are built directly -- which is also why the header and
 * payload are byte-stable for a reader that only inspects claims.
 */
function tokenWithoutVersionClaim(): string {
  const b64 = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ userId: OWNER })}`)
    .digest('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ userId: OWNER })}.${signature}`;
}

function aiRequest(token: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/ai/generate', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
      cookie: `dripl-session=${token}`,
    },
    body: JSON.stringify({ prompt: 'draw a rectangle' }),
  });
}

function snapshotsRequest(token: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/canvas/snapshots?canvasId=${CANVAS_ID}`, {
    headers: { cookie: `dripl-session=${token}` },
  });
}

describe('token revocation across dripl-app session readers', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '[{"type":"rectangle","x":100,"y":100}]' },
    });
    setGeneration(OWNER, 0);
    files.clear();
    files.set(CANVAS_ID, { id: CANVAS_ID, userId: OWNER });
  });

  describe('POST /api/ai/generate', () => {
    it('accepts a current token', async () => {
      const response = await aiPost(aiRequest(tokenAt(0)));

      expect(response.status).toBe(200);
    });

    it('refuses a token the account has revoked', async () => {
      setGeneration(OWNER, 1);

      const response = await aiPost(aiRequest(tokenAt(0)));

      expect(response.status).toBe(401);
      // Refused before the model was ever consulted: a revoked credential must not
      // be able to spend an API key.
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('refuses a revoked token presented as a bearer header too', async () => {
      setGeneration(OWNER, 1);

      const response = await aiPost(
        new NextRequest('http://localhost:3000/api/ai/generate', {
          method: 'POST',
          headers: {
            origin: 'http://localhost:3000',
            'content-type': 'application/json',
            authorization: `Bearer ${tokenAt(0)}`,
          },
          body: JSON.stringify({ prompt: 'draw a rectangle' }),
        })
      );

      expect(response.status).toBe(401);
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('refuses a token whose account does not exist', async () => {
      const response = await aiPost(aiRequest(signToken('user-ghost', 0)));

      expect(response.status).toBe(401);
    });

    it('refuses a token minted at a generation ahead of storage', async () => {
      const response = await aiPost(aiRequest(tokenAt(99)));

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/canvas/snapshots', () => {
    it('accepts a current token', async () => {
      const response = await snapshotsList(snapshotsRequest(tokenAt(0)));

      expect(response.status).toBe(200);
    });

    it('refuses a token the account has revoked', async () => {
      setGeneration(OWNER, 1);

      const response = await snapshotsList(snapshotsRequest(tokenAt(0)));

      expect(response.status).toBe(401);
    });

    /**
     * A revoked token must get the same answer as a forged one.
     *
     * If the two differed, the difference would be a revocation oracle: a caller
     * could hold a token and poll it to learn whether the account had revoked
     * anything. They are byte-identical here, which is the point of asserting both.
     */
    it('answers a revoked token exactly as it answers a forged one', async () => {
      setGeneration(OWNER, 1);

      const revoked = await snapshotsList(snapshotsRequest(tokenAt(0)));
      const forged = await snapshotsList(
        new NextRequest('http://localhost:3000/api/canvas/snapshots?canvasId=file-owned-by-owner', {
          headers: { cookie: 'dripl-session=a.b.c' },
        })
      );

      expect(revoked.status).toBe(forged.status);
      expect(await revoked.text()).toBe(await forged.text());
    });
  });

  describe('lib/server/session.ts (the Server Components reader)', () => {
    it('accepts a current token', async () => {
      expect(await userIdFromCandidates([tokenAt(0)])).toBe(OWNER);
    });

    it('refuses a token the account has revoked', async () => {
      setGeneration(OWNER, 1);

      // This is the gate on `/dashboard` and its children. A revoked token that
      // still resolved here would keep rendering an authenticated shell after logout.
      expect(await userIdFromCandidates([tokenAt(0)])).toBeNull();
    });

    it('skips a revoked candidate and accepts a live one', async () => {
      setGeneration(OWNER, 1);

      // The cookie can hold a stale token alongside a fresh one -- a device that
      // logged in again elsewhere -- and the reader must not fail the request just
      // because the first candidate is dead.
      const fresh = signToken('user-second-device', 0);
      setGeneration('user-second-device', 0);

      expect(await userIdFromCandidates([tokenAt(0), fresh])).toBe('user-second-device');
    });

    it('returns null for a token whose account does not exist', async () => {
      expect(await userIdFromCandidates([signToken('user-ghost', 0)])).toBeNull();
    });
  });

  describe('tokens issued before the version column existed', () => {
    it('keeps working until the account revokes, then stops', async () => {
      // No `ver` claim at all -- the shape every token in circulation carried when
      // this shipped. Rejecting it on deploy would sign every user out; accepting it
      // as the initial generation lets it expire on its own schedule and die at the
      // first revocation. Both halves are asserted, because either alone passes.
      const preColumn = tokenWithoutVersionClaim();

      expect(await userIdFromCandidates([preColumn])).toBe(OWNER);

      setGeneration(OWNER, 1);

      expect(await userIdFromCandidates([preColumn])).toBeNull();
    });
  });
});
