/**
 * THE MEMORY TICKET STORE, AGAINST A FAKE CLOCK AND STUB IDS.
 *
 * No fake timers, no module re-imports, no waiting: `FakeClock` owns time and
 * `StubIds` owns ticket strings, so every deadline and every eviction below is
 * asserted by advancing a number rather than by sleeping or by racing
 * `Date.now()`. If any of these fail, the store's policy changed — not the
 * machine's clock.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_WS_TICKETS,
  WS_TICKET_TTL_MS,
  createMemoryTicketStore,
  type ClockPort,
  type IdPort,
  type TicketPrincipal,
} from '../../ports';

class FakeClock implements ClockPort {
  private t: number;
  constructor(startMs = 1_000_000) {
    this.t = startMs;
  }
  nowMs(): number {
    return this.t;
  }
  nowDate(): Date {
    return new Date(this.t);
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

class StubIds implements IdPort {
  private n = 0;
  uuid(): string {
    this.n += 1;
    return `ticket-${this.n}`;
  }
  shareToken(): string {
    this.n += 1;
    return `share-${this.n}`;
  }
}

function setup() {
  const clock = new FakeClock();
  const ids = new StubIds();
  const store = createMemoryTicketStore(clock, ids);
  return { clock, ids, store };
}

const userPrincipal: TicketPrincipal = { kind: 'user', userId: 'user-1' };
const sharePrincipal: TicketPrincipal = {
  kind: 'share',
  fileId: 'file-7',
  token: 'share-token',
  permission: 'view',
};

describe('createMemoryTicketStore — issue/consume', () => {
  it('issues the id it is given and consumes back the principal', async () => {
    const { store } = setup();

    const ticket = await store.issue(userPrincipal, WS_TICKET_TTL_MS);

    expect(ticket).toBe('ticket-1');
    await expect(store.consume(ticket)).resolves.toEqual(userPrincipal);
  });

  it('round-trips a share principal with its scope intact', async () => {
    const { store } = setup();

    const ticket = await store.issue(sharePrincipal, WS_TICKET_TTL_MS);

    await expect(store.consume(ticket)).resolves.toEqual(sharePrincipal);
  });

  it('is single-shot: the second consume of a live ticket fails', async () => {
    const { store } = setup();
    const ticket = await store.issue(userPrincipal, WS_TICKET_TTL_MS);

    await expect(store.consume(ticket)).resolves.toEqual(userPrincipal);
    await expect(store.consume(ticket)).resolves.toBeNull();
  });

  it('refuses a ticket that was never issued', async () => {
    const { store } = setup();

    await expect(store.consume('never-issued')).resolves.toBeNull();
  });

  it('honours the deadline: live at exactly expiresAt, dead a millisecond later', async () => {
    const { clock, store } = setup();
    const ticket = await store.issue(userPrincipal, WS_TICKET_TTL_MS);

    // The store refuses when `expiresAt < now`, so equality is still live.
    clock.advance(WS_TICKET_TTL_MS);
    await expect(store.consume(ticket)).resolves.toEqual(userPrincipal);
  });

  it('refuses an expired ticket with the same answer as an unknown one', async () => {
    const { clock, store } = setup();
    const ticket = await store.issue(userPrincipal, WS_TICKET_TTL_MS);

    clock.advance(WS_TICKET_TTL_MS + 1);

    await expect(store.consume(ticket)).resolves.toBeNull();
    await expect(store.consume('never-issued')).resolves.toBeNull();
  });

  it('removes an expired ticket when it refuses it', async () => {
    const clock = new FakeClock();
    const entries = new Map<string, { principal: TicketPrincipal; expiresAt: number }>();
    const store = createMemoryTicketStore(clock, new StubIds(), { entries });
    const ticket = await store.issue(userPrincipal, WS_TICKET_TTL_MS);
    clock.advance(WS_TICKET_TTL_MS + 1);

    await store.consume(ticket);

    // Otherwise the sweep is the only thing that clears it, and a server whose
    // sweep interval were raised would accumulate dead entries indefinitely.
    expect(entries.has(ticket)).toBe(false);
  });

  it('evicts the oldest ticket rather than growing past the cap', async () => {
    const { store } = setup();

    const oldest = await store.issue({ kind: 'user', userId: 'first' }, WS_TICKET_TTL_MS);
    for (let index = 0; index < MAX_WS_TICKETS; index += 1) {
      await store.issue({ kind: 'user', userId: `filler-${index}` }, WS_TICKET_TTL_MS);
    }

    await expect(store.consume(oldest)).resolves.toBeNull();
    await expect(store.consume(`ticket-${MAX_WS_TICKETS + 1}`)).resolves.toEqual({
      kind: 'user',
      userId: `filler-${MAX_WS_TICKETS - 1}`,
    });
  });

  it('exposes the same policy through the sync core the route shims use', () => {
    const { clock, store } = setup();

    const ticket = store.issueSync(userPrincipal, WS_TICKET_TTL_MS);
    expect(ticket).toBe('ticket-1');
    expect(store.consumeSync(ticket)).toEqual(userPrincipal);
    expect(store.consumeSync(ticket)).toBeNull();

    const expiring = store.issueSync(userPrincipal, WS_TICKET_TTL_MS);
    clock.advance(WS_TICKET_TTL_MS + 1);
    expect(store.consumeSync(expiring)).toBeNull();
  });
});
