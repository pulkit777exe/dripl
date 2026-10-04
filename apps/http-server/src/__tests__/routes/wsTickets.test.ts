/**
 * THE WebSocket TICKET STORE AND THE INTERNAL REDEMPTION ENDPOINT.
 *
 * This is the one place in http-server that mints a capability with no expiry
 * attached to the credential itself. `POST /api/auth/ws-ticket` takes a session
 * token and returns a 30-second ticket; `POST /internal/validate-ticket` spends
 * that ticket exactly once and hands back the principal. ws-server redeems tickets
 * over that endpoint behind `INTERNAL_SECRET` and accepts no session JWT at all, so
 * this file is the whole authentication story for a collaboration socket.
 *
 * WHAT IS WORTH ASSERTING HERE
 *
 * A ticket is a bearer credential with a 30-second life, and its entire value
 * rests on three properties that are easy to state and easy to lose:
 *
 *   1. **Single use.** A replayed ticket must not resolve a second time. If
 *      redemption did not delete, a ticket captured from a network log would open
 *      a socket 30 seconds after its legitimate owner had already connected — and
 *      nothing else in the system would notice.
 *   2. **A real deadline.** An expired ticket must be refused, and refused the same
 *      way an unknown one is, so expiry is not distinguishable from absence.
 *   3. **Bounded memory.** The store is a module-level `Map` keyed by a UUID the
 *      server generates and the client echoes back. It is swept every 60 seconds,
 *      and it is also hard-capped on insert — a long-running server must not grow
 *      it without limit.
 *
 * `internal-auth.test.ts` already covers the secret comparison on this endpoint.
 * These cases cover everything after it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// The production revocation function over in-memory storage: `authMiddleware`
// resolves a session token's generation through `@dripl/db`, and `createApp`'s
// `/health` needs `$queryRaw`. Without both, `/api/auth/ws-ticket` answers 401 for
// a reason that has nothing to do with tickets.
vi.mock('@dripl/db', async () => {
  const { fakeDbModule } = await import('../test-utils/fakeDbModule');
  return fakeDbModule();
});

import { createInternalRouter, issueWsTicket, wsTicketStore, authRouter } from '../../routes/auth';
import { signToken } from '@dripl/utils/auth';
import {
  buildApp,
  CSRF_TOKEN,
  OWNER_ID,
  post,
  seedSessionUser,
} from '../test-utils/authenticatedRequest';
import { fakeDb, resetFakeDb } from '../test-utils/fakePrisma';

const INTERNAL_SECRET = 'the-internal-secret';

/** `app.ts` mounts `/api/auth` with CSRF but no blanket auth guard. */
const app = buildApp([{ path: '/api/auth', router: authRouter, auth: false }]);

function internalApp(): express.Express {
  const instance = express();
  instance.use(express.json());
  instance.use('/internal', createInternalRouter());
  return instance;
}

/** Redeem a ticket as ws-server does: with the secret, over the internal router. */
async function redeem(ticket: unknown, secret = INTERNAL_SECRET): Promise<request.Response> {
  const pending = request(internalApp()).post('/internal/validate-ticket').send({ ticket });
  return secret === null ? pending : pending.set('x-internal-secret', secret);
}

beforeEach(() => {
  wsTicketStore.clear();
  vi.stubEnv('INTERNAL_SECRET', INTERNAL_SECRET);
  resetFakeDb();
  seedSessionUser(OWNER_ID);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('POST /api/auth/ws-ticket', () => {
  it('binds the ticket to the session token’s subject', async () => {
    const response = await post(app, '/api/auth/ws-ticket', OWNER_ID);

    expect(response.status).toBe(200);
    expect(response.body.ticket).toEqual(expect.any(String));

    const entry = wsTicketStore.get(response.body.ticket);
    expect(entry?.principal).toEqual({ kind: 'user', userId: OWNER_ID });
  });

  /**
   * The ticket is stored unissued to anyone, and the store's own deadline is the
   * only thing bounding its usefulness if it leaks. Asserted on the stored entry
   * rather than on elapsed time: the assertion is that the deadline exists at all
   * and is in the future, which is what makes "expired" a meaningful state.
   */
  it('gives the ticket a short expiry from the moment it is issued', async () => {
    const before = Date.now();
    const response = await post(app, '/api/auth/ws-ticket', OWNER_ID);

    const entry = wsTicketStore.get(response.body.ticket);
    expect(entry?.expiresAt).toBeGreaterThan(before);
    // Generous upper bound so the assertion survives a refactor that shortens the
    // window, while still failing for one that lengthens it into "forever".
    expect(entry?.expiresAt).toBeLessThanOrEqual(before + 60_000);
  });

  /**
   * A session token whose subject has no `User` row must not mint a ticket.
   *
   * This is the revocation boundary seen from the other side: `verifyToken` refuses
   * a token for a deleted account, and `ws-ticket` is downstream of that. Asserted
   * because the bridge from "revoked" to "cannot open a socket" is the reason the
   * version column exists at all, and because ws-server accepts no session token of
   * its own — this route is the only way a revoked credential reaches a socket.
   */
  it('refuses to mint a ticket for a session whose account has been deleted', async () => {
    const token = `Bearer ${signToken(OWNER_ID, 0)}`;
    // The signed token stays byte-identical; only the row goes.
    fakeDb().rows('user').splice(0, 1);

    const response = await request(app)
      .post('/api/auth/ws-ticket')
      .set('Authorization', token)
      .set('Cookie', [`csrf-token=${CSRF_TOKEN}`])
      .set('x-csrf-token', CSRF_TOKEN);

    expect(response.status).toBe(401);
    expect(wsTicketStore.size).toBe(0);
  });
});

describe('POST /internal/validate-ticket — single use', () => {
  it('resolves a live ticket to its principal exactly once', async () => {
    const ticket = issueWsTicket({ kind: 'user', userId: OWNER_ID });

    const first = await redeem(ticket);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ kind: 'user', userId: OWNER_ID });

    // The replay. A ticket that resolves twice is a ticket that opens a second
    // socket from a captured value, and nothing downstream would object.
    const replay = await redeem(ticket);
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual({ error: 'Invalid or expired ticket' });
  });

  /**
   * A share principal round-trips intact.
   *
   * `GET /api/share/:token/ws-ticket` mints a `share` principal, and ws-server uses
   * its `fileId`/`permission`/`token` to admit a viewer to a canvas they have no
   * account for. A redemption that dropped or reshaped those fields would admit the
   * viewer to the wrong file, or with the wrong permission, and still answer 200.
   */
  it('round-trips a share principal with its scope intact', async () => {
    const ticket = issueWsTicket({
      kind: 'share',
      fileId: 'file-7',
      token: 'share-token',
      permission: 'view',
    });

    const response = await redeem(ticket);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      kind: 'share',
      fileId: 'file-7',
      token: 'share-token',
      permission: 'view',
    });
  });

  it('refuses a ticket that was never issued', async () => {
    const response = await redeem('not-a-real-ticket');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid or expired ticket' });
  });

  /**
   * Malformed bodies are refused before the store is consulted.
   *
   * `validate-ticket` is reachable by anything holding `INTERNAL_SECRET`, and its
   * body is `unknown`-typed from ws-server's perspective. Answering 400 for a
   * non-string or an over-long ticket rather than looking it up keeps a garbage
   * request from being a store probe, and keeps a 4 KB string out of the map's
   * lookup path.
   */
  it('answers 400 for a body that is not a usable ticket string', async () => {
    for (const ticket of [undefined, null, 42, { token: 'x' }, '', 'x'.repeat(513)]) {
      const response = await redeem(ticket);
      expect(response.status, JSON.stringify(ticket)?.slice(0, 40)).toBe(400);
      expect(response.body).toEqual({ error: 'Ticket is required' });
    }
  });

  /**
   * A ticket of exactly the maximum length is still looked up.
   *
   * The bound is `> 512`, so 512 is inside it. Asserted because an off-by-one in
   * the other direction — `>= 512` — would refuse a legitimate ticket, and nothing
   * else in the tree generates a ticket long enough to notice.
   */
  it('accepts a ticket at exactly the length ceiling', async () => {
    const ticket = 'y'.repeat(512);

    const response = await redeem(ticket);

    // Not the 400 that the malformed-body cases above require.
    expect(response.status).toBe(401);
  });
});

describe('the ticket expiry deadline is enforced', () => {
  /**
   * Real timers, a real wait: the deadline is `Date.now() + 30_000` and the store
   * compares against `Date.now()`. Rather than reach for fake timers — which would
   * let this pass against a comparison that ignored the clock entirely — the store
   * is given a ticket that expired a millisecond ago and required to refuse it.
   *
   * That is the assertion that matters: an expired ticket and an unknown ticket are
   * the same answer. A redemption that leaked *which* it was would tell an attacker
   * their capture was real and merely late, which is the difference between a
   * one-shot credential and a reusable one with a delay.
   */
  it('refuses an expired ticket with the same answer as an unknown one', async () => {
    const expired = 'expired-ticket';
    wsTicketStore.set(expired, {
      principal: { kind: 'user', userId: OWNER_ID },
      expiresAt: Date.now() - 1,
    });

    const response = await redeem(expired);
    const unknown = await redeem('never-issued');

    expect(response.status).toBe(401);
    expect(response.body).toEqual(unknown.body);
  });

  it('removes an expired ticket when it refuses it', async () => {
    const expired = 'expired-ticket';
    wsTicketStore.set(expired, {
      principal: { kind: 'user', userId: OWNER_ID },
      expiresAt: Date.now() - 1,
    });

    await redeem(expired);

    // Otherwise the sweep is the only thing that clears it, and a server whose
    // sweep interval were raised would accumulate dead entries indefinitely.
    expect(wsTicketStore.has(expired)).toBe(false);
  });

  /**
   * A live ticket and one expiring in a millisecond are told apart.
   *
   * The control for the case above: a redemption that refused everything would also
   * pass it. This requires the deadline to be a comparison rather than a constant
   * falsy.
   */
  it('still honours a ticket whose deadline has not passed', async () => {
    const live = issueWsTicket({ kind: 'user', userId: OWNER_ID });

    const response = await redeem(live);

    expect(response.status).toBe(200);
  });
});

describe('the ticket store is bounded', () => {
  /**
   * The insert-time cap.
   *
   * `issueWsTicket` evicts the oldest entry once the store reaches 10,000. Without
   * it, the 60-second sweep is the only bound, and it is a bound on *expiry*, not
   * on volume: a client that mints tickets far faster than they expire — which needs
   * nothing more than a valid session and a loop — grows the map until the process
   * runs out of memory.
   *
   * Driven past the cap and asserted on behaviour: the oldest ticket stops
   * resolving, which is what eviction means from the outside.
   */
  it('evicts the oldest ticket rather than growing past the cap', async () => {
    const oldest = issueWsTicket({ kind: 'user', userId: 'first' });
    for (let index = 0; index < 10_000; index += 1) {
      issueWsTicket({ kind: 'user', userId: `filler-${index}` });
    }

    expect(wsTicketStore.has(oldest)).toBe(false);
    expect(wsTicketStore.size).toBeLessThanOrEqual(10_000);
  });

  /**
   * The sweep.
   *
   * `wsTicketCleanup` runs every 60 seconds and deletes entries past their
   * deadline. Without it, a redeemed ticket's key lingers until it becomes the
   * eviction victim — so a server with steady traffic and few live tickets still
   * holds a full store, and the sweep's cost is paid on the eviction path instead.
   *
   * The interval is registered at module load, so it has to be observed in a
   * registry where the module loaded *while* the fake clock was already installed:
   * `vi.resetModules()` plus a dynamic import, in that order. Fake timers are the
   * right tool here precisely because the timer is the subject, and `Date.now()`
   * advances with it so the sweep's own deadline comparison is evaluated rather than
   * stubbed out.
   */
  it('sweeps expired tickets on its interval', async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      const fresh = await import('../../routes/auth');

      fresh.wsTicketStore.set('stale-ticket', {
        principal: { kind: 'user', userId: OWNER_ID },
        expiresAt: Date.now() - 1_000,
      });
      fresh.wsTicketStore.set('live-ticket', {
        principal: { kind: 'user', userId: OWNER_ID },
        expiresAt: Date.now() + 600_000,
      });

      await vi.advanceTimersByTimeAsync(60_000);

      expect(fresh.wsTicketStore.has('stale-ticket')).toBe(false);
      // The sweep deletes on expiry, not on age: a live ticket survives it.
      expect(fresh.wsTicketStore.has('live-ticket')).toBe(true);
    } finally {
      vi.useRealTimers();
      vi.resetModules();
    }
  });
});
