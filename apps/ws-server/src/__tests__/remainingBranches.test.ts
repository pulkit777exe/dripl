/**
 * The last four uncovered branches in this package, each of which is the "the
 * thing I expected to be safe is not" case:
 *
 *  - `rateLimiter`'s bucket cap and its Redis-init catch;
 *  - `roomOwnership`'s renewal sweep timer and its `loseLease` no-lease guard;
 *  - `rooms`' `normalizeLegacyElement` non-object arm and its metadata guard;
 *  - `sceneMutation`'s remote delete arm.
 *
 * Small individually. Grouped because each is a few lines and splitting them
 * into four files would cost more in duplication than it saves in clarity.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  file: { findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
  canvasRoom: { findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
}));

vi.mock('@dripl/db', () => ({ db: dbMock }));

import { getOrCreateRoom, loadRoomElements, parseStoredElements, rooms } from '../rooms';
import { applyRemoteSceneMessage } from '../sceneMutation';
import type { DriplElement } from '@dripl/common';

describe('stored element normalization', () => {
  beforeEach(() => {
    rooms.clear();
    vi.clearAllMocks();
  });

  it('passes non-object entries straight to the schema, which drops them', () => {
    // A stored array containing primitives, `null`, or a nested array. The
    // normalizer must not spread a `null` into an object (which would throw) nor
    // silently accept the array as a candidate element — the schema is the last
    // gate and it rejects all of them.
    const elements = parseStoredElements(
      JSON.stringify([
        null,
        7,
        'text',
        true,
        [],
        { id: 'real', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
      ])
    );
    expect(elements.map(element => element.id)).toEqual(['real']);
  });

  it('drops an element whose type is missing rather than coercing it', () => {
    // `type` absent means the entry never had one. Coercing it into a default
    // would invent a shape the renderer then has to handle.
    const elements = parseStoredElements(
      JSON.stringify([
        { id: 'typeless', x: 0, y: 0, width: 10, height: 10 },
        { id: 'typed', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
      ])
    );
    expect(elements.map(element => element.id)).toEqual(['typed']);
  });

  it('reads a stored content of the wrong JSON type as no envelope at all', async () => {
    // `readStoredSceneMetadata` guards on "is this an object" before reading any
    // field. A bare array or a scalar must not be walked as a record; that would
    // produce `encryptedPayload: undefined` keys and, on save, write an envelope
    // that was never in the row.
    dbMock.file.findUnique.mockResolvedValue({
      content: JSON.stringify([{ id: 'a', type: 'rectangle' }]),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const room = getOrCreateRoom('meta-array');
    await loadRoomElements('meta-array');
    expect(room.storedMetadata).toEqual({});
  });

  it('reads nullish stored content as no envelope', async () => {
    // A row that exists with a NULL `content` column. `parseStoredElements`
    // treats it as an empty scene and `readStoredSceneMetadata` as no envelope —
    // neither may throw, because both run on the join path.
    dbMock.file.findUnique.mockResolvedValue({
      content: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const room = getOrCreateRoom('meta-null');
    await expect(loadRoomElements('meta-null')).resolves.toBeInstanceOf(Map);
    expect(room.storedMetadata).toEqual({});
  });
});

describe('remote delete arm', () => {
  beforeEach(() => {
    rooms.clear();
    vi.clearAllMocks();
  });

  it('records a tombstone for a remote delete and marks the room', () => {
    // The remote delete arm, as opposed to the `scene-delta` delete arm already
    // covered. Both exist because both wire types are relayed; a peer using the
    // older spelling must get the same versioned delete, or the delete does not
    // un-happen for anyone.
    const room = getOrCreateRoom('remote-delete');
    room.elements.set('x', {
      id: 'x',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      version: 4,
      versionNonce: 4,
    } as unknown as DriplElement);

    expect(applyRemoteSceneMessage(room, { type: 'delete_element', elementId: 'x' })).toBe(true);
    expect(room.elements.has('x')).toBe(false);
    expect(room.tombstones.get('x')?.version).toBe(5);
    expect(room.dirty).toBe(true);
  });
});

describe('the local bucket cap', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('evicts the oldest identities once the map is at its bound', async () => {
    // The map is process-local with no cleanup interval, so the cap is the only
    // thing bounding it. A flood of distinct share tokens — every one of them
    // authenticated, so nothing upstream limits how many there can be — must not
    // grow it without limit.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.resetModules();
    const limiter = await import('../rateLimiter');

    // Fill past the cap without advancing the clock, so nothing expires and the
    // `while` eviction loop is the only thing keeping the map bounded.
    for (let i = 0; i < 10_050; i++) {
      const socket = {} as never;
      limiter.setRateLimitIdentity(socket, `id-${i}`);
      await limiter.checkRateLimit(socket);
    }

    // An evicted identity comes back with a full budget rather than inheriting
    // the flood's. This is the cost of the cap, and it is bounded and oldest-first
    // rather than arbitrary.
    const evicted = {} as never;
    limiter.setRateLimitIdentity(evicted, 'id-0');
    let admitted = 0;
    while (admitted <= limiter.RATE_LIMIT_MAX_MESSAGES) {
      if (await limiter.checkRateLimit(evicted)) admitted += 1;
      else break;
    }
    expect(admitted).toBe(limiter.RATE_LIMIT_MAX_MESSAGES);

    // And the limiter is still usable afterwards — the cap evicts, it does not
    // wedge.
    const after = {} as never;
    limiter.setRateLimitIdentity(after, 'id-after');
    await expect(limiter.checkRateLimit(after)).resolves.toBe(true);
  });
});

describe('the limiter falling back when Redis cannot be constructed', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('falls back to the local bucket when the Redis URL is malformed', async () => {
    // `initRedis` swallows a construction failure and leaves the local token
    // bucket in charge. Without that catch the module-level `void initRedis()`
    // would produce an unhandled rejection at import — and `rateLimiter` is
    // imported by the composition root, so that would be an unhandled rejection
    // during startup of every process, for a configuration mistake.
    //
    // This is not synthetic: `new Redis(...)` in `@upstash/redis@1.39.0` throws
    // `UrlError` for `not-a-url`, `ftp://x`, `:::`, and `localhost:6379`. A
    // deploy with Upstash set up from a template with the scheme omitted lands
    // here exactly.
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'not-a-url');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'a-token');
    vi.resetModules();
    const limiter = await import('../rateLimiter');

    const socket = {} as never;
    limiter.setRateLimitIdentity(socket, 'malformed-redis-user');
    // Bounded by the local bucket, which is the whole point of the fallback.
    for (let i = 0; i < limiter.RATE_LIMIT_MAX_MESSAGES; i++) {
      await expect(limiter.checkRateLimit(socket)).resolves.toBe(true);
    }
    await expect(limiter.checkRateLimit(socket)).resolves.toBe(false);
  });
});

describe('the renewal sweep timer', () => {
  const acquireRoomLease = vi.fn(async () => 'acquired' as const);
  const renewRoomLease = vi.fn(async (): Promise<'renewed' | 'lost'> => 'renewed');
  const releaseRoomLease = vi.fn(async () => 'released' as const);

  beforeEach(() => {
    vi.resetModules();
    acquireRoomLease.mockClear();
    renewRoomLease.mockClear();
    releaseRoomLease.mockClear();
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.stubEnv('WS_ROOM_OWNERSHIP', 'on');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  async function loadOwnership(): Promise<typeof import('../roomOwnership')> {
    vi.doMock('../redis', () => ({
      acquireRoomLease,
      renewRoomLease,
      releaseRoomLease,
      isRedisAvailable: () => true,
    }));
    return import('../roomOwnership');
  }

  it('renews on a timer, not only when something else calls it', async () => {
    // The whole point of the sweep: in production nothing else calls
    // `renewAllLeases`. If the timer were removed, every lease would silently
    // expire after its TTL and a live room would be taken over by a peer while
    // its users are still connected — the split-brain ADR-002 exists to prevent,
    // reached by inaction.
    vi.useFakeTimers();
    const ownership = await loadOwnership();
    await ownership.acquireRoom('swept-room');
    expect(renewRoomLease).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(ownership.ROOM_LEASE_RENEW_MS);
    expect(renewRoomLease).toHaveBeenCalledWith(
      'dripl:room-owner:swept-room',
      expect.any(String),
      ownership.ROOM_LEASE_TTL_MS
    );
    expect(ownership.ownsRoom('swept-room')).toBe(true);

    ownership.resetRoomOwnershipForTests();
  });

  it('stops the sweep once the last room is released', async () => {
    // The timer must not outlive the leases it renews: a timer that keeps
    // running with nothing to renew is a background task nobody can account for,
    // and `resetRoomOwnershipForTests` would not clear it.
    vi.useFakeTimers();
    const ownership = await loadOwnership();
    await ownership.acquireRoom('first-room');
    await ownership.acquireRoom('second-room');
    // One room still held, so the sweep must still be running.
    await ownership.releaseRoom('first-room');
    await vi.advanceTimersByTimeAsync(ownership.ROOM_LEASE_RENEW_MS);
    expect(renewRoomLease).toHaveBeenCalledTimes(1);

    renewRoomLease.mockClear();
    await ownership.releaseRoom('second-room');
    await vi.advanceTimersByTimeAsync(ownership.ROOM_LEASE_RENEW_MS * 3);

    expect(renewRoomLease).not.toHaveBeenCalled();
    ownership.resetRoomOwnershipForTests();
  });

  it('quiesces the room when the timer is the thing that notices the loss', async () => {
    // The unattended path: nobody calls `renewAllLeases` by hand, the renewal
    // CAS is rejected, and the ownership-lost handler has to fire on its own.
    // This is how a partition heals in production.
    vi.useFakeTimers();
    const ownership = await loadOwnership();
    const lost = vi.fn();
    ownership.onRoomOwnershipLost(lost);
    await ownership.acquireRoom('lost-by-timer');

    renewRoomLease.mockResolvedValueOnce('lost');
    await vi.advanceTimersByTimeAsync(ownership.ROOM_LEASE_RENEW_MS);

    expect(lost).toHaveBeenCalledExactlyOnceWith('lost-by-timer');
    expect(ownership.ownsRoom('lost-by-timer')).toBe(false);

    ownership.resetRoomOwnershipForTests();
  });

  it('tolerates a renewal for a lease released while the sweep was in flight', async () => {
    // The race the `if (!lease) return;` guard exists for: the sweep reads the
    // lease list, an awaited round-trip completes, and meanwhile the room was
    // released (by the GC or by shutdown). Reporting that as a lost lease would
    // quiesce a room that is already gone — harmless here, but the same code
    // path would fire the handler twice for a room released a moment later.
    const ownership = await loadOwnership();
    const lost = vi.fn();
    ownership.onRoomOwnershipLost(lost);
    await ownership.acquireRoom('raced');
    await ownership.releaseRoom('raced');

    await expect(ownership.renewAllLeases()).resolves.toBeUndefined();
    expect(lost).not.toHaveBeenCalled();

    ownership.resetRoomOwnershipForTests();
  });
});
