/**
 * Lease configuration and namespace invariants.
 *
 * `roomOwnership.test.ts` covers the state machine with sane configuration. The
 * numbers here are read once from the environment at module load, so a bad
 * value is not a runtime error — it is a lease with the wrong lifetime, which
 * presents as two instances both serving a room or as a renewal sweep that never
 * runs. Nothing downstream would report it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LeaseAcquireResult, LeaseRenewResult, LeaseReleaseResult } from '../redis';

const acquireRoomLease =
  vi.fn<(key: string, token: string, ttlMs: number) => Promise<LeaseAcquireResult>>();
const renewRoomLease =
  vi.fn<(key: string, token: string, ttlMs: number) => Promise<LeaseRenewResult>>();
const releaseRoomLease = vi.fn<(key: string, token: string) => Promise<LeaseReleaseResult>>();
const isRedisAvailable = vi.fn(() => true);

vi.mock('../redis', () => ({
  acquireRoomLease,
  renewRoomLease,
  releaseRoomLease,
  isRedisAvailable,
}));

type OwnershipModule = typeof import('../roomOwnership');

async function loadWithEnv(env: Record<string, string>): Promise<OwnershipModule> {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return import('../roomOwnership');
}

describe('lease configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the documented defaults when nothing is configured', async () => {
    const ownership = await loadWithEnv({ WS_ROOM_OWNERSHIP: 'on' });
    expect(ownership.ROOM_LEASE_TTL_MS).toBe(20_000);
    expect(ownership.ROOM_LEASE_RENEW_MS).toBe(5_000);
  });

  it('honours a valid configuration', async () => {
    const ownership = await loadWithEnv({
      WS_ROOM_OWNERSHIP: 'on',
      WS_ROOM_LEASE_TTL_MS: '45000',
      WS_ROOM_LEASE_RENEW_MS: '9000',
    });
    expect(ownership.ROOM_LEASE_TTL_MS).toBe(45_000);
    expect(ownership.ROOM_LEASE_RENEW_MS).toBe(9_000);
  });

  it('refuses a lease TTL that is zero, negative, or not a number', async () => {
    // Regression: `WS_ROOM_LEASE_TTL_MS=0` is the single most dangerous value
    // this process can be given. Every lease expires the instant it is written,
    // so two instances interleave `SET NX` and each serves the room for a moment
    // — precisely the split-brain the lease exists to prevent. Falling back to
    // 20s turns a typo into a slow handover instead.
    for (const value of ['0', '-1', 'abc', '', 'NaN', '1e', '20s']) {
      const ownership = await loadWithEnv({
        WS_ROOM_OWNERSHIP: 'on',
        WS_ROOM_LEASE_TTL_MS: value,
      });
      expect(ownership.ROOM_LEASE_TTL_MS, `TTL=${JSON.stringify(value)}`).toBe(20_000);
    }
  });

  it('truncates a fractional TTL rather than passing it through', async () => {
    // `Math.floor` keeps the key's TTL an integer number of milliseconds; a
    // float reaches Redis as a non-integer PX and the cast is Redis's, not ours.
    const ownership = await loadWithEnv({
      WS_ROOM_OWNERSHIP: 'on',
      WS_ROOM_LEASE_TTL_MS: '1500.9',
    });
    expect(ownership.ROOM_LEASE_TTL_MS).toBe(1_500);
  });

  it('applies a floor to the renewal period so a misconfiguration cannot hot-loop', async () => {
    // The sweep is an `unref()`ed interval. At a 10ms renewal period it becomes
    // a request loop against Upstash — every room, ten times a second, for as
    // long as the process lives.
    const ownership = await loadWithEnv({
      WS_ROOM_OWNERSHIP: 'on',
      WS_ROOM_LEASE_RENEW_MS: '10',
    });
    expect(ownership.ROOM_LEASE_RENEW_MS).toBe(1_000);
  });

  it('applies the renewal floor to an invalid value as well', async () => {
    const ownership = await loadWithEnv({
      WS_ROOM_OWNERSHIP: 'on',
      WS_ROOM_LEASE_RENEW_MS: 'not-a-number',
    });
    expect(ownership.ROOM_LEASE_RENEW_MS).toBe(5_000);
  });

  it('keys leases in a namespace disjoint from fan-out and rate limits', async () => {
    // Stated in the module as a requirement, and load-bearing: one shared
    // namespace means a room message, a rate-limit counter, or a lease can be
    // read or deleted as if it were another, and nothing would notice.
    const ownership = await loadWithEnv({ WS_ROOM_OWNERSHIP: 'on' });
    const key = ownership.roomLeaseKey('room-1');
    expect(key).toBe('dripl:room-owner:room-1');
    expect(ownership.ROOM_OWNERSHIP_KEY_PREFIX).toBe('dripl:room-owner:');
    // `dripl:room:*` is the fan-out pattern and `dripl:ws:ratelimit` the
    // limiter's prefix; the lease must match neither.
    expect(key.startsWith('dripl:room:')).toBe(false);
    expect(key.startsWith('dripl:ws:')).toBe(false);
  });

  it('treats only an explicit "off" as disabled', async () => {
    // Default is *on* whenever Redis is configured: an operator who configured
    // Upstash has two instances in mind, and silently reverting to per-process
    // rooms because nobody set a flag is how the limitation comes back.
    for (const value of ['on', 'ON', 'false', '0', 'no', '']) {
      const ownership = await loadWithEnv({ WS_ROOM_OWNERSHIP: value });
      expect(
        ownership.isRoomOwnershipDisabled(),
        `WS_ROOM_OWNERSHIP=${JSON.stringify(value)}`
      ).toBe(value === 'off');
    }
  });
});

describe('releasing a lease that a peer has taken', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('forgets the room without failing when the CAS says it is no longer ours', async () => {
    // The lease expired and a peer acquired the key between our last renewal
    // and this release. Our `DEL`-guarded script must not touch it, and the
    // release must not throw: it runs from the periodic GC and from shutdown,
    // where a throw is an unhandled rejection.
    acquireRoomLease.mockResolvedValue('acquired');
    renewRoomLease.mockResolvedValue('renewed');
    releaseRoomLease.mockResolvedValue('not-held');
    isRedisAvailable.mockReturnValue(true);
    const ownership = await loadWithEnv({ WS_ROOM_OWNERSHIP: 'on' });

    await ownership.acquireRoom('raced-room');
    expect(ownership.ownsRoom('raced-room')).toBe(true);

    await expect(ownership.releaseRoom('raced-room')).resolves.toBeUndefined();

    expect(ownership.ownsRoom('raced-room')).toBe(false);
    ownership.resetRoomOwnershipForTests();
  });

  it('forgets the room even when Redis could not be reached at all', async () => {
    // Releasing is an optimisation, not a correctness requirement — expiry alone
    // is sufficient. Refusing to forget the lease because the release failed
    // would pin the room to this process locally even though Redis has already
    // moved it, so `acquireRoom` would keep answering 'owner' for a room a peer
    // now serves.
    acquireRoomLease.mockResolvedValue('acquired');
    renewRoomLease.mockResolvedValue('renewed');
    releaseRoomLease.mockResolvedValue('unavailable');
    isRedisAvailable.mockReturnValue(true);
    const ownership = await loadWithEnv({ WS_ROOM_OWNERSHIP: 'on' });

    await ownership.acquireRoom('unreachable-release');
    await expect(ownership.releaseRoom('unreachable-release')).resolves.toBeUndefined();
    expect(ownership.ownsRoom('unreachable-release')).toBe(false);

    ownership.resetRoomOwnershipForTests();
  });
});
