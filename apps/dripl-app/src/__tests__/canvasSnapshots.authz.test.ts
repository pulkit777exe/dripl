import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signToken } from '@dripl/utils/auth';

/**
 * Access control for the snapshot collection routes.
 *
 * `canvasSnapshots.test.ts` already covers the route contract — payload
 * validation, durability, capacity, rate limiting — with a Prisma stand-in. It
 * treats every caller as trusted, which was the gap: nothing in the collection
 * route ever asked whether the caller owns the `canvasId` it was handed, so a
 * guessed slug was enough to enumerate and to write into somebody else's
 * version history.
 *
 * This file is the other half: it holds two callers and two `File` rows, and
 * asserts the matrix between them. The properties that matter are:
 *
 *  - `GET /snapshots/[id]` stays public. A share link with no credential at
 *    all still resolves, and unknown/expired ids still 404. Unchanged.
 *  - `GET /snapshots?canvasId=` requires ownership, and a refusal is
 *    byte-identical to the refusal for a slug that does not exist.
 *  - `POST` requires ownership of a supplied `canvasId`, and stays anonymous
 *    without one.
 *
 * Both fake delegates (`file`, `canvasSnapshot`) live here and are shared by
 * every test in the file, mirroring how the routes read real storage: through
 * `@dripl/db`, with no in-process shortcut.
 */
const harness = vi.hoisted(() => {
  interface FileRow {
    id: string;
    userId: string | null;
  }
  interface SnapshotRow {
    id: string;
    canvasId: string | null;
    data: string;
    createdAt: Date;
    expiresAt: Date;
  }

  const files = new Map<string, FileRow>();
  const snapshots = new Map<string, SnapshotRow>();
  const state = {
    /** Fails every delegate, so a route that reaches storage errors out. */
    failure: null as Error | null,
    /** Counted so a test can assert a gate ran before storage was consulted. */
    fileLookups: 0,
    snapshotReads: 0,
    writes: 0,
  };

  const isLive = (row: SnapshotRow, cutoff: Date | undefined): boolean =>
    cutoff === undefined || row.expiresAt.getTime() > cutoff.getTime();

  const client = {
    file: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; userId?: string };
      }): Promise<FileRow | null> => {
        state.fileLookups += 1;
        if (state.failure) throw state.failure;
        // Mirrors `WHERE id = $1 AND user_id = $2`: a slug owned by somebody
        // else and a slug that does not exist are the same empty result.
        const row = files.get(where.id);
        if (!row) return null;
        if (where.userId !== undefined && row.userId !== where.userId) return null;
        return { id: row.id, userId: row.userId };
      },
    },
    canvasSnapshot: {
      create: async ({ data }: { data: SnapshotRow }): Promise<SnapshotRow> => {
        state.writes += 1;
        if (state.failure) throw state.failure;
        const row: SnapshotRow = { ...data, canvasId: data.canvasId ?? null };
        snapshots.set(row.id, row);
        return { ...row };
      },
      findFirst: async ({
        where,
      }: {
        where: { id: string; expiresAt?: { gt?: Date } };
      }): Promise<{ data: string } | null> => {
        state.snapshotReads += 1;
        if (state.failure) throw state.failure;
        const row = snapshots.get(where.id);
        if (!row) return null;
        if (!isLive(row, where.expiresAt?.gt)) return null;
        return { data: row.data };
      },
      findMany: async ({
        where,
        orderBy,
      }: {
        where: { canvasId: string; expiresAt?: { gt?: Date } };
        orderBy: Array<{ createdAt: 'desc' } | { id: 'desc' }>;
      }): Promise<SnapshotRow[]> => {
        state.snapshotReads += 1;
        if (state.failure) throw state.failure;
        return [...snapshots.values()]
          .filter(row => row.canvasId === where.canvasId)
          .filter(row => isLive(row, where.expiresAt?.gt))
          .sort((a, b) => {
            for (const clause of orderBy) {
              if ('createdAt' in clause) {
                const delta = b.createdAt.getTime() - a.createdAt.getTime();
                if (delta !== 0) return delta;
              } else if (a.id !== b.id) {
                return a.id < b.id ? 1 : -1;
              }
            }
            return 0;
          })
          .map(row => ({ ...row }));
      },
      count: async ({ where }: { where: { expiresAt?: { gt?: Date } } }): Promise<number> => {
        if (state.failure) throw state.failure;
        return [...snapshots.values()].filter(row => isLive(row, where.expiresAt?.gt)).length;
      },
      deleteMany: async ({ where }: { where: { expiresAt?: { lte?: Date } } }) => {
        if (state.failure) throw state.failure;
        let count = 0;
        for (const [id, row] of snapshots) {
          const cutoff = where.expiresAt?.lte;
          if (cutoff && row.expiresAt.getTime() <= cutoff.getTime()) {
            snapshots.delete(id);
            count += 1;
          }
        }
        return { count };
      },
    },
  };

  return { files, snapshots, state, client };
});

// The three principals in this file all sit at the initial generation. Listed by
// name rather than left open, because an unlisted subject must be *refused* --
// that is what `getSnapshotCaller` now does, and a store that answers for anyone
// would hide the very case this suite exists to cover.
const { sessionStore, setGeneration } = vi.hoisted(() => {
  const generations = new Map<string, number>();
  return {
    sessionStore: {
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
    initializeDb: async () => harness.client,
    db: harness.client,
    ...(await revocationExports(sessionStore)),
  };
});

const { GET, POST } = await import('../../app/api/canvas/snapshots/route');
const { GET: GET_BY_ID } = await import('../../app/api/canvas/snapshots/[id]/route');
const { clearSnapshotRateLimitState } =
  await import('../../app/api/canvas/snapshots/_lib/snapshotRateLimit');
const { resetSnapshotSweepState } =
  await import('../../app/api/canvas/snapshots/_lib/snapshotStore');

const { files, snapshots, state } = harness;

const JWT_SECRET = 'test-jwt-secret-for-snapshot-authz-tests';
const OWNER = 'user-owner';
const STRANGER = 'user-stranger';
/** Holds a valid session but owns nothing in this file. */
const THIRD_PARTY = 'user-third-party';

/** Slugs that resolve to a `File` row, and one that resolves to nothing. */
const OWNED_CANVAS = 'file-owned';
const FOREIGN_CANVAS = 'file-foreign';
const MISSING_CANVAS = 'file-that-does-not-exist';

const element = {
  id: 'authz-element',
  type: 'rectangle' as const,
  x: 0,
  y: 0,
  width: 20,
  height: 20,
};

const SCENE = JSON.stringify([element]);

vi.stubEnv('JWT_SECRET', JWT_SECRET);
vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
vi.stubEnv('TRUST_PROXY', 'true');

/**
 * Signed *before* the secret is stubbed away, so the "no JWT_SECRET" test can
 * still present a genuine token to a route that refuses to look at one.
 */
function tokenFor(userId: string, secret: string = JWT_SECRET): string {
  const active = process.env.JWT_SECRET;
  vi.stubEnv('JWT_SECRET', secret);
  try {
    return signToken(userId, 0);
  } finally {
    if (active === undefined) vi.unstubAllEnvs();
    else vi.stubEnv('JWT_SECRET', active);
  }
}

function post(
  body: unknown,
  options: { userId?: string; token?: string; headers?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    origin: 'http://localhost:3000',
    'x-forwarded-for': '198.51.100.20',
    ...options.headers,
  };
  if (options.token !== undefined) {
    headers.cookie = `dripl-session=${options.token}`;
  } else if (options.userId !== undefined) {
    headers.cookie = `dripl-session=${tokenFor(options.userId)}`;
  }
  return new NextRequest('http://localhost:3000/api/canvas/snapshots', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function list(canvasId: string, options: { userId?: string; token?: string } = {}) {
  const headers: Record<string, string> = { 'x-forwarded-for': '198.51.100.21' };
  if (options.token !== undefined) {
    headers.cookie = `dripl-session=${options.token}`;
  } else if (options.userId !== undefined) {
    headers.cookie = `dripl-session=${tokenFor(options.userId)}`;
  }
  return new NextRequest(
    `http://localhost:3000/api/canvas/snapshots?canvasId=${encodeURIComponent(canvasId)}`,
    { headers }
  );
}

function read(id: string, options: { userId?: string } = {}) {
  const headers: Record<string, string> = {};
  if (options.userId !== undefined) headers.cookie = `dripl-session=${tokenFor(options.userId)}`;
  return GET_BY_ID(new Request(`http://localhost:3000/api/canvas/snapshots/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

/** Status plus the exact response text, so two answers can be compared byte for byte. */
async function shape(
  response: Response
): Promise<{ status: number; body: string; cacheControl: string | null }> {
  return {
    status: response.status,
    body: await response.text(),
    cacheControl: response.headers.get('cache-control'),
  };
}

/** Post a scene and return its id, failing loudly if the write was refused. */
async function createSnapshotId(
  scene: string,
  canvasId: string | undefined,
  options: { userId?: string } = {}
): Promise<string> {
  const response = await POST(
    post({ data: scene, ...(canvasId === undefined ? {} : { canvasId }) }, options)
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { id: string }).id;
}

describe('snapshot access control', () => {
  beforeEach(() => {
    clearSnapshotRateLimitState();
    resetSnapshotSweepState();
    files.clear();
    snapshots.clear();
    // All three principals sit at generation 0, matching the `ver` claim
    // `tokenFor` signs. Stated per test rather than seeded once, so a test that
    // revokes cannot leak a bumped generation into the next one.
    setGeneration(OWNER, 0);
    setGeneration(STRANGER, 0);
    setGeneration(THIRD_PARTY, 0);
    state.failure = null;
    state.fileLookups = 0;
    state.snapshotReads = 0;
    state.writes = 0;
    // Two real `File` rows: one the owner has, one a stranger has. `MISSING_CANVAS`
    // deliberately has no row at all.
    files.set(OWNED_CANVAS, { id: OWNED_CANVAS, userId: OWNER });
    files.set(FOREIGN_CANVAS, { id: FOREIGN_CANVAS, userId: STRANGER });
  });

  afterEach(() => {
    clearSnapshotRateLimitState();
    vi.unstubAllEnvs();
    vi.stubEnv('JWT_SECRET', JWT_SECRET);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.stubEnv('TRUST_PROXY', 'true');
  });

  describe('GET /api/canvas/snapshots?canvasId= (the enumerating route)', () => {
    it('refuses an unauthenticated caller, and cannot tell a real canvas from a fake one', async () => {
      await createSnapshotId(SCENE, OWNED_CANVAS, { userId: OWNER });
      // Zeroed after the setup write, which legitimately consulted `File`: the
      // assertion is about the two GETs below, not about the file the fixture
      // needed to create.
      const lookupsBefore = state.fileLookups;

      const real = await shape(await GET(list(OWNED_CANVAS)));
      const nonexistent = await shape(await GET(list(MISSING_CANVAS)));

      expect(real.status).toBe(401);
      // The whole point: an unauthorised caller learns nothing about which
      // slugs exist, because the credential check runs before any lookup.
      expect(nonexistent).toEqual(real);
      expect(real.cacheControl).toBe('no-store');
      expect(state.fileLookups).toBe(lookupsBefore);
      expect(state.snapshotReads).toBe(0);
    });

    it('refuses an authenticated caller who does not own the canvas, indistinguishably', async () => {
      await createSnapshotId(SCENE, FOREIGN_CANVAS, { userId: STRANGER });

      const response = await GET(list(FOREIGN_CANVAS, { userId: OWNER }));
      const shapeOfDenial = await shape(response);
      expect(shapeOfDenial.status).toBe(403);

      // "Not yours" and "does not exist" are the same answer, so the 403 is
      // not an existence oracle.
      expect(await shape(await GET(list(MISSING_CANVAS, { userId: OWNER })))).toEqual(
        shapeOfDenial
      );
      // ...and it discloses nothing about the canvas: no metadata, no count.
      expect(JSON.parse(shapeOfDenial.body)).toEqual({ error: 'Snapshot access denied.' });
    });

    it('separates "no credential" from "not yours" without leaking either', async () => {
      await createSnapshotId(SCENE, FOREIGN_CANVAS, { userId: STRANGER });

      // Two refusals, and each is a class of its own: 401 means the request
      // carried no usable session, 403 means it did and the canvas is not that
      // caller's. Neither says anything about whether the slug exists.
      const unauthenticated = await shape(await GET(list(FOREIGN_CANVAS)));
      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated).toEqual(await shape(await GET(list(MISSING_CANVAS))));
      // An unparseable cookie is just an absent credential, not a worse one.
      expect(await shape(await GET(list(FOREIGN_CANVAS, { token: 'not-a-jwt' })))).toEqual(
        unauthenticated
      );

      const forbidden = await shape(await GET(list(FOREIGN_CANVAS, { userId: OWNER })));
      expect(forbidden.status).toBe(403);
      // Any valid session that is not this canvas's owner lands on that same
      // 403, whether it arrived as a cookie or as a bearer header.
      expect(
        await shape(await GET(list(FOREIGN_CANVAS, { token: tokenFor(THIRD_PARTY) })))
      ).toEqual(forbidden);
      expect(await shape(await GET(list(MISSING_CANVAS, { userId: OWNER })))).toEqual(forbidden);
    });

    it('accepts a bearer header as well as the cookie', async () => {
      const id = await createSnapshotId(SCENE, OWNED_CANVAS, { userId: OWNER });

      // `lib/api.ts` sends the session as a bearer header for cross-origin
      // callers, so the cookie must not be the only accepted shape.
      const response = await GET(
        new NextRequest(`http://localhost:3000/api/canvas/snapshots?canvasId=${OWNED_CANVAS}`, {
          headers: { authorization: `Bearer ${tokenFor(OWNER)}` },
        })
      );
      expect(response.status).toBe(200);
      const { snapshots: listed } = (await response.json()) as {
        snapshots: Array<{ id: string }>;
      };
      expect(listed.map(snapshot => snapshot.id)).toEqual([id]);
    });

    it('lists the caller own canvas with the existing 200 shape, unchanged', async () => {
      const first = await createSnapshotId(SCENE, OWNED_CANVAS, { userId: OWNER });
      await new Promise(done => setTimeout(done, 5));
      const second = await createSnapshotId(SCENE, OWNED_CANVAS, { userId: OWNER });

      const response = await GET(list(OWNED_CANVAS, { userId: OWNER }));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');

      const body = (await response.json()) as {
        snapshots: Array<{ id: string; canvasId: string; createdAt: number; expiresAt: number }>;
      };
      expect(body.snapshots.map(snapshot => snapshot.id)).toEqual([second, first]);
      for (const snapshot of body.snapshots) {
        expect(snapshot.canvasId).toBe(OWNED_CANVAS);
        // Metadata only. Scene bytes still require the per-id route.
        expect(snapshot).not.toHaveProperty('data');
        expect(typeof snapshot.createdAt).toBe('number');
        expect(typeof snapshot.expiresAt).toBe('number');
      }
    });

    it('never lets one owner read another owner snapshots through a shared scene id', async () => {
      // The snapshot id is the capability the share link hands out, and route 3
      // resolves it for anyone. The list route must not extend that to a
      // directory: knowing a share id must not reveal the rest of the history.
      const first = await createSnapshotId(SCENE, FOREIGN_CANVAS, { userId: STRANGER });
      await createSnapshotId(SCENE, FOREIGN_CANVAS, { userId: STRANGER });

      const denied = await GET(list(FOREIGN_CANVAS, { userId: OWNER }));
      expect(denied.status).toBe(403);
      expect(JSON.parse(await denied.text())).toEqual({ error: 'Snapshot access denied.' });

      // And the id that leaked through the share link is still individually
      // fetchable — inherent to an unauthenticated share, not fixed here.
      expect((await read(first)).status).toBe(200);
    });

    it('reports a storage failure while checking ownership as a 500, never as a refusal', async () => {
      state.failure = new Error('connection terminated unexpectedly');
      const response = await GET(list(OWNED_CANVAS, { userId: OWNER }));

      // Folding an unreachable database into the 403 would tell the caller
      // "not yours" about a canvas they do own.
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Unable to verify snapshot access.' });
    });

    it('answers a deployment with no JWT_SECRET as a 503 rather than a refusal', async () => {
      // Signed first: the point is that a route which cannot verify anything
      // says so, rather than reporting a real owner as a stranger.
      const token = tokenFor(OWNER);
      vi.stubEnv('JWT_SECRET', '');
      const request = new NextRequest(
        `http://localhost:3000/api/canvas/snapshots?canvasId=${OWNED_CANVAS}`,
        { headers: { cookie: `dripl-session=${token}` } }
      );
      const response = await GET(request);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'Authentication is not configured.' });
      expect(state.fileLookups).toBe(0);
    });
  });

  describe('POST /api/canvas/snapshots', () => {
    it('refuses to write into a canvas the caller does not own', async () => {
      const response = await POST(
        post({ data: SCENE, canvasId: FOREIGN_CANVAS }, { userId: OWNER })
      );

      expect(response.status).toBe(403);
      expect(JSON.parse(await response.text())).toEqual({ error: 'Snapshot access denied.' });
      // Nothing was written, so a stranger cannot burn the owner's live
      // capacity budget by writing snapshots they will never be able to read.
      expect(state.writes).toBe(0);
      expect(snapshots.size).toBe(0);
    });

    it('refuses an unauthenticated caller who supplies a canvasId at all', async () => {
      const response = await POST(post({ data: SCENE, canvasId: OWNED_CANVAS }));

      expect(response.status).toBe(401);
      expect(state.writes).toBe(0);
      expect(snapshots.size).toBe(0);
    });

    it('gives the same refusal for a canvas that does not exist', async () => {
      const existing = await shape(
        await POST(post({ data: SCENE, canvasId: FOREIGN_CANVAS }, { userId: OWNER }))
      );
      const nonexistent = await shape(
        await POST(post({ data: SCENE, canvasId: MISSING_CANVAS }, { userId: OWNER }))
      );
      expect(existing.status).toBe(403);
      expect(nonexistent).toEqual(existing);
    });

    it('checks ownership before parsing the scene, so a refusal costs no more than a denial', async () => {
      // A huge valid payload from a non-owner is refused on ownership, with no
      // Zod parse and no write. Proved by the missing write rather than by a
      // timing assertion, which would be flaky by construction.
      const oversized = JSON.stringify(
        Array.from({ length: 20 }, (_, index) => ({
          ...element,
          id: `e${index}`,
          text: 'x'.repeat(100_000),
        }))
      );
      const response = await POST(
        post({ data: oversized, canvasId: FOREIGN_CANVAS }, { userId: OWNER })
      );

      expect(response.status).toBe(403);
      expect(state.writes).toBe(0);
    });

    it('still returns the existing 200 { id } for the owner own canvas', async () => {
      const response = await POST(post({ data: SCENE, canvasId: OWNED_CANVAS }, { userId: OWNER }));

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const { id } = (await response.json()) as { id: string };
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(snapshots.get(id)?.canvasId).toBe(OWNED_CANVAS);
    });

    it('binds a stored canvasId to the File record, not the string the client sent', async () => {
      const response = await POST(post({ data: SCENE, canvasId: OWNED_CANVAS }, { userId: OWNER }));
      const { id } = (await response.json()) as { id: string };

      // The stored value is the `File.id` the ownership lookup returned, which
      // is only ever reached by a caller that owns that row.
      expect(snapshots.get(id)?.canvasId).toBe(OWNED_CANVAS);
      expect(files.has(snapshots.get(id)?.canvasId ?? '')).toBe(true);
    });

    it('keeps an unscoped snapshot anonymous, because that is the share-link feature', async () => {
      const anonymous = await POST(post({ data: SCENE }));
      expect(anonymous.status).toBe(200);
      const { id } = (await anonymous.json()) as { id: string };
      // No canvas claim, so it can never be filed into anyone's version history.
      expect(snapshots.get(id)?.canvasId).toBeNull();

      // A signed-in caller gets the same capability, since `/api/canvas/snapshots`
      // is also how `TopBar.handleShareCanvas` creates the link.
      const signedIn = await createSnapshotId(SCENE, undefined, { userId: OWNER });
      expect(snapshots.get(signedIn)?.canvasId).toBeNull();
    });

    it('does not let an anonymous snapshot appear in any owner version list', async () => {
      await createSnapshotId(SCENE, undefined);
      const response = await GET(list(OWNED_CANVAS, { userId: OWNER }));

      expect(response.status).toBe(200);
      expect(((await response.json()) as { snapshots: unknown[] }).snapshots).toEqual([]);
    });

    it('keeps the origin and rate-limit gates ahead of the ownership check', async () => {
      // No origin header: refused before identity is even considered, so the
      // check ordering on the write path is unchanged.
      const noOrigin = await POST(
        new NextRequest('http://localhost:3000/api/canvas/snapshots', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ data: SCENE, canvasId: FOREIGN_CANVAS }),
        })
      );
      expect(noOrigin.status).toBe(403);
      expect(await noOrigin.json()).toEqual({ error: 'Forbidden origin' });

      // Over the declared-length cap: still a 413, still before any auth work.
      const tooLarge = await POST(
        post(
          { data: SCENE, canvasId: FOREIGN_CANVAS },
          { userId: OWNER, headers: { 'content-length': String(2 * 1024 * 1024 + 20_000) } }
        )
      );
      expect(tooLarge.status).toBe(413);
      expect(await tooLarge.json()).toEqual({ error: 'Snapshot too large.' });
      expect(state.fileLookups).toBe(0);
      expect(state.writes).toBe(0);
    });
  });

  describe('GET /api/canvas/snapshots/[id] stays public', () => {
    it('serves a share link with no credential at all', async () => {
      const id = await createSnapshotId(SCENE, undefined);

      const response = await read(id);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const { data } = (await response.json()) as { data: string };
      expect(JSON.parse(data)[0]).toMatchObject({ id: element.id, type: 'rectangle' });
    });

    it('serves the same link to a signed-in stranger, by design', async () => {
      const id = await createSnapshotId(SCENE, undefined);
      expect((await read(id, { userId: STRANGER })).status).toBe(200);
    });

    it('still 404s an unknown id and a malformed one', async () => {
      const unknown = await read('00000000-0000-4000-8000-000000000000');
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toEqual({ error: 'Snapshot not found.' });

      const malformed = await read('../../etc/passwd');
      expect(malformed.status).toBe(404);
      expect(await malformed.json()).toEqual({ error: 'Snapshot not found.' });
    });

    it('still 404s an expired id, and answers it identically to an unknown one', async () => {
      const id = await createSnapshotId(SCENE, undefined);
      const row = snapshots.get(id);
      if (!row) throw new Error('snapshot was not stored');
      row.expiresAt = new Date(row.createdAt.getTime() - 1);

      const expired = await shape(await read(id));
      expect(expired.status).toBe(404);
      expect(expired).toEqual(await shape(await read('00000000-0000-4000-8000-000000000000')));
    });

    it('consults no ownership record at all', async () => {
      const id = await createSnapshotId(SCENE, undefined);
      const before = state.fileLookups;
      expect((await read(id)).status).toBe(200);
      // No `File` row exists for an anonymous snapshot, and none was consulted:
      // this route must not have gained an ownership dependency.
      expect(state.fileLookups).toBe(before);
    });
  });
});
