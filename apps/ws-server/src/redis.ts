import { randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { logger } from './logger';

let redis: Redis | null = null;

const INSTANCE_ID = randomUUID();
const roomHandlers = new Map<string, (message: unknown) => void>();
let initialized = false;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return null;
  }
  redis = new Redis({ url, token });
  return redis;
}

function initSubscription(): void {
  if (initialized) return;
  const client = getRedis();
  if (!client) return;
  initialized = true;

  try {
    const sub = client.psubscribe('dripl:room:*');
    sub.on('pmessage', (data: { pattern: string; channel: string; message: unknown }) => {
      try {
        const roomId = String(data.channel).replace('dripl:room:', '');
        const payload = typeof data.message === 'string' ? JSON.parse(data.message) : data.message;
        if (payload.instanceId === INSTANCE_ID) return;
        const handler = roomHandlers.get(roomId);
        if (handler) handler(payload);
      } catch (err) {
        logger.error({
          event: 'redis_message_parse_error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
    logger.info({ event: 'redis_pattern_subscribed', pattern: 'dripl:room:*' });
  } catch (err) {
    initialized = false;
    logger.error({
      event: 'redis_subscribe_failed',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function subscribeToRoom(roomId: string, handler: (message: unknown) => void): void {
  initSubscription();
  roomHandlers.set(roomId, handler);
}

/**
 * ------------------------------------------------------------------
 * Room-lease primitives (the single-writer mechanism; see
 * `roomOwnership.ts` for the state model this exists to serve).
 * ------------------------------------------------------------------
 *
 * WHY LUA, AND NOT `SET NX` / `SET XX`.
 *
 * A lease needs three operations and only one of them is expressible with
 * plain string commands:
 *
 *   acquire  — `SET key <token> NX PX <ttl>`; `OK` wins, `null` loses.
 *              Atomic in Redis, one round-trip. No scripting needed.
 *   renew    — must extend the TTL **only if we still hold the key**.
 *   release  — must delete **only if we still hold the key**.
 *
 * `SET key val XX PX ttl` looks like it does renewal, but `XX` only asserts
 * "the key exists". It does not assert "the key is *mine*". A lapsed owner
 * whose lease expired and was re-acquired by another instance would happily
 * overwrite the new owner's value and TTL — the exact split-brain the lease
 * exists to prevent, reached through the command that is supposed to prevent
 * it. The same hole exists for a plain `DEL`.
 *
 * So renew/release are compare-and-set, and compare-and-set needs `EVAL`.
 * This is not an optimisation; it is the only primitive in the whole client
 * surface that can do it:
 *
 *   - `WATCH`/`UNWATCH`/`DISCARD` are NOT supported by Upstash REST
 *     (documented) and are not exposed by `@upstash/redis@1.39.0` at all
 *     (verified against the installed instance and prototype chain). No
 *     optimistic-locking retry is available, by either route.
 *   - `client.multi()` is a real `MULTI`/`EXEC` (`/multi-exec`), but Redis
 *     queues a transaction block and returns every result only at `EXEC`. A
 *     queued command cannot consume the reply of an earlier one, so a
 *     read-modify-write is not expressible inside it. Atomic, but blind.
 *   - `client.pipeline()` is documented by Upstash as explicitly non-atomic.
 *   - `EVAL` is atomic for the whole script body, so a script that reads,
 *     compares, and writes is a single indivisible step. That is the one
 *     primitive here that is both available and sufficient.
 *
 * Consequence for the state model (this is the crux of ADR-002, and it is
 * why room state is not simply "moved into Redis"): atomicity here is only
 * ever obtained *inside one script*, and a scene mutation is not one script —
 * it is an admission decision (capacity, tombstone, freshness fence) plus a
 * write, each of which needs the room's current state, and the wire protocol
 * also needs a synchronous admission answer before it can fan out the
 * accepted delta. Upstash charges and pays latency per request, so making the
 * ~30-mutations/second/room path script-shaped would put a network round-trip
 * on every scene edit. Single-writer ownership gets the same
 * mutual-exclusion guarantee for free, because with one writer there is no
 * read-modify-write to lose. See `roomOwnership.ts`.
 *
 * Both scripts return an integer (1 = the CAS held, 0 = it did not) rather
 * than the `SET` status reply. A Lua `redis.call` on a status command yields
 * a `{ok=...}` table, which is awkward to round-trip through the REST JSON
 * encoder; an integer is unambiguous and keeps the client-side comparison
 * trivial.
 */

/** `SET key <next> PX <ttl>` only if `key` currently holds `<expected>`. */
const LEASE_RENEW_LUA = `if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
  return 1
end
return 0`;

/** `DEL key` only if `key` currently holds `<expected>`. */
const LEASE_RELEASE_LUA = `if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

export type LeaseAcquireResult = 'acquired' | 'held-elsewhere' | 'unavailable';
export type LeaseRenewResult = 'renewed' | 'lost' | 'unavailable';
export type LeaseReleaseResult = 'released' | 'not-held' | 'unavailable';

/**
 * Try to become the single writer for `key` for `ttlMs`.
 *
 * `'unavailable'` is a *transport* verdict, deliberately distinct from
 * `'held-elsewhere'`: the caller must be able to tell "a peer owns this room"
 * (fail closed, refuse the join) from "Redis is unreachable" (fail open, keep
 * serving) — see `roomOwnership.ts` for why those must not be conflated.
 */
export async function acquireRoomLease(
  key: string,
  token: string,
  ttlMs: number
): Promise<LeaseAcquireResult> {
  try {
    const client = getRedis();
    if (!client) return 'unavailable';
    const result = await client.set(key, token, { nx: true, px: ttlMs });
    return result === null ? 'held-elsewhere' : 'acquired';
  } catch (err) {
    logger.error({
      event: 'redis_lease_acquire_failed',
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return 'unavailable';
  }
}

/** Extend `key`'s TTL iff it still holds our `token`. */
export async function renewRoomLease(
  key: string,
  token: string,
  ttlMs: number
): Promise<LeaseRenewResult> {
  try {
    const client = getRedis();
    if (!client) return 'unavailable';
    // The token is unchanged across renewals: the CAS precondition is what
    // proves ownership, and only the holder ever learns the token.
    const result = await client.eval<[string, string, string], number>(
      LEASE_RENEW_LUA,
      [key],
      [token, token, String(ttlMs)]
    );
    return Number(result) === 1 ? 'renewed' : 'lost';
  } catch (err) {
    logger.error({
      event: 'redis_lease_renew_failed',
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return 'unavailable';
  }
}

/** Delete `key` iff it still holds our `token`. */
export async function releaseRoomLease(key: string, token: string): Promise<LeaseReleaseResult> {
  try {
    const client = getRedis();
    if (!client) return 'unavailable';
    const result = await client.eval<[string], number>(LEASE_RELEASE_LUA, [key], [token]);
    return Number(result) === 1 ? 'released' : 'not-held';
  } catch (err) {
    logger.error({
      event: 'redis_lease_release_failed',
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return 'unavailable';
  }
}

export function unsubscribeFromRoom(roomId: string): void {
  roomHandlers.delete(roomId);
}

/**
 * Best-effort cross-instance fan-out for one room. The scene broadcast path
 * calls this without awaiting it, so the contract that makes that safe is
 * stated here rather than assumed at six call sites: **this never rejects.**
 * The client lookup moved inside the `try` for exactly that reason — `new
 * Redis(...)` throws synchronously on a malformed `UPSTASH_REDIS_REST_URL`, and
 * in an `async` function a synchronous throw becomes a rejection. That one
 * unlogged rejection was enough to take the whole ws-server process down
 * (Node aborts on unhandled rejections) the first time a client with a bad
 * Redis URL published a scene delta.
 *
 * Every failure is logged as `redis_publish_failed`. Since room ownership
 * (see `roomOwnership.ts`) makes exactly one instance the writer for a room,
 * this channel is now expected to carry cursors and the short handover window
 * between a lapsed and a new owner — not a steady stream of competing scene
 * deltas. It remains the correctness backstop for that handover window, which
 * is why it is unchanged rather than removed.
 */
export async function publishToRoom(roomId: string, payload: object): Promise<void> {
  try {
    const client = getRedis();
    if (!client) return;
    await client.publish(`dripl:room:${roomId}`, {
      ...payload,
      instanceId: INSTANCE_ID,
      timestamp: Date.now(),
    });
  } catch (err) {
    logger.error({
      event: 'redis_publish_failed',
      roomId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function isRedisAvailable(): boolean {
  return getRedis() !== null;
}
