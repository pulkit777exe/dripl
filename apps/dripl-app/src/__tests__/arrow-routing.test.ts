import { describe, expect, it } from 'vitest';
import type { DriplElement, Point } from '@dripl/common';
import { getElementBounds } from '@dripl/math/intersection';
import arrowRouting, {
  calculateArrowBinding,
  calculateArrowPath,
  calculateCurvedPath,
  calculateElbowPath,
  calculateStraightPath,
  getArrowheadPoints,
  getDirectionVector,
  recalculateBinding,
  snapToShapeBinding,
  type ArrowheadType,
} from '@/utils/arrow-routing';
import { linear, rectangle } from './helpers/elements';

/**
 * `utils/arrow-routing.ts` — the geometry that decides where an arrowhead lands.
 *
 * Every assertion here is a *geometric invariant* ("the result is on the
 * shape's perimeter", "no coordinate is NaN", "A→B and B→A agree") rather than a
 * restatement of the formula. That is deliberate: the formulas are one line
 * each and a copy of them would catch nothing, whereas the invariants are the
 * properties `renderer/elements.ts` and `lib/canvas/binding-sync.ts` depend on
 * and that a sign slip or a missing guard silently breaks.
 *
 * Fixtures come from the shared element factories. `strokeWidth: 0` keeps
 * `getElementBounds` returning the element's literal rect — it otherwise inflates
 * by `strokeWidth / 2`, which would shift every expected coordinate by a pixel
 * without testing anything.
 */

function rect(id: string, x: number, y: number, width: number, height: number): DriplElement {
  return rectangle(id, { x, y, width, height, strokeWidth: 0 });
}

/** Every finite number in a point list, flattened. */
function coords(points: readonly Point[]): number[] {
  return points.flatMap(point => [point.x, point.y]);
}

function assertFinite(points: readonly Point[]): void {
  for (const value of coords(points)) {
    expect(Number.isFinite(value)).toBe(true);
  }
}

/**
 * Is `point` on the perimeter of `bounds` (within `epsilon`)? Uses the same
 * `getElementBounds` the module under test uses, so this is about the routing
 * maths and not about stroke padding.
 */
function onPerimeter(
  point: Point,
  bounds: { x: number; y: number; width: number; height: number }
) {
  const e = 1e-9;
  const { x, y, width, height } = bounds;
  const onLeft = Math.abs(point.x - x) <= e;
  const onRight = Math.abs(point.x - (x + width)) <= e;
  const onTop = Math.abs(point.y - y) <= e;
  const onBottom = Math.abs(point.y - (y + height)) <= e;
  const withinX = point.x >= x - e && point.x <= x + width + e;
  const withinY = point.y >= y - e && point.y <= y + height + e;
  return withinX && withinY && (onLeft || onRight || onTop || onBottom);
}

/** Strictly inside the bounds — the negative space an arrowhead must never sit in. */
function strictlyInside(
  point: Point,
  bounds: { x: number; y: number; width: number; height: number }
): boolean {
  const e = 1e-9;
  return (
    point.x > bounds.x + e &&
    point.x < bounds.x + bounds.width - e &&
    point.y > bounds.y + e &&
    point.y < bounds.y + bounds.height - e
  );
}

const A: Point = { x: 0, y: 0 };
const B: Point = { x: 100, y: 40 };
const ARROWHEADS: ArrowheadType[] = ['triangle', 'dot', 'bar', 'diamond', 'none'];
const DIRECTIONS: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  getDirectionVector(A, B),
  getDirectionVector(B, A),
];

describe('arrow-routing path construction', () => {
  it('straight routing returns exactly the two endpoints, unmodified', () => {
    // Regression: a straight arrow that passes through a midpoint (or normalises
    // its arguments) would render a different line than the two points the
    // renderer asks for — invisible at style `straight`, but it is what the
    // renderer interpolates for hit-testing.
    expect(calculateStraightPath(A, B)).toEqual([A, B]);
  });

  it('curved routing puts the control point on the midpoint when curvature is 0', () => {
    // Regression: `options.curvature || 0.5` instead of `??` would silently turn
    // an explicit 0 into 0.5, so a caller asking for a straight bezier (still
    // 3 control points) got a visibly bowed arrow. `calculateArrowPath` is the
    // path by which a stored `curvature: 0` reaches this function.
    expect(calculateCurvedPath(A, B, 0)).toEqual([A, { x: 50, y: 20 }, B]);
    expect(calculateArrowPath(A, B, { style: 'curved', curvature: 0 })).toEqual([
      A,
      { x: 50, y: 20 },
      B,
    ]);
  });

  it('curved routing defaults to curvature 0.5 and bows perpendicular to the chord', () => {
    // Regression: the perpendicular offset is `(-dy, dx)/len * len * c * 0.25`.
    // Losing the sign of the x term mirrors the bow to the other side of the
    // chord — still perpendicular, still finite, still off the chord, so only a
    // directional assertion catches it. The first assertion pins the *default*
    // curvature, so changing it is caught too.
    const path = calculateCurvedPath(A, B);
    const [start, , end] = path;
    const control = path[1]!;
    expect(start).toEqual(A);
    expect(end).toEqual(B);
    expect(calculateCurvedPath(A, B)).toEqual(calculateCurvedPath(A, B, 0.5));
    // Midpoint (50, 20) offset by (-5, +12.5) at the default curvature.
    expect(control.x).toBeCloseTo(45, 9);
    expect(control.y).toBeCloseTo(32.5, 9);
    const cross = (B.x - A.x) * (control.y - A.y) - (B.y - A.y) * (control.x - A.x);
    expect(Math.abs(cross)).toBeGreaterThan(0);
    assertFinite(calculateCurvedPath(A, B));
    assertFinite(calculateCurvedPath(A, B, 1));
  });

  it('elbow routing turns on the longer axis, and the corner shares one coordinate with each end', () => {
    // Regression: swapping the two branches produces a corner on the wrong axis.
    // The path is still start → corner → end, so only the corner's position
    // distinguishes them, hence asserting on the corner.
    const horizontal = calculateElbowPath(A, { x: 100, y: 10 });
    expect(horizontal).toEqual([A, { x: 100, y: 0 }, { x: 100, y: 10 }]);
    // |dx| > |dy| holds, so the horizontal leg comes first.
    expect(horizontal[1]!.y).toBe(A.y);

    const vertical = calculateElbowPath(A, { x: 10, y: 100 });
    expect(vertical).toEqual([A, { x: 0, y: 100 }, { x: 10, y: 100 }]);
    expect(vertical[1]!.x).toBe(A.x);
  });

  it('an exact tie between |dx| and |dy| routes vertical-first', () => {
    // Regression: `>=` instead of `>` changes which axis the corner sits on for
    // every 45° arrow, i.e. a large fraction of real diagonal arrows.
    expect(calculateElbowPath(A, { x: 50, y: 50 })[1]).toEqual({ x: 0, y: 50 });
  });

  it('every style routes from start to end, and an unknown style falls back to straight', () => {
    // Regression: the `default` branch of the style switch is what keeps an
    // element stored by a newer build (or a hand-edited scene) from producing
    // no path at all.
    for (const style of ['straight', 'curved', 'elbow'] as const) {
      const path = calculateArrowPath(A, B, { style });
      expect(path.length).toBeGreaterThanOrEqual(2);
      expect(path[0]).toEqual(A);
      expect(path[path.length - 1]).toEqual(B);
      assertFinite(path);
    }

    const fallback = calculateArrowPath(A, B, {
      style: 'zigzag' as unknown as 'straight',
    });
    expect(fallback).toEqual([A, B]);
  });

  it('routes are symmetric under reversal for straight and elbow, and finite everywhere', () => {
    // Regression: elbow asymmetry (a corner computed from the wrong endpoint)
    // would make the same arrow drawn in the opposite direction look different.
    expect(calculateStraightPath(A, B)).toEqual([...calculateStraightPath(B, A)].reverse());
    const forward = calculateElbowPath(A, B);
    const backward = calculateElbowPath(B, A);
    expect(forward[0]).toEqual(backward[backward.length - 1]);
    expect(forward[forward.length - 1]).toEqual(backward[0]);
    assertFinite(calculateElbowPath(A, B));
    assertFinite(calculateElbowPath({ x: -5, y: -5 }, { x: 5, y: -5 }));
  });

  it('a zero-length arrow produces a defined (if degenerate) straight and elbow path', () => {
    // Regression: an arrow dragged and released at its start point must not
    // produce NaN coordinates that propagate into the stored `points` and from
    // there into every consumer of the scene.
    for (const path of [calculateStraightPath(A, A), calculateElbowPath(A, A)]) {
      assertFinite(path);
      expect(path.every(point => point.x === 0 && point.y === 0)).toBe(true);
    }
  });

  it('a zero-length curved arrow stays finite instead of producing a NaN control point', () => {
    // Regression: a zero-length segment has no direction, so the perpendicular
    // offset is `(-0/0) * 0`, i.e. `NaN`. That NaN is the *middle* point of the
    // path, so it propagates to every consumer: the renderer silently drops the
    // element and a serialised arrow round-trips with `"NaN"` in it.
    //
    // The identical function in `packages/element/src/rough-renderer.ts` has
    // always had `if (length === 0) return [start, end];`. This copy had drifted
    // from it, which is how the two diverged unnoticed. Latent only because
    // production renders through the package copy -- this export is what a caller
    // in the app actually reaches for.
    const path = calculateCurvedPath(A, A, 0.5);

    expect(path.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    // And not merely finite: a degenerate arrow is a straight line, so the
    // endpoints are the whole path.
    expect(path).toEqual([A, A]);
  });

  it('still curves a non-degenerate arrow, so the guard did not disable curvature', () => {
    // The control for the test above. A fix that returned `[start, end]`
    // unconditionally would pass it, so this pins that the three-point path and a
    // genuinely offset control point survive.
    const path = calculateCurvedPath(A, B, 0.5);

    expect(path).toHaveLength(3);
    expect(path[0]).toEqual(A);
    expect(path[2]).toEqual(B);
    // The control point must actually be off the straight line between them.
    const midX = (A.x + B.x) / 2;
    const midY = (A.y + B.y) / 2;
    expect(path[1]!.x === midX && path[1]!.y === midY).toBe(false);
  });
});

describe('arrow-routing direction and arrowheads', () => {
  it('the direction vector is a unit vector, and reversing the endpoints negates it', () => {
    // Regression: an unnormalised direction (or a missing sign) makes every
    // arrowhead scale with the arrow's length instead of with `size`.
    const forward = getDirectionVector(A, B);
    const backward = getDirectionVector(B, A);
    expect(Math.hypot(forward.x, forward.y)).toBeCloseTo(1, 12);
    expect(Math.hypot(backward.x, backward.y)).toBeCloseTo(1, 12);
    expect(forward.x).toBeCloseTo(-backward.x, 12);
    expect(forward.y).toBeCloseTo(-backward.y, 12);
  });

  it('a zero-length segment yields a defined unit direction rather than NaN', () => {
    // Regression: without the `length === 0` guard this is `0/0`.
    const direction = getDirectionVector(A, A);
    expect(direction).toEqual({ x: 1, y: 0 });
  });

  it('no arrowhead point extends past the tip in the direction of travel', () => {
    // Regression: the base of every arrowhead is `tip - direction * size`. A
    // dropped negation puts the head *in front of* the tip, i.e. inside the
    // shape the arrow is bound to. Only a projection test catches that; the
    // point count stays the same either way.
    const tip: Point = { x: 10, y: 10 };
    for (const type of ARROWHEADS) {
      for (const direction of DIRECTIONS) {
        const points = getArrowheadPoints(tip, direction, type);
        assertFinite(points);
        for (const point of points) {
          if (point.x === tip.x && point.y === tip.y) continue; // the tip itself
          const projection = (point.x - tip.x) * direction.x + (point.y - tip.y) * direction.y;
          expect(projection).toBeLessThanOrEqual(1e-9);
        }
      }
    }
  });

  it('arrowhead geometry scales with `size` and is anchored at the tip', () => {
    // Regression: `size` ignored (e.g. a hard-coded 10) makes every head the
    // same size regardless of zoom or stroke width.
    const tip: Point = { x: 0, y: 0 };
    const direction: Point = { x: 1, y: 0 };
    const small = getArrowheadPoints(tip, direction, 'triangle', 4);
    const large = getArrowheadPoints(tip, direction, 'triangle', 40);
    expect(small).toHaveLength(3);
    expect(large).toHaveLength(3);
    expect(small[0]).toEqual(tip);
    expect(large[0]).toEqual(tip);
    expect(Math.abs(large[1]!.x - tip.x)).toBeGreaterThan(Math.abs(small[1]!.x - tip.x));
  });

  it('a bar head lies across the tip, not along it', () => {
    // Regression: using `direction` instead of its perpendicular turns the bar
    // into a segment lying along the arrow's shaft. A diagonal direction is what
    // makes the two distinguishable — on an axis-aligned one the perpendicular
    // and the direction share a zero component.
    const tip: Point = { x: 5, y: 5 };
    const direction = getDirectionVector({ x: 0, y: 0 }, { x: 3, y: 4 }); // (0.6, 0.8)
    const [first, second] = getArrowheadPoints(tip, direction, 'bar', 10);

    // Centred on the tip, perpendicular: (±0.8, ∓0.6) at half the size.
    expect(first!.x).toBeCloseTo(5 - 4, 9);
    expect(first!.y).toBeCloseTo(5 + 3, 9);
    expect(second!.x).toBeCloseTo(5 + 4, 9);
    expect(second!.y).toBeCloseTo(5 - 3, 9);
    expect((first!.x - second!.x) * direction.x + (first!.y - second!.y) * direction.y).toBeCloseTo(
      0,
      9
    );
  });

  it('a dot head is the tip alone, and `none` draws nothing', () => {
    // Regression: an unhandled arrowhead type falling through to a triangle
    // means an element explicitly set to `none` still grows a head.
    expect(getArrowheadPoints({ x: 1, y: 2 }, { x: 1, y: 0 }, 'dot')).toEqual([{ x: 1, y: 2 }]);
    expect(getArrowheadPoints({ x: 1, y: 2 }, { x: 1, y: 0 }, 'none')).toEqual([]);
    expect(getArrowheadPoints({ x: 1, y: 2 }, { x: 1, y: 0 }, 'unknown' as ArrowheadType)).toEqual(
      []
    );
  });
});

describe('arrow-routing binding to a shape', () => {
  const target = rect('target', 100, 100, 200, 100);
  const bounds = getElementBounds(target);

  it('an arrow endpoint near an edge anchor snaps onto the perimeter', () => {
    // Regression: `snapToShapeBinding` is what stops a bound arrow's head
    // floating outside its target. Returning the input point unchanged, or
    // snapping to the shape's *centre*, is the bug this catches.
    const snapped = snapToShapeBinding({ x: 105, y: 150 }, target);
    expect(snapped).toEqual({ x: 100, y: 150 });
    expect(onPerimeter(snapped, bounds)).toBe(true);
    expect(strictlyInside(snapped, bounds)).toBe(false);
  });

  it('snapping picks the *nearest* anchor, not the first within threshold', () => {
    // Regression: taking the first anchor under the threshold snaps every
    // arrow near the top-right of a shape to the left edge.
    const nearRight = snapToShapeBinding({ x: 296, y: 140 }, target);
    expect(nearRight).toEqual({ x: 300, y: 150 });
    const nearBottom = snapToShapeBinding({ x: 195, y: 196 }, target);
    expect(nearBottom).toEqual({ x: 200, y: 200 });
  });

  it('an endpoint further than the threshold is left alone', () => {
    // Regression: snapping regardless of distance would drag a distant arrow's
    // head onto a shape it was never bound to.
    const far = { x: 0, y: 0 };
    expect(snapToShapeBinding(far, target)).toEqual(far);
    expect(snapToShapeBinding({ x: 100, y: 100 }, target, 1000)).not.toEqual({
      x: 100,
      y: 100,
    });
  });

  it('a zero-size target snaps to its own origin and never yields NaN', () => {
    // Regression: all four anchors collapse onto one point for a zero-size
    // target; a bounds-based implementation that divided by width/height would
    // produce NaN here.
    const dot = rect('dot', 50, 50, 0, 0);
    const snapped = snapToShapeBinding({ x: 55, y: 50 }, dot);
    assertFinite([snapped]);
    expect(snapped).toEqual({ x: 50, y: 50 });
    const dotBounds = getElementBounds(dot);
    expect(onPerimeter(snapped, dotBounds)).toBe(true);
  });

  it('binding reports a focus on the edge the arrow points at', () => {
    // Regression: swapping the right/left focus formula flips which edge an
    // arrow attaches to, which only shows up once the shape moves.
    const right = calculateArrowBinding({ x: 1000, y: 150 }, target);
    expect(right).toEqual({ elementId: 'target', focus: 0.5 });
    // Above and to the right of centre → the top edge, focus below 0.5.
    const above = calculateArrowBinding({ x: 250, y: -1000 }, target);
    expect(above?.focus).toBeCloseTo(0.375, 12);
    // Below and to the right of centre → the bottom edge, focus above 0.5.
    const below = calculateArrowBinding({ x: 250, y: 1000 }, target);
    expect(below?.focus).toBeCloseTo(0.625, 12);
  });

  it('focus is clamped to 0-1 however far the arrow overshoots', () => {
    // Regression: without the clamp, an arrow dragged far past its target
    // yields `focus = 8.5`, and `recalculateBinding` maps that to a point
    // several shape-widths away — the arrowhead detaches entirely.
    for (const arrowEnd of [
      { x: 1e6, y: 1e6 },
      { x: -1e6, y: -1e6 },
      { x: 1e9, y: 150 },
      { x: 200, y: -1e9 },
    ]) {
      const binding = calculateArrowBinding(arrowEnd, target);
      expect(binding).not.toBeNull();
      expect(binding!.focus).toBeGreaterThanOrEqual(0);
      expect(binding!.focus).toBeLessThanOrEqual(1);
      const point = recalculateBinding(binding!, target);
      assertFinite([point]);
      expect(onPerimeter(point, bounds)).toBe(true);
    }
  });

  it('an arrow that stops at the target centre still binds without NaN', () => {
    // Regression: `dx === dy === 0` falls to the top/bottom branch with
    // `dy === 0`; a `dy >= 0` comparison or a division by the bounds would turn
    // this into a NaN focus.
    const binding = calculateArrowBinding({ x: 200, y: 150 }, target);
    assertFinite([{ x: binding!.focus, y: 0 }]);
    expect(binding).toEqual({ elementId: 'target', focus: 0.5 });
    const point = recalculateBinding(binding!, target);
    expect(onPerimeter(point, bounds)).toBe(true);
  });

  it('a zero-height target collapses the horizontal-edge focus to 0.5', () => {
    // Regression: `0.5 + (dy / bounds.height) * 0.5` with a zero height is
    // `NaN` or `Infinity`, and the clamp silently turns `NaN` into `NaN`.
    const flat = rect('flat', 0, 0, 200, 0);
    // Both horizontal edges: the guard is duplicated per branch, so each is
    // exercised on its own.
    for (const arrowEnd of [
      { x: 1000, y: 40 }, // right edge
      { x: -1000, y: 40 }, // left edge
    ]) {
      const binding = calculateArrowBinding(arrowEnd, flat);
      expect(binding).toEqual({ elementId: 'flat', focus: 0.5 });
      const point = recalculateBinding(binding!, flat);
      assertFinite([point]);
      expect(onPerimeter(point, getElementBounds(flat))).toBe(true);
    }
  });

  it('a zero-width target collapses the vertical-edge focus to 0.5', () => {
    const sliver = rect('sliver', 0, 0, 0, 200);
    // Both vertical edges, as above.
    for (const arrowEnd of [
      { x: 40, y: 1000 }, // bottom edge
      { x: 40, y: -1000 }, // top edge
    ]) {
      const binding = calculateArrowBinding(arrowEnd, sliver);
      expect(binding).toEqual({ elementId: 'sliver', focus: 0.5 });
      assertFinite([recalculateBinding(binding!, sliver)]);
    }
  });

  it('recalculating a binding lands on the perimeter for every focus', () => {
    // Regression: `recalculateBinding` is called on every shape move for every
    // bound arrow. A missing edge branch, or a focus mapped outside 0-1,
    // leaves the head in the middle of the shape (inside the fill, where the
    // user cannot see it) or off the shape entirely.
    for (let focus = 0; focus <= 1.0001; focus += 0.05) {
      const point = recalculateBinding({ elementId: 'target', focus }, target);
      assertFinite([point]);
      expect(onPerimeter(point, bounds)).toBe(true);
      expect(strictlyInside(point, bounds)).toBe(false);
    }
  });

  it('each focus quarter maps to the edge it names', () => {
    // Regression: the four `focus <` boundaries decide which edge a bound arrow
    // attaches to; swapping two of them keeps every point on the perimeter (so
    // the invariant test above still passes) but moves arrows to the wrong edge.
    const top = recalculateBinding({ elementId: 'target', focus: 0.1 }, target);
    expect(top.x).toBeCloseTo(bounds.x + 0.4 * bounds.width, 9);
    expect(top.y).toBeCloseTo(bounds.y, 9);

    const right = recalculateBinding({ elementId: 'target', focus: 0.3 }, target);
    expect(right.x).toBeCloseTo(bounds.x + bounds.width, 9);
    expect(right.y).toBeCloseTo(bounds.y + 0.2 * bounds.height, 9);

    const bottom = recalculateBinding({ elementId: 'target', focus: 0.6 }, target);
    expect(bottom.x).toBeCloseTo(bounds.x + 0.4 * bounds.width, 9);
    expect(bottom.y).toBeCloseTo(bounds.y + bounds.height, 9);

    const left = recalculateBinding({ elementId: 'target', focus: 0.9 }, target);
    expect(left.x).toBeCloseTo(bounds.x, 9);
    expect(left.y).toBeCloseTo(bounds.y + 0.6 * bounds.height, 9);
  });

  it('binding then recalculating is symmetric for A→B and B→A', () => {
    // Regression: the renderer calls this pair for both ends of every bound
    // arrow. If the pair were asymmetric, one end of an arrow would land on the
    // perimeter while the other drifted — the "half-attached arrow" bug, which
    // no single-direction test shows.
    const source = rect('source', 0, 0, 100, 100);
    const sourceBounds = getElementBounds(source);
    const endpoints = [
      { x: 50, y: -50 },
      { x: 50, y: 250 },
      { x: -50, y: 150 },
      { x: 350, y: 150 },
      { x: 200, y: 200 },
      // Far overshoot: the unclamped focus it produces puts the head several
      // shape-widths away, i.e. neither end is attached.
      { x: 2000, y: 1000 },
    ];

    for (const endpoint of endpoints) {
      const forward = calculateArrowBinding(endpoint, target);
      const backward = calculateArrowBinding({ x: 150, y: 50 }, source);
      expect(forward).not.toBeNull();
      expect(backward).not.toBeNull();
      const head = recalculateBinding(forward!, target);
      const tail = recalculateBinding(backward!, source);
      expect(onPerimeter(head, bounds)).toBe(true);
      expect(onPerimeter(tail, sourceBounds)).toBe(true);
      expect(head).not.toEqual(tail);
      assertFinite([head, tail]);
    }
  });

  it('binding follows a path element by its points, not by its x/y', () => {
    // Regression: `getElementBounds` for a path is derived from `points` mapped
    // to world space. An implementation that read `element.x/y/width/height`
    // directly would attach the arrow to the wrong place for every path with a
    // non-zero origin — which is every arrow drawn from a drag. This fixture's
    // declared `width`/`height` are 0, so the wrong answer is (0, 0).
    const arrow = linear(
      'arrow-1',
      'arrow',
      [
        { x: 500, y: 500 },
        { x: 500, y: 700 },
      ],
      { strokeWidth: 0 }
    );
    const arrowBounds = getElementBounds(arrow);
    expect(arrowBounds).toEqual({ x: 500, y: 500, width: 0, height: 200 });

    const binding = calculateArrowBinding({ x: 2000, y: 560 }, arrow);
    const point = recalculateBinding(binding!, arrow);
    assertFinite([point]);
    expect(onPerimeter(point, arrowBounds)).toBe(true);
    // Right edge of the path's world bounds, not the origin-declared rect.
    expect(point.x).toBeCloseTo(arrowBounds.x + arrowBounds.width, 9);
    expect(point.y).toBeGreaterThan(arrowBounds.y);
    expect(point.y).toBeLessThan(arrowBounds.y + arrowBounds.height);
  });
});

describe('arrow-routing public surface', () => {
  it('the default export exposes exactly the routing functions the renderer imports', () => {
    // Regression: `renderer/elements.ts` and `lib/draw/find-shape.ts` import the
    // named exports, but anything importing the default gets this object; a
    // function renamed without updating it becomes `undefined` at the call
    // site with no type error.
    expect(Object.keys(arrowRouting).sort()).toEqual([
      'calculateArrowBinding',
      'calculateArrowPath',
      'getArrowheadPoints',
      'getDirectionVector',
      'recalculateBinding',
      'snapToShapeBinding',
    ]);
    for (const value of Object.values(arrowRouting)) {
      expect(typeof value).toBe('function');
    }
  });
});
