import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  file: { findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
  canvasRoom: { findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
}));

vi.mock('@dripl/db', () => ({ db: dbMock }));

import { getOrCreateRoom, rooms, mergeMemoryWithStored } from '../rooms';
import {
  TOMBSTONE_TTL_MS,
  deleteWithTombstone,
  getLiveTombstone,
  isSupersededByTombstone,
  sweepExpiredTombstones,
} from '../tombstones';
import { acceptElement } from '../sceneMutation';
import type { DriplElement } from '@dripl/common';

const el = (id: string, version = 1, versionNonce = 1): DriplElement =>
  ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    version,
    versionNonce,
  }) as DriplElement;

describe('tombstones', () => {
  beforeEach(() => {
    rooms.clear();
    vi.clearAllMocks();
  });

  it('records a versioned delete marker and removes the element', () => {
    const room = getOrCreateRoom('t1');
    room.elements.set('a', el('a', 3, 7));

    expect(deleteWithTombstone(room, 'a')).toBe(true);
    expect(room.elements.has('a')).toBe(false);
    const tombstone = getLiveTombstone(room, 'a');
    expect(tombstone).toMatchObject({ id: 'a', version: 4 });
  });

  it('is a no-op for absent ids', () => {
    const room = getOrCreateRoom('t2');
    expect(deleteWithTombstone(room, 'ghost')).toBe(false);
    expect(getLiveTombstone(room, 'ghost')).toBeUndefined();
  });

  it('rejects a stale concurrent edit instead of resurrecting', () => {
    const room = getOrCreateRoom('t3');
    room.elements.set('a', el('a', 2, 9));
    deleteWithTombstone(room, 'a');

    // Edit made against the pre-delete state (same version the deleted
    // element had) must lose to the tombstone.
    expect(acceptElement(room, el('a', 2, 10))).toBeNull();
    expect(room.elements.has('a')).toBe(false);
    expect(isSupersededByTombstone(room, el('a', 2, 10))).toBe(true);
    // The marker itself survives the rejected write.
    expect(getLiveTombstone(room, 'a')).toBeDefined();
  });

  it('accepts a genuinely newer edit and clears the marker', () => {
    const room = getOrCreateRoom('t4');
    room.elements.set('a', el('a', 2, 9));
    deleteWithTombstone(room, 'a');

    const revived = acceptElement(room, el('a', 5, 1));
    expect(revived?.version).toBe(5);
    expect(room.elements.get('a')?.version).toBe(5);
    expect(getLiveTombstone(room, 'a')).toBeUndefined();
  });

  it('lets expired markers go', () => {
    const room = getOrCreateRoom('t5');
    room.elements.set('a', el('a', 1, 1));
    deleteWithTombstone(room, 'a', 0);

    expect(getLiveTombstone(room, 'a', TOMBSTONE_TTL_MS)).toBeUndefined();
    expect(room.tombstones.has('a')).toBe(false);
    // A stale edit is admissible again once the marker is gone.
    expect(acceptElement(room, el('a', 1, 2))).not.toBeNull();
  });

  it('sweeps only expired markers', () => {
    const room = getOrCreateRoom('t6');
    room.elements.set('a', el('a', 1, 1));
    room.elements.set('b', el('b', 1, 1));
    deleteWithTombstone(room, 'a', 0);
    deleteWithTombstone(room, 'b', TOMBSTONE_TTL_MS);

    expect(sweepExpiredTombstones(room, TOMBSTONE_TTL_MS)).toBe(1);
    expect(room.tombstones.has('a')).toBe(false);
    expect(room.tombstones.has('b')).toBe(true);
  });
});

describe('mergeMemoryWithStored', () => {
  beforeEach(() => {
    rooms.clear();
  });

  it('lets the fresher version win per id and keeps stored-only ids', () => {
    const room = getOrCreateRoom('m1');
    room.elements.set('a', el('a', 2, 1)); // beats stored a@v1
    room.elements.set('c', el('c', 1, 1)); // beats stored c@v3? no — loses

    const { merged, resurrected } = mergeMemoryWithStored(room, [
      el('a', 1, 1),
      el('b', 1, 1),
      el('c', 3, 1),
    ]);
    expect(merged.get('a')).toMatchObject({ version: 2 });
    expect(merged.get('c')).toMatchObject({ version: 3 });
    expect(merged.get('b')).toMatchObject({ version: 1 });
    // Only b is stored-only; c is already in memory (stored v3 won).
    expect(resurrected.map(e => e.id).sort()).toEqual(['b']);
  });

  it('drops stored elements beaten by a live tombstone', () => {
    const room = getOrCreateRoom('m2');
    room.elements.set('a', el('a', 2, 1));
    deleteWithTombstone(room, 'a'); // tombstone v3 beats stored a@v2

    const { merged, resurrected } = mergeMemoryWithStored(room, [el('a', 2, 5)]);
    expect(merged.has('a')).toBe(false);
    expect(resurrected).toEqual([]);
  });
});
