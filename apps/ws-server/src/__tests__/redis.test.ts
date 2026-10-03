/**
 * The Redis surface ADR-002 rests on: the room-lease compare-and-set and the
 * cross-instance fan-out channel.
 *
 * `roomOwnership.test.ts` mocks these functions and proves the state model
 * above them. Nothing proved *these* functions, which means the claims the
 * whole ADR rests on — that renew and release are ownership-checked, that a
 * `null` from `SET NX` means "a peer holds it" and not "we failed", that our
 * own fan-out is dropped on the way back in — had no test at all.
 *
 * These tests assert on the commands, not on log output: the Lua bodies and
 * the ARGV vectors are the mechanism, and a change to either that preserved the
 * return-value mapping would reintroduce split-brain silently.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (payload: never) => void;

const upstash = vi.hoisted(() => ({
  /** Constructor configs, so a test can assert the URL/token actually wired in. */
  configs: [] as Array<{ url: string; token: string }>,
  setCalls: [] as unknown[][],
  evalCalls: [] as unknown[][],
  publishCalls: [] as unknown[][],
  psubscribes: [] as string[],
  /** Injection points; reset per test. */
  setImpl: (async () => 'OK') as (...args: unknown[]) => Promise<unknown>,
  evalImpl: (async () => 1) as (...args: unknown[]) => Promise<unknown>,
  publishImpl: (async () => 'OK') as (...args: unknown[]) => Promise<unknown>,
  psubscribeImpl: null as null | (() => void),
  subscriber: null as null | {
    emit: (type: string, payload: unknown) => void;
    listenerCount: (type: string) => number;
  },
}));

vi.mock('@upstash/redis', () => {
  class FakeSubscriber {
    private readonly listeners = new Map<string, Listener[]>();

    on(type: string, fn: Listener): this {
      const existing = this.listeners.get(type) ?? [];
      existing.push(fn);
      this.listeners.set(type, existing);
      return this;
    }

    emit(type: string, payload: unknown): void {
      for (const fn of this.listeners.get(type) ?? []) (fn as (p: unknown) => void)(payload);
    }

    listenerCount(type: string): number {
      return this.listeners.get(type)?.length ?? 0;
    }
  }

  class FakeRedis {
    constructor(config: { url: string; token: string }) {
      upstash.configs.push(config);
    }

    async set(...args: unknown[]): Promise<unknown> {
      upstash.setCalls.push(args);
      return upstash.setImpl(...args);
    }

    async eval(...args: unknown[]): Promise<unknown> {
      upstash.evalCalls.push(args);
      return upstash.evalImpl(...args);
    }

    async publish(...args: unknown[]): Promise<unknown> {
      upstash.publishCalls.push(args);
      return upstash.publishImpl(...args);
    }

    // Synchronous by contract, matching `@upstash/redis@1.39.0`: `psubscribe`
    // constructs and returns a `Subscriber` (an `EventTarget` subclass) rather
    // than a promise, which is the assumption `redis.ts` relies on to attach
    // its `error`/`pmessage` listeners. A fake that returned a promise would
    // pass here while the real code path was broken.
    psubscribe(...patterns: string[]): FakeSubscriber {
      upstash.psubscribes.push(...patterns);
      upstash.psubscribeImpl?.();
      const sub = new FakeSubscriber();
      upstash.subscriber = sub;
      return sub;
    }
  }

  return { Redis: FakeRedis };
});

type RedisModule = typeof import('../redis');

const URL_ = 'https://example.upstash.io';
const TOKEN_ = 'token-value';

/**
 * Each test gets a fresh module instance: `redis.ts` caches the constructed
 * client and the one-shot `initialized` subscription flag at module scope, so
 * a shared instance would make the order of these tests decide their results.
 */
async function loadRedis(): Promise<RedisModule> {
  vi.resetModules();
  return import('../redis');
}

function evalArgs(index: number): { script: string; keys: string[]; argv: string[] } {
  const call = upstash.evalCalls[index];
  if (!call) throw new Error(`eval was not called ${index + 1} time(s)`);
  return {
    script: call[0] as string,
    keys: call[1] as string[],
    argv: call[2] as string[],
  };
}

describe('redis lease primitives', () => {
  let redis: RedisModule;

  beforeEach(() => {
    upstash.configs = [];
    upstash.setCalls = [];
    upstash.evalCalls = [];
    upstash.publishCalls = [];
    upstash.psubscribes = [];
    upstash.setImpl = async () => 'OK';
    upstash.evalImpl = async () => 1;
    upstash.publishImpl = async () => 'OK';
    upstash.psubscribeImpl = null;
    upstash.subscriber = null;
    vi.stubEnv('UPSTASH_REDIS_REST_URL', URL_);
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', TOKEN_);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('acquireRoomLease', () => {
    it('claims the key with SET NX so a second instance cannot also claim it', async () => {
      // Regression: losing `nx: true` turns the mutual-exclusion primitive into
      // a plain SET. Two instances would both "acquire", both load the scene,
      // and both write the same row — the exact split-brain ADR-002 exists to
      // prevent. The `px` TTL is what lets a dead owner be taken over.
      redis = await loadRedis();
      await expect(redis.acquireRoomLease('dripl:room-owner:r1', 'tok', 20_000)).resolves.toBe(
        'acquired'
      );
      expect(upstash.setCalls).toEqual([['dripl:room-owner:r1', 'tok', { nx: true, px: 20_000 }]]);
    });

    it('reports a null NX reply as held-elsewhere, not as a failure', async () => {
      // The load-bearing distinction in ADR-002. Redis answers `null` to
      // `SET NX` when the key already exists — i.e. a peer demonstrably holds
      // the lease, which must fail *closed*. If this collapsed into the same
      // verdict as a transport error, either a peer would be served alongside
      // us or a Redis blip would refuse every join.
      upstash.setImpl = async () => null;
      redis = await loadRedis();
      await expect(redis.acquireRoomLease('dripl:room-owner:r1', 'tok', 20_000)).resolves.toBe(
        'held-elsewhere'
      );
    });

    it('reports unavailable — not held-elsewhere — when Redis is not configured', async () => {
      // With no credentials ownership is disabled by `acquireRoom` before this
      // is called, but the verdict must still be the transport one: collapsing
      // "no Redis" into "a peer owns it" would refuse every join on a
      // single-instance deployment.
      vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
      redis = await loadRedis();
      await expect(redis.acquireRoomLease('k', 'tok', 1)).resolves.toBe('unavailable');
      expect(upstash.setCalls).toEqual([]);
    });

    it('does not treat a half-configured Upstash pair as available', async () => {
      // A URL without a token (or the reverse) is a deploy that lost half its
      // Redis config. It must read as "unavailable" so the lease layer fails
      // open loudly, not as a working Redis.
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
      redis = await loadRedis();
      expect(redis.isRedisAvailable()).toBe(false);
      await expect(redis.acquireRoomLease('k', 'tok', 1)).resolves.toBe('unavailable');
    });

    it('reports unavailable when the transport fails', async () => {
      upstash.setImpl = async () => {
        throw new Error('upstash 503');
      };
      redis = await loadRedis();
      await expect(redis.acquireRoomLease('k', 'tok', 1)).resolves.toBe('unavailable');
    });

    it('reuses one client for the process rather than constructing per call', async () => {
      // A per-call `new Redis(...)` would re-validate the URL and rebuild the
      // command pipeline on every join, on the one path that must not add
      // latency.
      redis = await loadRedis();
      await redis.acquireRoomLease('k', 't', 1);
      await redis.acquireRoomLease('k2', 't', 1);
      await redis.acquireRoomLease('k3', 't', 1);
      expect(upstash.configs).toEqual([{ url: URL_, token: TOKEN_ }]);
    });
  });

  describe('renewRoomLease', () => {
    it('extends the TTL only when the key still holds our token', async () => {
      // Regression: replacing the CAS script with `SET XX PX` would renew a
      // lease a *different* instance now owns — reaching split-brain through
      // the command meant to prevent it. `XX` asserts only that the key
      // exists, never that it is ours.
      redis = await loadRedis();
      await expect(redis.renewRoomLease('dripl:room-owner:r1', 'tok', 20_000)).resolves.toBe(
        'renewed'
      );
      const { script, keys, argv } = evalArgs(0);
      expect(keys).toEqual(['dripl:room-owner:r1']);
      // The precondition: compare the stored value against our token, and only
      // then write. Both must stay or renew becomes a blind overwrite.
      expect(script).toContain("redis.call('GET', KEYS[1]) == ARGV[1]");
      expect(script).toContain("redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])");
      // The token is passed unchanged twice — once as the precondition and once
      // as the value written back. Rotating it on renewal would orphan the key
      // this instance just extended and make the *next* renewal a `lost`.
      expect(argv).toEqual(['tok', 'tok', '20000']);
    });

    it('reports a rejected CAS as lost, which is the signal to quiesce the room', async () => {
      // Regression: mapping 0 to 'renewed' would leave a superseded owner
      // believing it is still authoritative and happily writing the scene.
      upstash.evalImpl = async () => 0;
      redis = await loadRedis();
      await expect(redis.renewRoomLease('k', 'tok', 20_000)).resolves.toBe('lost');
    });

    it('accepts a Redis integer reply as well as a string', async () => {
      // The REST JSON encoder is free to return `1` or `"1"`. `===` against
      // the number would read every real renewal as a loss and quiesce every
      // room every five seconds.
      upstash.evalImpl = async () => '1';
      redis = await loadRedis();
      await expect(redis.renewRoomLease('k', 'tok', 1)).resolves.toBe('renewed');
      upstash.evalImpl = async () => '0';
      await expect(redis.renewRoomLease('k', 'tok', 1)).resolves.toBe('lost');
    });

    it('reports unavailable when the transport fails', async () => {
      upstash.evalImpl = async () => {
        throw new Error('timeout');
      };
      redis = await loadRedis();
      await expect(redis.renewRoomLease('k', 'tok', 1)).resolves.toBe('unavailable');
    });

    it('reports unavailable, not lost, when Redis is not configured', async () => {
      // The distinction that decides whether a healthy room dies: `lost` means
      // "stop serving", `unavailable` means "keep serving". With no Redis the
      // lease layer is disabled upstream, but a renewal that answered `lost`
      // here would quiesce the room anyway.
      vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
      redis = await loadRedis();
      await expect(redis.renewRoomLease('k', 'tok', 1)).resolves.toBe('unavailable');
    });
  });

  describe('releaseRoomLease', () => {
    it('deletes the key only when it still holds our token', async () => {
      // Regression: a bare `DEL` from a lapsed owner removes the *new* owner's
      // lease, handing the room to a third instance while two still believe
      // they own it.
      redis = await loadRedis();
      await expect(redis.releaseRoomLease('dripl:room-owner:r1', 'tok')).resolves.toBe('released');
      const { script, keys, argv } = evalArgs(0);
      expect(keys).toEqual(['dripl:room-owner:r1']);
      expect(argv).toEqual(['tok']);
      expect(script).toContain("redis.call('GET', KEYS[1]) == ARGV[1]");
      expect(script).toContain("redis.call('DEL', KEYS[1])");
    });

    it('reports not-held when a peer already owns the key', async () => {
      upstash.evalImpl = async () => 0;
      redis = await loadRedis();
      await expect(redis.releaseRoomLease('k', 'tok')).resolves.toBe('not-held');
    });

    it('reports unavailable when the transport fails', async () => {
      upstash.evalImpl = async () => {
        throw new Error('boom');
      };
      redis = await loadRedis();
      await expect(redis.releaseRoomLease('k', 'tok')).resolves.toBe('unavailable');
    });

    it('reports unavailable, not released, when Redis is not configured', async () => {
      vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
      redis = await loadRedis();
      await expect(redis.releaseRoomLease('k', 'tok')).resolves.toBe('unavailable');
    });
  });

  describe('publishToRoom', () => {
    it('never rejects, even when the client cannot be constructed', async () => {
      // The documented contract, and the one that was already paid for once:
      // `new Redis(...)` throws synchronously on a malformed
      // `UPSTASH_REDIS_REST_URL`, and in an `async` function that becomes a
      // rejection. The scene broadcast path calls this without awaiting it, so
      // a single such rejection took the whole ws-server process down — which
      // for this server means discarding every in-memory RoomState it is the
      // authoritative writer for.
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'not-a-url');
      redis = await loadRedis();
      await expect(redis.publishToRoom('r1', { type: 'cursor_move' })).resolves.toBeUndefined();
    });

    it('never rejects when the publish itself fails', async () => {
      upstash.publishImpl = async () => {
        throw new Error('upstash 500');
      };
      redis = await loadRedis();
      await expect(redis.publishToRoom('r1', { type: 'cursor_move' })).resolves.toBeUndefined();
    });

    it('stamps the publishing instance id so the echo can be dropped', async () => {
      // Without this stamp the pmessage handler cannot tell "my own message
      // coming back" from "a peer's mutation", and every delta would be
      // re-applied and re-broadcast by its own author.
      redis = await loadRedis();
      await redis.publishToRoom('r1', { type: 'cursor_move', x: 1 });
      const call = upstash.publishCalls[0];
      if (!call) throw new Error('publish was never called');
      expect(call[0]).toBe('dripl:room:r1');
      expect(call[1]).toMatchObject({ type: 'cursor_move', x: 1 });
      expect(typeof (call[1] as { instanceId: unknown }).instanceId).toBe('string');
      expect(typeof (call[1] as { timestamp: unknown }).timestamp).toBe('number');
    });

    it('is a no-op with no Redis configured', async () => {
      vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
      redis = await loadRedis();
      await redis.publishToRoom('r1', { type: 'cursor_move' });
      expect(upstash.publishCalls).toEqual([]);
    });
  });

  describe('room fan-out subscription', () => {
    /** The instance id this module stamps on its own publishes. */
    async function ownInstanceId(module: RedisModule): Promise<string> {
      await module.publishToRoom('r1', { probe: true });
      const call = upstash.publishCalls.at(-1);
      if (!call) throw new Error('publish was never called');
      return (call[1] as { instanceId: string }).instanceId;
    }

    function dispatch(channel: string, message: unknown): void {
      const sub = upstash.subscriber;
      if (!sub) throw new Error('psubscribe was never called');
      sub.emit('pmessage', { pattern: 'dripl:room:*', channel, message });
    }

    it('subscribes to the namespaced pattern exactly once', async () => {
      // A second pattern subscription would double every remote message in the
      // process — each scene delta applied (and re-broadcast) twice.
      redis = await loadRedis();
      redis.subscribeToRoom('r1', vi.fn());
      redis.subscribeToRoom('r2', vi.fn());
      redis.subscribeToRoom('r3', vi.fn());
      expect(upstash.psubscribes).toEqual(['dripl:room:*']);
    });

    it('delivers a peer mutation to that room only', async () => {
      // Regression: routing on a shared channel rather than per-room would
      // apply one room's delta into another room's authoritative state — silent
      // cross-room corruption with no error anywhere.
      redis = await loadRedis();
      const first = vi.fn();
      const second = vi.fn();
      redis.subscribeToRoom('r1', first);
      redis.subscribeToRoom('r2', second);

      dispatch(
        'dripl:room:r1',
        JSON.stringify({ type: 'cursor_move', instanceId: 'peer-a', x: 5 })
      );

      expect(first).toHaveBeenCalledExactlyOnceWith({
        type: 'cursor_move',
        instanceId: 'peer-a',
        x: 5,
      });
      expect(second).not.toHaveBeenCalled();
    });

    it('drops our own published message instead of echoing it', async () => {
      // Without the instanceId check, a locally applied delta is re-read from
      // Redis, re-applied through the remote funnel, marked dirty again, and
      // re-published — a self-sustaining loop that also dirties the room
      // forever so it is never GC'd.
      redis = await loadRedis();
      const handler = vi.fn();
      redis.subscribeToRoom('r1', handler);
      const instanceId = await ownInstanceId(redis);

      dispatch('dripl:room:r1', JSON.stringify({ type: 'scene-delta', instanceId, added: [] }));

      expect(handler).not.toHaveBeenCalled();
    });

    it('survives an unparseable payload rather than throwing inside the listener', async () => {
      // The pmessage listener runs from Upstash's own dispatch loop, not from
      // a try/catch this module controls: a throw here is an unhandled
      // rejection, i.e. process death, from one peer's malformed message.
      redis = await loadRedis();
      const handler = vi.fn();
      redis.subscribeToRoom('r1', handler);

      expect(() => dispatch('dripl:room:r1', '{not json')).not.toThrow();
      // And the subscription still works afterwards: a parse failure must not
      // take the channel down for every later message.
      dispatch('dripl:room:r1', JSON.stringify({ type: 'cursor_move', instanceId: 'peer' }));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('ignores a channel with no registered handler', async () => {
      // The pattern subscription is process-wide while handlers are per-room,
      // so channels for rooms this process never served arrive constantly.
      redis = await loadRedis();
      redis.subscribeToRoom('r1', vi.fn());
      expect(() => dispatch('dripl:room:not-mine', { type: 'cursor_move' })).not.toThrow();
    });

    it('accepts an already-parsed object payload as well as a JSON string', async () => {
      // Upstash's deserializer shape is not guaranteed; refusing objects would
      // silently drop the entire channel depending on library internals.
      redis = await loadRedis();
      const handler = vi.fn();
      redis.subscribeToRoom('r1', handler);
      dispatch('dripl:room:r1', { type: 'cursor_move', instanceId: 'peer', x: 1 });
      expect(handler).toHaveBeenCalledWith({ type: 'cursor_move', instanceId: 'peer', x: 1 });
    });

    it('stops delivering to a room it unsubscribed from', async () => {
      // `handleRoomOwnershipLost` and the empty-room GC both unsubscribe. If
      // the handler stayed registered, a mutated room would keep receiving —
      // and applying — fan-out after this process gave it up.
      redis = await loadRedis();
      const handler = vi.fn();
      redis.subscribeToRoom('r1', handler);
      redis.unsubscribeFromRoom('r1');
      dispatch('dripl:room:r1', JSON.stringify({ type: 'scene-delta', instanceId: 'peer' }));
      expect(handler).not.toHaveBeenCalled();
    });

    it('registers no subscription when Redis is not configured', async () => {
      // `subscribeToRoom` is called from the join path on every join; with no
      // Redis it must do nothing rather than half-initialise state that a later
      // `isRedisAvailable()` would then contradict.
      vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
      redis = await loadRedis();
      redis.subscribeToRoom('r1', vi.fn());
      expect(upstash.psubscribes).toEqual([]);
      expect(redis.isRedisAvailable()).toBe(false);
    });

    it('leaves the subscription retryable when constructing it throws', async () => {
      // `initialized` gates re-subscription. Marking it done before the
      // subscription exists means one transient failure silently disables
      // cross-instance fan-out for the life of the process with nothing to
      // retry it — the failure mode the module's own comment describes.
      upstash.psubscribeImpl = () => {
        throw new Error('subscription construction failed');
      };
      redis = await loadRedis();
      expect(() => redis.subscribeToRoom('r1', vi.fn())).not.toThrow();
      // Retry succeeds once the transport recovers.
      upstash.psubscribeImpl = null;
      redis.subscribeToRoom('r1', vi.fn());
      expect(upstash.psubscribes).toEqual(['dripl:room:*', 'dripl:room:*']);
    });

    it('keeps listening for later messages after a subscriber error event', async () => {
      // Upstash's `Subscriber` extends `EventTarget`, so an `'error'` dispatch
      // with no listener is a silent no-op — which is exactly how an
      // unreachable subscription used to stop fan-out with no log line at all.
      redis = await loadRedis();
      const handler = vi.fn();
      redis.subscribeToRoom('r1', handler);
      const sub = upstash.subscriber;
      if (!sub) throw new Error('psubscribe was never called');
      expect(sub.listenerCount('error')).toBeGreaterThan(0);
      sub.emit('error', new Error('stream reset'));
      dispatch('dripl:room:r1', JSON.stringify({ type: 'cursor_move', instanceId: 'peer' }));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
