/**
 * THE REDIS TICKET DRIVER, AGAINST A FAKE CLIENT — PLUS ITS CONFIG GATE AND
 * ITS LUA SCRIPT.
 *
 * Three layers, each honest about what it does and does not prove:
 *
 *   1. `resolveTicketConfig` — pure env mapping. No Redis involved at all.
 *   2. `createRedisTicketStore` against `FakeRedisTicketClient` — proves the
 *      driver's serialization (JSON value, `expiresAt` deadline), its TTL
 *      wiring (`SET ... NX PX`), its collision retry, and its single-shot
 *      consumption (exactly one `eval` per `consume`). What it does NOT prove
 *      is the Lua text itself: the fake emulates the script's *semantics* in
 *      TypeScript, so a typo in `TICKET_CONSUME_LUA` would pass this layer.
 *   3. `TICKET_CONSUME_LUA` under LuaJIT — runs the exact script text through
 *      every branch (missing, live, stale-but-present, boundary, replay)
 *      against stubbed `redis`/`cjson` globals. What *that* does not prove is
 *      the Upstash REST round-trip, which only a live instance exercises —
 *      and there is no live instance in this suite, by design.
 *
 * The memory driver this mirrors is covered in `ticketStore.test.ts` and is
 * deliberately not re-asserted here: this file is the Redis half of the port
 * contract, not a second copy of the memory half.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createRedisTicketStore,
  REDIS_TICKET_TTL_SLACK_MS,
  resolveTicketConfig,
  TICKET_CONSUME_LUA,
  TICKET_KEY_PREFIX,
  WS_TICKET_TTL_MS,
  type ClockPort,
  type IdPort,
  type RedisTicketClient,
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

/**
 * An in-memory Redis with `SET NX PX` and `EVAL` semantics, sharing the
 * driver's own clock so TTL behaviour is asserted by advancing a number. The
 * `eval` arm emulates what `TICKET_CONSUME_LUA` *means* (get, expiry check
 * against the driver's `now`, delete, return) — the script *text* is executed
 * separately, below, under LuaJIT.
 */
class FakeRedisTicketClient implements RedisTicketClient {
  readonly sets: Array<{ key: string; value: string; opts: { nx: true; px: number } }> = [];
  evalCalls = 0;
  /** Directly seedable, so tests can plant foreign or malformed values. */
  readonly entries = new Map<string, { value: string; deadline: number }>();
  /** Next `set` replies, consumed in order; default is honest acceptance. */
  readonly setReplies: Array<'OK' | string | null> = [];

  constructor(private readonly clock: ClockPort) {}

  async set(
    key: string,
    value: string,
    opts: { nx: true; px: number }
  ): Promise<'OK' | string | null> {
    this.sets.push({ key, value, opts });
    const forced = this.setReplies.shift();
    if (forced !== undefined) return forced;
    const current = this.entries.get(key);
    if (current && current.deadline > this.clock.nowMs()) {
      // NX precondition fails: the id is taken.
      return null;
    }
    this.entries.set(key, { value, deadline: this.clock.nowMs() + opts.px });
    return 'OK';
  }

  async eval<TArgs extends unknown[], TData>(
    _script: string,
    keys: string[],
    args: TArgs
  ): Promise<TData> {
    this.evalCalls += 1;
    const key = keys[0] as string;
    const now = Number((args as unknown[])[0]);
    const current = this.entries.get(key);
    if (!current || current.deadline <= this.clock.nowMs()) {
      this.entries.delete(key);
      return null as TData;
    }
    let entry: { principal?: unknown; expiresAt?: unknown };
    try {
      entry = JSON.parse(current.value) as typeof entry;
    } catch {
      this.entries.delete(key);
      return null as TData;
    }
    if (typeof entry.expiresAt !== 'number' || entry.expiresAt < now) {
      this.entries.delete(key);
      return null as TData;
    }
    this.entries.delete(key);
    return current.value as TData;
  }
}

const userPrincipal: TicketPrincipal = { kind: 'user', userId: 'user-1' };
const sharePrincipal: TicketPrincipal = {
  kind: 'share',
  fileId: 'file-7',
  token: 'share-token',
  permission: 'view',
};

function setup() {
  const clock = new FakeClock();
  const ids = new StubIds();
  const client = new FakeRedisTicketClient(clock);
  const store = createRedisTicketStore(client, clock, ids);
  return { clock, ids, client, store };
}

describe('resolveTicketConfig', () => {
  it('resolves to memory when neither Upstash variable is set', () => {
    expect(resolveTicketConfig({})).toEqual({ kind: 'memory' });
  });

  it('resolves to redis when both variables are present, carrying them through', () => {
    expect(
      resolveTicketConfig({
        UPSTASH_REDIS_REST_URL: 'https://redis.example.test',
        UPSTASH_REDIS_REST_TOKEN: 'token-abc',
      })
    ).toEqual({ kind: 'redis', url: 'https://redis.example.test', token: 'token-abc' });
  });

  it('resolves to memory when only the URL is set', () => {
    expect(resolveTicketConfig({ UPSTASH_REDIS_REST_URL: 'https://redis.example.test' })).toEqual({
      kind: 'memory',
    });
  });

  it('resolves to memory when only the token is set', () => {
    expect(resolveTicketConfig({ UPSTASH_REDIS_REST_TOKEN: 'token-abc' })).toEqual({
      kind: 'memory',
    });
  });

  it('treats blank variables as absent rather than as a Redis address', () => {
    expect(
      resolveTicketConfig({ UPSTASH_REDIS_REST_URL: '  ', UPSTASH_REDIS_REST_TOKEN: '' })
    ).toEqual({ kind: 'memory' });
  });
});

describe('createRedisTicketStore — issue/consume', () => {
  it('round-trips a user principal through JSON', async () => {
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

  it('is single-shot, spending the ticket in exactly one eval', async () => {
    const { client, store } = setup();
    const ticket = await store.issue(userPrincipal, WS_TICKET_TTL_MS);

    await expect(store.consume(ticket)).resolves.toEqual(userPrincipal);
    await expect(store.consume(ticket)).resolves.toBeNull();

    // One `eval` per `consume` is the whole cross-instance guarantee: the
    // get, expiry check, and delete happen inside a single script, so two
    // instances racing for the same ticket cannot both read it live.
    expect(client.evalCalls).toBe(2);
  });

  it('refuses a ticket that was never issued', async () => {
    const { store } = setup();

    await expect(store.consume('never-issued')).resolves.toBeNull();
  });

  it('honours the deadline: live at exactly expiresAt, dead a millisecond later', async () => {
    const { clock, store } = setup();
    const ticket = await store.issue(userPrincipal, WS_TICKET_TTL_MS);

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

  it('reclaims the key when it refuses an expired ticket', async () => {
    const { clock, client, store } = setup();
    const ticket = await store.issue(userPrincipal, WS_TICKET_TTL_MS);
    clock.advance(WS_TICKET_TTL_MS + 1);

    await store.consume(ticket);

    // Otherwise every unredeemed ticket lingers until its key TTL lapses with
    // no reader to observe it — the script's explicit DEL is the reclamation.
    expect(client.entries.has(`${TICKET_KEY_PREFIX}${ticket}`)).toBe(false);
  });

  it('issues with SET NX PX: namespaced key, single-use guard, caller TTL plus slack', async () => {
    const { client, store } = setup();

    const ticket = await store.issue(userPrincipal, WS_TICKET_TTL_MS);

    expect(client.sets).toHaveLength(1);
    const call = client.sets[0]!;
    expect(call.key).toBe(`${TICKET_KEY_PREFIX}${ticket}`);
    // The PX is the ticket TTL plus REDIS_TICKET_TTL_SLACK_MS: the slack keeps
    // Redis key-expiry from pre-empting the script's own `expiresAt` verdict
    // at the exact deadline (Redis reaps at `<=`, the script refuses at `<`).
    expect(call.opts).toEqual({ nx: true, px: WS_TICKET_TTL_MS + REDIS_TICKET_TTL_SLACK_MS });
    // The value is the same shape the memory driver stores, so a key read in
    // redis-cli is human-readable and the deadline is inspectable.
    expect(JSON.parse(call.value)).toEqual({
      principal: userPrincipal,
      expiresAt: 1_000_000 + WS_TICKET_TTL_MS,
    });
  });

  it('retries with a fresh id when SET NX reports a collision', async () => {
    const { client, store } = setup();
    client.setReplies.push(null);

    const ticket = await store.issue(userPrincipal, WS_TICKET_TTL_MS);

    expect(ticket).toBe('ticket-2');
    expect(client.sets.map(call => call.key)).toEqual([
      `${TICKET_KEY_PREFIX}ticket-1`,
      `${TICKET_KEY_PREFIX}ticket-2`,
    ]);
  });

  it('gives up after a bounded number of collisions rather than looping', async () => {
    const clock = new FakeClock();
    const client = new FakeRedisTicketClient(clock);
    client.setReplies.push(null, null);
    const store = createRedisTicketStore(client, clock, new StubIds(), { maxIssueAttempts: 2 });

    await expect(store.issue(userPrincipal, WS_TICKET_TTL_MS)).rejects.toThrow();
    expect(client.sets).toHaveLength(2);
  });

  it('lets an unexpected SET reply throw rather than retrying it as a collision', async () => {
    const { client, store } = setup();
    client.setReplies.push('UNEXPECTED');

    // Only `null` means "id taken". Any other non-`OK` reply is a transport
    // surprise, and retrying it would risk minting twice.
    await expect(store.issue(userPrincipal, WS_TICKET_TTL_MS)).rejects.toThrow();
    expect(client.sets).toHaveLength(1);
  });

  it('refuses a value it did not write rather than crashing on it', async () => {
    const { client, store } = setup();
    client.entries.set(`${TICKET_KEY_PREFIX}foreign`, {
      value: 'not-json{{{',
      deadline: 9_999_999_999,
    });

    await expect(store.consume('foreign')).resolves.toBeNull();
  });

  it('treats a non-string script reply as absence', async () => {
    const clock = new FakeClock();
    const weird = {
      set: async () => 'OK' as const,
      eval: async () => 42 as never,
    } satisfies RedisTicketClient;
    const store = createRedisTicketStore(weird, clock, new StubIds());

    await expect(store.consume('anything')).resolves.toBeNull();
  });
});

describe('TICKET_CONSUME_LUA — executed, not just strung', () => {
  /**
   * The one branch the fake above cannot cover: whether the Lua *text* parses
   * and does what the comment above it claims. Runs the exact exported string
   * under LuaJIT (5.1 semantics, as Redis embeds) with stubbed `redis`/`cjson`
   * globals — see `ticketConsume.lua` for the harness. Skipped, loudly rather
   * than silently, where no LuaJIT exists.
   */
  const harnessPath = fileURLToPath(new URL('./ticketConsume.lua', import.meta.url));
  let hasLuajit = false;
  try {
    execFileSync('luajit', ['-v'], { stdio: 'ignore' });
    hasLuajit = true;
  } catch {
    hasLuajit = false;
  }

  it.runIf(hasLuajit)('passes every branch: missing, live, stale, boundary, replay', () => {
    const stdout = execFileSync('luajit', [harnessPath], { input: TICKET_CONSUME_LUA });
    const lines = stdout.toString().trim().split('\n');

    expect(lines).toContain('PASS missing key returns nil');
    expect(lines).toContain('PASS live ticket returns its value');
    expect(lines).toContain('PASS live ticket is deleted');
    expect(lines).toContain('PASS stale ticket returns nil');
    expect(lines).toContain('PASS stale ticket is deleted');
    expect(lines).toContain('PASS ticket at exactly expiresAt is live');
    expect(lines).toContain('PASS replay of a spent ticket returns nil');
    expect(lines).toContain('ALL PASS');
  });

  it.runIf(!hasLuajit)('is skipped only because LuaJIT is unavailable here', () => {
    // A passing suite must not be mistaken for an executed script: if this
    // case runs, the real coverage above did not.
    expect(hasLuajit).toBe(false);
  });
});
