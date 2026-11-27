import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { Redis } from '@upstash/redis';
import { timingSafeEqualString } from '@dripl/utils';
import { authMiddleware, type AuthenticatedRequest } from '../middlewares/authMiddleware';
import {
  CryptoIds,
  SystemClock,
  WS_TICKET_TTL_MS,
  createMemoryTicketStore,
  createRedisTicketStore,
  resolveTicketConfig,
  type TicketPrincipal,
  type TicketStorePort,
} from '../ports';

/** The ticket principal shape lives on the port; this alias keeps existing imports working. */
export type WsTicketPrincipal = TicketPrincipal;

type WsTicketEntry = { principal: WsTicketPrincipal; expiresAt: number };

const ticketEntries = new Map<string, WsTicketEntry>();
const memoryTicketStore = createMemoryTicketStore(SystemClock, CryptoIds, {
  entries: ticketEntries,
});

/**
 * The selected ticket driver: the memory store above, unless the Upstash
 * variables resolve to Redis — the same Upstash-with-memory-fallback contract
 * `lib/rateLimiter.ts` uses. In memory mode this *is* `memoryTicketStore` (same
 * object, not a copy), so the memory path below behaves byte-for-byte as it
 * always did: same map, same TTL, same eviction, same sweep.
 *
 * `new Redis()` is constructed inside the `try` because it throws
 * synchronously on a malformed `UPSTASH_REDIS_REST_URL` (the ws-server Redis
 * module documents exactly that), and a typo in an env var must degrade to
 * process-local tickets rather than crash boot.
 */
function createTicketStorePort(): TicketStorePort {
  const config = resolveTicketConfig(process.env);
  if (config.kind === 'redis') {
    try {
      return createRedisTicketStore(
        new Redis({ url: config.url, token: config.token }),
        SystemClock,
        CryptoIds
      );
    } catch {
      return memoryTicketStore;
    }
  }
  return memoryTicketStore;
}

const ticketStorePort: TicketStorePort = createTicketStorePort();

/**
 * Compat shims over the ticket-store port. `wsTicketStore` is the memory
 * store's own backing map (same object, not a copy), so existing direct uses —
 * tests seeding entries, the sweep below — keep seeing live state.
 * `issueWsTicket` stays synchronous and delegates to the memory store's sync
 * core with the shared TTL.
 *
 * Both shims are memory-only by construction: a synchronous call cannot cross
 * the network. Production routes must use the async `issueTicket` /
 * `ticketStorePort` below, which reach the selected driver — in Redis mode a
 * ticket minted through these shims would be invisible to every other
 * instance, which is the split brain the Redis driver exists to remove. No
 * production caller uses them; they remain for the test suites that drive the
 * memory path directly.
 */
export const wsTicketStore: Map<string, WsTicketEntry> = ticketEntries;

export function issueWsTicket(principal: WsTicketPrincipal): string {
  return memoryTicketStore.issueSync(principal, WS_TICKET_TTL_MS);
}

/**
 * The one production minting path: through the selected driver, so a ticket
 * issued by this instance is redeemable on every instance behind the load
 * balancer. Same TTL, same principal — only the driver differs.
 */
export function issueTicket(principal: WsTicketPrincipal): Promise<string> {
  return ticketStorePort.issue(principal, WS_TICKET_TTL_MS);
}

const wsTicketCleanup = setInterval(() => {
  const now = Date.now();
  for (const [ticket, data] of wsTicketStore.entries()) {
    if (data.expiresAt < now) wsTicketStore.delete(ticket);
  }
}, 60_000);
wsTicketCleanup.unref();

const wsTicketRouter: Router = Router();

wsTicketRouter.post('/ws-ticket', authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const ticket = await issueTicket({ kind: 'user', userId: req.userId });
  res.json({ ticket });
});

export { wsTicketRouter };

const validateTicketSchema = z.object({
  ticket: z.string().min(1).max(512),
});

export function createInternalRouter(): Router {
  const internalRouter = Router();

  function requireInternalSecret(req: Request, res: Response, next: NextFunction): void {
    const expectedSecret = process.env.INTERNAL_SECRET;
    const providedSecret = req.get('x-internal-secret');
    if (
      !expectedSecret ||
      !providedSecret ||
      !timingSafeEqualString(expectedSecret, providedSecret)
    ) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  }

  internalRouter.post('/validate-ticket', requireInternalSecret, async (req, res) => {
    // Malformed in any way — absent, the wrong type, empty, overlong —
    // answers the same 400: this is an internal endpoint and its wire says
    // only "no". Reading the body through the schema also removed a latent
    // 500: the previous destructure threw when no body parser had run.
    const parsed = validateTicketSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ticket is required' });
      return;
    }
    // Through the selected driver, so a ticket minted by any instance is
    // spendable on this one. In memory mode this is the same store (and the
    // same single-threaded atomicity) the previous sync call provided.
    const principal = await ticketStorePort.consume(parsed.data.ticket);
    if (!principal) {
      res.status(401).json({ error: 'Invalid or expired ticket' });
      return;
    }
    res.json(principal);
  });

  return internalRouter;
}
