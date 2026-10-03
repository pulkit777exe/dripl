import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { DriplElement, LinearElement } from '@dripl/common';

import { mutateElement, type ElementUpdate } from '../mutateElement';
import {
  hasCachedBitmapForTest,
  resetElementBitmapCacheForTest,
  seedCacheEntryForTest,
} from '../staticScene';
import { getShapeFromCache, setShapeInCache } from '../shape-cache';

/** A linear element, because it is the widest element union member. */
function arrow(overrides: Partial<LinearElement> = {}): LinearElement {
  return {
    id: 'arrow-1',
    type: 'arrow',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ],
    version: 3,
    versionNonce: 17,
    ...overrides,
  } as LinearElement;
}

const MAX_NONCE = 2_147_483_647;

afterEach(() => {
  vi.restoreAllMocks();
  resetElementBitmapCacheForTest();
});

describe('mutateElement version contract', () => {
  it('increments version by exactly one for every mutated field', () => {
    // Every field the interface declares, so a new field cannot be added
    // without this noticing that it bypasses the bump.
    const updates: ElementUpdate[] = [
      { x: 7 },
      { y: 7 },
      { width: 7 },
      { height: 7 },
      { angle: 0.5 },
      { opacity: 0.5 },
      { strokeColor: '#fff' },
      { backgroundColor: '#000' },
      { strokeWidth: 9 },
      { roughness: 2 },
      { strokeStyle: 'dashed' },
      { fillStyle: 'solid' },
      { groupId: 'g1' },
      { fractionalIndex: 'a1' },
      { text: 'hi' },
      { fontSize: 11 },
      { fontFamily: 'Inter' },
      { points: [{ x: 1, y: 1 }] },
      { src: 'https://example.test/a.png' },
    ];

    for (const update of updates) {
      const updated = mutateElement(arrow(), update);
      expect(updated.version).toBe(4);
    }
  });

  it('increments version by exactly one for any starting version', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2_000_000_000 }), version => {
        const updated = mutateElement(arrow({ version }), { x: 1 });
        expect(updated.version).toBe(version + 1);
      })
    );
  });

  it('treats a missing version as 0 and lands on 1', () => {
    const legacy = { ...arrow(), version: undefined } as unknown as DriplElement;
    expect(mutateElement(legacy, { x: 5 }).version).toBe(1);
  });

  it('redraws the versionNonce on every real mutation', () => {
    // The nonce is a tie-break between replicas, so it has to move whenever the
    // payload moves. A frozen nonce would make every same-version pair a tie.
    const nonces = new Set<number>();
    let current = arrow();
    for (let i = 0; i < 50; i += 1) {
      current = mutateElement(current, { x: i });
      nonces.add(current.versionNonce as number);
    }
    expect(nonces.size).toBeGreaterThan(40);
  });

  it('keeps versionNonce a non-negative integer inside the 31-bit range', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), index => {
        const updated = mutateElement(arrow(), { x: index });
        expect(Number.isInteger(updated.versionNonce)).toBe(true);
        expect(updated.versionNonce).toBeGreaterThanOrEqual(0);
        // `Math.floor(random() * MAX)` can produce at most MAX - 1.
        expect(updated.versionNonce).toBeLessThan(MAX_NONCE);
      })
    );
  });

  it('honours a zero versionNonce as a real value rather than "missing"', () => {
    // `compareElementFreshness` reads the nonce as `?? 0`, so a minted 0 is
    // indistinguishable from an absent nonce. It is a legitimate draw and must
    // be stored as-is rather than substituted.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const updated = mutateElement(arrow(), { x: 3 });
    expect(updated.versionNonce).toBe(0);
    expect('versionNonce' in updated).toBe(true);
  });

  it('advances the version by one per effective edit and not at all per no-op', () => {
    // One lineage's keys are unique by version alone; the nonce only breaks
    // ties across replicas. So the version must advance on every commit and
    // hold still on a rejected no-op — neither more nor less than once.
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -3, max: 3 }), { minLength: 1, maxLength: 40 }),
        xs => {
          let current = arrow();
          for (const x of xs) {
            const isNoOp = x === current.x;
            const next = mutateElement(current, { x });
            expect(next.version).toBe((current.version ?? 0) + (isNoOp ? 0 : 1));
            current = next;
          }
        }
      )
    );
  });
});

describe('mutateElement no-op guard', () => {
  it('returns the same reference when no field differs', () => {
    const original = arrow();
    expect(mutateElement(original, { x: 0, y: 0, width: 100, height: 50 })).toBe(original);
  });

  it('treats an empty update as a no-op', () => {
    const original = arrow();
    expect(mutateElement(original, {})).toBe(original);
  });

  it('ignores undefined values rather than clearing the field', () => {
    // `undefined` must not be read as "set this field to undefined": it is the
    // documented way to express "not part of this update".
    const original = arrow();
    // `ElementUpdate` declares those keys as `x?: number`, and with
    // `exactOptionalPropertyTypes` an explicit `undefined` needs its own cast.
    const noFields = { x: undefined, strokeColor: undefined } as unknown as ElementUpdate;
    const updated = mutateElement(original, noFields);
    expect(updated).toBe(original);
    expect(updated.x).toBe(0);
    expect(updated.strokeColor).toBeUndefined();
  });

  it('commits when only one of several fields changes', () => {
    const updated = mutateElement(arrow(), { x: 0, y: 0, width: 250 });
    expect(updated).not.toBe(arrow());
    expect(updated.width).toBe(250);
  });

  it('does not invalidate the caches for a no-op', () => {
    // A no-op must be free. The previous frame's bitmap and drawable are still
    // correct, and dropping them would cost a full regeneration for nothing.
    const element = arrow();
    seedCacheEntryForTest(element);
    setShapeInCache(element, { shape: 'drawable' } as never, 'light');

    expect(mutateElement(element, { x: 0 })).toBe(element);

    expect(hasCachedBitmapForTest(element)).toBe(true);
    expect(getShapeFromCache(element, 'light')).toEqual({ shape: 'drawable' });
  });

  it('compares point arrays by value, not by identity', () => {
    const original = arrow();
    const equalCopy = mutateElement(original, {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ],
    });
    expect(equalCopy).toBe(original);

    const movedY = mutateElement(original, {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 51 },
      ],
    });
    expect(movedY).not.toBe(original);

    const shorter = mutateElement(original, { points: [{ x: 0, y: 0 }] });
    expect(shorter).not.toBe(original);
  });
});

describe('mutateElement cache invalidation', () => {
  it('drops both the bitmap and the drawable on a geometry change', () => {
    const element = arrow();
    seedCacheEntryForTest(element);
    setShapeInCache(element, { shape: 'drawable' } as never, 'light');

    mutateElement(element, { x: 42 });

    expect(hasCachedBitmapForTest(element)).toBe(false);
    expect(getShapeFromCache(element, 'light')).toBeUndefined();
  });

  it('drops both caches for an appearance-only change too', () => {
    // This is the load-bearing claim in the source comment: the bitmap embeds
    // stroke colour and opacity, so a geometry-only invalidation check would
    // leave a stale image on screen.
    for (const appearance of [{ opacity: 0.25 }, { strokeColor: '#ff0000' }, { strokeWidth: 7 }]) {
      const element = arrow();
      seedCacheEntryForTest(element);
      setShapeInCache(element, { shape: 'drawable' } as never, 'light');

      mutateElement(element, appearance);

      expect(hasCachedBitmapForTest(element)).toBe(false);
      expect(getShapeFromCache(element, 'light')).toBeUndefined();
    }
  });

  it('invalidates the bitmap keyed by id even when the id map holds another object', () => {
    // `invalidateElementCache` is string-keyed while the bitmap cache is keyed
    // by object identity, so the lookup has to go through the id map. Seeding
    // two objects under one id proves which side of that bridge is consulted.
    const original = arrow({ id: 'shared' });
    seedCacheEntryForTest(original);
    expect(hasCachedBitmapForTest(original)).toBe(true);

    const replacement = mutateElement(original, { x: 1 });
    expect(replacement.id).toBe('shared');
    expect(hasCachedBitmapForTest(original)).toBe(false);
    // The mutated object is a different reference, so it never had a bitmap.
    expect(hasCachedBitmapForTest(replacement)).toBe(false);
  });
});
