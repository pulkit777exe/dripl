import { randomBytes, randomUUID } from 'node:crypto';

/**
 * The framework-free seams.
 *
 * `src/storage/` owns the image-byte seam (interface, three drivers, env
 * contract). This module owns the *other* things routes reach for directly
 * that make tests reach for real time, real randomness, or module state:
 * the clock, id generation, and the single-use WS ticket store. Each is a
 * small interface with a production value and an injectable fake, so a test
 * can advance time or stub ids without fake timers or module re-imports.
 *
 * Deliberately framework-free: `node:crypto` only, no express, no Prisma, no
 * Redis client. A future Redis-backed `TicketStorePort` lives here as a
 * second driver next to `createMemoryTicketStore`, not in a route.
 */

/** The one clock question the ticket store asks: "what time is it, in ms?" */
export interface ClockPort {
  nowMs(): number;
  nowDate(): Date;
}

/** Production clock: the wall clock, read fresh on every call. */
export const SystemClock: ClockPort = {
  nowMs: () => Date.now(),
  nowDate: () => new Date(),
};

/**
 * Id generation, split by shape rather than by caller.
 *
 * `uuid` mints WS tickets (opaque, echoed back by the client). `shareToken`
 * mints share-link tokens (24 CSPRNG bytes, base64url — the same encoding
 * `ShareService` and `RoomService` already use, kept identical so a token
 * minted through this port is indistinguishable from one minted inline).
 */
export interface IdPort {
  uuid(): string;
  shareToken(): string;
}

/** Production ids: CSPRNG in both arms. */
export const CryptoIds: IdPort = {
  uuid: () => randomUUID(),
  shareToken: () => randomBytes(24).toString('base64url'),
};

/**
 * Who a WS ticket admits. A `user` ticket binds the session token's subject;
 * a `share` ticket binds a file, its share token, and the permission the
 * share link grants. ws-server redeems the ticket over the internal endpoint
 * and accepts no session JWT of its own, so these fields are the whole
 * admission decision — a redemption that dropped or reshaped them would admit
 * the viewer to the wrong file, or with the wrong permission, and still
 * answer 200.
 */
export type TicketPrincipal =
  | { kind: 'user'; userId: string }
  | { kind: 'share'; fileId: string; token: string; permission: 'view' | 'edit' };

/** A stored ticket: its principal plus the deadline that bounds it. */
export interface TicketEntry {
  principal: TicketPrincipal;
  expiresAt: number;
}

/**
 * The WS ticket seam: two methods, mirroring `ImageStore`'s shape.
 *
 * `issue` mints a single-use bearer credential good for `ttlMs`; `consume`
 * spends it exactly once, returning the principal, or `null` when the ticket
 * was never issued or its deadline has passed. Absence is `null`, never an
 * error — an expired ticket and an unknown ticket are deliberately the same
 * answer, so expiry is not distinguishable from absence.
 *
 * Both methods are async even though the memory driver never blocks: the
 * interface is the contract a future shared driver must also satisfy, and a
 * sync signature would force every call site to change the day one appears.
 *
 * TODO(multi-instance): Redis-backed `TicketStorePort` for a horizontally
 * scaled http-server. `issue` is `SET ticket principal NX PX ttlMs` with a
 * bounded retry on id collision; `consume` must stay single-shot across
 * processes, so it needs a Lua compare-and-delete (get + expiry check +
 * delete in one script), not separate `GET`/`DEL` round trips. Until then
 * the memory driver below is the only implementation and tickets are
 * process-local, which is why ws-server currently delegates validation back
 * over HTTP instead of reading the store itself.
 */
export interface TicketStorePort {
  issue(principal: TicketPrincipal, ttlMs: number): Promise<string>;
  consume(ticket: string): Promise<TicketPrincipal | null>;
}

/**
 * Ticket policy, in one place so the route, the store, and the tests cannot
 * disagree about it. 30 seconds is long enough to open a socket and short
 * enough that a leaked ticket is not a durable credential; 10,000 bounds a
 * long-running process against a client that mints tickets faster than they
 * expire (a valid session and a loop — the 60-second sweep bounds expiry,
 * not volume, so the cap has to live on insert).
 */
export const WS_TICKET_TTL_MS = 30_000;
export const MAX_WS_TICKETS = 10_000;

export interface MemoryTicketStoreOptions {
  /**
   * Backing entries. Defaults to a fresh private `Map`. Inject a module-level
   * map only to preserve object identity for legacy shims that already hand
   * that map out (see `routes/auth.ts`'s `wsTicketStore` compat export).
   */
  entries?: Map<string, TicketEntry>;
}

/**
 * The process-local ticket driver, plus the sync core the async port wraps.
 *
 * `issueSync`/`consumeSync` are exposed (not hidden) because the two call
 * sites that predate this port are synchronous: `issueWsTicket` must stay
 * sync — its callers use the return value directly as a ticket string — and
 * the internal redemption handler spends inline. The async `issue`/`consume`
 * delegate to them with no `await` between get and delete, so single-shot
 * consumption stays atomic on the JS single thread either way.
 */
export interface MemoryTicketStore extends TicketStorePort {
  issueSync(principal: TicketPrincipal, ttlMs: number): string;
  consumeSync(ticket: string): TicketPrincipal | null;
}

export function createMemoryTicketStore(
  clock: ClockPort,
  ids: IdPort,
  options: MemoryTicketStoreOptions = {}
): MemoryTicketStore {
  const entries = options.entries ?? new Map<string, TicketEntry>();

  function issueSync(principal: TicketPrincipal, ttlMs: number): string {
    const ticket = ids.uuid();
    if (entries.size >= MAX_WS_TICKETS) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    entries.set(ticket, { principal, expiresAt: clock.nowMs() + ttlMs });
    return ticket;
  }

  function consumeSync(ticket: string): TicketPrincipal | null {
    const entry = entries.get(ticket);
    if (!entry || entry.expiresAt < clock.nowMs()) {
      entries.delete(ticket);
      return null;
    }
    entries.delete(ticket);
    return entry.principal;
  }

  return {
    issueSync,
    consumeSync,
    async issue(principal: TicketPrincipal, ttlMs: number): Promise<string> {
      return issueSync(principal, ttlMs);
    },
    async consume(ticket: string): Promise<TicketPrincipal | null> {
      return consumeSync(ticket);
    },
  };
}

/**
 * Which ticket driver the process should use, resolved from the environment.
 *
 * Mirrors `lib/rateLimiter.ts`'s contract exactly: both Upstash variables
 * present means Redis, anything else means process-local memory. Redis is an
 * operational optimisation, not a reason for a single-instance development
 * server to refuse every ticket — and a half-configured Redis (URL without a
 * token, or vice versa) reads as unconfigured rather than as a boot error.
 */
export type TicketStoreConfig =
  | { kind: 'memory' }
  | { kind: 'redis'; url: string; token: string };

export function resolveTicketConfig(
  env: Record<string, string | undefined> = process.env
): TicketStoreConfig {
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (url && token) return { kind: 'redis', url, token };
  return { kind: 'memory' };
}

/**
 * The only Redis surface the ticket driver touches, kept minimal so tests can
 * fake it without a network and so this module stays dependency-free.
 *
 * `Redis` from `@upstash/redis@1.39.0` satisfies this structurally — `set`
 * with `{ nx: true, px }` and `eval(script, keys, args)` are both used
 * verbatim in-repo (`apps/ws-server/src/redis.ts` lease acquire/renew) — but
 * this module deliberately does not import it. The seam stays `node:crypto`
 * only; the route that wires the real client owns that import.
 */
export interface RedisTicketClient {
  set(key: string, value: string, opts: { nx: true; px: number }): Promise<'OK' | string | null>;
  eval<TArgs extends unknown[], TData>(
    script: string,
    keys: string[],
    args: TArgs
  ): Promise<TData>;
}

export interface RedisTicketStoreOptions {
  /** Key prefix, so ticket keys are recognisable in a shared Redis. */
  keyPrefix?: string;
  /** `SET NX` retries on id collision before giving up. UUIDs do not collide. */
  maxIssueAttempts?: number;
}

/** Visible in Redis listings; the ticket itself is the random suffix. */
export const TICKET_KEY_PREFIX = 'dripl:ws-ticket:';

/** Three attempts: one genuine try plus margin for a collision that never happens. */
export const MAX_TICKET_ISSUE_ATTEMPTS = 3;

/**
 * Extra milliseconds on the key TTL beyond the ticket's own deadline.
 *
 * Redis reaps a key whose TTL has *elapsed* (`when <= now` on access), while
 * the memory driver — and the Lua script — treat a ticket as live at exactly
 * `expiresAt` (`expiresAt < now` refuses). Without slack, a ticket consumed at
 * the exact millisecond of its deadline would read live from memory and
 * missing from Redis: the same port contract answering differently per
 * driver, at a boundary the memory suite pins. The slack moves reclamation
 * strictly later, so the embedded `expiresAt` the script checks is always the
 * verdict and the key TTL is purely the backstop that reclaims keys nobody
 * redeems. One second: an unredeemed ticket lingering a second longer in
 * Redis is unobservable, while any smaller margin would still be a race.
 */
export const REDIS_TICKET_TTL_SLACK_MS = 1_000;

/**
 * Get, expiry-check, and delete in one atomic step — the shape the module
 * docstring's TODO calls for, and for the same reason: separate `GET`/`DEL`
 * round trips let two instances both read a live ticket before either deletes
 * it, and the ticket stops being single-use.
 *
 * Why the expiry check lives inside the script rather than relying on the key
 * TTL alone: the memory driver pins "live at exactly `expiresAt`, dead a
 * millisecond later", and the script preserves that boundary across drivers
 * instead of leaving it to Redis key-expiry sampling. The `PX` on `SET` is
 * still the backstop that reclaims keys nobody redeems.
 *
 * Two encoding notes for the next reader. The value is the same
 * `{ principal, expiresAt }` JSON the memory driver stores, so a key read in
 * `redis-cli` is human-readable. And the script returns the bulk string or
 * nil — never a status reply — because a Lua `redis.call` on a status command
 * yields an `{ok=...}` table that round-trips awkwardly through the REST
 * encoder (the same reason the ws-server lease scripts return integers).
 *
 * Live-test honesty: this script is executed under LuaJIT in
 * `src/__tests__/ports/redisTicketStore.test.ts` (all four branches, against
 * stubbed `redis`/`cjson` globals), but it has never run against a live
 * Upstash instance. It assumes the standard `cjson.decode` the stock Redis
 * Lua sandbox provides.
 */
export const TICKET_CONSUME_LUA = `local raw = redis.call('GET', KEYS[1])
if not raw then
  return nil
end
local entry = cjson.decode(raw)
if entry.expiresAt < tonumber(ARGV[1]) then
  redis.call('DEL', KEYS[1])
  return nil
end
redis.call('DEL', KEYS[1])
return raw`;

/**
 * The shared ticket driver: `issue` is `SET key value NX PX ttlMs` with a
 * bounded retry on id collision; `consume` spends the ticket through the Lua
 * script above, so get, expiry check, and delete are one atomic step even
 * when two http-server instances race for the same ticket.
 *
 * Absence is `null`, never an error — the same indistinguishability the
 * memory driver promises. A Redis transport failure, on the other hand,
 * rejects: failing closed is the point, because a ticket this process cannot
 * see is a ticket it must not honour. The one deliberate asymmetry with
 * `lib/rateLimiter.ts` is that there is no memory fallback on failure — a
 * limiter that falls back merely counts locally for a while, while a ticket
 * store that fell back would mint tickets its peers cannot redeem (or redeem
 * tickets its peers cannot see), which is a split brain, not a degradation.
 */
export function createRedisTicketStore(
  client: RedisTicketClient,
  clock: ClockPort,
  ids: IdPort,
  options: RedisTicketStoreOptions = {}
): TicketStorePort {
  const prefix = options.keyPrefix ?? TICKET_KEY_PREFIX;
  const maxAttempts = options.maxIssueAttempts ?? MAX_TICKET_ISSUE_ATTEMPTS;

  async function issue(principal: TicketPrincipal, ttlMs: number): Promise<string> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const ticket = ids.uuid();
      const value = JSON.stringify({ principal, expiresAt: clock.nowMs() + ttlMs });
      // `null` is the NX precondition failing — the id is taken — so mint a
      // fresh one and try again. Anything else that is not `OK` is a transport
      // surprise, and retrying it would risk double-minting; let it throw.
      //
      // The key TTL carries REDIS_TICKET_TTL_SLACK_MS beyond the ticket's own
      // deadline so the script's `expiresAt` check — not Redis key-expiry
      // sampling — is the verdict at the boundary, exactly as in memory.
      const result = await client.set(`${prefix}${ticket}`, value, {
        nx: true,
        px: ttlMs + REDIS_TICKET_TTL_SLACK_MS,
      });
      if (result === 'OK') return ticket;
      if (result !== null) {
        throw new Error(`ticket store rejected issue with an unexpected reply`);
      }
    }
    throw new Error(`ticket store could not mint a unique ticket in ${maxAttempts} attempts`);
  }

  async function consume(ticket: string): Promise<TicketPrincipal | null> {
    const raw = await client.eval<[string], string | null>(
      TICKET_CONSUME_LUA,
      [`${prefix}${ticket}`],
      [String(clock.nowMs())]
    );
    // `null` is absence-or-expired, per the script. A non-string is a reply
    // shape this driver never produces; treat it as absence, not as a principal.
    if (typeof raw !== 'string') return null;
    try {
      const entry = JSON.parse(raw) as { principal?: unknown; expiresAt?: unknown };
      if (!entry || typeof entry !== 'object') return null;
      if (typeof entry.expiresAt !== 'number') return null;
      if (!entry.principal || typeof entry.principal !== 'object') return null;
      return entry.principal as TicketPrincipal;
    } catch {
      // A value this driver did not write (a foreign key under our prefix, a
      // half-written value). Refuse it rather than crash on it.
      return null;
    }
  }

  return { issue, consume };
}
