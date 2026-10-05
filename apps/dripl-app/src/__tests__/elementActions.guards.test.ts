import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import type { DriplElement, LinearElement, TextElement } from '@dripl/common';
import { updateArrowLabelPosition } from '@/utils/textBindingUtils';
import { recalculateBinding } from '@/utils/arrow-routing';

/**
 * The early-return and no-op guards in `lib/store/elementActions.ts`, plus the arrow
 * label repositioning that `updateElement` does as a side effect.
 *
 * These guards are the ones that decide whether a mutation reaches history at all. Each
 * is asserted on its *effect* — the history stack, the array identity, and the spatial
 * revision — rather than on "nothing threw", because a guard that fails open still
 * returns normally and only differs in what it recorded.
 *
 * `updateElement`'s label block is the other half: it is the only place that writes a
 * second scene element from inside a single-element update, and the comment in the source
 * records a past duplicate-label bug there. The tests below assert single-occupancy and
 * both array/map representations agree.
 */

const rect = (id: string, extra: Partial<DriplElement> = {}): DriplElement =>
  ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    version: 1,
    versionNonce: 1,
    ...extra,
  }) as DriplElement;

const text = (id: string, extra: Partial<TextElement> = {}): TextElement =>
  ({
    id,
    type: 'text',
    x: 0,
    y: 0,
    width: 40,
    height: 20,
    text: 'label',
    fontSize: 20,
    fontFamily: 'sans-serif',
    version: 1,
    versionNonce: 1,
    ...extra,
  }) as TextElement;

const arrow = (id: string, extra: Partial<LinearElement> = {}): LinearElement =>
  ({
    id,
    type: 'arrow',
    x: 200,
    y: 0,
    width: 100,
    height: 0,
    version: 1,
    versionNonce: 1,
    points: [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ],
    ...extra,
  }) as LinearElement;

const state = () => useCanvasStore.getState();

/** Reset to an empty scene, then seed without touching the history stack. */
function seed(elements: DriplElement[], over: Partial<ReturnType<typeof state>> = {}): void {
  useCanvasStore.setState({
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set(),
    past: [],
    future: [],
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
    ...over,
  });
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
  useCanvasStore.setState({ past: [], future: [], spatialVersion: 0 });
}

/** A snapshot of everything a guard could plausibly have touched. */
function fingerprint() {
  const s = state();
  return {
    elements: s.elements,
    ids: s.elements.map(e => e.id),
    versions: s.elements.map(e => e.version ?? 0),
    past: s.past,
    future: s.future,
    spatialVersion: s.spatialVersion,
    spatialChangedIds: s.spatialChangedIds,
  };
}

beforeEach(() => {
  seed([rect('a')]);
});

describe('addElement — refuses a duplicate id', () => {
  it('leaves the scene, the history stack and the spatial revision untouched', () => {
    seed([rect('a', { version: 7 })]);
    const before = fingerprint();

    state().addElement(rect('a', { x: 999 }));

    const after = fingerprint();
    expect(after.elements).toBe(before.elements);
    expect(after.ids).toEqual(['a']);
    expect(after.versions).toEqual([7]);
    expect(after.past).toHaveLength(0);
    expect(after.spatialVersion).toBe(before.spatialVersion);
  });

  it('really is keyed on id, not on content: a different element with the same id is refused', () => {
    seed([rect('a')]);
    state().addElement(rect('a', { x: 500, width: 42 }));
    expect(state().elements).toHaveLength(1);
    expect(state().elements[0]?.x).toBe(0);
  });
});

describe('addElements — refuses an empty or wholly-duplicate batch', () => {
  it('does nothing for an empty array', () => {
    seed([rect('a')]);
    const before = fingerprint();

    state().addElements([]);

    const after = fingerprint();
    expect(after.elements).toBe(before.elements);
    expect(after.past).toHaveLength(0);
    expect(after.spatialVersion).toBe(before.spatialVersion);
  });

  it('does nothing when every id is already present', () => {
    seed([rect('a', { version: 3 }), rect('b', { version: 4 })]);
    const before = fingerprint();

    state().addElements([rect('a', { x: 10 }), rect('b', { x: 20 })]);

    const after = fingerprint();
    expect(after.elements).toBe(before.elements);
    expect(after.versions).toEqual([3, 4]);
    expect(after.past).toHaveLength(0);
  });

  it('still adds the fresh ids from a partially duplicate batch', () => {
    seed([rect('a')]);
    state().addElements([rect('a', { x: 10 }), rect('b', { x: 20 })]);
    const after = state();
    expect(after.elements.map(e => e.id)).toEqual(['a', 'b']);
    // The duplicate must be dropped entirely, not merged over the original.
    expect(after.elementsById.get('a')?.x).toBe(0);
    expect(after.past).toHaveLength(1);
  });
});

describe('updateElement — refuses an unknown id', () => {
  it('records no history and no new element', () => {
    seed([rect('a')]);
    const before = fingerprint();

    state().updateElement('ghost', { x: 50 });

    const after = fingerprint();
    expect(after.elements).toBe(before.elements);
    expect(after.past).toHaveLength(0);
    expect(after.spatialVersion).toBe(before.spatialVersion);
  });
});

describe('updateElement — arrow label repositioning', () => {
  const withLabel = () => {
    seed([arrow('a', { labelId: 'label' }), text('label', { x: 5000, y: 5000 })]);
  };

  it('moves the label to the new midpoint and keeps exactly one copy of it', () => {
    withLabel();
    const before = state();
    const labelBefore = before.elementsById.get('label') as TextElement;

    state().updateElement('a', {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 40 },
      ],
    });

    const after = state();
    const updated = after.elementsById.get('a') as LinearElement;
    const labelAfter = after.elementsById.get('label') as TextElement;
    const expected = updateArrowLabelPosition(updated, labelBefore);
    expect(labelAfter.x).toBeCloseTo(expected.x, 10);
    expect(labelAfter.y).toBeCloseTo(expected.y, 10);
    // The regression this block exists for: the label must be replaced in place, never
    // appended. Asserted on the array, not on `elementsById`, because a duplicate in the
    // array with a single map entry is exactly the shape the old bug produced.
    expect(after.elements.filter(e => e.id === 'label')).toHaveLength(1);
    // Both representations must agree, since the map is the id lookup the renderer uses.
    const fromArray = after.elements.find(e => e.id === 'label');
    expect(fromArray).toBe(labelAfter);
    expect(after.past).toHaveLength(1);
  });

  it('bumps the label version so its own change is not silently lost to LWW merge', () => {
    withLabel();
    const before = state().elementsById.get('label') as TextElement;
    state().updateElement('a', {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 40 },
      ],
    });
    const after = state().elementsById.get('label') as TextElement;
    expect(after.version ?? 0).toBe((before.version ?? 0) + 1);
  });

  it('leaves the label alone when the update did not touch points', () => {
    withLabel();
    const before = fingerprint();

    // Only the arrow origin moves. The label follows the *points*, which did not change,
    // so a label reposition here would be wrong: it would jump while the arrow did not.
    state().updateElement('a', { x: 400 });

    const after = state();
    expect(after.elementsById.get('a')?.x).toBe(400);
    const label = after.elementsById.get('label') as TextElement;
    expect([label.x, label.y]).toEqual([5000, 5000]);
    expect(after.elements).not.toBe(before.elements);
  });

  it('leaves the label alone when it is already at the arrow midpoint', () => {
    // `updateArrowLabelPosition` returns its argument unchanged when the arrow has fewer
    // than two points, and the block must then write nothing at all: the label's version
    // must not be bumped for a repositioning that did not happen.
    seed([arrow('a', { labelId: 'label', points: [{ x: 0, y: 0 }] }), text('label')]);
    const before = state().elementsById.get('label') as TextElement;

    state().updateElement('a', { points: [{ x: 0, y: 0 }] });

    const after = state().elementsById.get('label') as TextElement;
    expect(after.version).toBe(before.version);
    expect([after.x, after.y]).toEqual([before.x, before.y]);
  });

  it('writes the label into the array when the map held it but the array did not', () => {
    // Defensive branch: `elementsById` is derived from `elements` on every public path, so
    // an id present in one and absent from the other cannot be produced through the store's
    // own actions. Seeding the inconsistency directly is the only way to reach the append,
    // and it is worth reaching: it asserts the label is not dropped on the floor there.
    const label = text('label');
    seed([arrow('a', { labelId: 'label' })]);
    useCanvasStore.setState({
      elementsById: new Map([
        ['a', state().elementsById.get('a')!],
        ['label', label],
      ]),
    });

    state().updateElement('a', {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 40 },
      ],
    });

    const after = state();
    expect(after.elements.filter(e => e.id === 'label')).toHaveLength(1);
    expect(after.elementsById.get('label')?.x).not.toBe(label.x);
  });

  it('does nothing when the labelId names an id that is not in the scene', () => {
    seed([arrow('a', { labelId: 'ghost' })]);
    const before = fingerprint();

    state().updateElement('a', {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 40 },
      ],
    });

    const after = fingerprint();
    expect(after.ids).toEqual(['a']);
    expect(after.versions).toEqual([2]);
    expect(after.past).toHaveLength(1);
    expect(after.elements).not.toBe(before.elements);
  });

  it('ignores a line carrying a labelId, since the block names the arrow type', () => {
    const line = { ...arrow('l', { labelId: 'label' }), type: 'line' as const } as LinearElement;
    seed([line, text('label', { x: 5000, y: 5000 })]);

    state().updateElement('l', {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 40 },
      ],
    });

    const label = state().elementsById.get('label') as TextElement;
    expect([label.x, label.y]).toEqual([5000, 5000]);
  });
});

describe('updateElementTransient — refusals', () => {
  it('ignores an unknown id without touching history or the spatial hint', () => {
    seed([rect('a')]);
    const before = fingerprint();

    state().updateElementTransient('ghost', { x: 5 });

    const after = fingerprint();
    expect(after.elements).toBe(before.elements);
    expect(after.spatialChangedIds).toEqual([]);
    expect(after.past).toHaveLength(0);
    expect(after.spatialVersion).toBe(before.spatialVersion);
  });

  it('ignores an update that changes nothing, leaving the array identity intact', () => {
    seed([rect('a', { x: 12 })]);
    const before = fingerprint();

    state().updateElementTransient('a', { x: 12 });

    const after = fingerprint();
    expect(after.elements).toBe(before.elements);
    expect(after.versions).toEqual([1]);
    expect(after.spatialChangedIds).toEqual([]);
    expect(after.spatialVersion).toBe(before.spatialVersion);
  });
});

describe('updateElementsTransient — per-entry skips and the all-skipped bail', () => {
  it('skips unknown ids and unchanged values, and still applies the rest', () => {
    seed([rect('a', { x: 0 }), rect('b', { x: 100 }), rect('c', { x: 200 })]);
    const before = fingerprint();

    state().updateElementsTransient(
      new Map([
        ['ghost', { x: 1 }],
        ['b', { x: 100 }],
        ['c', { x: 300 }],
      ])
    );

    const after = state();
    expect(after.elements.map(e => e.x)).toEqual([0, 100, 300]);
    // One revision for the whole batch, not one per applied entry.
    expect(after.spatialVersion).toBe(before.spatialVersion + 1);
    // The hint is built from `updates.keys()`, not from the ids actually written, so it
    // names every id in the batch -- including the ghost and the no-op. That is
    // over-inclusive rather than wrong: the spatial index re-keys by id, so a hint for an
    // unchanged element costs a re-key, not a correctness problem. Recorded as observed, so
    // a future narrowing of the hint does not read as a regression here.
    expect([...after.spatialChangedIds].sort()).toEqual(['b', 'c', 'ghost']);
    expect(after.past).toHaveLength(0);
  });

  it('bails without a revision when every entry is skipped', () => {
    seed([rect('a', { x: 5 })]);
    const before = fingerprint();

    state().updateElementsTransient(
      new Map([
        ['ghost', { x: 1 }],
        ['a', { x: 5 }],
      ])
    );

    const after = fingerprint();
    expect(after.elements).toBe(before.elements);
    expect(after.spatialVersion).toBe(before.spatialVersion);
    expect(after.spatialChangedIds).toEqual([]);
  });

  it('skips an id the map knows but the array does not', () => {
    // The `index === undefined` half of the guard. `indexById` is built from the array
    // while `previous` comes from the map, so the two can disagree only when the
    // representations have drifted — which no store action does, but which `setState` can
    // produce. Without the guard, `nextElements[undefined] = updated` writes a string
    // property onto the array and leaves a hole: the element then exists in the map, is
    // absent from the array, and `spatialChangedIds` names it. Asserted on both halves.
    seed([rect('a')]);
    useCanvasStore.setState({
      elementsById: new Map([
        ['a', state().elementsById.get('a')!],
        ['ghost', rect('ghost')],
      ]),
    });

    state().updateElementsTransient(new Map([['ghost', { x: 42 }]]));

    const after = state();
    expect(after.elements.map(e => e.id)).toEqual(['a']);
    expect(after.spatialVersion).toBe(0);
    expect(after.spatialChangedIds).toEqual([]);
    expect(after.elementsById.get('ghost')?.x).toBe(0);
  });

  it('bails on an empty batch', () => {
    const before = fingerprint();
    state().updateElementsTransient(new Map());
    const after = fingerprint();
    expect(after.elements).toBe(before.elements);
    expect(after.spatialVersion).toBe(before.spatialVersion);
  });
});

describe('translateElements — a bound update that recomputes to no change', () => {
  /**
   * Moving a shape and the arrow bound to it by the *same* delta leaves the arrow's
   * relative endpoint unchanged: the binding point moves with the shape and the arrow
   * origin moves with the arrow, so `recalculateBinding(...) - el.x` is the same number
   * as the point already stored. The binding pass still produces an entry, and
   * `mutateElement`'s no-op guard then returns the previous element.
   *
   * Reachable without hand-seeding: translate both ids together.
   */
  /**
   * A shape at the origin with `focus: 0.5` binds to the bottom edge, whose point is
   * `(shape.x, shape.y + shape.height)` — the bottom-left corner. With the arrow origin at
   * `(100, 0)` that is a relative point of `(-100, 60)`, which is the `points[0]` the
   * fixture starts from: the arrow is already glued, so nothing recomputes to a *new*
   * value in the first test.
   */
  const anchored = { x: 0, y: 0 } as const;
  const shapeEl = () =>
    rect('shape', {
      ...anchored,
      width: 100,
      height: 60,
      boundElements: [{ id: 'arrow-1', type: 'arrow' }],
    });
  const arrowEl = (extra: Partial<LinearElement> = {}) =>
    arrow('arrow-1', {
      x: 100,
      y: 0,
      points: [
        { x: -100, y: 60 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ],
      startBinding: { elementId: 'shape', fixedPoint: { x: 0.5, y: 0 }, mode: 'inside' },
      ...extra,
    });

  it('does not bump the arrow a second time when its recomputed points are unchanged', () => {
    seed([shapeEl(), arrowEl()]);
    state().translateElements(['shape', 'arrow-1'], 10, 0);

    const moved = state().elementsById.get('arrow-1') as LinearElement;
    // The arrow was translated (one version bump from the move itself) and its binding
    // then recomputed to the same relative point. A second bump would mean the binding
    // pass published a change that does not exist to every collaborator in the room.
    expect(moved.version).toBe(2);
    expect(moved.x).toBe(110);
    // The endpoint really is unchanged, so this test is not passing because the binding
    // pass declined to run at all.
    const recomputed = recalculateBinding(
      { elementId: 'shape', focus: 0.5 },
      state().elementsById.get('shape')!
    );
    expect(recomputed.x - moved.x).toBeCloseTo(moved.points[0]!.x, 10);
    expect(state().past).toHaveLength(1);
  });

  it('still bumps once more when the endpoint really does change', () => {
    // The counterpart to the test above: moving the shape alone changes the relative
    // endpoint, so the arrow must be written. Without this pair the previous test would
    // also pass for an implementation that never recomputes anything.
    seed([shapeEl(), arrowEl()]);

    state().translateElements(['shape'], 10, 0);

    const moved = state().elementsById.get('arrow-1') as LinearElement;
    expect(moved.version).toBe(2);
    expect(moved.points[0]!.x).toBeCloseTo(-90, 10);
  });
});

describe('deleteElements — refusals', () => {
  it('does nothing for an empty id list', () => {
    seed([rect('a')]);
    const before = fingerprint();

    state().deleteElements([]);

    const after = fingerprint();
    expect(after.elements).toBe(before.elements);
    expect(after.past).toHaveLength(0);
    expect(after.spatialVersion).toBe(before.spatialVersion);
  });

  it('does nothing when no id is actually present, even after unbinding ran', () => {
    // The unbind passes rewrite bound arrows before the length check, so this exercises
    // "the unbind was a no-op" rather than "the code returns early". If the length check
    // were removed, the arrow would survive but the call would still push history.
    seed([
      arrow('a', { startBinding: { elementId: 'b', fixedPoint: { x: 0, y: 0 }, mode: 'inside' } }),
      rect('b'),
    ]);
    const before = fingerprint();

    state().deleteElements(['ghost']);

    const after = fingerprint();
    expect(after.elements).toBe(before.elements);
    expect(after.past).toHaveLength(0);
    expect(after.spatialVersion).toBe(before.spatialVersion);
  });
});
