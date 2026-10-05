import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { generateKeyBetween } from 'fractional-indexing';

import {
  MAX_HISTORY,
  MAX_HISTORY_BYTES,
  buildElementsById,
  cloneElements,
  commitPresentFromHistory,
  ensureFractionalIndexes,
  generateFractionalIndexAfterAll,
  generateFractionalIndexBeforeAll,
  generateFractionalIndexBetween,
  pushPast,
  sortedInsert,
  withHistoryBeforeMutation,
} from '@/lib/store/helpers';
import { compareZOrder, sortElementsByZIndex } from '@/utils/zIndexUtils';

/**
 * The pure half of the canvas store: fractional-index generation, z-ordered
 * insertion, and the undo history's two budgets.
 *
 * `elementActions`/`arrangeActions` call these in passing, so a defect here shows
 * up as a mis-ordered element or an undo that silently forgets a step rather
 * than as an exception. Two properties are asserted as invariants over the
 * inputs rather than as literal keys, because the concrete keys are
 * `fractional-indexing`'s business and would change under a version bump:
 *
 *   * ordering -- a generated key must sort strictly *after* `before` and
 *     strictly *before* `after`, under the same total order the store inserts
 *     with. That is what makes "insert between these two elements" mean anything.
 *   * budgets -- `pushPast` enforces a *count* limit and a *byte* limit, and both
 *     drop the oldest snapshots first. Undo that forgets the oldest entry is
 *     still "working", which is why these need explicit assertions.
 */

const rect = (id: string, extra: Partial<DriplElement> = {}): DriplElement =>
  ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version: 1,
    versionNonce: 1,
    ...extra,
  }) as DriplElement;

/**
 * Whether `key` sits strictly between `before` and `after` in z-order.
 *
 * Built from `compareZOrder` rather than from string comparison because the store
 * compares by fractional index first and falls back to element id -- and these
 * generated keys have no element, so only the index column is meaningful here.
 * The check is written as "sorts after `before` and before `after`" using the
 * library's own comparator on synthetic elements, so it stays true whatever
 * `fractional-indexing` decides the key string looks like.
 */
function sitsBetween(key: string, before: string | null, after: string | null) {
  const probe = rect('probe', { fractionalIndex: key });
  const beforeEl = before === null ? null : rect('before', { fractionalIndex: before });
  const afterEl = after === null ? null : rect('after', { fractionalIndex: after });
  const afterBefore = beforeEl === null || compareZOrder(probe, beforeEl) > 0;
  const beforeAfter = afterEl === null || compareZOrder(probe, afterEl) < 0;
  return afterBefore && beforeAfter;
}

describe('generateFractionalIndexBetween', () => {
  // Regression: the lookup half. `beforeId`/`afterId` are element *ids*, and the
  // keys come from those elements -- reading `beforeId` as a key directly would
  // produce a key between two strings that were never z-ordered values, so the
  // insert lands in the wrong place with no error.
  it('resolves the neighbour ids to their fractional indexes and orders between them', () => {
    const elements = [
      rect('first', { fractionalIndex: 'a0' }),
      rect('second', { fractionalIndex: 'a1' }),
    ];

    const key = generateFractionalIndexBetween(elements, 'first', 'second');

    expect(sitsBetween(key, 'a0', 'a1')).toBe(true);
  });

  it('agrees with generateKeyBetween on the same pair of indexes', () => {
    const elements = [rect('a', { fractionalIndex: 'a0' }), rect('b', { fractionalIndex: 'a1' })];

    expect(generateFractionalIndexBetween(elements, 'a', 'b')).toBe(generateKeyBetween('a0', 'a1'));
  });

  // Each row asserts against the *open* end it actually has: `generateKeyBetween`
  // has no upper neighbour to stay below, so the only claim available is that
  // the key sorts after `before` (or before `after`).
  it.each([
    ['no neighbours at all', null, null, null, null],
    ['only a lower neighbour', 'first', null, 'a0', null],
    ['only an upper neighbour', null, 'second', null, 'a1'],
  ] as const)(
    'orders against the open end of the scene with %s',
    (_label, beforeId, afterId, beforeKey, afterKey) => {
      const elements = [
        rect('first', { fractionalIndex: 'a0' }),
        rect('second', { fractionalIndex: 'a1' }),
      ];

      const key = generateFractionalIndexBetween(elements, beforeId, afterId);

      expect(typeof key).toBe('string');
      expect(sitsBetween(key, beforeKey, afterKey)).toBe(true);
    }
  );

  // Regression: the *pair* bounds the key on both sides, proved with a gap rather
  // than adjacent keys so the assertion would fail for a key generated anywhere
  // outside the interval. The end-to-end form is what matters: an element carrying
  // the returned key must actually land *between* the two named elements once the
  // store's own insertion runs, which is what "insert between these two" means.
  it('lands an element carrying the key between the two named elements', () => {
    const lo = generateKeyBetween(null, null);
    const mid = generateKeyBetween(lo, null);
    const hi = generateKeyBetween(mid, null);
    const elements = [rect('low', { fractionalIndex: lo }), rect('high', { fractionalIndex: hi })];

    const inserted = rect('inserted', {
      fractionalIndex: generateFractionalIndexBetween(elements, 'low', 'high'),
    });

    expect(sortedInsert(elements, inserted).map(e => e.id)).toEqual(['low', 'inserted', 'high']);
  });

  // Regression: the `?? null` half. An id that is not in the scene is a stale
  // reference from a concurrent edit, not a crash -- and it must read as "open
  // end" rather than as the id string itself, which would create a key that
  // sorts next to a name instead of next to an element.
  it('treats an unknown id as an open end rather than as a key', () => {
    const elements = [rect('present', { fractionalIndex: 'a0' })];

    const fromUnknown = generateFractionalIndexBetween(elements, 'ghost', null);
    const fromNothing = generateFractionalIndexBetween(elements, null, null);

    expect(fromUnknown).toBe(fromNothing);
    expect(sitsBetween(fromUnknown, 'a0', null)).toBe(true);
  });

  // Regression: the same `?? null` on the *upper* neighbour. Asserted separately
  // because the two substitutions fail differently -- a fabricated lower bound
  // lands the new element in the wrong half of the scene, while a fabricated
  // upper bound lands it before the scene instead of after.
  it('treats an unknown upper id as an open end too', () => {
    const elements = [rect('present', { fractionalIndex: 'a0' })];

    const fromUnknown = generateFractionalIndexBetween(elements, 'present', 'ghost');
    const fromNothing = generateFractionalIndexBetween(elements, 'present', null);

    expect(fromUnknown).toBe(fromNothing);
    expect(sitsBetween(fromUnknown, 'a0', null)).toBe(true);
  });

  // Regression: the upper lookup specifically. With `before` known and `after`
  // unknown, the key must still land *after* `before` -- not before it, which is
  // what a fabricated upper bound would produce.
  it('lands after the known lower neighbour when the upper id is unknown', () => {
    const lo = generateKeyBetween(null, null);
    const elements = [rect('present', { fractionalIndex: lo })];

    const key = generateFractionalIndexBetween(elements, 'present', 'ghost');

    expect(compareZOrder(rect('p', { fractionalIndex: key }), elements[0]!) > 0).toBe(true);
  });

  it('does not mutate the scene it reads', () => {
    const elements = [rect('a', { fractionalIndex: 'a0' }), rect('b', { fractionalIndex: 'a1' })];
    const before = elements.map(e => e.fractionalIndex);

    generateFractionalIndexBetween(elements, 'a', 'b');

    expect(elements.map(e => e.fractionalIndex)).toEqual(before);
    expect(elements.map(e => e.id)).toEqual(['a', 'b']);
  });

  // `generateKeyBetween` throws when `before >= after`. Passing the same id for
  // both neighbours is therefore a hard failure, not a degenerate key. Pinned
  // because the id-lookup form makes it reachable: the two ids come from a
  // drag-select and a concurrent delete can hand back one element twice.
  it('throws when both neighbours resolve to the same element', () => {
    const elements = [rect('only', { fractionalIndex: 'a0' })];

    expect(() => generateFractionalIndexBetween(elements, 'only', 'only')).toThrow();
  });
});

describe('generateFractionalIndexAfterAll / BeforeAll', () => {
  // Regression: "after all" means after the *highest* key in the scene, not merely
  // after one of them. A three-element scene is what makes the distinction
  // observable -- reading the wrong end of the sorted array produces a key that
  // sorts after the lowest element while still sorting before the highest, so a
  // two-element fixture would pass for a broken implementation.
  it('lands the new element after every existing one', () => {
    const lo = generateKeyBetween(null, null);
    const mid = generateKeyBetween(lo, null);
    const hi = generateKeyBetween(mid, null);
    const elements = [
      rect('mid', { fractionalIndex: mid }),
      rect('hi', { fractionalIndex: hi }),
      rect('lo', { fractionalIndex: lo }),
    ];

    const key = generateFractionalIndexAfterAll(elements);

    // Past the maximum, which is the only claim "after all" makes. The comparison
    // target carries its own key -- comparing against a bare `rect('hi')` would
    // compare against an element with *no* fractional index and pass for any key.
    expect(
      compareZOrder(rect('probe', { fractionalIndex: key }), rect('hi', { fractionalIndex: hi })) >
        0
    ).toBe(true);
  });

  it('lands the new element before every existing one', () => {
    const elements = [rect('b', { fractionalIndex: 'a1' }), rect('a', { fractionalIndex: 'a0' })];

    const key = generateFractionalIndexBeforeAll(elements);

    expect(compareZOrder(rect('probe', { fractionalIndex: key }), elements[1]!) < 0).toBe(true);
  });

  // Regression: both use the *last element of the sorted scene*, so an unsorted
  // input must not produce a key that lands in the middle. Asserted against the
  // sorted extremes rather than the input order, which is the whole point.
  it('reads the extreme of the sorted scene, not of the input order', () => {
    // Keys are built by walking `generateKeyBetween` rather than typed, so the
    // fixture stays valid under any `fractional-indexing` version.
    const lo = generateKeyBetween(null, null);
    const hi = generateKeyBetween(lo, null);
    const unsorted = [rect('hi', { fractionalIndex: hi }), rect('lo', { fractionalIndex: lo })];

    const afterKey = generateFractionalIndexAfterAll(unsorted);
    const beforeKey = generateFractionalIndexBeforeAll(unsorted);
    const highest = unsorted[0]!;
    const lowest = unsorted[1]!;

    expect(compareZOrder(rect('p', { fractionalIndex: afterKey }), highest) > 0).toBe(true);
    expect(compareZOrder(rect('p', { fractionalIndex: beforeKey }), lowest) < 0).toBe(true);
    // And the two keys are themselves ordered, which is what makes a reorder of
    // the whole scene expressible as two insertions.
    expect(
      compareZOrder(
        rect('p', { fractionalIndex: beforeKey }),
        rect('p', { fractionalIndex: afterKey })
      ) < 0
    ).toBe(true);
  });

  // Regression: the `?.fractionalIndex ?? null` halves. An element with no index
  // at all is a scene that has not been migrated, and the key must be computed
  // against an open end rather than against `undefined`.
  it('handles elements with no fractional index as an open end', () => {
    const elements = [rect('a'), rect('b')];

    expect(typeof generateFractionalIndexAfterAll(elements)).toBe('string');
    expect(typeof generateFractionalIndexBeforeAll(elements)).toBe('string');
    // Two calls over the same scene are deterministic.
    expect(generateFractionalIndexAfterAll(elements)).toBe(
      generateFractionalIndexAfterAll(elements)
    );
  });

  it('handles an empty scene', () => {
    expect(typeof generateFractionalIndexAfterAll([])).toBe('string');
    expect(typeof generateFractionalIndexBeforeAll([])).toBe('string');
  });
});

describe('sortedInsert', () => {
  // Regression: the `lo = mid + 1` half of the binary search -- the branch taken
  // when an existing element sorts *before* the new one. A search that only ever
  // returned `hi = mid` would place every new element at the front, which is a
  // scene whose z-order silently inverts with each insert.
  it('places a new element after the ones it sorts behind', () => {
    const elements = [
      rect('a', { fractionalIndex: 'a0' }),
      rect('b', { fractionalIndex: 'a1' }),
      rect('c', { fractionalIndex: 'a2' }),
    ];

    const next = sortedInsert(elements, rect('mid', { fractionalIndex: 'a1V' }));

    expect(next.map(e => e.id)).toEqual(['a', 'b', 'mid', 'c']);
  });

  it('places a new element before the ones it sorts ahead of', () => {
    const elements = [rect('b', { fractionalIndex: 'a1' }), rect('c', { fractionalIndex: 'a2' })];

    const next = sortedInsert(elements, rect('front', { fractionalIndex: 'a0V' }));

    expect(next.map(e => e.id)).toEqual(['front', 'b', 'c']);
  });

  // The invariant, over every insertion position: the result is sorted by the
  // same total order the store compares with, the length grew by one, and the
  // new element is present exactly once. Derived from the inputs rather than
  // asserted against a hand-written expected order, so it holds for any key
  // `fractional-indexing` produces.
  it('keeps the result sorted for every insertion position', () => {
    const elements = ['a0', 'a1', 'a2', 'a3'].map((key, i) =>
      rect(`e${i}`, { fractionalIndex: key })
    );
    const sorted = sortElementsByZIndex(elements);

    for (let slot = 0; slot <= sorted.length; slot++) {
      const existing = sortElementsByZIndex(sorted.slice(0, slot));
      const beforeKey = existing[existing.length - 1]?.fractionalIndex ?? null;
      const afterKey = sorted[slot]?.fractionalIndex ?? null;
      const inserted = rect(`new-${slot}`, {
        fractionalIndex: generateKeyBetween(beforeKey ?? null, afterKey ?? null),
      });

      const next = sortedInsert(sorted, inserted);

      expect(next).toHaveLength(sorted.length + 1);
      expect(next.filter(e => e.id === inserted.id)).toHaveLength(1);
      const resorted = sortElementsByZIndex(next);
      expect(resorted.map(e => e.id)).toEqual(next.map(e => e.id));
    }
  });

  // Regression: `sortedInsert` copies rather than mutating, because the store
  // hands the same array to subscribers and a caller's in-place splice would
  // change a scene that is already on screen.
  it('does not mutate the array it was given', () => {
    const elements = [rect('a', { fractionalIndex: 'a0' }), rect('b', { fractionalIndex: 'a1' })];
    const snapshot = elements.map(e => e.id);

    const next = sortedInsert(elements, rect('c', { fractionalIndex: 'a0V' }));

    expect(elements.map(e => e.id)).toEqual(snapshot);
    expect(next).not.toBe(elements);
  });

  it('appends when the scene is empty', () => {
    expect(sortedInsert([], rect('only')).map(e => e.id)).toEqual(['only']);
  });
});

describe('pushPast — count budget', () => {
  // Regression: the count limit. Undo entries are what make an edit reversible,
  // so dropping the oldest is the intended behaviour -- but dropping the *newest*
  // would make Ctrl+Z a no-op, which is the failure this pins.
  it('keeps the newest MAX_HISTORY snapshots when the count is exceeded', () => {
    const past = Array.from({ length: MAX_HISTORY }, (_, i) => [rect(`old-${i}`)]);
    const snapshot = [rect('newest')];

    const next = pushPast(past, snapshot);

    expect(next).toHaveLength(MAX_HISTORY);
    expect(next[next.length - 1]!.map(e => e.id)).toEqual(['newest']);
    // The oldest entries are the ones dropped.
    expect(next[0]!.map(e => e.id)).toEqual(['old-1']);
    expect(next.flat().some(e => e.id === 'old-0')).toBe(false);
  });

  it('does not trim at exactly the limit', () => {
    const past = Array.from({ length: MAX_HISTORY - 1 }, (_, i) => [rect(`s-${i}`)]);

    const next = pushPast(past, [rect('newest')]);

    expect(next).toHaveLength(MAX_HISTORY);
    expect(next[0]!.map(e => e.id)).toEqual(['s-0']);
  });

  // Regression: the stored snapshot is cloned, so a later in-place edit of the
  // live scene cannot rewrite history. Without the clone, undo restores whatever
  // the element looks like *now*.
  it('clones the snapshot it stores', () => {
    const element = rect('mutable');
    const snapshot = [element];

    const next = pushPast([], snapshot);
    element.x = 999;

    expect(next[0]![0]!.x).toBe(0);
  });

  it('does not mutate the past array it was given', () => {
    const past = [[rect('a')]];

    const next = pushPast(past, [rect('b')]);

    expect(past).toHaveLength(1);
    expect(next).toHaveLength(2);
  });
});

describe('pushPast — byte budget', () => {
  /**
   * A snapshot large enough that its estimated size alone exceeds the whole
   * budget.
   *
   * Derived from `MAX_HISTORY_BYTES` rather than hardcoded, because the
   * estimator is `length * 250` bytes per element -- an internal detail that
   * should not be restated as a literal here. One element past the budget's
   * capacity is the smallest fixture that trips the guard.
   */
  const oversized = () => {
    const perElement = MAX_HISTORY_BYTES / 250;
    return Array.from({ length: Math.ceil(perElement) + 1 }, (_, i) => rect(`big-${i}`));
  };

  // Regression: the byte guard. A scene big enough to blow the memory budget must
  // evict history rather than growing without bound -- and the eviction point is
  // the *first* snapshot whose cumulative size crossed the line, so everything
  // older than the offender goes and the offender itself stays.
  it('evicts every snapshot older than the one that crossed the budget', () => {
    const big = oversized();
    const past: DriplElement[][] = [[rect('ancient')], [rect('older')], big];

    const next = pushPast(past, [rect('newest')]);

    expect(next.flat().some(e => e.id === 'ancient')).toBe(false);
    expect(next.flat().some(e => e.id === 'older')).toBe(false);
    // The offending snapshot is the cut point, not the casualty: it is the first
    // entry the budget could not absorb, and dropping it instead would silently
    // discard the undo step that produced it.
    expect(next.flat().some(e => e.id === 'big-0')).toBe(true);
    expect(next.flat().some(e => e.id === 'newest')).toBe(true);
  });

  // The empty-snapshot edge: a snapshot with no elements contributes zero bytes,
  // so it can never be the cut point. If it were treated as over-budget the whole
  // history would be discarded on a single empty push.
  it('does not treat an empty snapshot as the cut point', () => {
    const past: DriplElement[][] = [[rect('ancient')], []];

    const next = pushPast(past, [rect('newest')]);

    expect(next.flat().some(e => e.id === 'ancient')).toBe(true);
    expect(next).toHaveLength(3);
  });

  it('leaves an under-budget history untouched', () => {
    const past: DriplElement[][] = [[rect('a')], [rect('b')]];

    const next = pushPast(past, [rect('c')]);

    expect(next.map(s => s.map(e => e.id))).toEqual([['a'], ['b'], ['c']]);
  });

  // Regression: the count limit runs first. A history that is over the count but
  // under the byte budget must be trimmed by count, so the byte walk is not even
  // reached -- which is why the result here is exactly MAX_HISTORY long.
  it('applies the count limit before the byte budget', () => {
    const past = Array.from({ length: MAX_HISTORY }, (_, i) => [rect(`s-${i}`)]);

    const next = pushPast(past, [rect('newest')]);

    expect(next).toHaveLength(MAX_HISTORY);
  });
});

describe('cloneElements', () => {
  it('produces a deep copy that shares nothing with the input', () => {
    const original = [rect('a')];
    const copy = cloneElements(original);

    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    expect(copy[0]).not.toBe(original[0]);
  });
});

describe('buildElementsById', () => {
  it('maps every element by its id', () => {
    const elements = [rect('a'), rect('b')];

    const map = buildElementsById(elements);

    expect([...map.keys()]).toEqual(['a', 'b']);
    expect(map.get('a')).toBe(elements[0]);
  });

  // Regression: the id is the map key, so a scene whose elements carry no `id`
  // must not silently collapse into one entry. Last write wins is the observable
  // consequence, and it is why `id` is schema-required.
  it('keeps one entry per distinct id', () => {
    const elements = [rect('dup', { x: 1 }), rect('dup', { x: 2 })];

    const map = buildElementsById(elements);

    expect(map.size).toBe(1);
    expect(map.get('dup')?.x).toBe(2);
  });

  it('is empty for an empty scene', () => {
    expect(buildElementsById([]).size).toBe(0);
  });
});

describe('ensureFractionalIndexes', () => {
  it('leaves an already-indexed scene untouched, by identity', () => {
    const elements = [rect('a', { fractionalIndex: 'a0' }), rect('b', { fractionalIndex: 'a1' })];

    expect(ensureFractionalIndexes(elements)).toBe(elements);
  });

  it('fills in a missing index and preserves z-order', () => {
    const elements = [rect('b', { fractionalIndex: 'a1' }), rect('a')];

    const out = ensureFractionalIndexes(elements);

    expect(out.every(e => typeof e.fractionalIndex === 'string')).toBe(true);
    expect(sortElementsByZIndex(out).map(e => e.id)).toEqual(['a', 'b']);
  });

  it('keeps existing indexes and only fills the gaps', () => {
    const elements = [rect('a', { fractionalIndex: 'a0' }), rect('b')];

    const out = ensureFractionalIndexes(elements);

    expect(out.find(e => e.id === 'a')?.fractionalIndex).toBe('a0');
    expect(out.find(e => e.id === 'b')?.fractionalIndex).toBeTruthy();
  });
});

describe('withHistoryBeforeMutation', () => {
  // Regression: `future: []`. A new mutation after an undo has to discard the
  // redo stack -- keeping it would let a user undo forward into a branch that no
  // longer follows from the scene they are looking at.
  it('pushes the present and clears the future', () => {
    const current = [rect('current')];

    const history = withHistoryBeforeMutation(
      { past: [[rect('past')]], future: [[rect('future')]] },
      current
    );

    expect(history.future).toEqual([]);
    expect(history.past).toHaveLength(2);
    expect(history.past[1]!.map(e => e.id)).toEqual(['current']);
  });

  it('does not alias the future array it replaced', () => {
    const future: DriplElement[][] = [[rect('future')]];

    const history = withHistoryBeforeMutation({ past: [], future }, []);

    expect(history.future).not.toBe(future);
  });
});

describe('commitPresentFromHistory', () => {
  it('copies both stacks rather than aliasing them', () => {
    const past: DriplElement[][] = [[rect('a')]];
    const future: DriplElement[][] = [[rect('b')]];

    const out = commitPresentFromHistory(past, future);

    expect(out.past).toEqual(past);
    expect(out.future).toEqual(future);
    expect(out.past).not.toBe(past);
    expect(out.future).not.toBe(future);
  });

  it('preserves the entries rather than deep-copying the snapshots', () => {
    // Shallow on purpose: this runs on every mutation, and the snapshots are
    // already clones taken by `pushPast`. Deep-copying here would double the
    // history's memory for no additional isolation.
    const snapshot = [rect('a')];
    const past: DriplElement[][] = [snapshot];

    const out = commitPresentFromHistory(past, []);

    expect(out.past[0]).toBe(snapshot);
  });
});
