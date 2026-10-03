import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signToken } from '@dripl/utils/auth';
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

/**
 * Session signing for the authenticated routes.
 *
 * `POST` with a `canvasId` and the listing route both require a caller who owns
 * the canvas, so these are signed with a real `JWT_SECRET` — exactly the secret
 * `verifyToken` will read inside the route, which is the part a hand-written
 * fake token would get wrong.
 */
const JWT_SECRET = 'test-jwt-secret-for-snapshot-db-tests';
vi.stubEnv('JWT_SECRET', JWT_SECRET);

function tokenFor(userId: string): string {
  return signToken(userId, 0);
}

/** The `User.id` that owns the `File` rows this file seeds. */
const OWNER_ID = 'db-test-owner';
/** A second real user, so "not the owner" is a genuine non-owner and not a typo. */
const OTHER_USER_ID = 'db-test-other-user';

/**
 * Every `User` and `File` row this file creates, for cleanup.
 *
 * The `User` rows are not ceremony: `File.userId` carries a real foreign key to
 * `User.id` (`File_userId_fkey`), so ownership can only be exercised against
 * rows that exist. That FK is also the reason a `File` with a null `userId`
 * belongs to nobody and can never satisfy the ownership filter.
 */
const userIds = [OWNER_ID, OTHER_USER_ID];
const fileIds: string[] = [];

/**
 * `userId` defaults to the owner, so a test that is not about access control
 * does not have to think about it.
 */
function post(data: string, canvasId: string | undefined, ip: string, userId: string = OWNER_ID) {
  return new NextRequest('http://localhost:3000/api/canvas/snapshots', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      'x-forwarded-for': ip,
      cookie: `dripl-session=${tokenFor(userId)}`,
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
      headers: { 'x-forwarded-for': ip, cookie: `dripl-session=${tokenFor(OWNER_ID)}` },
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
    // Ownership is a `File.userId` → `User.id` comparison, and the FK is real, so
    // the users have to exist before any `File` can be owned by one.
    for (const id of userIds) {
      await db.user.upsert({
        where: { id },
        update: {},
        create: { id, email: `${id}@dripl.test`, name: id },
      });
    }
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
    // The `File` rows exist only so the routes can resolve ownership; a real
    // deployment creates them through `POST /api/files`, which these tests
    // deliberately bypass to keep the assertion on the snapshot path.
    await db.file.deleteMany({ where: { id: { in: fileIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    routes.rateLimit.clearSnapshotRateLimitState();
  });

  afterEach(() => {
    routes.rateLimit.clearSnapshotRateLimitState();
  });

  /**
   * A fresh canvasId plus a fresh IP, so no test inherits another's bucket.
   *
   * The canvasId is a real `File` row, because the route resolves the id the
   * client sends against `File` filtered by owner: an id with no `File` behind
   * it is now correctly a refusal, which would make every test here fail for a
   * reason that has nothing to do with PostgreSQL.
   */
  async function scope(userId: string = OWNER_ID): Promise<{ canvasId: string; ip: string }> {
    const file = await db.file.create({
      data: { id: `db-canvas-${randomUUID()}`, name: 'scoped canvas', userId },
      select: { id: true },
    });
    canvasIds.push(file.id);
    fileIds.push(file.id);
    return { canvasId: file.id, ip: `10.0.0.${(canvasIds.length % 250) + 1}` };
  }

  it('persists a posted snapshot as a row and reads it back through the route', async () => {
    const { canvasId, ip } = await scope();
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
    const { canvasId, ip } = await scope();
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
    const { canvasId, ip } = await scope();
    const other = await scope();
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

  it('refuses a canvas owned by another user, indistinguishably from one that does not exist', async () => {
    // Against real SQL rather than a stand-in, because the property under test
    // *is* the query: `WHERE id = $1 AND user_id = $2` returns the same empty
    // result for a stranger's canvas and for a made-up one. A fake that
    // branched in JavaScript could pass while the real predicate leaked.
    const { ip } = await scope();
    const othersCanvas = await scope(OTHER_USER_ID);
    // The other user writes their own version history first, so there is
    // something real for `OWNER_ID` to be refused.
    const created = await routes.collection.POST(
      post(JSON.stringify([element]), othersCanvas.canvasId, ip, OTHER_USER_ID)
    );
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };

    // Every request below is `OWNER_ID`, which does not own `othersCanvas`.
    const foreignList = await list(othersCanvas.canvasId, ip);
    const foreignPost = await routes.collection.POST(
      post(JSON.stringify([element]), othersCanvas.canvasId, ip)
    );
    const missingList = await list(randomUUID(), ip);

    expect(foreignList.status).toBe(403);
    expect(foreignPost.status).toBe(403);
    // Byte-identical, so neither the status nor the body distinguishes "not
    // yours" from "no such canvas" on either route.
    expect(await missingList.text()).toBe(await foreignList.clone().text());
    expect(await foreignPost.text()).toBe(await foreignList.clone().text());

    // Nothing was written under a canvas the caller does not own, and the
    // owner still has exactly the one row they created.
    expect(await db.canvasSnapshot.count({ where: { canvasId: othersCanvas.canvasId } })).toBe(1);
    // The share link is unaffected: the id is still fetchable by anyone.
    expect((await read(id)).status).toBe(200);
  });

  it('refuses an unauthenticated list before the database is consulted', async () => {
    const { canvasId, ip } = await scope();
    const response = await routes.collection.GET(
      new NextRequest(`http://localhost:3000/api/canvas/snapshots?canvasId=${canvasId}`, {
        headers: { 'x-forwarded-for': ip },
      })
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Authentication required.' });
  });

  it('partitions the capacity budget in real SQL, not just in the fake', async () => {
    // The JS fake in canvasSnapshots.test.ts filters `canvasId` in application
    // code. Prisma expresses `{ canvasId: null }` as `IS NULL` and a string as
    // equality, so the partition has to hold against the real predicate — a
    // fake can branch where SQL cannot.
    const { canvasId } = await scope();
    const scene = JSON.stringify([element]);

    expect((await store.createSnapshot({ data: scene, canvasId })).status).toBe('created');
    for (let i = 0; i < store.MAX_ANONYMOUS_SNAPSHOTS; i += 1) {
      await store.createSnapshot({ data: scene });
    }

    // The anonymous pool is now full...
    expect((await store.createSnapshot({ data: scene })).status).toBe('capacity');
    // ...but this canvas still has its own budget, untouched by the flood.
    expect((await store.createSnapshot({ data: scene, canvasId })).status).toBe('created');
  });

  it('bounds the stored scene at the size the write path enforces', async () => {
    const { canvasId, ip } = await scope();
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
