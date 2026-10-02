import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeaseAcquireResult, LeaseRenewResult, LeaseReleaseResult } from '../redis';

// Typed so `mock.calls[0]` is a tuple rather than `any[]`; untyped `vi.fn()`
// makes every argument access an unchecked index.
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

async function loadModule(): Promise<OwnershipModule> {
  vi.resetModules();
  return import('../roomOwnership');
}

/**
 * The lease token the module actually wrote. Asserted rather than indexed so a
 * missing acquire fails with a readable message instead of an index error, and
 * so the test states what it depends on: the token is per-acquisition and is
 * the compare-and-set precondition.
 */
function acquiredToken(): string {
  const call = acquireRoomLease.mock.calls[0];
  if (!call) throw new Error('acquireRoomLease was never called');
  return call[1];
}

describe('room ownership (ADR-002 single-writer lease)', () => {
  let ownership: OwnershipModule;

  beforeEach(async () => {
    acquireRoomLease.mockReset().mockResolvedValue('acquired');
    renewRoomLease.mockReset().mockResolvedValue('renewed');
    releaseRoomLease.mockReset().mockResolvedValue('released');
    isRedisAvailable.mockReset().mockReturnValue(true);
    vi.stubEnv('WS_ROOM_OWNERSHIP', 'on');
    vi.unstubAllEnvs();
    vi.stubEnv('WS_ROOM_OWNERSHIP', 'on');
    ownership = await loadModule();
  });

  afterEach(() => {
    ownership.resetRoomOwnershipForTests();
    vi.unstubAllEnvs();
  });

  it('is disabled, and touches no Redis, without credentials', async () => {
    isRedisAvailable.mockReturnValue(false);
    ownership = await loadModule();
    await expect(ownership.acquireRoom('room-a')).resolves.toBe('disabled');
    expect(acquireRoomLease).not.toHaveBeenCalled();
  });

  it('is disabled by explicit opt-out even when Redis is available', async () => {
    vi.stubEnv('WS_ROOM_OWNERSHIP', 'off');
    ownership = await loadModule();
    await expect(ownership.acquireRoom('room-a')).resolves.toBe('disabled');
    expect(acquireRoomLease).not.toHaveBeenCalled();
  });

  it('claims the room under a namespaced TTL key', async () => {
    await expect(ownership.acquireRoom('room-a')).resolves.toBe('owner');
    expect(acquireRoomLease).toHaveBeenCalledTimes(1);
    const call = acquireRoomLease.mock.calls[0];
    if (!call) throw new Error('acquireRoomLease was never called');
    expect(call[0]).toBe('dripl:room-owner:room-a');
    // A fresh random token per acquisition is what makes the renew CAS
    // ownership-checked: a lapsed owner cannot present a token a new owner
    // would ever have written.
    expect(call[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(call[2]).toBe(ownership.ROOM_LEASE_TTL_MS);
    expect(ownership.ownsRoom('room-a')).toBe(true);
  });

  it('is idempotent: a second join to a room we hold does not re-run SET NX', async () => {
    await expect(ownership.acquireRoom('room-a')).resolves.toBe('owner');
    await expect(ownership.acquireRoom('room-a')).resolves.toBe('owner');
    expect(acquireRoomLease).toHaveBeenCalledTimes(1);
  });

  it('reports a live peer lease as foreign and does not claim the room', async () => {
    acquireRoomLease.mockResolvedValue('held-elsewhere');
    await expect(ownership.acquireRoom('room-a')).resolves.toBe('foreign');
    expect(ownership.ownsRoom('room-a')).toBe(false);
  });

  it('fails open, but distinctly, when Redis is unreachable', async () => {
    acquireRoomLease.mockResolvedValue('unavailable');
    // Fail-open is what keeps a Redis outage from becoming a product outage;
    // the distinct verdict is what stops it being mistaken for a peer holding
    // the room, which must fail closed.
    await expect(ownership.acquireRoom('room-a')).resolves.toBe('unavailable');
    expect(ownership.ownsRoom('room-a')).toBe(false);
  });

  it('keeps a lease across a renewal, using the held token as the CAS precondition', async () => {
    await ownership.acquireRoom('room-a');
    const token = acquiredToken();
    await ownership.renewAllLeases();
    expect(renewRoomLease).toHaveBeenCalledWith(
      'dripl:room-owner:room-a',
      token,
      ownership.ROOM_LEASE_TTL_MS
    );
    expect(ownership.ownsRoom('room-a')).toBe(true);
  });

  it('reports a rejected CAS as a lost lease and notifies the owner exactly once', async () => {
    const lost = vi.fn();
    ownership.onRoomOwnershipLost(lost);
    await ownership.acquireRoom('room-a');
    renewRoomLease.mockResolvedValue('lost');
    await ownership.renewAllLeases();
    expect(lost).toHaveBeenCalledExactlyOnceWith('room-a');
    expect(ownership.ownsRoom('room-a')).toBe(false);

    // The lease is gone, so a later renewal tick must not re-notify: the
    // caller's quiesce path is not idempotent-safe to run twice.
    await ownership.renewAllLeases();
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('survives a transient renewal failure inside the lease TTL', async () => {
    const lost = vi.fn();
    ownership.onRoomOwnershipLost(lost);
    await ownership.acquireRoom('room-a');
    renewRoomLease.mockResolvedValue('unavailable');
    await ownership.renewAllLeases(Date.now());
    expect(lost).not.toHaveBeenCalled();
    expect(ownership.ownsRoom('room-a')).toBe(true);
  });

  it('gives up a lease it could not renew for longer than the TTL', async () => {
    const lost = vi.fn();
    ownership.onRoomOwnershipLost(lost);
    await ownership.acquireRoom('room-a');
    renewRoomLease.mockResolvedValue('unavailable');
    // The key expires on its own TTL; once we are older than that, another
    // instance may already own the room and we are editing it blind.
    await ownership.renewAllLeases(Date.now() + ownership.ROOM_LEASE_TTL_MS);
    expect(lost).toHaveBeenCalledExactlyOnceWith('room-a');
    expect(ownership.ownsRoom('room-a')).toBe(false);
  });

  it('releases only with its own token, and forgets the room', async () => {
    await ownership.acquireRoom('room-a');
    const token = acquiredToken();
    await ownership.releaseRoom('room-a');
    expect(releaseRoomLease).toHaveBeenCalledWith('dripl:room-owner:room-a', token);
    expect(ownership.ownsRoom('room-a')).toBe(false);
  });

  it('releasing a room we never held is a no-op, not a delete', async () => {
    await ownership.releaseRoom('room-a');
    expect(releaseRoomLease).not.toHaveBeenCalled();
  });

  it('releases every held room, for shutdown', async () => {
    await ownership.acquireRoom('room-a');
    await ownership.acquireRoom('room-b');
    await ownership.releaseAllRooms();
    expect(ownership.ownsRoom('room-a')).toBe(false);
    expect(ownership.ownsRoom('room-b')).toBe(false);
    expect(releaseRoomLease).toHaveBeenCalledTimes(2);
  });

  it('ignores a renewal verdict for a room whose lease was already released', async () => {
    const lost = vi.fn();
    ownership.onRoomOwnershipLost(lost);
    await ownership.acquireRoom('room-a');
    await ownership.releaseRoom('room-a');
    await ownership.renewAllLeases();
    expect(lost).not.toHaveBeenCalled();
  });
});
