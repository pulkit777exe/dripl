import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signToken } from '@dripl/utils/auth';
import { GET as GET_BY_ID } from '../../app/api/canvas/snapshots/[id]/route';
import {
  MAX_SNAPSHOT_BYTES,
  MAX_ANONYMOUS_SNAPSHOTS,
  MAX_OWNED_SNAPSHOTS_PER_CANVAS,
  SNAPSHOT_TTL_MS,
  resetSnapshotSweepState,
} from '../../app/api/canvas/snapshots/_lib/snapshotStore';
import { clearSnapshotRateLimitState } from '../../app/api/canvas/snapshots/_lib/snapshotRateLimit';

/**
 * These tests replace the module-level `globalThis` map the routes used to keep
 * with a Prisma stand-in that lives *here*, in the test file. That inversion is
 * the whole regression guard: the routes can no longer round-trip a snapshot
 * through anything except the delegate the fake exposes, so a reintroduced
 * process-local store would answer the per-id GET with a 404 and fail these
 * assertions. `database` is created once per test file and never reset, which
 * is also how real storage behaves across module reloads.
 */
interface StoredSnapshot {
  id: string;
  canvasId: string | null;
  data: string;
  createdAt: Date;
  expiresAt: Date;
}

const harness = vi.hoisted(() => {
  interface Row {
    id: string;
    canvasId: string | null;
    data: string;
    createdAt: Date;
    expiresAt: Date;
  }

  const rows = new Map<string, Row>();
  const state = {
    /** Fails the snapshot store. */
    failure: null as Error | null,
    /** Fails everything, including the `File` lookup that precedes a read. */
    totalFailure: null as Error | null,
    sweeps: 0,
  };

  /** `gt` is the only comparison the store generates. */
  const isLive = (row: Row, filter: Date | undefined): boolean =>
    filter === undefined || row.expiresAt.getTime() > filter.getTime();

  const userId = 'contract-test-user';

  /**
   * The ownership stand-in for a contract test.
   *
   * Every caller in *this* file is the owner of every canvas it names. That is
   * the premise these tests were written under before ownership existed at all,
   * and preserving it keeps each assertion about one thing — validation,
   * durability, capacity, rate limiting — instead of two.
   *
   * It is deliberately not a vacuous stub: the query still runs and still
   * returns a row, so a route that skipped the lookup, or looked up the wrong
   * thing, still fails here. The negative cases (a stranger's canvas, a canvas
   * that does not exist, an unauthenticated caller) are the subject of
   * `canvasSnapshots.authz.test.ts`.
   */
  const file = {
    findFirst: async ({
      where,
    }: {
      where: { id: string; userId?: string };
    }): Promise<{ id: string } | null> => {
      // Only a *total* outage reaches the ownership gate; a snapshot-store
      // outage must leave the gate working so the read path can fail on its own.
      if (state.totalFailure) throw state.totalFailure;
      if (where.userId !== undefined && where.userId !== userId) return null;
      return { id: where.id };
    },
  };

  const client = {
    canvasSnapshot: {
      create: async ({ data }: { data: Row }) => {
        if (state.failure) throw state.failure;
        // Prisma reports a missing nullable column as null, never undefined.
        const row = { ...data, canvasId: data.canvasId ?? null };
        rows.set(row.id, row);
        return { ...row };
      },
      findFirst: async ({ where }: { where: { id: string; expiresAt?: { gt?: Date } } }) => {
        if (state.failure) throw state.failure;
        const row = rows.get(where.id);
        if (!row) return null;
        if (where.expiresAt?.gt && !isLive(row, where.expiresAt.gt)) return null;
        return { data: row.data };
      },
      findMany: async ({
        where,
        orderBy,
      }: {
        where: { canvasId: string; expiresAt?: { gt?: Date } };
        orderBy: Array<{ createdAt: 'desc' } | { id: 'desc' }>;
      }) => {
        if (state.failure) throw state.failure;
        return [...rows.values()]
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
      count: async ({
        where,
      }: {
        // `canvasId` is how the capacity budget is partitioned: a string counts
        // one canvas's history, and `null` counts the anonymous pool. A fake
        // that ignored it would make every partition test pass for the wrong
        // reason.
        where: { expiresAt?: { gt?: Date }; canvasId?: string | null };
      }) => {
        if (state.failure) throw state.failure;
        return [...rows.values()].filter(row => {
          if (!isLive(row, where.expiresAt?.gt)) return false;
          if (where.canvasId === undefined) return true;
          return (row.canvasId ?? null) === where.canvasId;
        }).length;
      },
      deleteMany: async ({ where }: { where: { expiresAt?: { lte?: Date } } }) => {
        if (state.failure) throw state.failure;
        state.sweeps += 1;
        let count = 0;
        for (const [id, row] of rows) {
          const cutoff = where.expiresAt?.lte;
          if (cutoff && row.expiresAt.getTime() <= cutoff.getTime()) {
            rows.delete(id);
            count += 1;
          }
        }
        return { count };
      },
    },
  };

  return { rows, state, client, file, userId };
});

vi.mock('@dripl/db', () => ({
  initializeDb: async () => ({ ...harness.client, file: harness.file }),
  db: harness.client,
}));

const { GET, POST } = await import('../../app/api/canvas/snapshots/route');

const { rows: database, state: storage, client: fakeClient } = harness;

/**
 * The route contract here is written for an owner. `canvasSnapshots.authz.test.ts`
 * covers the refusals and the indistinguishability; this file stays about the
 * happy path, the payload gates, durability and capacity, so every request is
 * sent as the owner of whatever canvas it names.
 *
 * The secret is stubbed *before* the token is signed, because `signToken` and
 * the route both read `JWT_SECRET` at call time.
 */
vi.stubEnv('JWT_SECRET', 'test-jwt-secret-for-snapshot-contract-tests');

const OWNER_ID = harness.userId;
const OWNER_TOKEN = signToken(OWNER_ID);

function authHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return { cookie: `dripl-session=${OWNER_TOKEN}`, ...headers };
}

const element = {
  id: 'snapshot-element',
  type: 'rectangle' as const,
  x: 0,
  y: 0,
  width: 20,
  height: 20,
};

/** The old process-local store, gone. Asserted rather than assumed. */
const legacyGlobal = '__driplCanvasSnapshots';

function post(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/canvas/snapshots', {
    method: 'POST',
    headers: authHeaders({
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      ...headers,
    }),
    body: JSON.stringify(body),
  });
}

function postScene(data: string, canvasId?: string) {
  return POST(post({ data, ...(canvasId === undefined ? {} : { canvasId }) }));
}

function read(id: string) {
  return GET_BY_ID(new Request('http://localhost:3000/api/canvas/snapshots/' + id), {
    params: Promise.resolve({ id }),
  });
}

function list(canvasId?: string) {
  const url =
    canvasId === undefined
      ? 'http://localhost:3000/api/canvas/snapshots'
      : `http://localhost:3000/api/canvas/snapshots?canvasId=${canvasId}`;
  return GET(new NextRequest(url, { headers: authHeaders() }));
}

async function create(data: string, canvasId?: string): Promise<string> {
  const response = await postScene(data, canvasId);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { id: string };
  return body.id;
}

/**
 * What the routes persist is the *validated* scene, so Zod's defaults are part
 * of the stored payload. Pinning the exact normalized shape is what keeps the
 * round-trip assertions honest about the existing write contract.
 */
const VALIDATED_ELEMENT = {
  id: 'snapshot-element',
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 20,
  height: 20,
  angle: 0,
  strokeColor: '#000000',
  fillColor: 'transparent',
  backgroundColor: 'transparent',
  strokeWidth: 2,
  opacity: 1,
  roughness: 1,
  locked: false,
};

describe('canvas snapshot capability route', () => {
  beforeEach(() => {
    clearSnapshotRateLimitState();
  });

  afterEach(() => {
    clearSnapshotRateLimitState();
  });

  it('stores only a bounded, valid element scene', async () => {
    const response = await postScene(JSON.stringify([element]));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

    const stored = database.get(body.id);
    expect(stored?.data).toContain('snapshot-element');
    expect(stored?.expiresAt.getTime()).toBe((stored?.createdAt.getTime() ?? 0) + SNAPSHOT_TTL_MS);
  });

  it('rejects malformed snapshot elements', async () => {
    expect((await postScene(JSON.stringify([{ id: 'bad' }]))).status).toBe(400);
  });

  it('rejects chunked payloads over the size limit while reading', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_SNAPSHOT_BYTES + 1));
        controller.close();
      },
    });
    const chunkedRequest = new NextRequest('http://localhost:3000/api/canvas/snapshots', {
      method: 'POST',
      headers: authHeaders({
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      }),
      body,
    } as ConstructorParameters<typeof NextRequest>[1]);

    expect((await POST(chunkedRequest)).status).toBe(413);
  });

  it('rejects requests with a missing origin', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/canvas/snapshots', {
        method: 'POST',
        // Authenticated on purpose: the origin gate must run first, so a
        // session that would otherwise be accepted proves the ordering.
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ data: JSON.stringify([element]) }),
      })
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden origin' });
  });

  it('rejects declared payloads over the size limit before reading', async () => {
    const response = await POST(
      post(
        { data: JSON.stringify([element]) },
        { 'content-length': String(MAX_SNAPSHOT_BYTES + 20_000) }
      )
    );
    expect(response.status).toBe(413);
  });
});

describe('canvas snapshot durability', () => {
  beforeEach(() => {
    clearSnapshotRateLimitState();
    resetSnapshotSweepState();
    storage.failure = null;
    storage.totalFailure = null;
  });

  it('round-trips a scene through the database with no process memory involved', async () => {
    expect(legacyGlobal in globalThis).toBe(false);

    const id = await create(JSON.stringify([element]), 'canvas-durable');

    // The write landed in storage, and nowhere else.
    expect(database.has(id)).toBe(true);
    expect(legacyGlobal in globalThis).toBe(false);

    const response = await read(id);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(((await response.json()) as { data: string }).data)).toEqual([
      VALIDATED_ELEMENT,
    ]);
  });

  it('survives the routes being re-imported, as a restarted process would', async () => {
    const id = await create(JSON.stringify([element]), 'canvas-restart');

    // A fresh module registry is the closest in-process stand-in for a
    // restart: every module-level cache in the routes is rebuilt, and only the
    // database carries over.
    vi.resetModules();
    const restarted = await import('../../app/api/canvas/snapshots/[id]/route');
    const response = await restarted.GET(new Request('http://localhost:3000/x'), {
      params: Promise.resolve({ id }),
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(((await response.json()) as { data: string }).data)).toEqual([
      VALIDATED_ELEMENT,
    ]);
    expect(legacyGlobal in globalThis).toBe(false);
  });

  it('answers an unknown id with the not-found response', async () => {
    const response = await read('00000000-0000-4000-8000-000000000000');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Snapshot not found.' });
  });

  it('answers a malformed id with the not-found response without querying storage', async () => {
    storage.failure = new Error('must not be reached');
    try {
      const response = await read('../../etc/passwd');
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Snapshot not found.' });
    } finally {
      storage.failure = null;
    }
  });

  it('rejects an expired snapshot even though no sweep has run', async () => {
    const id = await create(JSON.stringify([element]), 'canvas-expiry');
    expect((await read(id)).status).toBe(200);

    const stored = database.get(id);
    if (!stored) throw new Error('snapshot was not stored');
    stored.expiresAt = new Date(stored.createdAt.getTime() - 1);

    // The row is still present, so no sweep can be what produced this 404.
    expect(database.has(id)).toBe(true);
    const response = await read(id);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Snapshot not found.' });
  });

  it('never lists an expired snapshot', async () => {
    const id = await create(JSON.stringify([element]), 'canvas-expiry-list');
    const stored = database.get(id);
    if (!stored) throw new Error('snapshot was not stored');
    stored.expiresAt = new Date(stored.createdAt.getTime() - 1);

    const listed = (await (await list('canvas-expiry-list')).json()) as { snapshots: unknown[] };
    expect(listed.snapshots).toEqual([]);
  });

  it('reports a storage failure instead of claiming the snapshot is unknown', async () => {
    const id = await create(JSON.stringify([element]), 'canvas-outage');
    storage.failure = new Error('connection terminated unexpectedly');
    try {
      const response = await read(id);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Unable to load snapshot.' });

      const listed = await list('canvas-outage');
      expect(listed.status).toBe(500);
      expect(await listed.json()).toEqual({ error: 'Unable to list snapshots.' });

      const created = await postScene(JSON.stringify([element]), 'canvas-outage');
      expect(created.status).toBe(500);
      expect(await created.json()).toEqual({ error: 'Unable to create snapshot.' });
    } finally {
      storage.failure = null;
    }
  });

  it('reports an outage in the ownership lookup as a 500, not as a refusal', async () => {
    // The snapshot store is healthy here, so this isolates the gate: the
    // `File` read that decides ownership is unreachable. Answering 403 would
    // tell the owner of a real canvas that it is not theirs.
    storage.totalFailure = new Error('connection terminated unexpectedly');
    try {
      const listed = await list('canvas-outage');
      expect(listed.status).toBe(500);
      expect(await listed.json()).toEqual({ error: 'Unable to verify snapshot access.' });

      const created = await postScene(JSON.stringify([element]), 'canvas-outage');
      expect(created.status).toBe(500);
      expect(await created.json()).toEqual({ error: 'Unable to verify snapshot access.' });

      // Route 3 never consults `File`, so an outage there cannot break a share
      // link — which is the property that keeps the share feature independent
      // of this one.
      const anonymous = await postScene(JSON.stringify([element]));
      expect(anonymous.status).toBe(200);
    } finally {
      storage.totalFailure = null;
    }
  });

  it('does not let a filled anonymous pool block an owner from taking a snapshot', async () => {
    // The regression this partition prevents: with one shared ceiling, filling
    // the anonymous pool returned 503 to everyone, including owners whose own
    // version history had nothing to do with the flood.
    const seeded: StoredSnapshot[] = [];
    for (let i = 0; i < MAX_ANONYMOUS_SNAPSHOTS; i++) {
      const row: StoredSnapshot = {
        id: `4444${String(i).padStart(4, '0')}`,
        canvasId: null,
        data: '[]',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + SNAPSHOT_TTL_MS),
      };
      database.set(row.id, row);
      seeded.push(row);
    }

    // The anonymous pool is full, so an anonymous share is refused...
    const anonymous = await postScene(JSON.stringify([element]));
    expect(anonymous.status).toBe(503);

    // ...while an owner on a different canvas is unaffected.
    const owned = await postScene(JSON.stringify([element]), 'canvas-unaffected');
    expect(owned.status).toBe(200);
  });

  it('does not let one owner filling their own history block another owner', async () => {
    const seeded: StoredSnapshot[] = [];
    for (let i = 0; i < MAX_OWNED_SNAPSHOTS_PER_CANVAS; i++) {
      const row: StoredSnapshot = {
        id: `5555${String(i).padStart(4, '0')}`,
        canvasId: 'canvas-noisy',
        data: '[]',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + SNAPSHOT_TTL_MS),
      };
      database.set(row.id, row);
      seeded.push(row);
    }

    expect((await postScene(JSON.stringify([element]), 'canvas-noisy')).status).toBe(503);
    expect((await postScene(JSON.stringify([element]), 'canvas-quiet')).status).toBe(200);
  });

  it('caps live snapshots at the ceiling, then accepts writes again once they expire', async () => {
    // Start from a known-live set filling this canvas's own history budget.
    const seeded: StoredSnapshot[] = [];
    for (let i = 0; i < MAX_OWNED_SNAPSHOTS_PER_CANVAS; i++) {
      const row: StoredSnapshot = {
        id: `3333${String(i).padStart(4, '0')}`,
        canvasId: 'canvas-capacity',
        data: '[]',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + SNAPSHOT_TTL_MS),
      };
      database.set(row.id, row);
      seeded.push(row);
    }
    // Anything earlier in the file left behind must not count as live.
    for (const row of database.values()) {
      if (!seeded.includes(row)) row.expiresAt = new Date(row.createdAt.getTime() - 1);
    }

    const rejected = await postScene(JSON.stringify([element]), 'canvas-capacity');
    expect(rejected.status).toBe(503);
    expect(await rejected.json()).toEqual({
      error: 'Snapshot capacity reached; try again later.',
    });

    // Expiring the ceiling frees capacity without anyone deleting a row: the
    // count is over live rows, not stored rows.
    for (const row of seeded) row.expiresAt = new Date(row.createdAt.getTime() - 1);
    const accepted = await postScene(JSON.stringify([element]), 'canvas-capacity');
    expect(accepted.status).toBe(200);
  });

  it('sweeps expired rows off the write path so they cannot accumulate', async () => {
    const stale = Array.from({ length: 3 }, (_, i) => {
      const row: StoredSnapshot = {
        id: `4444${String(i).padStart(4, '0')}`,
        canvasId: 'canvas-sweep',
        data: '[]',
        createdAt: new Date(0),
        expiresAt: new Date(1),
      };
      database.set(row.id, row);
      return row;
    });

    resetSnapshotSweepState();
    const created = await postScene(JSON.stringify([element]), 'canvas-sweep');
    expect(created.status).toBe(200);

    for (const row of stale) expect(database.has(row.id)).toBe(false);
  });

  it('throttles the sweep so a burst of writes issues at most one delete', async () => {
    resetSnapshotSweepState();
    const before = storage.sweeps;
    for (let i = 0; i < 3; i++) {
      expect((await postScene(JSON.stringify([element]), 'canvas-sweep-throttle')).status).toBe(
        200
      );
    }
    expect(storage.sweeps - before).toBe(1);
  });
});

describe('canvas snapshot listing', () => {
  beforeEach(() => {
    clearSnapshotRateLimitState();
  });

  it('lists scoped snapshots newest-first, metadata only', async () => {
    const scene = JSON.stringify([element]);
    const canvasId = 'canvas-list-order';
    const first = await create(scene, canvasId);
    await new Promise(resolve => setTimeout(resolve, 5));
    const second = await create(scene, canvasId);
    await create(scene, 'canvas-other');

    const response = await list(canvasId);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as {
      snapshots: Array<{ id: string; canvasId: string; createdAt: number; expiresAt: number }>;
    };
    expect(body.snapshots.map(s => s.id)).toEqual([second, first]);
    for (const snapshot of body.snapshots) {
      expect(snapshot.canvasId).toBe(canvasId);
      expect(snapshot).not.toHaveProperty('data');
      expect(snapshot.expiresAt).toBe(snapshot.createdAt + SNAPSHOT_TTL_MS);
    }
  });

  it('requires canvasId and rejects other canvases', async () => {
    expect((await list()).status).toBe(400);
    expect((await list('x'.repeat(201))).status).toBe(400);

    await create(JSON.stringify([element]), 'canvas-scoped');
    const other = (await (await list('canvas-unrelated')).json()) as { snapshots: unknown[] };
    expect(other.snapshots).toEqual([]);
  });

  it('keeps unscoped snapshots out of filtered lists', async () => {
    const id = await create(JSON.stringify([element]));
    expect(database.get(id)?.canvasId).toBeNull();
    const response = await list('canvas-legacy-check');
    expect(((await response.json()) as { snapshots: unknown[] }).snapshots).toEqual([]);
  });

  it('rejects a list or a write with no session, without consulting storage', async () => {
    // An anonymous share is anonymous by design; naming a canvas is not.
    const anonymous = new NextRequest('http://localhost:3000/api/canvas/snapshots', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ data: JSON.stringify([element]), canvasId: 'canvas-anonymous' }),
    });
    expect((await POST(anonymous)).status).toBe(401);

    const listUrl = 'http://localhost:3000/api/canvas/snapshots?canvasId=canvas-anonymous';
    expect((await GET(new NextRequest(listUrl))).status).toBe(401);
  });

  it('rejects invalid canvasId values on write', async () => {
    expect((await postScene(JSON.stringify([element]), 'x'.repeat(201))).status).toBe(400);
    expect((await postScene(JSON.stringify([element]), '')).status).toBe(400);
  });

  it('rejects a scene whose serialized form exceeds the size cap', async () => {
    // A reachable case, not a hypothetical one: Zod fills in ~150 bytes of
    // element defaults, so a scene whose request envelope fits under the cap
    // can still serialize past it. The write path must refuse before the
    // oversized blob reaches the column, which the table's CHECK constraint
    // would otherwise reject as a 500.
    const text = 't'.repeat(420);
    const scene = JSON.stringify(
      Array.from({ length: 3200 }, (_, i) => ({
        id: `e${i}`,
        type: 'text',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        text,
      }))
    );
    // The request itself is comfortably inside the 2 MiB envelope cap...
    expect(JSON.stringify({ data: scene }).length).toBeLessThan(MAX_SNAPSHOT_BYTES);
    // ...while the stored form, with defaults applied, is not.
    expect(scene.length + 3200 * 200).toBeGreaterThan(MAX_SNAPSHOT_BYTES);

    const response = await postScene(scene);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Snapshot too large.' });
    expect(fakeClient.canvasSnapshot.create).toBeTypeOf('function');
  });
});

describe('canvas snapshot rate limiting', () => {
  beforeEach(() => {
    clearSnapshotRateLimitState();
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.stubEnv('TRUST_PROXY', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // `unstubAllEnvs` also drops the signing secret stubbed at module scope, so
    // it is restored for the next test in this file.
    vi.stubEnv('JWT_SECRET', 'test-jwt-secret-for-snapshot-contract-tests');
    clearSnapshotRateLimitState();
  });

  it('rejects the 31st request in a minute for one forwarded IP', async () => {
    const headers = { 'x-forwarded-for': '203.0.113.7' };
    for (let i = 0; i < 30; i++) {
      expect((await POST(post({ data: JSON.stringify([element]) }, headers))).status).toBe(200);
    }
    const limited = await POST(post({ data: JSON.stringify([element]) }, headers));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'Too many snapshot requests' });
  });

  it('keeps separate buckets per forwarded IP', async () => {
    for (let i = 0; i < 30; i++) {
      await POST(post({ data: JSON.stringify([element]) }, { 'x-forwarded-for': '203.0.113.1' }));
    }
    const other = await POST(
      post({ data: JSON.stringify([element]) }, { 'x-forwarded-for': '203.0.113.2' })
    );
    expect(other.status).toBe(200);
  });

  it('uses one shared bucket when forwarded IP headers are not trusted', async () => {
    vi.stubEnv('TRUST_PROXY', 'false');
    for (let i = 0; i < 30; i++) {
      await POST(post({ data: JSON.stringify([element]) }, { 'x-forwarded-for': '198.51.100.9' }));
    }
    // A different spoofed IP still lands in the same anonymous bucket.
    const spoofed = await POST(
      post({ data: JSON.stringify([element]) }, { 'x-forwarded-for': '198.51.100.10' })
    );
    expect(spoofed.status).toBe(429);
  });

  it('rates-limits the listing route too', async () => {
    // As the owner, so this stays a test about the limiter rather than about
    // access control.
    for (let i = 0; i < 30; i++) {
      expect((await list('canvas-rate-limited')).status).toBe(200);
    }
    expect((await list('canvas-rate-limited')).status).toBe(429);
  });
});
