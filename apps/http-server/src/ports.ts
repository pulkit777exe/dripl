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
