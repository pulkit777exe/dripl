import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { DriplElement, FreeDrawElement, Point } from '@dripl/common';
import {
  shouldTestInside,
  isPathALoop,
  inverseRotatePoint,
  elementLocalPointToWorld,
  getElementBounds,
  isPointInElement,
  elementIntersectsSegment,
  getFreedrawOutline,
  getDistanceToBounds,
  isPointNearElement,
  isPointOnElementOutline,
} from './intersection';
import { rotatePoint, rotateBounds } from './geometry';

// Property seeds are pinned so any failure is reproducible from this file
// alone: fast-check prints the seed and path, and both are constants here.
const SEED = 20_260_903;

const pt = (x: number, y: number): Point => ({ x, y });
const num = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const fcPoint: fc.Arbitrary<Point> = fc.record({ x: num(-400, 400), y: num(-400, 400) });
const fcAngle = num(-Math.PI * 2, Math.PI * 2);
const RUNS = 300;

/** Minimal shape element; `type` and geometry are overridden per test. */
/**
 * Every field optional and explicitly `| undefined`-able.
 *
 * `Partial<DriplElement>` cannot express "this element has no stroke", because
 * `exactOptionalPropertyTypes` makes `strokeWidth?: number` reject
 * `strokeWidth: undefined` — and absent is exactly what that case means. The
 * mapped form says what the tests actually mean.
 */
type ElementOverrides = {
  [K in keyof DriplElement]?: DriplElement[K] | undefined;
} & { type: DriplElement['type'] };

function el(overrides: ElementOverrides): DriplElement {
  return {
    id: 'e1',
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    strokeWidth: 2,
    ...overrides,
  } as DriplElement;
}

/** Minimal path element; `points` are relative to (x, y), as the app stores them. */
function path(
  type: 'freedraw' | 'line' | 'arrow',
  points: Point[],
  overrides: Partial<DriplElement> = {}
): DriplElement {
  return {
    id: 'p1',
    type,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    strokeWidth: 2,
    points,
    ...overrides,
  } as DriplElement;
}

const centreOf = (e: DriplElement): Point => pt(e.x + e.width / 2, e.y + e.height / 2);

describe('math/intersection', () => {
  describe('elementLocalPointToWorld / inverseRotatePoint', () => {
    it('offsets by the element origin when the element is unrotated', () => {
      const e = path('freedraw', [pt(0, 0), pt(30, 20)], { x: 100, y: 50 });
      expect(elementLocalPointToWorld(e, pt(0, 0))).toEqual({ x: 100, y: 50 });
      expect(elementLocalPointToWorld(e, pt(30, 20))).toEqual({ x: 130, y: 70 });
    });

    it('rotates about the element centre, matching the canvas transform', () => {
      const e = path('freedraw', [pt(0, 0)], { x: 100, y: 50, angle: Math.PI / 2 });
      const expected = rotatePoint(pt(100, 50), 150, 100, Math.PI / 2);
      expect(elementLocalPointToWorld(e, pt(0, 0)).x).toBeCloseTo(expected.x, 9);
      expect(elementLocalPointToWorld(e, pt(0, 0)).y).toBeCloseTo(expected.y, 9);
    });

    it('inverseRotatePoint undoes elementLocalPointToWorld', () => {
      fc.assert(
        fc.property(fcPoint, fcAngle, (local, angle) => {
          const e = path('freedraw', [local], { x: 100, y: 50, angle });
          const c = centreOf(e);
          const back = inverseRotatePoint(elementLocalPointToWorld(e, local), c.x, c.y, angle);
          expect(back.x).toBeCloseTo(e.x + local.x, 6);
          expect(back.y).toBeCloseTo(e.y + local.y, 6);
        }),
        { seed: SEED, numRuns: RUNS }
      );
    });

    it('translating the element translates its world points by the same amount', () => {
      fc.assert(
        fc.property(fcPoint, num(-300, 300), num(-300, 300), (local, dx, dy) => {
          const e = path('line', [local, pt(10, 10)], { x: 100, y: 50, angle: 0.3 });
          const moved = { ...e, x: e.x + dx, y: e.y + dy } as DriplElement;
          const a = elementLocalPointToWorld(e, local);
          const b = elementLocalPointToWorld(moved, local);
          expect(b.x - dx).toBeCloseTo(a.x, 6);
          expect(b.y - dy).toBeCloseTo(a.y, 6);
        }),
        { seed: SEED, numRuns: RUNS }
      );
    });
  });

  describe('shouldTestInside', () => {
    it('follows the documented rule per element type', () => {
      const filled = (type: DriplElement['type']) => el({ type, backgroundColor: '#f00' });
      const withBoundText = (type: DriplElement['type']) =>
        el({ type, boundElements: [{ id: 't', type: 'text' as const }] });

      // Stroke-only shapes: never draggable from the interior.
      expect(shouldTestInside(el({ type: 'arrow' }))).toBe(false);
      expect(shouldTestInside(filled('arrow'))).toBe(false);

      // Shapes need a fill or bound text.
      for (const type of ['rectangle', 'ellipse', 'diamond', 'frame', 'embed'] as const) {
        expect(shouldTestInside(el({ type }))).toBe(false);
        expect(shouldTestInside(filled(type))).toBe(true);
        expect(shouldTestInside(withBoundText(type))).toBe(true);
      }

      // Text and image are always inside-testable.
      expect(shouldTestInside(el({ type: 'text' }))).toBe(true);
      expect(shouldTestInside(el({ type: 'image' }))).toBe(true);
    });

    it('a transparent background does not count as a fill', () => {
      for (const bg of ['', 'transparent', 'rgba(0,0,0,0)', 'rgba(0, 0, 0, 0.0)']) {
        expect(shouldTestInside(el({ type: 'rectangle', backgroundColor: bg }))).toBe(false);
      }
      expect(shouldTestInside(el({ type: 'rectangle', backgroundColor: 'rgba(0,0,0,0.5)' }))).toBe(
        true
      );
      expect(shouldTestInside(el({ type: 'rectangle', backgroundColor: '#fff' }))).toBe(true);
    });

    it('a line or freedraw needs a closed loop as well as a fill', () => {
      const open = [pt(0, 0), pt(50, 0), pt(100, 40)];
      const closed = [pt(0, 0), pt(50, 0), pt(100, 40), pt(5, 2)];
      for (const type of ['line', 'freedraw'] as const) {
        expect(shouldTestInside(path(type, open, { backgroundColor: '#f00' }))).toBe(false);
        expect(shouldTestInside(path(type, closed, { backgroundColor: '#f00' }))).toBe(true);
        expect(shouldTestInside(path(type, closed))).toBe(false);
      }
    });
  });

  describe('isPathALoop', () => {
    const loop = [pt(0, 0), pt(50, 0), pt(50, 50)];

    it('needs at least three points', () => {
      expect(isPathALoop(path('line', []) as never)).toBe(false);
      expect(isPathALoop(path('line', [pt(0, 0)]) as never)).toBe(false);
      expect(isPathALoop(path('line', [pt(0, 0), pt(1, 0)]) as never)).toBe(false);
    });

    it('uses a 10px gap between the first and last point', () => {
      expect(isPathALoop(path('line', [...loop, pt(6, 8)]) as never)).toBe(true); // gap = 10
      expect(isPathALoop(path('line', [...loop, pt(6.01, 8)]) as never)).toBe(false);
      expect(isPathALoop(path('line', [...loop, pt(100, 100)]) as never)).toBe(false);
    });

    it('measures the straight-line gap between endpoints', () => {
      fc.assert(
        fc.property(num(-40, 40), num(-40, 40), (dx, dy) => {
          const e = path('line', [pt(0, 0), pt(50, 50), pt(dx, dy)]);
          expect(isPathALoop(e as never)).toBe(Math.hypot(dx, dy) <= 10);
        }),
        { seed: SEED, numRuns: RUNS }
      );
    });
  });

  describe('getElementBounds', () => {
    it('pads a shape box by half the stroke width', () => {
      expect(
        getElementBounds(
          el({ type: 'rectangle', x: 10, y: 20, width: 100, height: 50, strokeWidth: 2 })
        )
      ).toEqual({
        x: 9,
        y: 19,
        width: 102,
        height: 52,
      });
    });

    it('does not pad when there is no stroke', () => {
      expect(getElementBounds(el({ type: 'rectangle', ...{ strokeWidth: undefined } }))).toEqual({
        x: 0,
        y: 0,
        width: 100,
        height: 60,
      });
    });

    it('bounds a path by its world points, padded', () => {
      const e = path('line', [pt(0, 0), pt(30, 20)], { x: 100, y: 50, strokeWidth: 4 });
      expect(getElementBounds(e)).toEqual({ x: 98, y: 48, width: 34, height: 24 });
    });

    it('degenerates to the element origin for an empty path', () => {
      const e = path('line', [], { x: 100, y: 50, strokeWidth: 4 });
      expect(getElementBounds(e)).toEqual({ x: 98, y: 48, width: 4, height: 4 });
    });

    it('a rotated shape bounds as the rotated box', () => {
      const e = el({
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 20,
        height: 10,
        angle: Math.PI / 2,
        strokeWidth: 0,
      });
      const r = getElementBounds(e);
      expect(r.width).toBeCloseTo(10, 9);
      expect(r.height).toBeCloseTo(20, 9);
      expect(r.x + r.width / 2).toBeCloseTo(10, 9);
      expect(r.y + r.height / 2).toBeCloseTo(5, 9);
    });

    it('agrees with rotateBounds of the unrotated bounds for shapes', () => {
      const closeTo = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);
      fc.assert(
        fc.property(
          fc.constantFrom<DriplElement['type']>(
            'rectangle',
            'ellipse',
            'diamond',
            'frame',
            'text',
            'image',
            'embed'
          ),
          num(-300, 300),
          num(-300, 300),
          num(1, 250),
          num(1, 250),
          num(0, 8),
          fcAngle,
          (type: DriplElement['type'], x, y, w, h, sw, angle) => {
            const flat = el({ type, x, y, width: w, height: h, strokeWidth: sw, angle: 0 });
            const turned = { ...flat, angle } as DriplElement;
            const expected = rotateBounds(getElementBounds(flat), centreOf(flat), angle);
            const actual = getElementBounds(turned);
            closeTo(actual.x, expected.x);
            closeTo(actual.y, expected.y);
            closeTo(actual.width, expected.width);
            closeTo(actual.height, expected.height);
          }
        ),
        { seed: SEED, numRuns: 200 }
      );
    });

    it('contains every drawn point of a shape', () => {
      const shapeTypes = [
        'rectangle',
        'ellipse',
        'diamond',
        'frame',
        'text',
        'image',
        'embed',
      ] as const;
      const assertContains = (e: DriplElement, points: Point[]) => {
        const b = getElementBounds(e);
        const pad = (e.strokeWidth ?? 0) / 2;
        for (const p of points) {
          expect(p.x).toBeGreaterThanOrEqual(b.x - 1e-6);
          expect(p.x).toBeLessThanOrEqual(b.x + b.width + pad + 1e-6);
          expect(p.y).toBeGreaterThanOrEqual(b.y - 1e-6);
          expect(p.y).toBeLessThanOrEqual(b.y + b.height + pad + 1e-6);
        }
      };
      fc.assert(
        fc.property(
          fc.constantFrom<DriplElement['type']>(...shapeTypes),
          num(-300, 300),
          num(-300, 300),
          num(1, 250),
          num(1, 250),
          fcAngle,
          (type, x, y, w, h, angle) => {
            const e = el({ type, x, y, width: w, height: h, angle, strokeWidth: 2 });
            const c = centreOf(e);
            assertContains(
              e,
              [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)].map(p =>
                rotatePoint(p, c.x, c.y, angle)
              )
            );
          }
        ),
        { seed: SEED, numRuns: 300 }
      );
      fc.assert(
        fc.property(fc.array(fcPoint, { minLength: 1, maxLength: 8 }), fcAngle, (points, angle) => {
          const e = path('freedraw', points, {
            x: 20,
            y: 30,
            width: 200,
            height: 200,
            angle,
            strokeWidth: 2,
          });
          assertContains(
            e,
            points.map(p => elementLocalPointToWorld(e, p))
          );
        }),
        { seed: SEED, numRuns: 300 }
      );
    });

    it('translates with the element', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<DriplElement['type']>('rectangle', 'freedraw'),
          num(-1000, 1000),
          num(-1000, 1000),
          fcAngle,
          (type, dx, dy, angle) => {
            const base =
              type === 'rectangle'
                ? el({ type, x: 13, y: 27, width: 61, height: 33, angle })
                : path('freedraw', [pt(0, 0), pt(30, 10), pt(61, 33)], {
                    x: 13,
                    y: 27,
                    width: 61,
                    height: 33,
                    angle,
                  });
            const moved = { ...base, x: base.x + dx, y: base.y + dy } as DriplElement;
            const a = getElementBounds(base);
            const b = getElementBounds(moved);
            expect(b.x - dx).toBeCloseTo(a.x, 6);
            expect(b.y - dy).toBeCloseTo(a.y, 6);
            expect(b.width).toBeCloseTo(a.width, 6);
            expect(b.height).toBeCloseTo(a.height, 6);
          }
        ),
        { seed: SEED, numRuns: RUNS }
      );
    });
  });

  describe('isPointInElement', () => {
    it('accepts the interior and rejects points outside the box', () => {
      const r = el({ type: 'rectangle', x: 0, y: 0, width: 100, height: 40 });
      expect(isPointInElement(pt(50, 20), r)).toBe(true);
      expect(isPointInElement(pt(0, 0), r)).toBe(true);
      expect(isPointInElement(pt(100, 40), r)).toBe(true);
      expect(isPointInElement(pt(-1, 20), r)).toBe(false);
      expect(isPointInElement(pt(50, 41), r)).toBe(false);
    });

    it('uses the exact ellipse equation, not its bounding box', () => {
      const e = el({ type: 'ellipse', x: 0, y: 0, width: 100, height: 100 });
      expect(isPointInElement(pt(50, 50), e)).toBe(true);
      expect(isPointInElement(pt(5, 50), e)).toBe(true); // on the minor axis
      expect(isPointInElement(pt(5, 5), e)).toBe(false); // corner of the box, outside the ellipse
    });

    it('accepts all four diamond vertices and rejects the box corners', () => {
      const d = el({ type: 'diamond', x: 0, y: 0, width: 100, height: 100 });
      // Regression: the ray-cast interior test reported three of the four
      // vertices as outside, so they were not hit-testable.
      expect(isPointInElement(pt(50, 0), d)).toBe(true);
      expect(isPointInElement(pt(100, 50), d)).toBe(true);
      expect(isPointInElement(pt(50, 100), d)).toBe(true);
      expect(isPointInElement(pt(0, 50), d)).toBe(true);
      expect(isPointInElement(pt(50, 50), d)).toBe(true);
      expect(isPointInElement(pt(1, 1), d)).toBe(false);
      expect(isPointInElement(pt(99, 99), d)).toBe(false);
    });

    it('has no interior test for frame or embed', () => {
      for (const type of ['frame', 'embed'] as const) {
        expect(isPointInElement(pt(50, 30), el({ type }))).toBe(false);
      }
    });

    it('hits a path within strokeWidth/2 + 2 of the centreline', () => {
      // Bounds for this path are y in [-2, 2]; the tolerance reaches 4, so the
      // pre-filter must be inflated by the same slack or the last 2px are lost.
      const line = path('line', [pt(0, 0), pt(100, 0)], { x: 0, y: 0, strokeWidth: 4 });
      expect(getElementBounds(line)).toMatchObject({ x: -2, y: -2, width: 104, height: 4 });
      expect(isPointInElement(pt(50, 0), line)).toBe(true);
      expect(isPointInElement(pt(50, 4), line)).toBe(true);
      expect(isPointInElement(pt(50, 4.001), line)).toBe(false);
      expect(isPointInElement(pt(-2.5, 0), line)).toBe(true);
      expect(isPointInElement(pt(-4, 0), line)).toBe(true); // 4 from the start point
      expect(isPointInElement(pt(-4.001, 0), line)).toBe(false);
      expect(isPointInElement(pt(50, 40), line)).toBe(false);
    });

    it('hits a single-point path as a dot', () => {
      const dot = path('line', [pt(50, 50)], { x: 0, y: 0, strokeWidth: 4 });
      expect(isPointInElement(pt(53, 50), dot)).toBe(true);
      expect(isPointInElement(pt(50, 60), dot)).toBe(false);
    });

    it('fills a closed freedraw but not an open one', () => {
      // Loop gap is 1.41 here and 80 in the open case; the fill test uses a
      // strokeWidth/2 + 1 = 2 threshold, distinct from isPathALoop's 10.
      const closed = path('freedraw', [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100), pt(1, 1)]);
      const open = path('freedraw', [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100), pt(0, 80)]);
      expect(isPathALoop(closed as never)).toBe(true);
      expect(isPathALoop(open as never)).toBe(false);
      expect(isPointInElement(pt(50, 50), closed)).toBe(true);
      expect(isPointInElement(pt(50, 50), open)).toBe(false);
    });

    it('is invariant under translation', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<DriplElement['type']>('rectangle', 'ellipse', 'diamond'),
          num(-1000, 1000),
          num(-1000, 1000),
          fcPoint,
          (type, dx, dy, p) => {
            const base = el({ type, x: 40, y: 60, width: 90, height: 70, angle: 0.4 });
            const moved = { ...base, x: base.x + dx, y: base.y + dy } as DriplElement;
            expect(isPointInElement(pt(p.x + dx, p.y + dy), moved)).toBe(isPointInElement(p, base));
          }
        ),
        { seed: SEED, numRuns: RUNS }
      );
      fc.assert(
        fc.property(
          fc.array(fcPoint, { minLength: 1, maxLength: 6 }),
          num(-300, 300),
          num(-300, 300),
          fcPoint,
          (points, dx, dy, p) => {
            const base = path('line', points, { x: 10, y: 10, width: 200, height: 200 });
            const moved = { ...base, x: base.x + dx, y: base.y + dy } as DriplElement;
            expect(isPointInElement(pt(p.x + dx, p.y + dy), moved)).toBe(isPointInElement(p, base));
          }
        ),
        { seed: SEED, numRuns: RUNS }
      );
    });

    it('is equivariant under rotation for shapes and paths', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<DriplElement['type']>('rectangle', 'ellipse', 'diamond'),
          num(2, 200),
          num(2, 200),
          fcAngle,
          fcPoint,
          (type, w, h, angle, p) => {
            const base = el({ type, x: 30, y: 40, width: w, height: h, angle: 0 });
            const turned = { ...base, angle } as DriplElement;
            const c = centreOf(base);
            expect(isPointInElement(p, turned)).toBe(
              isPointInElement(inverseRotatePoint(p, c.x, c.y, angle), base)
            );
          }
        ),
        { seed: SEED, numRuns: RUNS }
      );
      fc.assert(
        fc.property(
          fc.array(fcPoint, { minLength: 1, maxLength: 6 }),
          fcAngle,
          fcPoint,
          (points, angle, p) => {
            const base = path('freedraw', points, {
              x: 20,
              y: 30,
              width: 200,
              height: 200,
              angle: 0,
            });
            const turned = { ...base, angle } as DriplElement;
            const c = centreOf(base);
            expect(isPointInElement(p, turned)).toBe(
              isPointInElement(inverseRotatePoint(p, c.x, c.y, angle), base)
            );
          }
        ),
        { seed: SEED, numRuns: RUNS }
      );
    });
  });

  describe('getDistanceToBounds', () => {
    const box = el({ type: 'rectangle', x: 0, y: 0, width: 10, height: 10, strokeWidth: 0 });

    it('is zero for any point inside the box', () => {
      expect(getDistanceToBounds(pt(5, 5), box)).toBe(0);
      expect(getDistanceToBounds(pt(0, 0), box)).toBe(0);
    });

    it('is the gap to the nearest face, and to the corner off a corner', () => {
      expect(getDistanceToBounds(pt(-3, 5), box)).toBe(3);
      expect(getDistanceToBounds(pt(13, 5), box)).toBe(3);
      expect(getDistanceToBounds(pt(5, -4), box)).toBe(4);
      expect(getDistanceToBounds(pt(-3, -4), box)).toBe(5);
    });

    it('matches an independent point-to-rect reference', () => {
      fc.assert(
        fc.property(
          num(-200, 200),
          num(-200, 200),
          num(1, 200),
          num(1, 200),
          num(0, 5),
          fcPoint,
          (x, y, w, h, sw, p) => {
            const e = el({ type: 'rectangle', x, y, width: w, height: h, strokeWidth: sw });
            const b = getElementBounds(e);
            const nx = Math.max(b.x, Math.min(p.x, b.x + b.width));
            const ny = Math.max(b.y, Math.min(p.y, b.y + b.height));
            expect(getDistanceToBounds(p, e)).toBeCloseTo(Math.hypot(p.x - nx, p.y - ny), 9);
          }
        ),
        { seed: SEED, numRuns: RUNS }
      );
    });
  });

  describe('isPointNearElement', () => {
    it('is true for interior points regardless of tolerance', () => {
      expect(isPointNearElement(pt(50, 30), el({ type: 'rectangle' }), 0)).toBe(true);
    });

    it('flips exactly at the tolerance for points outside the bounds', () => {
      const r = el({ type: 'rectangle', x: 0, y: 0, width: 100, height: 40, strokeWidth: 0 });
      expect(getDistanceToBounds(pt(-4, 20), r)).toBe(4);
      expect(isPointNearElement(pt(-4, 20), r, 3.9)).toBe(false);
      expect(isPointNearElement(pt(-4, 20), r, 4)).toBe(true);
    });

    it('never turns off as the tolerance grows', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<DriplElement['type']>(
            'rectangle',
            'ellipse',
            'diamond',
            'frame',
            'text',
            'image'
          ),
          num(-100, 100),
          num(-100, 100),
          num(1, 150),
          num(1, 150),
          fcAngle,
          fcPoint,
          num(0, 20),
          (type, x, y, w, h, angle, p, t) => {
            const e = el({ type, x, y, width: w, height: h, angle, backgroundColor: '#fff' });
            if (isPointNearElement(p, e, t)) {
              expect(isPointNearElement(p, e, t + 25)).toBe(true);
            }
          }
        ),
        { seed: SEED, numRuns: RUNS }
      );
    });

    it('translates with the element', () => {
      fc.assert(
        fc.property(num(-500, 500), num(-500, 500), fcPoint, num(0, 15), (dx, dy, p, t) => {
          const base = el({ type: 'ellipse', x: 20, y: 30, width: 80, height: 40, angle: 0.5 });
          const moved = { ...base, x: base.x + dx, y: base.y + dy } as DriplElement;
          expect(isPointNearElement(pt(p.x + dx, p.y + dy), moved, t)).toBe(
            isPointNearElement(p, base, t)
          );
        }),
        { seed: SEED, numRuns: RUNS }
      );
    });
  });

  describe('isPointOnElementOutline', () => {
    const rect = el({ type: 'rectangle', x: 0, y: 0, width: 100, height: 40 });

    it('hits a point exactly on an edge and misses the middle of the interior', () => {
      expect(isPointOnElementOutline(pt(0, 20), rect, 0)).toBe(true);
      expect(isPointOnElementOutline(pt(50, 0), rect, 0)).toBe(true);
      expect(isPointOnElementOutline(pt(100, 20), rect, 0)).toBe(true);
      expect(isPointOnElementOutline(pt(50, 40), rect, 0)).toBe(true);
      expect(isPointOnElementOutline(pt(0, 0), rect, 0)).toBe(true); // corner
      expect(isPointOnElementOutline(pt(50, 20), rect, 0)).toBe(false);
    });

    it('flips at the analytic distance from the rectangle border', () => {
      // Distance from (50,-3) to the border is 3; from (-3,-4) it is 5.
      expect(isPointOnElementOutline(pt(50, -3), rect, 2.9)).toBe(false);
      expect(isPointOnElementOutline(pt(50, -3), rect, 3)).toBe(true);
      expect(isPointOnElementOutline(pt(-3, -4), rect, 4.9)).toBe(false);
      expect(isPointOnElementOutline(pt(-3, -4), rect, 5)).toBe(true);
    });

    it('treats a frame like a rectangle', () => {
      const frame = el({ type: 'frame', x: 0, y: 0, width: 100, height: 40 });
      expect(isPointOnElementOutline(pt(0, 20), frame, 0)).toBe(true);
      expect(isPointOnElementOutline(pt(50, 20), frame, 0)).toBe(false);
    });

    it('flips at the analytic distance from a diamond edge', () => {
      const d = el({ type: 'diamond', x: 0, y: 0, width: 100, height: 100 });
      // Upper-right edge runs (50,0)->(100,50), i.e. the line x - y = 50.
      const gapOf = (x: number, y: number) => Math.abs(x - y - 50) / Math.SQRT2;
      expect(gapOf(75, 25)).toBeCloseTo(0, 9);
      expect(isPointOnElementOutline(pt(75, 25), d, 1e-9)).toBe(true);
      expect(isPointOnElementOutline(pt(75, 20), d, gapOf(75, 20) - 1e-6)).toBe(false);
      expect(isPointOnElementOutline(pt(75, 20), d, gapOf(75, 20) + 1e-6)).toBe(true);
      expect(isPointOnElementOutline(pt(50, 50), d, 0)).toBe(false);
    });

    it('hits an ellipse boundary point and misses the centre', () => {
      // The outline is a 32-gon inscribed in the ellipse, so a point on the true
      // ellipse is at most r * (1 - cos(pi/32)) away from the sampled outline.
      const e = el({ type: 'ellipse', x: 0, y: 0, width: 100, height: 100 });
      expect(isPointOnElementOutline(pt(100, 50), e, 0)).toBe(true);
      expect(isPointOnElementOutline(pt(50, 0), e, 1e-9)).toBe(true);
      expect(isPointOnElementOutline(pt(50, 50), e, 0)).toBe(false);
      const sagitta = 50 * (1 - Math.cos(Math.PI / 32));
      const worstCase = pt(50 + 50 * Math.cos(Math.PI / 32), 50 + 50 * Math.sin(Math.PI / 32));
      expect(isPointOnElementOutline(worstCase, e, sagitta * 2)).toBe(true);
    });

    it('hits a path within strokeWidth/2 + threshold of the centreline', () => {
      const line = path('line', [pt(0, 0), pt(100, 0)], { x: 0, y: 0, strokeWidth: 4 });
      expect(isPointOnElementOutline(pt(50, 2), line, 0)).toBe(true);
      expect(isPointOnElementOutline(pt(50, 2.5), line, 0)).toBe(false);
      expect(isPointOnElementOutline(pt(50, 2.5), line, 0.5)).toBe(true);
      expect(isPointOnElementOutline(pt(500, 0), line, 0)).toBe(false);
    });

    it('is equivariant under rotation', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<DriplElement['type']>(
            'rectangle',
            'ellipse',
            'diamond',
            'frame',
            'text',
            'image'
          ),
          num(2, 200),
          num(2, 200),
          fcAngle,
          fcPoint,
          num(0, 15),
          (type, w, h, angle, p, t) => {
            const base = el({ type, x: 30, y: 40, width: w, height: h, angle: 0 });
            const turned = { ...base, angle } as DriplElement;
            const c = centreOf(base);
            expect(isPointOnElementOutline(p, turned, t)).toBe(
              isPointOnElementOutline(inverseRotatePoint(p, c.x, c.y, angle), base, t)
            );
          }
        ),
        { seed: SEED, numRuns: RUNS }
      );
      fc.assert(
        fc.property(
          fc.array(fcPoint, { minLength: 2, maxLength: 6 }),
          fcAngle,
          fcPoint,
          num(0, 15),
          (points, angle, p, t) => {
            const base = path('line', points, { x: 20, y: 30, width: 200, height: 200, angle: 0 });
            const turned = { ...base, angle } as DriplElement;
            const c = centreOf(base);
            expect(isPointOnElementOutline(p, turned, t)).toBe(
              isPointOnElementOutline(inverseRotatePoint(p, c.x, c.y, angle), base, t)
            );
          }
        ),
        { seed: SEED, numRuns: RUNS }
      );
    });

    it('translates with the element', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<DriplElement['type']>('rectangle', 'ellipse', 'diamond'),
          num(-500, 500),
          num(-500, 500),
          fcPoint,
          num(0, 12),
          (type, dx, dy, p, t) => {
            const base = el({ type, x: 15, y: 25, width: 70, height: 50, angle: 0.9 });
            const moved = { ...base, x: base.x + dx, y: base.y + dy } as DriplElement;
            expect(isPointOnElementOutline(pt(p.x + dx, p.y + dy), moved, t)).toBe(
              isPointOnElementOutline(p, base, t)
            );
          }
        ),
        { seed: SEED, numRuns: RUNS }
      );
    });

    it('returns false for a type with no outline test', () => {
      expect(isPointOnElementOutline(pt(50, 30), el({ type: 'embed' }), 100)).toBe(false);
    });

    it('follows the rotation of a shape element, as the canvas transform does', () => {
      // The outline test counter-rotates the probe point, so a rotated element
      // must behave exactly like the unrotated one at the inverse-rotated point.
      const base = el({ type: 'rectangle', x: 0, y: 0, width: 120, height: 40 });
      const turned = { ...base, angle: Math.PI / 4 } as DriplElement;
      const c = centreOf(base);
      for (const probe of [
        pt(0, 20),
        pt(60, 0),
        pt(120, 20),
        pt(60, 40),
        pt(-10, -10),
        pt(60, 20),
      ]) {
        expect(isPointOnElementOutline(probe, turned, 0)).toBe(
          isPointOnElementOutline(inverseRotatePoint(probe, c.x, c.y, Math.PI / 4), base, 0)
        );
      }
    });
  });

  describe('elementIntersectsSegment', () => {
    // Exported but with no caller anywhere in the repo; characterised here so the
    // behaviour is pinned if it is ever wired up.
    const rect = el({ type: 'rectangle', x: 0, y: 0, width: 100, height: 40, strokeWidth: 0 });

    it('detects a stroke crossing the element', () => {
      expect(elementIntersectsSegment(rect, { start: pt(-10, 20), end: pt(110, 20) })).toBe(true);
      expect(elementIntersectsSegment(rect, { start: pt(50, -10), end: pt(50, 50) })).toBe(true);
    });

    it('detects a stroke entirely inside the element', () => {
      expect(elementIntersectsSegment(rect, { start: pt(10, 10), end: pt(90, 30) })).toBe(true);
    });

    it('rejects a stroke clear of the element', () => {
      expect(elementIntersectsSegment(rect, { start: pt(-50, 20), end: pt(-10, 20) })).toBe(false);
      expect(elementIntersectsSegment(rect, { start: pt(0, 200), end: pt(100, 200) })).toBe(false);
    });

    it('gates shape hits on the threshold-expanded box, not a thicker stroke', () => {
      // For shape elements the threshold only widens the cheap box reject; the
      // geometric test still uses the unthickened segment.
      const stroke = { start: pt(-5, -3), end: pt(105, -3) };
      expect(elementIntersectsSegment(rect, stroke, 0)).toBe(false);
      expect(elementIntersectsSegment(rect, stroke, 4)).toBe(false);
      expect(elementIntersectsSegment(rect, { start: pt(-5, -3), end: pt(105, 3) }, 4)).toBe(true);
    });

    it('detects a stroke crossing a path element', () => {
      // Regression: the old endpoint-distance-only test reported false here,
      // because a crossing has four positive endpoint distances and distance 0.
      const line = path('line', [pt(0, 0), pt(100, 0)], { x: 0, y: 0, strokeWidth: 0 });
      expect(elementIntersectsSegment(line, { start: pt(50, -20), end: pt(50, 20) })).toBe(true);
      expect(elementIntersectsSegment(line, { start: pt(50, -20), end: pt(50, -5) })).toBe(false);
      // Threshold widens the tolerance around the centreline for paths.
      expect(elementIntersectsSegment(line, { start: pt(50, -20), end: pt(50, -5) }, 6)).toBe(true);
    });

    it('handles diamond and ellipse outlines', () => {
      const diamond = el({ type: 'diamond', x: 0, y: 0, width: 100, height: 100, strokeWidth: 0 });
      expect(elementIntersectsSegment(diamond, { start: pt(50, -10), end: pt(50, 110) })).toBe(
        true
      );
      expect(elementIntersectsSegment(diamond, { start: pt(-10, 50), end: pt(110, 50) })).toBe(
        true
      );
      // Horizontal at y=2: enters through the upper-left edge at x=48, and the
      // upper-right edge at x=52.
      expect(elementIntersectsSegment(diamond, { start: pt(2, 2), end: pt(98, 2) })).toBe(true);
      expect(elementIntersectsSegment(diamond, { start: pt(-30, 2), end: pt(60, 2) })).toBe(true);
      expect(elementIntersectsSegment(diamond, { start: pt(-30, 2), end: pt(20, 2) })).toBe(false);

      const ellipse = el({ type: 'ellipse', x: 0, y: 0, width: 100, height: 100, strokeWidth: 0 });
      expect(elementIntersectsSegment(ellipse, { start: pt(50, -10), end: pt(50, 110) })).toBe(
        true
      );
      expect(elementIntersectsSegment(ellipse, { start: pt(-10, 50), end: pt(110, 50) })).toBe(
        true
      );
      expect(elementIntersectsSegment(ellipse, { start: pt(-30, 50), end: pt(-20, 50) })).toBe(
        false
      );
    });

    it('rotates shape outlines by the element angle, as the canvas transform does', () => {
      // Rotation invariance for the segment version: a rotated rectangle must
      // intersect exactly the segments the unrotated one does, taken to the
      // unrotated frame.
      for (const type of ['rectangle', 'diamond', 'ellipse'] as const) {
        const base = el({ type, x: 10, y: 20, width: 80, height: 60, strokeWidth: 0 });
        const turned = { ...base, angle: 0.6 } as DriplElement;
        const c = centreOf(base);
        const toLocal = (s: { start: Point; end: Point }) => ({
          start: inverseRotatePoint(s.start, c.x, c.y, 0.6),
          end: inverseRotatePoint(s.end, c.x, c.y, 0.6),
        });
        const strokes = [
          { start: pt(-40, 50), end: pt(150, 50) },
          { start: pt(50, -40), end: pt(50, 130) },
          { start: pt(20, 30), end: pt(80, 70) },
          { start: pt(-60, -40), end: pt(-30, -20) },
        ];
        for (const stroke of strokes) {
          expect(elementIntersectsSegment(turned, stroke)).toBe(
            elementIntersectsSegment(base, toLocal(stroke))
          );
        }
      }
    });

    it('rotates path outlines by the element angle', () => {
      const points = [pt(0, 0), pt(60, 20), pt(120, 0)];
      const base = path('line', points, { x: 10, y: 20, width: 120, height: 20, strokeWidth: 0 });
      const turned = { ...base, angle: 0.9 } as DriplElement;
      const c = centreOf(base);
      const stroke = { start: pt(70, -60), end: pt(70, 100) };
      const local = {
        start: inverseRotatePoint(stroke.start, c.x, c.y, 0.9),
        end: inverseRotatePoint(stroke.end, c.x, c.y, 0.9),
      };
      expect(elementIntersectsSegment(turned, stroke)).toBe(elementIntersectsSegment(base, local));
      expect(elementIntersectsSegment(turned, stroke)).toBe(true);
    });

    it('ignores types with no shape test', () => {
      expect(
        elementIntersectsSegment(el({ type: 'embed' }), { start: pt(50, 30), end: pt(60, 30) })
      ).toBe(false);
    });

    it('fills a closed freedraw when the stroke crosses the interior', () => {
      const closed = path('freedraw', [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100), pt(1, 1)]);
      const open = path('freedraw', [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100), pt(0, 80)]);
      // A stroke wholly inside the closed shape: no edge is crossed, so this
      // only works via the interior fill.
      expect(elementIntersectsSegment(closed, { start: pt(10, 50), end: pt(90, 50) })).toBe(true);
      expect(elementIntersectsSegment(open, { start: pt(10, 50), end: pt(90, 50) })).toBe(false);
      // Two-point paths have no interior to fill, only the centreline test.
      expect(
        elementIntersectsSegment(path('freedraw', [pt(0, 0), pt(100, 0)]), {
          start: pt(10, 50),
          end: pt(90, 50),
        })
      ).toBe(false);
    });
  });

  describe('getFreedrawOutline', () => {
    it('returns an empty array for no points', () => {
      expect(getFreedrawOutline(path('freedraw', []) as FreeDrawElement)).toEqual([]);
    });

    it('is exactly the element-local-to-world map over points', () => {
      // Exported but with no caller anywhere in the repo; the app uses
      // elementLocalPointToWorld directly, so the two must not drift.
      fc.assert(
        fc.property(fc.array(fcPoint, { minLength: 0, maxLength: 8 }), fcAngle, (points, angle) => {
          const e = path('freedraw', points, { x: 20, y: 30, width: 200, height: 200, angle });
          expect(getFreedrawOutline(e as FreeDrawElement)).toEqual(
            points.map(p => elementLocalPointToWorld(e, p))
          );
        }),
        { seed: SEED, numRuns: RUNS }
      );
    });
  });
});
