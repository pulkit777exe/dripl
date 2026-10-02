import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, initializeDb } from '@dripl/db';
import * as store from '../../app/api/canvas/snapshots/_lib/snapshotStore';
import {
  MAX_SNAPSHOT_BYTES,
  SNAPSHOT_TTL_MS,
} from '../../app/api/canvas/snapshots/_lib/snapshotStore';

/**
 * The snapshot routes against a real, migrated PostgreSQL database.
 *
 * `canvasSnapshots.test.ts` proves the route contract with a Prisma stand-in;
 * this file proves the thing that stand-in cannot: that a snapshot written
 * through `POST /api/canvas/snapshots` is in PostgreSQL, survives everything
 * process-local, and is still rejected after it expires. Every assertion here
 * reads the row back through Prisma or through the route — nothing inspects a
 * module-level variable, because there are none left to inspect.
 *
 * Opt-in, because it needs a disposable migrated database:
 *
 *   docker run -d --name dripl-pg-test -e POSTGRES_PASSWORD=dripl \
 *     -e POSTGRES_USER=dripl -e POSTGRES_DB=dripl_test -p 55432:5432 postgres:16
 *   (cd packages/db && DATABASE_URL=... pnpm exec prisma migrate deploy)
 *   RUN_DB_INTEGRATION=true DATABASE_URL=... \
 *     pnpm --filter dripl-app exec vitest run src/__tests__/canvasSnapshots.db.test.ts
 *
 * Invoke vitest directly rather than `pnpm turbo run test`: this app's
 * `turbo.json` redefines the `test` task's `env` as
 * `["NEXT_PUBLIC_*", "GEMINI_API_KEY"]`, which replaces the inherited list
 * instead of extending it, so `DATABASE_URL` and `RUN_DB_INTEGRATION` never
 * reach the process and the suite silently skips. `apps/http-server` inherits
 * the root list, which is why its `fileService.db.test.ts` does run in CI.
 * Widening that list to `["NEXT_PUBLIC_*", "GEMINI_API_KEY", "DATABASE_URL",
 * "RUN_DB_INTEGRATION"]` would fix it; that file is not this change's to touch.
 */
const run = process.env.RUN_DB_INTEGRATION === 'true';
const describeDb = run ? describe : describe.skip;

const element = {
  id: 'db-snapshot-element',
  type: 'rectangle' as const,
  x: 0,
  y: 0,
  width: 20,
  height: 20,
};

/** Every snapshot this file creates, so the sweep tests start from a known set. */
const canvasIds: string[] = [];

function post(data: string, canvasId: string | undefined, ip: string) {
  return new NextRequest('http://localhost:3000/api/canvas/snapshots', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify({ data, ...(canvasId === undefined ? {} : { canvasId }) }),
  });
}

function read(id: string) {
  return routes.byId.GET(new Request('http://localhost:3000/api/canvas/snapshots/' + id), {
    params: Promise.resolve({ id }),
  });
}

function list(canvasId: string, ip: string) {
  return routes.collection.GET(
    new NextRequest(`http://localhost:3000/api/canvas/snapshots?canvasId=${canvasId}`, {
      headers: { 'x-forwarded-for': ip },
    })
  );
}

let routes: {
  collection: typeof import('../../app/api/canvas/snapshots/route');
  byId: typeof import('../../app/api/canvas/snapshots/[id]/route');
  rateLimit: typeof import('../../app/api/canvas/snapshots/_lib/snapshotRateLimit');
};

describeDb('canvas snapshot routes against PostgreSQL', () => {
  beforeAll(async () => {
    // Per-IP buckets keep the 30/minute limit out of the way of a test file
    // that makes more than thirty route calls.
    vi.stubEnv('TRUST_PROXY', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    await initializeDb();
    routes = {
      collection: await import('../../app/api/canvas/snapshots/route'),
      byId: await import('../../app/api/canvas/snapshots/[id]/route'),
      rateLimit: await import('../../app/api/canvas/snapshots/_lib/snapshotRateLimit'),
    };
  }, 30_000);

  afterAll(async () => {
    await db.canvasSnapshot.deleteMany({
      where: { canvasId: { in: canvasIds } },
    });
    await db.$disconnect();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    routes.rateLimit.clearSnapshotRateLimitState();
  });

  afterEach(() => {
    routes.rateLimit.clearSnapshotRateLimitState();
  });

  /** A fresh canvasId plus a fresh IP, so no test inherits another's bucket. */
  function scope(): { canvasId: string; ip: string } {
    const canvasId = `db-canvas-${randomUUID()}`;
    canvasIds.push(canvasId);
    return { canvasId, ip: `10.0.0.${(canvasIds.length % 250) + 1}` };
  }

  it('persists a posted snapshot as a row and reads it back through the route', async () => {
    const { canvasId, ip } = scope();
    const created = await routes.collection.POST(post(JSON.stringify([element]), canvasId, ip));
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    // The row exists in PostgreSQL, keyed by that id.
    const row = await db.canvasSnapshot.findUnique({ where: { id } });
    expect(row?.canvasId).toBe(canvasId);
    expect(row?.expiresAt.getTime()).toBe((row?.createdAt.getTime() ?? 0) + SNAPSHOT_TTL_MS);
    expect(JSON.parse(row?.data ?? '[]')).toHaveLength(1);

    const response = await read(id);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const payload = (await response.json()) as { data: string };
    expect(JSON.parse(payload.data)[0]).toMatchObject({ id: element.id, type: 'rectangle' });
  });

  it('answers an id that was never written with the not-found response', async () => {
    const response = await read(randomUUID());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Snapshot not found.' });
  });

  it('rejects an expired snapshot and only reclaims the row on a later write', async () => {
    const { canvasId, ip } = scope();
    const created = await routes.collection.POST(post(JSON.stringify([element]), canvasId, ip));
    const { id } = (await created.json()) as { id: string };

    await db.canvasSnapshot.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });

    expect((await read(id)).status).toBe(404);

    // No sweep, no process memory: the expired row is still there, and the 404
    // came from the query, not from anything having deleted it.
    expect(await db.canvasSnapshot.findUnique({ where: { id } })).not.toBeNull();

    // The listing route agrees, without having deleted anything either.
    const listed = (await (await list(canvasId, ip)).json()) as { snapshots: unknown[] };
    expect(listed.snapshots).toEqual([]);
    expect(await db.canvasSnapshot.findUnique({ where: { id } })).not.toBeNull();

    // A later write sweeps it away. The sweep is throttled to one per minute
    // per process, so the throttle is reset to make one run now rather than
    // leaving this to wall-clock luck.
    store.resetSnapshotSweepState();
    const next = await routes.collection.POST(post(JSON.stringify([element]), canvasId, ip));
    expect(next.status).toBe(200);
    expect(await db.canvasSnapshot.findUnique({ where: { id } })).toBeNull();
  });

  it('lists one canvas newest-first and never another canvas snapshots', async () => {
    const { canvasId, ip } = scope();
    const other = scope();
    const scene = JSON.stringify([element]);

    const first = (await (await routes.collection.POST(post(scene, canvasId, ip))).json()) as {
      id: string;
    };
    await new Promise(done => setTimeout(done, 5));
    const second = (await (await routes.collection.POST(post(scene, canvasId, ip))).json()) as {
      id: string;
    };
    await routes.collection.POST(post(scene, other.canvasId, ip));

    const response = await list(canvasId, ip);
    const body = (await response.json()) as {
      snapshots: Array<{ id: string; canvasId: string; createdAt: number; expiresAt: number }>;
    };
    expect(body.snapshots.map(snapshot => snapshot.id)).toEqual([second.id, first.id]);
    for (const snapshot of body.snapshots) {
      expect(snapshot.canvasId).toBe(canvasId);
      expect(snapshot).not.toHaveProperty('data');
    }

    const foreign = (await (await list(other.canvasId, ip)).json()) as {
      snapshots: Array<{ id: string }>;
    };
    expect(foreign.snapshots.map(snapshot => snapshot.id)).not.toContain(first.id);
  });

  it('bounds the stored scene at the size the write path enforces', async () => {
    const { canvasId, ip } = scope();
    const created = await routes.collection.POST(post(JSON.stringify([element]), canvasId, ip));
    const { id } = (await created.json()) as { id: string };

    // The table refuses a blob the write path would have rejected, so the
    // bound holds even if a future caller skips the route.
    await expect(
      db.canvasSnapshot.update({
        where: { id },
        data: { data: 'x'.repeat(MAX_SNAPSHOT_BYTES + 1) },
      })
    ).rejects.toThrow(/CanvasSnapshot_data_bytes/);

    // ...and the constraint is pinned to the constant, not to a number that
    // happened to match when the migration was written.
    const constraints = await db.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = 'CanvasSnapshot_data_bytes'
    `;
    expect(constraints).toHaveLength(1);
    expect(constraints[0]?.definition).toContain(`octet_length(data) <= ${MAX_SNAPSHOT_BYTES}`);
  });
});
