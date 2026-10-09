import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import {
  buildBoundArrowsByShape,
  resolveGestureUpdates,
  updateBoundArrows,
  updateBoundLabels,
} from '@/lib/canvas/binding-sync';

const rect = (id: string, extra: Partial<DriplElement> = {}): DriplElement =>
  ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    version: 1,
    versionNonce: 1,
    ...extra,
  }) as DriplElement;

const arrow = (id: string, extra: Partial<DriplElement> = {}): DriplElement =>
  ({
    id,
    type: 'arrow',
    x: 100,
    y: 0,
    width: 60,
    height: 10,
    version: 1,
    versionNonce: 1,
    points: [
      { x: 0, y: 5 },
      { x: 60, y: 5 },
    ],
    ...extra,
  }) as DriplElement;

describe('buildBoundArrowsByShape', () => {
  it('indexes arrows bound to a shape, ignoring text bindings', () => {
    const shape = rect('shape', {
      boundElements: [
        { id: 'arrow-1', type: 'arrow' },
        { id: 'label-1', type: 'text' },
      ],
    });
    const index = buildBoundArrowsByShape([shape, arrow('arrow-1')]);
    expect(index.get('shape')).toEqual(new Set(['arrow-1']));
  });

  it('returns an empty index when nothing is bound', () => {
    expect(buildBoundArrowsByShape([rect('a'), arrow('b')]).size).toBe(0);
  });
});

describe('updateBoundArrows', () => {
  it('is a no-op when no moved id has bound arrows', () => {
    const shape = rect('shape');
    const byId = new Map([
      ['shape', shape],
      ['arrow-1', arrow('arrow-1')],
    ]);
    const updates = new Map<string, Partial<DriplElement>>();
    updateBoundArrows(new Set(['unrelated']), byId, new Map(), updates);
    expect(updates.size).toBe(0);
  });

  it('recomputes the bound endpoint when its target moves', () => {
    const shape = rect('shape', { x: 10, y: 10 });
    const bound = arrow('arrow-1', {
      startBinding: { elementId: 'shape', fixedPoint: { x: 0.5, y: 0 }, mode: 'inside' },
    });
    const byId = new Map([
      ['shape', shape],
      ['arrow-1', bound],
    ]);
    const index = new Map([['shape', new Set(['arrow-1'])]]);
    const updates = new Map<string, Partial<DriplElement>>();
    updateBoundArrows(new Set(['shape']), byId, index, updates);
    const updated = updates.get('arrow-1');
    expect(updated).toBeDefined();
    const points = (updated as DriplElement & { points: Array<{ x: number; y: number }> }).points;
    // Start endpoint re-anchored relative to the arrow origin; end untouched.
    expect(points[0]).not.toEqual({ x: 0, y: 5 });
    expect(points[1]).toEqual({ x: 60, y: 5 });
  });

  it('skips arrows whose binding target did not move', () => {
    const shape = rect('shape');
    const other = rect('other');
    const bound = arrow('arrow-1', {
      startBinding: { elementId: 'other', fixedPoint: { x: 0.5, y: 0 }, mode: 'inside' },
    });
    const byId = new Map([
      ['shape', shape],
      ['other', other],
      ['arrow-1', bound],
    ]);
    const index = new Map([['other', new Set(['arrow-1'])]]);
    const updates = new Map<string, Partial<DriplElement>>();
    updateBoundArrows(new Set(['shape']), byId, index, updates);
    expect(updates.size).toBe(0);
  });
});

describe('updateBoundLabels', () => {
  it('tracks arrow labels via bound text entries', () => {
    const label = {
      id: 'label-1',
      type: 'text',
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      text: 'hi',
      fontSize: 20,
    } as unknown as DriplElement;
    const owner = arrow('owner', {
      boundElements: [{ id: 'label-1', type: 'text' }],
    });
    const byId = new Map([
      ['owner', owner],
      ['label-1', label],
    ]);
    const updates = new Map<string, Partial<DriplElement>>();
    updateBoundLabels(new Set(['owner']), byId, updates);
    const updated = updates.get('label-1') as unknown as { x: number; y: number };
    expect(updated).toBeDefined();
    // Arrow midpoint (130,5), label 40×20 centered on it → (110,-5).
    expect(updated.x).toBeCloseTo(110, 10);
    expect(updated.y).toBeCloseTo(-5, 10);
  });

  it('is a no-op for owners without labels', () => {
    const byId = new Map([['owner', rect('owner')]]);
    const updates = new Map<string, Partial<DriplElement>>();
    updateBoundLabels(new Set(['owner']), byId, updates);
    expect(updates.size).toBe(0);
  });
});

describe('resolveGestureUpdates', () => {
  function boundShape(): DriplElement {
    return rect('shape', {
      x: 10,
      y: 10,
      labelId: 'label-1',
      boundElements: [{ id: 'arrow-1', type: 'arrow' }],
    });
  }

  function boundArrow(): DriplElement {
    return arrow('arrow-1', {
      startBinding: { elementId: 'shape', fixedPoint: { x: 0.5, y: 0 }, mode: 'inside' },
    });
  }

  function textLabel(): DriplElement {
    return {
      id: 'label-1',
      type: 'text',
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      text: 'hi',
      fontSize: 20,
    } as unknown as DriplElement;
  }

  function index(): Map<string, Set<string>> {
    return new Map([['shape', new Set(['arrow-1'])]]);
  }

  type Point = { x: number; y: number };
  const pointsOf = (value: Partial<DriplElement> | undefined): Point[] =>
    (value as unknown as { points: Point[] }).points;

  it('folds the arrow follow-up into the primary commit', () => {
    const shape = boundShape();
    const bound = boundArrow();
    const byId = new Map<string, DriplElement>([
      ['shape', shape],
      ['arrow-1', bound],
      ['label-1', textLabel()],
    ]);
    const moved = { ...shape, x: 30 };

    const merged = resolveGestureUpdates(byId, new Map([['shape', moved]]), index());

    // Primary entry keeps its identity rather than a copy; the arrow follows.
    expect(merged.get('shape')).toBe(moved);
    const mergedPoints = pointsOf(merged.get('arrow-1'));
    expect(mergedPoints[0]).not.toEqual({ x: 0, y: 5 });
    expect(mergedPoints[1]).toEqual({ x: 60, y: 5 });
  });

  it('keeps primary geometry when an element is both moved and bound-followed', () => {
    const shape = boundShape();
    const bound = boundArrow();
    const byId = new Map<string, DriplElement>([
      ['shape', shape],
      ['arrow-1', bound],
      ['label-1', textLabel()],
    ]);
    const movedShape = { ...shape, x: 30 };
    const movedArrow = { ...bound, x: 130 };

    const merged = resolveGestureUpdates(
      byId,
      new Map([
        ['shape', movedShape],
        ['arrow-1', movedArrow],
      ]),
      index()
    );

    // Spread order is follow-up over primary: the moved x survives while the
    // points are the recomputed ones, not the primary's stale copy.
    const mergedArrow = merged.get('arrow-1');
    expect(mergedArrow).toMatchObject({ x: 130 });
    expect(pointsOf(mergedArrow)[0]).not.toEqual({ x: 0, y: 5 });
  });

  it('repositions labels in the same commit', () => {
    const shape = boundShape();
    const byId = new Map<string, DriplElement>([
      ['shape', shape],
      ['arrow-1', boundArrow()],
      ['label-1', textLabel()],
    ]);
    const moved = { ...shape, x: 30 };

    const merged = resolveGestureUpdates(byId, new Map([['shape', moved]]), new Map(), {
      includeBoundArrows: false,
    });

    // Moved shape spans x 30..130: the label centres on x 80 with the
    // container width minus padding. y depends on font metrics, so only x is
    // pinned here.
    expect(merged.get('label-1')).toMatchObject({ x: 80, width: 90 });
  });

  it('skips arrows but keeps labels in labels-only mode', () => {
    const shape = boundShape();
    const byId = new Map<string, DriplElement>([
      ['shape', shape],
      ['arrow-1', boundArrow()],
      ['label-1', textLabel()],
    ]);
    const moved = { ...shape, x: 30 };

    const merged = resolveGestureUpdates(byId, new Map([['shape', moved]]), index(), {
      includeBoundArrows: false,
    });

    // The rotate path this mode serves has only ever repositioned labels;
    // rebinding endpoints would be a behavior change of its own.
    expect(merged.has('arrow-1')).toBe(false);
    expect(merged.has('label-1')).toBe(true);
  });

  it('returns the primary map alone when nothing follows', () => {
    const shape = rect('shape');
    const byId = new Map<string, DriplElement>([['shape', shape]]);
    const moved = { ...shape, x: 5 };

    const merged = resolveGestureUpdates(byId, new Map([['shape', moved]]), new Map());

    expect(merged.size).toBe(1);
    expect(merged.get('shape')).toBe(moved);
  });

  it('returns empty for empty primary and never mutates its inputs', () => {
    const shape = boundShape();
    const byId = new Map<string, DriplElement>([
      ['shape', shape],
      ['arrow-1', boundArrow()],
    ]);
    const primary = new Map<string, Partial<DriplElement>>();

    expect(resolveGestureUpdates(byId, primary, index()).size).toBe(0);
    expect(byId.get('shape')).toBe(shape);
    expect(byId.size).toBe(2);
    expect(primary.size).toBe(0);
  });
});
