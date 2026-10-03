import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { DriplElement, Point } from '@dripl/common';
import { getElementBounds } from '@dripl/math/intersection';
import { rotatePoint } from '@dripl/math/geometry';

import { resizeSingleElement, type TransformHandleDirection } from '../resizeElements';

const HANDLES: readonly TransformHandleDirection[] = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'];

/**
 * `fc.double` yields NaN by default, and every arithmetic below would then be
 * compared against NaN, which `toBeCloseTo` refuses. Sizes are also never NaN
 * in the product: they come from pointer deltas.
 */
const coord = (min: number, max: number) => fc.double({ min, max, noNaN: true });

/**
 * World coordinates. Bounded away from the denormal range on purpose: a
 * coordinate of 5e-324 is annihilated by adding a size delta of 49.5, so the
 * origin maths would report a 1e-324 error that is IEEE-754, not a defect.
 */
const position = (min: number, max: number) => fc.double({ min, max, noNaN: true });

/**
 * Absolute-or-relative closeness. Origin maths mixes world coordinates in the
 * thousands with deltas in the hundredths, so a fixed absolute epsilon either
 * fails on legitimate floating-point noise or hides a real error.
 */
function expectCloseTo(actual: number, expected: number, places = 9): void {
  const tolerance = Math.max(1e-6, Math.abs(expected) * 10 ** -places);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rect(overrides: Partial<DriplElement> = {}): DriplElement {
  return {
    id: 'r1',
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    ...overrides,
  } as DriplElement;
}

/** The named corner or edge midpoint of a box, in the box's own coordinates. */
const EDGE: Record<TransformHandleDirection, (b: Box) => Point> = {
  n: b => ({ x: b.x + b.width / 2, y: b.y }),
  s: b => ({ x: b.x + b.width / 2, y: b.y + b.height }),
  e: b => ({ x: b.x + b.width, y: b.y + b.height / 2 }),
  w: b => ({ x: b.x, y: b.y + b.height / 2 }),
  ne: b => ({ x: b.x + b.width, y: b.y }),
  nw: b => ({ x: b.x, y: b.y }),
  se: b => ({ x: b.x + b.width, y: b.y + b.height }),
  sw: b => ({ x: b.x, y: b.y + b.height }),
};

/** World position after the element's own rotation about its own centre. */
function worldOf(local: Point, box: Box, angle: number): Point {
  if (!angle) return local;
  return rotatePoint(local, box.x + box.width / 2, box.y + box.height / 2, angle);
}

/**
 * `handle` is the corner being dragged; `opposite` is the corner that must not
 * move. The two are listed explicitly rather than derived, so a mirrored anchor
 * table in the implementation cannot make the expectation follow it.
 */
const DRAG_AND_FIXED: readonly (readonly [TransformHandleDirection, TransformHandleDirection])[] = [
  ['ne', 'sw'],
  ['nw', 'se'],
  ['se', 'nw'],
  ['sw', 'ne'],
  ['n', 's'],
  ['s', 'n'],
  ['e', 'w'],
  ['w', 'e'],
];

describe('a resize pins the corner or edge the user is not dragging', () => {
  // The headline property. A mirrored or transposed anchor table still passes
  // every hand-written origin assertion, because those assertions were derived
  // from the same formulas — only an independent geometric invariant catches it.
  for (const [handle, fixed] of DRAG_AND_FIXED) {
    it(`${handle} drag leaves ${fixed} exactly where it was, at any angle`, () => {
      fc.assert(
        fc.property(
          position(-1_000_000, 1_000_000),
          position(-1_000_000, 1_000_000),
          coord(1, 2000),
          coord(1, 2000),
          coord(1, 4000),
          coord(1, 4000),
          coord(-Math.PI * 2, Math.PI * 2),
          (x, y, width, height, nextWidth, nextHeight, angle) => {
            const before: Box = { x, y, width, height };
            const element = rect({ x, y, width, height, angle });
            const result = resizeSingleElement(nextWidth, nextHeight, element, element, handle);
            const after: Box = {
              x: result.x as number,
              y: result.y as number,
              width: result.width as number,
              height: result.height as number,
            };

            const beforeWorld = worldOf(EDGE[fixed](before), before, angle);
            const afterWorld = worldOf(EDGE[fixed](after), after, angle);

            expectCloseTo(afterWorld.x, beforeWorld.x, 6);
            expectCloseTo(afterWorld.y, beforeWorld.y, 6);
          }
        ),
        { numRuns: 500 }
      );
    });
  }
});

describe('resizeSingleElement size contract', () => {
  it('never reports a width or height below 1', () => {
    fc.assert(
      fc.property(
        coord(-10_000, 10_000),
        coord(-10_000, 10_000),
        fc.constantFrom(...HANDLES),
        (nextWidth, nextHeight, handle) => {
          const element = rect({ width: 100, height: 80 });
          const result = resizeSingleElement(nextWidth, nextHeight, element, element, handle);
          expect(result.width).toBeGreaterThanOrEqual(1);
          expect(result.height).toBeGreaterThanOrEqual(1);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('reports the requested size unchanged when it is above the floor', () => {
    fc.assert(
      fc.property(
        coord(1.0001, 5000),
        coord(1.0001, 5000),
        fc.constantFrom(...HANDLES),
        (nextWidth, nextHeight, handle) => {
          const element = rect({ width: 100, height: 80 });
          const result = resizeSingleElement(nextWidth, nextHeight, element, element, handle);
          expectCloseTo(result.width as number, nextWidth);
          expectCloseTo(result.height as number, nextHeight);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('never moves the origin for a south-east drag at zero angle', () => {
    // `se` resolves to the `top-left` anchor, whose x and y deltas cancel
    // exactly at angle 0. With no rotation the origin is therefore pinned, and
    // the assertion is exact to floating-point precision. (At a non-zero angle
    // the origin legitimately moves by `(Δ/2)·sin θ + (Δ/2)·(cos θ - 1)`; the
    // general case is covered by the pinned-corner property above, which is
    // angle-agnostic by construction.)
    fc.assert(
      fc.property(
        position(-1_000_000, 1_000_000),
        position(-1_000_000, 1_000_000),
        coord(1, 4000),
        coord(1, 4000),
        (x, y, nextWidth, nextHeight) => {
          const element = rect({ x, y, width: 100, height: 100, angle: 0 });
          const result = resizeSingleElement(nextWidth, nextHeight, element, element, 'se');
          expect(result.x).toBeCloseTo(x, 6);
          expect(result.y).toBeCloseTo(y, 6);
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('resize from centre', () => {
  it('keeps the centre fixed in world space, at any angle', () => {
    fc.assert(
      fc.property(
        position(-1_000_000, 1_000_000),
        position(-1_000_000, 1_000_000),
        coord(1, 2000),
        coord(1, 2000),
        coord(1, 4000),
        coord(1, 4000),
        coord(-Math.PI * 2, Math.PI * 2),
        (x, y, width, height, nextWidth, nextHeight, angle) => {
          const element = rect({ x, y, width, height, angle });
          const result = resizeSingleElement(nextWidth, nextHeight, element, element, 'se', {
            shouldResizeFromCenter: true,
          });
          const before = { x: x + width / 2, y: y + height / 2 };
          const after = {
            x: (result.x as number) + (result.width as number) / 2,
            y: (result.y as number) + (result.height as number) / 2,
          };
          // The centre is the rotation pivot, so it is the same world point
          // before and after whatever the angle.
          expectCloseTo(after.x, before.x, 6);
          expectCloseTo(after.y, before.y, 6);
        }
      ),
      { numRuns: 400 }
    );
  });
});

describe('linear and freedraw point scaling', () => {
  for (const type of ['arrow', 'line', 'freedraw'] as const) {
    it(`${type}: relative points scale by exactly next/prev on each axis`, () => {
      fc.assert(
        fc.property(
          coord(-500, 500),
          coord(-500, 500),
          coord(1, 1000),
          coord(1, 1000),
          coord(1, 3000),
          coord(1, 3000),
          (px, py, width, height, nextWidth, nextHeight) => {
            const element = {
              ...rect({ x: 20, y: 30, width, height }),
              type,
              points: [
                { x: px, y: py },
                { x: width, y: height },
              ],
            } as DriplElement;

            const result = resizeSingleElement(nextWidth, nextHeight, element, element, 'se');
            const points = result.points as Point[];
            expect(points).toHaveLength(2);
            expectCloseTo(points[0]!.x, (px * nextWidth) / width);
            expectCloseTo(points[0]!.y, (py * nextHeight) / height);
            expectCloseTo(points[1]!.x, nextWidth);
            expectCloseTo(points[1]!.y, nextHeight);
          }
        ),
        { numRuns: 300 }
      );
    });
  }

  it('does not divide by zero when the gesture started on a zero-width path', () => {
    // A vertical line has width 0. Scaling x by nextWidth/0 would put Infinity
    // or NaN into a point, and those poison every downstream bounds
    // computation silently instead of failing loudly.
    fc.assert(
      fc.property(coord(1, 2000), coord(1, 2000), (nextWidth, nextHeight) => {
        const element = {
          ...rect({ x: 5, y: 5, width: 0, height: 100 }),
          type: 'line',
          points: [
            { x: 0, y: 0 },
            { x: 0, y: 100 },
          ],
        } as DriplElement;

        const result = resizeSingleElement(nextWidth, nextHeight, element, element, 'se');
        for (const point of result.points as Point[]) {
          expect(Number.isFinite(point.x)).toBe(true);
          expect(Number.isFinite(point.y)).toBe(true);
        }
        // The unscaled axis is held, not blown up.
        expect((result.points as Point[])[0]!.x).toBe(0);
        expect((result.points as Point[])[1]!.y).toBeCloseTo(nextHeight, 9);
      }),
      { numRuns: 200 }
    );
  });

  it('returns no properties when the gesture-start element had no points', () => {
    const stripped = {
      ...rect(),
      type: 'arrow',
      points: undefined,
    } as unknown as DriplElement;
    expect(resizeSingleElement(200, 200, stripped, stripped, 'se')).toEqual({});
  });
});

describe('the resize maths agrees with the culling maths', () => {
  it('produces bounds the culler reads back as the unrotated box, padding included', () => {
    // `getElementBounds` and `getResizedOrigin` are separate code paths. If a
    // resize returned a mirrored origin, the renderer would draw the element
    // where the resizer says and the culler would look for it somewhere else —
    // invisible until the next selection, and then only as "the editor lost my
    // shape". At zero rotation the two must agree exactly, padding included.
    fc.assert(
      fc.property(
        position(-100_000, 100_000),
        position(-100_000, 100_000),
        coord(10, 1000),
        coord(10, 1000),
        coord(10, 3000),
        coord(10, 3000),
        coord(0, 0),
        fc.constantFrom(...HANDLES),
        (x, y, width, height, nextWidth, nextHeight, angle, handle) => {
          const strokeWidth = 4;
          const element = rect({ x, y, width, height, angle, strokeWidth });
          const result = resizeSingleElement(nextWidth, nextHeight, element, element, handle);
          const resized = { ...element, ...result } as DriplElement;
          const bounds = getElementBounds(resized);
          const padding = strokeWidth / 2;

          expect(bounds.x).toBeCloseTo((result.x as number) - padding, 9);
          expect(bounds.y).toBeCloseTo((result.y as number) - padding, 9);
          expect(bounds.width).toBeCloseTo((result.width as number) + padding * 2, 9);
          expect(bounds.height).toBeCloseTo((result.height as number) + padding * 2, 9);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('keeps the pinned corner inside the resized element bounds, at any angle', () => {
    fc.assert(
      fc.property(
        position(-100_000, 100_000),
        position(-100_000, 100_000),
        coord(10, 1000),
        coord(10, 1000),
        coord(10, 3000),
        coord(10, 3000),
        coord(-Math.PI, Math.PI),
        fc.constantFrom(...HANDLES),
        (x, y, width, height, nextWidth, nextHeight, angle, handle) => {
          const element = rect({ x, y, width, height, angle });
          const before: Box = { x, y, width, height };
          const result = resizeSingleElement(nextWidth, nextHeight, element, element, handle);
          const after: Box = {
            x: result.x as number,
            y: result.y as number,
            width: result.width as number,
            height: result.height as number,
          };

          const fixedCorner = DRAG_AND_FIXED.find(([h]) => h === handle)?.[1] ?? 'se';
          const worldBefore = worldOf(EDGE[fixedCorner](before), before, angle);
          const worldAfter = worldOf(EDGE[fixedCorner](after), after, angle);

          // The corner is pinned in world space...
          expectCloseTo(worldAfter.x, worldBefore.x, 6);
          expectCloseTo(worldAfter.y, worldBefore.y, 6);

          // ...and it must lie inside the box the culler will search, or the
          // culler is looking at a region that excludes the element's own
          // anchor point.
          const bounds = getElementBounds({ ...element, ...result } as DriplElement);
          expect(worldBefore.x).toBeGreaterThanOrEqual(bounds.x - 1e-6);
          expect(worldBefore.x).toBeLessThanOrEqual(bounds.x + bounds.width + 1e-6);
          expect(worldBefore.y).toBeGreaterThanOrEqual(bounds.y - 1e-6);
          expect(worldBefore.y).toBeLessThanOrEqual(bounds.y + bounds.height + 1e-6);
        }
      ),
      { numRuns: 300 }
    );
  });
});
