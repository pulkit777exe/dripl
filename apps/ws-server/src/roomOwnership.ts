import { randomUUID } from 'node:crypto';
import {
  acquireRoomLease,
  isRedisAvailable,
  renewRoomLease,
  releaseRoomLease,
  type LeaseAcquireResult,
} from './redis';
import { logger } from './logger';

/**
 * ==================================================================
 * ADR-002 state model: one authoritative writer per room.
 * ==================================================================
 *
 * THE PROBLEM THIS SOLVES
 *
 * `RoomState` (`types.ts`) is an in-memory mutable graph: elements, tombstones,
 * locks, cursors, the `recentMsgIds` dedup ring, and the `updatedAt` fence used
 * by the Postgres save. Redis fan-out (`redis.ts`) made *delivery* of a peer's
 * accepted mutation cross-instance, but each instance still held its own
 * `RoomState` and applied the peer's delta to it. Two instances holding room R
 * therefore both admitted edits against their own divergent copy, and both
 * later raced the same Postgres row. That is silent data loss, not a
 * replication lag you can wait out.
 *
 * THE CHOICE: single writer, not distributed state
 *
 * `docs/collaboration-crdt-e2ee-decision.md` §3.1.8 requires "one
 * authoritative reducer/sequencer and durable revision/dedup storage" and §5.1
 * names the two admissible routes: "a durable room revision/operation ledger
 * **or a single authoritative room owner**". This module implements the second.
 * The first was rejected on measured grounds, not taste:
 *
 *   - An operation ledger makes the room mutation a read-modify-write against
 *     shared state on *every* message. The room path sustains ~30
 *     mutations/second (`rateLimiter.ts`: 30 msgs/s). Upstash's client is REST:
 *     each command is an HTTP round-trip, billed and measured per request. The
 *     dispatcher `await`s each handler, so the room's whole message budget would
 *     serialise behind that round-trip.
 *   - Even ignoring cost, the ledger needs the *admission decision* and the
 *     *write* to be one indivisible step, because capacity (`MAX_ELEMENTS_PER_SCENE`),
 *     the tombstone fence, and `shouldAcceptElement` all read the room's current
 *     state, and the handler must return an accept/reject verdict before it can
 *     fan out. On this client that means one `EVAL` per mutation whose script
 *     must reimplement the whole admission funnel — duplicating
 *     `sceneMutation.ts` in Lua, where it could not be unit-tested with the same
 *     `@dripl/common` reducers that guarantee the semantics elsewhere.
 *
 * Single-writer ownership reaches the same mutual exclusion with **zero** shared
 * state on the mutation path, because mutual exclusion is only hard when two
 * writers exist. With one writer per room there is no read-modify-write to lose:
 * the admission funnel reads the one authoritative copy, and Postgres remains
 * the durable authority with the fenced write and merge-retry it already had.
 *
 * WHAT IS THE SOURCE OF TRUTH
 *
 *   Durable scene data ....... PostgreSQL (`file`/`canvasRoom.content`), written
 *                              through `persistRoom`'s `updatedAt` fence, with
 *                              `mergeAndSaveOnConflict` as the retry. Unchanged.
 *   Authoritative in-memory
 *   copy for a room .......... whichever instance holds the lease. Exactly one,
 *                              by construction, so "the" copy is unambiguous.
 *   Room ownership ............ `dripl:room-owner:<roomId>` in Redis: a
 *                              TTL'd key whose value is this instance's lease
 *                              token. Advisory across processes, authoritative
 *                              for mutual exclusion.
 *   Cross-instance delivery ... Redis pub/sub. Now a backstop for the handover
 *                              window rather than the steady-state mechanism.
 *
 * WHAT HAPPENS WHEN TWO INSTANCES MUTATE THE SAME ROOM
 *
 * They cannot. The second instance's `acquireRoom` returns `'foreign'` and the
 * join is refused with close code 4010 before any `RoomState` is created, so it
 * never loads a scene, never admits a mutation, and never writes Postgres. If
 * ownership is lost *after* it was serving (lease expiry, Redis partition longer
 * than the TTL), `onRoomOwnershipLost` fires: the room's sockets are closed with
 * 4010 and the local `RoomState` is dropped **without saving**, because the new
 * owner is now the authority and an un-fenced write from a lapsed owner is
 * exactly the clobber the lease prevents. The residual cost of a handover is
 * bounded and stated in ADR-002: whatever the old owner had not yet persisted
 * (<= `SAVE_DEBOUNCE_MS` with the debounce, <= `PERIODIC_SAVE_INTERVAL_MS` for a
 * room whose debounce never fired), which is the same class of loss a single
 * process restart already had.
 *
 * FAILURE MODE WHEN REDIS IS UNAVAILABLE
 *
 * Two different failures must not be conflated, so the lease layer reports
 * three outcomes rather than a boolean:
 *
 *   'disabled'     no Redis configured, or `WS_ROOM_OWNERSHIP=off`. Serve the
 *                  room exactly as the single-instance configuration always
 *                  has. This is the production configuration today and its
 *                  behaviour is byte-for-byte unchanged.
 *   'held-elsewhere' a peer demonstrably holds a live lease. **Fail closed**:
 *                  refuse the join. Refusing is correct; the alternative is
 *                  serving a room we know is being written elsewhere.
 *   'unavailable'  Redis is configured but the request failed. **Fail open**,
 *                  with a loud `room_ownership_unavailable` log line, because
 *                  making an infrastructure outage into a total product outage
 *                  is a strictly worse failure than the divergence it risks.
 *                  Fail-open degrades to the pre-ADR-002 behaviour (per-process
 *                  rooms, Pub/Sub fan-out), not to some new partial-shared-state
 *                  mode: there is no half-authoritative state here to observe.
 *
 *   The fail-open case is the honest residual risk of this ADR. During a Redis
 *   outage two instances *can* both serve and diverge again. It is bounded by
 *   the outage and it is visible in logs; `WS_ROOM_OWNERSHIP=off` plus a single
 *   instance is the documented deployment for operators who would rather accept
 *   the outage risk than the failover risk.
 *
 * WHAT STAYS PROCESS-LOCAL, AND WHY IT CANNOT BE OTHERWISE
 *
 * Two of these are not policy choices, they are structural, and no amount of
 * Redis changes them:
 *
 *   - `wsToRoomMap` is keyed by a live `WebSocket` **object**. A socket handle
 *     is not a value; it cannot be serialised, and it is meaningless in another
 *     process. Per-socket routing state is inherently local.
 *   - `saveTimeouts` is keyed by a live `NodeJS.Timeout` handle, for the same
 *     reason and more sharply: a debounce timer is a pending callback in *this*
 *     event loop. A remote peer cannot fire it.
 *
 * The rest (`roomLastEmptyAt`, `userToRoomMap`, `recentMsgIds`, and each
 * `RoomState`'s users/cursors/locks/viewports/following/tombstones) is local
 * because single-writer ownership makes the local copy *complete and
 * authoritative* for its room, so there is nothing to share. Note what that
 * buys: because the owner's warm `RoomState` is the only copy, a joiner is
 * served from memory rather than re-read from Postgres, which removes the
 * join-time staleness window entirely; element locks are room-wide rather than
 * instance-wide; scene capacity is counted once; and a tombstone cannot be
 * undone by a peer that never saw the delete.
 */

/**
 * Key namespace for the ownership lease. Deliberately disjoint from
 * `dripl:room:*` (the fan-out channel) and `dripl:ws:ratelimit`: a lease must
 * never be confused with a message or a counter, and must never be swept by
 * anything that reasons about the other two.
 */
export const ROOM_OWNERSHIP_KEY_PREFIX = 'dripl:room-owner:';

/**
 * Lease lifetime. Bounds how long a dead instance can hold a room hostage
 * before a peer takes over, and therefore also bounds the window in which a
 * partitioned-but-live owner keeps editing a room another instance now owns.
 * Short enough to make handover feel like a reconnect, long enough to ride out
 * an Upstash blip or a GC pause without dropping a healthy room.
 */
const DEFAULT_ROOM_LEASE_TTL_MS = 20_000;

/**
 * Renewal period. Four renewals fit inside the TTL, so three consecutive
 * failures (including an 'unavailable' verdict) are tolerated before the
 * lapsed-owner guard below fires.
 */
const DEFAULT_ROOM_LEASE_RENEW_MS = 5_000;

/** Floor so a misconfigured value cannot turn the renew sweep into a hot loop. */
const MIN_ROOM_LEASE_RENEW_MS = 1_000;

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn({ event: 'room_lease_env_invalid', name, value: raw, fallback });
    return fallback;
  }
  return Math.floor(parsed);
}

export const ROOM_LEASE_TTL_MS = positiveIntFromEnv(
  'WS_ROOM_LEASE_TTL_MS',
  DEFAULT_ROOM_LEASE_TTL_MS
);

export const ROOM_LEASE_RENEW_MS = Math.max(
  MIN_ROOM_LEASE_RENEW_MS,
  positiveIntFromEnv('WS_ROOM_LEASE_RENEW_MS', DEFAULT_ROOM_LEASE_RENEW_MS)
);

export function roomLeaseKey(roomId: string): string {
  return `${ROOM_OWNERSHIP_KEY_PREFIX}${roomId}`;
}

/**
 * `true` when room ownership is switched off explicitly. Default is *on*
 * whenever Redis is configured: an operator who has bothered to configure
 * Upstash has two instances in mind, and silently reverting to per-process
 * rooms because nobody set a flag is how this limitation comes back.
 */
export function isRoomOwnershipDisabled(): boolean {
  return process.env.WS_ROOM_OWNERSHIP === 'off';
}

/** Ownership can only be enforced when there is somewhere to hold a lease. */
export function isRoomOwnershipEnabled(): boolean {
  return !isRoomOwnershipDisabled() && isRedisAvailable();
}

export type RoomLeaseOutcome = 'owner' | 'foreign' | 'unavailable' | 'disabled';

interface RoomLease {
  roomId: string;
  /** Unique per acquisition; the CAS precondition. Never leaves this process
   * except as the Redis value, and only the holder can learn it. */
  token: string;
  acquiredAt: number;
  lastRenewedAt: number;
}

const leases = new Map<string, RoomLease>();
let renewTimer: NodeJS.Timeout | null = null;
let ownershipLostHandler: ((roomId: string) => void) | null = null;

/**
 * Register the reaction to losing a room we were serving. Kept as an injected
 * hook rather than an import so this module has no dependency on `rooms.ts` /
 * `index.ts` and can be exercised without a running server.
 */
export function onRoomOwnershipLost(handler: (roomId: string) => void): void {
  ownershipLostHandler = handler;
}

function ensureRenewSweep(): void {
  if (renewTimer) return;
  renewTimer = setInterval(() => {
    void renewAllLeases();
  }, ROOM_LEASE_RENEW_MS);
  // Never hold the process open for a lease renewal.
  renewTimer.unref();
}

function stopRenewSweepIfIdle(): void {
  if (leases.size > 0 || !renewTimer) return;
  clearInterval(renewTimer);
  renewTimer = null;
}

/**
 * Claim exclusive write authority for `roomId`, or report why not.
 *
 * Idempotent for a room this instance already holds: the second call returns
 * `'owner'` without touching Redis. Re-running the `SET NX` against a lease we
 * already own would *fail*, and treating that failure as `'foreign'` would
 * make every extra join to a busy room look like a lost race.
 */
export async function acquireRoom(roomId: string): Promise<RoomLeaseOutcome> {
  if (isRoomOwnershipDisabled()) return 'disabled';
  if (!isRedisAvailable()) return 'disabled';
  if (leases.has(roomId)) return 'owner';

  const token = randomUUID();
  const result: LeaseAcquireResult = await acquireRoomLease(
    roomLeaseKey(roomId),
    token,
    ROOM_LEASE_TTL_MS
  );
  if (result === 'acquired') {
    const now = Date.now();
    leases.set(roomId, { roomId, token, acquiredAt: now, lastRenewedAt: now });
    ensureRenewSweep();
    logger.info({ event: 'room_ownership_acquired', roomId, ttlMs: ROOM_LEASE_TTL_MS });
    return 'owner';
  }
  if (result === 'held-elsewhere') {
    logger.warn({ event: 'room_ownership_conflict', roomId });
    return 'foreign';
  }
  // Fail open, loudly: see the state-model comment above.
  logger.error({
    event: 'room_ownership_unavailable',
    roomId,
    note: 'serving room without an ownership lease; concurrent instances may diverge',
  });
  return 'unavailable';
}

export function ownsRoom(roomId: string): boolean {
  return leases.has(roomId);
}

/**
 * Extend every lease we hold. Exported for the sweep and for tests; it is
 * idempotent and safe to call concurrently with itself.
 */
export async function renewAllLeases(now = Date.now()): Promise<void> {
  const results = await Promise.all(
    Array.from(leases.values(), async lease => {
      const verdict = await renewRoomLease(
        roomLeaseKey(lease.roomId),
        lease.token,
        ROOM_LEASE_TTL_MS
      );
      return { lease, verdict };
    })
  );
  for (const { lease, verdict } of results) {
    if (verdict === 'renewed') {
      lease.lastRenewedAt = now;
      continue;
    }
    if (verdict === 'lost') {
      loseLease(lease.roomId, 'cas_rejected');
      continue;
    }
    // 'unavailable': one failed round-trip is not proof of loss, and killing a
    // healthy room because Upstash had a bad second would be a worse bug than
    // the one this module exists to prevent. But an owner that cannot renew
    // for longer than the TTL *has* lost the lease — the key expired, and
    // whoever holds it now may be a different instance. Time, not a single
    // error, is what makes that unambiguous.
    if (now - lease.lastRenewedAt >= ROOM_LEASE_TTL_MS) {
      loseLease(lease.roomId, 'renewal_expired');
    }
  }
}

function loseLease(roomId: string, reason: string): void {
  const lease = leases.get(roomId);
  if (!lease) return;
  leases.delete(roomId);
  logger.error({
    event: 'room_ownership_lost',
    roomId,
    reason,
    heldForMs: Date.now() - lease.acquiredAt,
  });
  stopRenewSweepIfIdle();
  ownershipLostHandler?.(roomId);
}

/**
 * Give up a room. Called when the room is garbage-collected locally (after its
 * final persisted write) and at shutdown, so a room does not stay pinned to a
 * process for the remainder of the TTL once nobody is using it.
 *
 * Releasing is an optimisation, not a correctness requirement: expiry alone is
 * sufficient. That is deliberate — it is why release never blocks the caller
 * and never reports failure upward.
 */
export async function releaseRoom(roomId: string): Promise<void> {
  const lease = leases.get(roomId);
  if (!lease) return;
  leases.delete(roomId);
  stopRenewSweepIfIdle();
  const result = await releaseRoomLease(roomLeaseKey(roomId), lease.token);
  if (result === 'released') {
    logger.info({ event: 'room_ownership_released', roomId });
  } else if (result === 'not-held') {
    // Another instance already owns it; nothing to undo and nothing to say.
    logger.info({ event: 'room_ownership_release_race', roomId });
  }
}

export async function releaseAllRooms(): Promise<void> {
  const roomIds = Array.from(leases.keys());
  await Promise.all(roomIds.map(roomId => releaseRoom(roomId)));
}

/** Test seam: drop local lease state without touching Redis. */
export function resetRoomOwnershipForTests(): void {
  if (renewTimer) {
    clearInterval(renewTimer);
    renewTimer = null;
  }
  leases.clear();
  ownershipLostHandler = null;
}
