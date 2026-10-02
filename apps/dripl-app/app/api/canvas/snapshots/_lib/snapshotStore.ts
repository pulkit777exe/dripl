import { randomUUID } from 'crypto';
import { initializeDb } from '@dripl/db';

/**
 * Public share snapshots, stored in PostgreSQL.
 *
 * This used to be a `Map` hung off `globalThis`, which meant every snapshot
 * died with the process: a restart, a redeploy, a scale event or simply hitting
 * a second app instance all turned a working share link into a 404. The record
 * shape, the one-hour TTL, the id format and the capacity ceiling are unchanged
 * here; only the durability changed.
 *
 * Two invariants the old in-memory store gave for free are now explicit:
 *
 *  - **Expiry is a query filter, not a cleanup job.** Every read filters
 *    `expiresAt > now`, so a snapshot stops resolving the instant it expires
 *    whether or not any sweep has run. `sweepExpired` is a space optimisation
 *    only. A periodic sweeper that owned correctness would be the same class of
 *    bug as the memory map, just slower: a process that never runs the timer
 *    would serve expired links forever.
 *  - **Capacity counts live rows, not stored rows.** The 503 is raised against
 *    `expiresAt > now`, exactly as `pruneStore` counted map entries after
 *    dropping the expired ones.
 */

/** Serialized-scene ceiling. Mirrored by the `CanvasSnapshot_data_bytes` CHECK
 * constraint in `20261002133016_add_canvas_snapshot`; raise both together. */
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

/**
 * Live-snapshot ceilings, counted over `expiresAt > now`.
 *
 * These are deliberately TWO budgets rather than one global 500. `canvasId` is
 * already nullable and already separates an owned version-history row from an
 * anonymous share, so partitioning needs no new column and no migration — the
 * discriminator the rows already carry is the one worth budgeting on.
 *
 * With a single shared ceiling, an anonymous flood is a denial of service on
 * everyone: `POST` allows 30 writes/minute/IP with no credential, so one host
 * fills 500 rows in about 17 minutes and every owner's version history starts
 * returning 503 until the hour-long TTL drains. Splitting the budget means that
 * flood can exhaust only anonymous sharing, and one owner spamming their own
 * canvas can exhaust only their own history.
 *
 * What this does NOT fix: anonymous shares have no owner to partition by, so
 * `MAX_ANONYMOUS_SNAPSHOTS` is still a single global pool and an attacker who
 * keeps it full keeps share links failing for everyone. Closing that needs
 * either an authenticated write path or a limit keyed on something harder to
 * forge than an IP address; per-IP is the only lever available to an anonymous
 * caller. The point of the split is that the failure is contained rather than
 * total.
 */
export const MAX_OWNED_SNAPSHOTS_PER_CANVAS = 100;
export const MAX_ANONYMOUS_SNAPSHOTS = 500;
export const SNAPSHOT_TTL_MS = 60 * 60 * 1000;

/** Longest an owning canvas/file slug may be, on both the write and list path. */
export const MAX_CANVAS_ID_LENGTH = 200;

/**
 * How often this process is willing to issue an expiry sweep. A `setInterval`
 * in a route module is unreliable in serverless and keeps a warm process
 * alive, so the sweep rides the write path instead, throttled by this
 * interval. Multiple instances each sweep; the DELETE is idempotent, so the
 * only cost is a few redundant statements.
 */
const SNAPSHOT_SWEEP_INTERVAL_MS = 60 * 1000;

let lastSweepAt = 0;

/**
 * Ids are `randomUUID()`, but the reader accepts the loose shape the old route
 * did so that a malformed id is a cheap 404 rather than a query. Prisma
 * parameterises the lookup, so this is defence in depth, not injection
 * defence.
 */
export function isSnapshotId(value: string): boolean {
  return /^[0-9a-f-]{1,80}$/i.test(value);
}

export interface SnapshotSummary {
  id: string;
  canvasId: string;
  createdAt: number;
  expiresAt: number;
}

export type CreateSnapshotResult = { status: 'created'; id: string } | { status: 'capacity' };

/**
 * Best-effort deletion of expired rows. Wrapped so a sweep failure can never
 * fail a write, and throttled so it costs at most one DELETE per interval per
 * process. Nothing reads the result: correctness lives in the `expiresAt`
 * filters.
 */
async function sweepExpired(now: Date): Promise<void> {
  if (now.getTime() - lastSweepAt < SNAPSHOT_SWEEP_INTERVAL_MS) return;
  lastSweepAt = now.getTime();
  try {
    const client = await initializeDb();
    await client.canvasSnapshot.deleteMany({ where: { expiresAt: { lte: now } } });
  } catch {
    // Leave the rows. They are already invisible to reads, and the next sweep
    // (or the capacity check) will deal with them.
  }
}

/** Clear the in-process sweep throttle. Test-only. */
export function resetSnapshotSweepState(): void {
  lastSweepAt = 0;
}

/**
 * Store a validated scene and return its share id, or report that the live
 * capacity ceiling has been reached.
 *
 * `canvasId` is optional, and both values mean something different:
 *
 *  - **Present** — the caller has already been shown to own the `File` this id
 *    names (`resolveOwnedCanvasId`), so the row is that canvas's version
 *    history. The route is what enforces this; this function is not a
 *    second policy and must not be reachable with an unverified id.
 *  - **Absent** — an anonymous share snapshot. This is the product: the
 *    recipient opens `/canvas?snapshot=<id>` with no credential at all, so
 *    requiring one on every write would delete the share-link feature
 *    (`TopBar.handleShareCanvas` posts `{ data }` and nothing else, and
 *    `/canvas` is reachable logged out). Such rows are stored with
 *    `canvasId = null`, which is what keeps them out of every owner's
 *    version list in `listSnapshotSummaries`.
 *
 * The capacity check is partitioned by ownership — see the note on
 * `MAX_ANONYMOUS_SNAPSHOTS` — so an owned row is counted against its own
 * canvas's history and an anonymous row against the shared anonymous pool.
 */
export async function createSnapshot(input: {
  data: string;
  canvasId?: string;
}): Promise<CreateSnapshotResult> {
  const client = await initializeDb();
  const now = new Date();
  await sweepExpired(now);

  // Partitioned so one caller cannot spend another's budget. An owned row is
  // counted against its own canvas; an anonymous row against the shared
  // anonymous pool. See the note on MAX_ANONYMOUS_SNAPSHOTS.
  if (input.canvasId !== undefined) {
    const owned = await client.canvasSnapshot.count({
      where: { canvasId: input.canvasId, expiresAt: { gt: now } },
    });
    if (owned >= MAX_OWNED_SNAPSHOTS_PER_CANVAS) return { status: 'capacity' };
  } else {
    const anonymous = await client.canvasSnapshot.count({
      where: { canvasId: null, expiresAt: { gt: now } },
    });
    if (anonymous >= MAX_ANONYMOUS_SNAPSHOTS) return { status: 'capacity' };
  }

  const id = randomUUID();
  await client.canvasSnapshot.create({
    data: {
      id,
      data: input.data,
      createdAt: now,
      expiresAt: new Date(now.getTime() + SNAPSHOT_TTL_MS),
      ...(input.canvasId !== undefined ? { canvasId: input.canvasId } : {}),
    },
  });
  return { status: 'created', id };
}

/**
 * Resolve a snapshot's scene, or `null` when the id is unknown or the record
 * has expired. Both cases are indistinguishable here on purpose: the route
 * answers 404 for each, matching the old `!record || record.expiresAt <= now`.
 */
export async function readSnapshotData(id: string): Promise<string | null> {
  const client = await initializeDb();
  const row = await client.canvasSnapshot.findFirst({
    where: { id, expiresAt: { gt: new Date() } },
    select: { data: true },
  });
  return row?.data ?? null;
}

/**
 * Version-history metadata for one canvas, newest first. Scene bytes stay
 * behind `readSnapshotData`.
 *
 * `canvasId` here must be a `File.id` the caller has already been shown to own
 * (`resolveOwnedCanvasId`); this function does no authorisation, because the
 * route's own gate is what keeps it a version list rather than a directory.
 * It never lists across canvases regardless.
 */
export async function listSnapshotSummaries(canvasId: string): Promise<SnapshotSummary[]> {
  const client = await initializeDb();
  const rows = await client.canvasSnapshot.findMany({
    where: { canvasId, expiresAt: { gt: new Date() } },
    // The id tiebreaker is not in the old contract, which relied on Map
    // insertion order surviving a sort. Rows written in the same millisecond
    // otherwise come back in whatever order PostgreSQL feels like, so the
    // version list could reshuffle between refreshes.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, canvasId: true, createdAt: true, expiresAt: true },
  });

  return rows.map(row => ({
    id: row.id,
    // The filter pins canvasId to a validated non-empty string, so every row
    // that reaches this map has one. The column is nullable only for unscoped
    // snapshots, which this query excludes.
    canvasId: row.canvasId ?? canvasId,
    createdAt: row.createdAt.getTime(),
    expiresAt: row.expiresAt.getTime(),
  }));
}
