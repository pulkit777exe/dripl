import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriplElement, LinearElement, TextElement } from '@dripl/common';
import {
  buildBoundArrowsByShape,
  updateBoundArrows,
  updateBoundLabels,
} from '@/lib/canvas/binding-sync';
import { recalculateBinding } from '@/utils/arrow-routing';
import { updateArrowLabelPosition, updateBoundTextPosition } from '@/utils/textBindingUtils';
import { createRecordingContext } from './helpers/canvas-recorder';

/**
 * The two binding-sync halves that `binding-sync.test.ts` does not reach: the arrow
 * *end* anchor (it only ever moved a start anchor), and the label paths that are driven
 * by `labelId` or that must refuse a non-text / missing label.
 *
 * Every expected coordinate is recomputed with the same production helper the module
 * uses (`recalculateBinding` / `updateArrowLabelPosition`) rather than transcribed from
 * the implementation's arithmetic. A test that hardcodes the number would agree with any
 * mutant that keeps the old number; recomputing from the shared helper means the
 * assertion is about *where the arrow is anchored*, which is the invariant that matters,
 * and it still fails if the module stops relativising the point to the arrow origin.
 */

/** `focus` splits the perimeter into four edge bands; 0 is top-left, 1 is bottom-left. */
const TOP_LEFT = { x: 0, y: 0 };
const BOTTOM_RIGHT = { x: 1, y: 0 };

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

const arrow = (id: string, extra: Partial<LinearElement> = {}): LinearElement =>
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
  }) as LinearElement;

const text = (id: string, extra: Partial<TextElement> = {}): TextElement =>
  ({
    id,
    type: 'text',
    x: 0,
    y: 0,
    width: 40,
    height: 20,
    text: 'hi',
    fontSize: 20,
    fontFamily: 'sans-serif',
    version: 1,
    versionNonce: 1,
    ...extra,
  }) as TextElement;

const pointsOf = (partial: Partial<DriplElement> | undefined): Array<{ x: number; y: number }> =>
  (partial as { points: Array<{ x: number; y: number }> }).points;

/**
 * An `updates` map that counts `set` calls per key.
 *
 * Dedupe claims ("this arrow is indexed by two shapes, but is written once") are
 * invisible in a plain `Map`: the second write overwrites the first, so `size` and the
 * stored value are identical whether the guard held or not. Counting the writes is the
 * only way to tell a `Set` of ids from an array of ids here.
 */
class CountingUpdates extends Map<string, Partial<DriplElement>> {
  writes = new Map<string, number>();

  override set(key: string, value: Partial<DriplElement>): this {
    this.writes.set(key, (this.writes.get(key) ?? 0) + 1);
    return super.set(key, value);
  }
}

/**
 * `updateBoundTextPosition` measures text through a canvas context, and jsdom has no
 * 2D context: `getContext` returns null, `measureText` degrades to width 0, and the
 * label's height collapses to 0. That would make the container-label assertions below
 * pass for any implementation that centres on `bounds.x + width / 2` regardless of the
 * text. A recording context with a known 10px-per-character table restores real metrics.
 */
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    createRecordingContext({ defaultCharWidth: 10 }).ctx
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('updateBoundArrows — the end anchor', () => {
  it('moves only the last point, and only when the end binding target moved', () => {
    const shape = rect('shape', { x: 10, y: 20 });
    const bound = arrow('arrow-1', {
      endBinding: { elementId: 'shape', fixedPoint: BOTTOM_RIGHT, mode: 'inside' },
    });
    const byId = new Map<string, DriplElement>([
      ['shape', shape],
      ['arrow-1', bound],
    ]);
    const index = new Map([['shape', new Set(['arrow-1'])]]);
    const updates = new Map<string, Partial<DriplElement>>();

    updateBoundArrows(new Set(['shape']), byId, index, updates);

    const points = pointsOf(updates.get('arrow-1'));
    // The end point is the binding on the shape's bounds, expressed relative to the
    // arrow's own origin -- that is the whole contract of this function.
    const expected = recalculateBinding({ elementId: 'shape', focus: BOTTOM_RIGHT.x }, shape);
    expect(points[points.length - 1]).toEqual({
      x: expected.x - bound.x,
      y: expected.y - bound.y,
    });
    // The start point is untouched: only the end binding named a moved element.
    expect(points[0]).toEqual({ x: 0, y: 5 });
  });

  it('moves the last point of a polyline, not the second point', () => {
    // Three points make `points[1]` and `points[-1]` different objects. If the module
    // indexed the second point instead of the last, a single-point assertion would pass.
    const shape = rect('shape', { x: 0, y: 40 });
    const bound = arrow('arrow-1', {
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 60, y: 0 },
      ],
      endBinding: { elementId: 'shape', fixedPoint: BOTTOM_RIGHT, mode: 'inside' },
    });
    const byId = new Map<string, DriplElement>([
      ['shape', shape],
      ['arrow-1', bound],
    ]);
    const index = new Map([['shape', new Set(['arrow-1'])]]);
    const updates = new Map<string, Partial<DriplElement>>();

    updateBoundArrows(new Set(['shape']), byId, index, updates);

    const points = pointsOf(updates.get('arrow-1'));
    expect(points).toHaveLength(3);
    expect(points[1]).toEqual({ x: 30, y: 0 });
    const expected = recalculateBinding({ elementId: 'shape', focus: BOTTOM_RIGHT.x }, shape);
    expect(points[2]).toEqual({ x: expected.x - bound.x, y: expected.y - bound.y });
  });

  it('moves both ends when both bindings name the same moved shape', () => {
    const shape = rect('shape', { x: 5, y: 5 });
    const bound = arrow('arrow-1', {
      startBinding: { elementId: 'shape', fixedPoint: TOP_LEFT, mode: 'inside' },
      endBinding: { elementId: 'shape', fixedPoint: BOTTOM_RIGHT, mode: 'inside' },
    });
    const byId = new Map<string, DriplElement>([
      ['shape', shape],
      ['arrow-1', bound],
    ]);
    const index = new Map([['shape', new Set(['arrow-1'])]]);
    const updates = new Map<string, Partial<DriplElement>>();

    updateBoundArrows(new Set(['shape']), byId, index, updates);

    const points = pointsOf(updates.get('arrow-1'));
    const start = recalculateBinding({ elementId: 'shape', focus: TOP_LEFT.x }, shape);
    const end = recalculateBinding({ elementId: 'shape', focus: BOTTOM_RIGHT.x }, shape);
    expect(points[0]).toEqual({ x: start.x - bound.x, y: start.y - bound.y });
    expect(points[points.length - 1]).toEqual({ x: end.x - bound.x, y: end.y - bound.y });
  });

  it('leaves the end point alone when the end binding target did not move', () => {
    const shape = rect('shape');
    const still = rect('still', { x: 3, y: 3 });
    const bound = arrow('arrow-1', {
      endBinding: { elementId: 'still', fixedPoint: BOTTOM_RIGHT, mode: 'inside' },
    });
    const byId = new Map<string, DriplElement>([
      ['shape', shape],
      ['still', still],
      ['arrow-1', bound],
    ]);
    const index = new Map([['still', new Set(['arrow-1'])]]);
    const updates = new Map<string, Partial<DriplElement>>();

    updateBoundArrows(new Set(['shape']), byId, index, updates);

    // An arrow that is *indexed* but whose own bindings do not name a moved element must
    // not be written at all: `needsUpdate` stays false, so no entry is set.
    expect(updates.has('arrow-1')).toBe(false);
  });

  it('skips an indexed id that is not an arrow or line', () => {
    // The index is caller-supplied, so a shape id can arrive in the arrow set. Writing a
    // partial for it would put a non-arrow into `updates` under the arrow's id.
    const shape = rect('shape');
    const decoy = rect('not-an-arrow');
    const byId = new Map<string, DriplElement>([
      ['shape', shape],
      ['not-an-arrow', decoy],
    ]);
    const index = new Map([['shape', new Set(['not-an-arrow'])]]);
    const updates = new Map<string, Partial<DriplElement>>();

    updateBoundArrows(new Set(['shape']), byId, index, updates);

    expect(updates.size).toBe(0);
  });

  it('skips an indexed id that is absent from the scene map', () => {
    const shape = rect('shape');
    const byId = new Map<string, DriplElement>([['shape', shape]]);
    const index = new Map([['shape', new Set(['ghost'])]]);
    const updates = new Map<string, Partial<DriplElement>>();

    updateBoundArrows(new Set(['shape']), byId, index, updates);

    expect(updates.size).toBe(0);
  });

  it('treats a line exactly as it treats an arrow', () => {
    // `line` is the other linear type and the guard admits both; a mutation narrowing the
    // guard to `arrow` would silently stop glued lines from following.
    const shape = rect('shape', { x: 0, y: 40 });
    const bound = {
      ...arrow('line-1', {
        endBinding: { elementId: 'shape', fixedPoint: BOTTOM_RIGHT, mode: 'inside' },
      }),
      type: 'line' as const,
    } as LinearElement;
    const byId = new Map<string, DriplElement>([
      ['shape', shape],
      ['line-1', bound],
    ]);
    const index = new Map([['shape', new Set(['line-1'])]]);
    const updates = new Map<string, Partial<DriplElement>>();

    updateBoundArrows(new Set(['shape']), byId, index, updates);

    // Asserted before reading the points so that a guard narrowed to `arrow` fails as an
    // assertion about the entry being missing, not as a TypeError on `undefined`.
    expect(updates.has('line-1')).toBe(true);
    const points = pointsOf(updates.get('line-1'));
    const expected = recalculateBinding({ elementId: 'shape', focus: BOTTOM_RIGHT.x }, shape);
    expect(points[points.length - 1]).toEqual({
      x: expected.x - bound.x,
      y: expected.y - bound.y,
    });
  });

  it('writes one entry per arrow even when two moved shapes both list it', () => {
    const a = rect('a', { x: 0, y: 0 });
    const b = rect('b', { x: 0, y: 40 });
    const bound = arrow('arrow-1', {
      startBinding: { elementId: 'a', fixedPoint: TOP_LEFT, mode: 'inside' },
      endBinding: { elementId: 'b', fixedPoint: BOTTOM_RIGHT, mode: 'inside' },
    });
    const byId = new Map<string, DriplElement>([
      ['a', a],
      ['b', b],
      ['arrow-1', bound],
    ]);
    // The same arrow id reachable from two shapes: the dedupe set must collapse it, or
    // the two passes would each re-anchor against the other's already-rewritten points.
    const index = new Map([
      ['a', new Set(['arrow-1'])],
      ['b', new Set(['arrow-1'])],
    ]);
    const updates = new CountingUpdates();

    updateBoundArrows(new Set(['a', 'b']), byId, index, updates);

    expect(updates.size).toBe(1);
    // One *write*, not two: the count is the only thing that distinguishes a deduped id
    // set from a list, since a second write would leave the same map contents behind.
    expect(updates.writes.get('arrow-1')).toBe(1);
    const points = pointsOf(updates.get('arrow-1'));
    const start = recalculateBinding({ elementId: 'a', focus: TOP_LEFT.x }, a);
    const end = recalculateBinding({ elementId: 'b', focus: BOTTOM_RIGHT.x }, b);
    expect(points[0]).toEqual({ x: start.x - bound.x, y: start.y - bound.y });
    expect(points[points.length - 1]).toEqual({ x: end.x - bound.x, y: end.y - bound.y });
  });
});

describe('updateBoundLabels — labelId and refusals', () => {
  it('follows a container label named by labelId, without a boundElements entry', () => {
    const shape = rect('shape', { x: 0, y: 0, width: 100, height: 80, labelId: 'label' });
    const label = text('label', { containerId: 'shape' });
    const byId = new Map<string, DriplElement>([
      ['shape', shape],
      ['label', label],
    ]);
    const updates = new Map<string, Partial<DriplElement>>();

    updateBoundLabels(new Set(['shape']), byId, updates);

    const updated = updates.get('label') as TextElement;
    expect(updated).toBeDefined();
    // The shared production helper defines where a bound text belongs; re-running it here
    // makes this an assertion about *delegation* rather than a transcription of the maths.
    const wrapped = updateBoundTextPosition(shape, label);
    expect(updated.x).toBeCloseTo(wrapped.x, 10);
    expect(updated.y).toBeCloseTo(wrapped.y, 10);
    // Non-arrow owners go through `updateBoundTextPosition`, not the arrow path, so the
    // text is re-wrapped and the width becomes the container's inner width.
    expect(updated.width).toBeCloseTo(wrapped.width, 10);
    expect(updated.text).toBe(wrapped.text);
    // Guard against the test being satisfiable by the wrong branch: the two helpers must
    // disagree for this fixture, or routing a rectangle through `updateArrowLabelPosition`
    // would pass. The arrow path centres a label on the owner's *origin* and keeps its
    // size; the bound-text path centres it in the container's box and resizes it.
    const arrowPath = updateArrowLabelPosition(shape as unknown as LinearElement, label);
    expect(arrowPath.x).not.toBeCloseTo(wrapped.x, 10);
    expect(arrowPath.width).toBe(label.width);
    expect(wrapped.width).not.toBe(label.width);
    // The measured height proves the canvas stub is live: with no 2D context
    // `measureText` yields 0 and `textHeight` would be 0 too.
    expect(wrapped.height).toBeGreaterThan(0);
    expect(updated.height).toBeCloseTo(wrapped.height, 10);
  });

  it('ignores a labelId pointing at an id that is not in the scene', () => {
    // A dangling `labelId` is the interesting failure: the module must not write an entry
    // for a label it never read, which would resurrect a deleted element into the scene.
    const shape = rect('shape', { labelId: 'gone' });
    const byId = new Map<string, DriplElement>([['shape', shape]]);
    const updates = new Map<string, Partial<DriplElement>>();

    updateBoundLabels(new Set(['shape']), byId, updates);

    expect(updates.size).toBe(0);
  });

  it('ignores a labelId pointing at an element that is not text', () => {
    const decoy = rect('decoy');
    const shape = rect('shape', { labelId: 'decoy' });
    const byId = new Map<string, DriplElement>([
      ['shape', shape],
      ['decoy', decoy],
    ]);
    const updates = new Map<string, Partial<DriplElement>>();

    updateBoundLabels(new Set(['shape']), byId, updates);

    expect(updates.size).toBe(0);
  });

  it('skips a moved id that is absent from the scene map', () => {
    const byId = new Map<string, DriplElement>();
    const updates = new Map<string, Partial<DriplElement>>();

    updateBoundLabels(new Set(['ghost']), byId, updates);

    expect(updates.size).toBe(0);
  });

  it('visits both a labelId label and a bound text label of the same owner', () => {
    // `labelId` and `boundElements` are two independent routes to the same field; if only
    // one were read, the other label would never move. Both are written in one pass.
    const shape = rect('shape', {
      labelId: 'by-label-id',
      boundElements: [{ id: 'by-binding', type: 'text' }],
    });
    const first = text('by-label-id');
    const second = text('by-binding');
    const byId = new Map<string, DriplElement>([
      ['shape', shape],
      ['by-label-id', first],
      ['by-binding', second],
    ]);
    const updates = new Map<string, Partial<DriplElement>>();

    updateBoundLabels(new Set(['shape']), byId, updates);

    expect([...updates.keys()].sort()).toEqual(['by-binding', 'by-label-id']);
  });

  it('deduplicates an id reachable by both routes', () => {
    const shape = rect('shape', {
      labelId: 'label',
      boundElements: [{ id: 'label', type: 'text' }],
    });
    const label = text('label');
    const byId = new Map<string, DriplElement>([
      ['shape', shape],
      ['label', label],
    ]);
    const updates = new CountingUpdates();

    updateBoundLabels(new Set(['shape']), byId, updates);

    expect(updates.size).toBe(1);
    // `labelId` and `boundElements` both name this label; without the `Set` the label
    // would be positioned twice, which is invisible in `size` but visible in the count.
    expect(updates.writes.get('label')).toBe(1);
  });

  it('routes a line owner through the arrow label path, not the text path', () => {
    // `line` is a linear type and shares `updateArrowLabelPosition`; a mutation that
    // narrowed the branch to `arrow` would send lines through `updateBoundTextPosition`
    // and give them container-centring instead of a midpoint.
    const line = { ...arrow('line-1'), type: 'line' as const };
    const label = text('label', { x: 999, y: 999 });
    const owner = { ...line, boundElements: [{ id: 'label', type: 'text' as const }] };
    const byId = new Map<string, DriplElement>([
      ['line-1', owner],
      ['label', label],
    ]);
    const updates = new Map<string, Partial<DriplElement>>();

    updateBoundLabels(new Set(['line-1']), byId, updates);

    const updated = updates.get('label') as TextElement;
    expect(updated.x).not.toBe(999);
    const arrowPath = updateArrowLabelPosition(owner as LinearElement, label);
    expect(updated.x).toBeCloseTo(arrowPath.x, 10);
    expect(updated.y).toBeCloseTo(arrowPath.y, 10);
  });
});

describe('buildBoundArrowsByShape — index shape', () => {
  it('accumulates several arrows on one shape and skips non-arrow bindings', () => {
    const shape = rect('shape', {
      boundElements: [
        { id: 'arrow-1', type: 'arrow' },
        { id: 'label-1', type: 'text' },
        { id: 'arrow-2', type: 'arrow' },
      ],
    });
    const index = buildBoundArrowsByShape([shape]);
    // Set semantics, order-independent: asserted as a set so a mutation that dropped the
    // second binding, or indexed the text entry, cannot pass.
    expect([...index.get('shape')!].sort()).toEqual(['arrow-1', 'arrow-2']);
  });

  it('accepts any iterable, so a Map works as a source', () => {
    const shape = rect('shape', { boundElements: [{ id: 'arrow-1', type: 'arrow' }] });
    const source = new Map([['shape', shape]]);
    expect(buildBoundArrowsByShape(source.values()).get('shape')).toEqual(new Set(['arrow-1']));
  });
});
