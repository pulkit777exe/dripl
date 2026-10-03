import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DriplElementSchema } from '@dripl/common';
import type {
  DriplElement,
  FreeDrawElement,
  LinearElement,
  Point,
  TextElement,
} from '@dripl/common';
import {
  addPoint,
  getBoundingBox,
  getMidpoint,
  insertPointAt,
  removePoint,
  snapPointToElements,
  toRelativePoints,
  updatePoint,
} from '@/utils/tools/shared';
import {
  addPointToLine,
  createLineElement,
  removePointFromLine,
  snapLineToElement,
  updatePointInLine,
} from '@/utils/tools/line';
import {
  addPointToArrow,
  createArrowElement,
  createArrowLabel,
  getArrowMidpoint,
  insertPointIntoArrow,
  removePointFromArrow,
  snapArrowToElement,
  updatePointInArrow,
} from '@/utils/tools/arrow';
import {
  addPointToFreedraw,
  createFreedrawElement,
  removePointFromFreedraw,
  updatePointInFreedraw,
} from '@/utils/tools/freedraw';
import { createTextElement, updateTextDimensions } from '@/utils/tools/text';
import { getDefaultFontFamily } from '@/utils/fontPreferences';
import { baseProps } from './helpers/elements';

/**
 * `utils/tools/shared.ts` is the point-array algebra every point-based tool is
 * built on, and `line.ts` / `arrow.ts` / `freedraw.ts` are the three tools that
 * store points in element-local coordinates.
 *
 * The invariant that ties them together is the local/world round trip: an
 * element stores `points` relative to `(x, y)`, and `getPathPoints` in the
 * renderer adds `(x, y)` back. If these two ever disagree, every arrow and every
 * freehand stroke on the canvas is drawn in the wrong place.
 */

const coord = fc.integer({ min: -5_000_000, max: 5_000_000 }).map(n => n / 1000);
const pointArb = fc.record({ x: coord, y: coord });
const pointList = fc.array(pointArb, { minLength: 1, maxLength: 12 });

type PointyState = { points: Point[]; isComplete: boolean };

const stateWith = (points: Point[]): PointyState => ({ points, isComplete: false });

describe('getBoundingBox', () => {
  it('reports the extremes of the point cloud', () => {
    expect(
      getBoundingBox([
        { x: 3, y: -1 },
        { x: -4, y: 9 },
        { x: 10, y: 2 },
      ])
    ).toEqual({ minX: -4, minY: -1, maxX: 10, maxY: 9 });
  });

  it('collapses to a point for a single input', () => {
    expect(getBoundingBox([{ x: 5, y: 6 }])).toEqual({ minX: 5, minY: 6, maxX: 5, maxY: 6 });
  });

  it('returns an all-degenerate box for an empty list', () => {
    // Not an error, but the reason every caller guards on length first.
    expect(getBoundingBox([])).toEqual({
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    });
  });

  it('holds for arbitrary point clouds', () => {
    fc.assert(
      fc.property(pointList, points => {
        const box = getBoundingBox(points);
        for (const p of points) {
          expect(p.x).toBeGreaterThanOrEqual(box.minX);
          expect(p.x).toBeLessThanOrEqual(box.maxX);
          expect(p.y).toBeGreaterThanOrEqual(box.minY);
          expect(p.y).toBeLessThanOrEqual(box.maxY);
        }
        expect(box.minX).toBe(Math.min(...points.map(p => p.x)));
        expect(box.maxX).toBe(Math.max(...points.map(p => p.x)));
        expect(box.minY).toBe(Math.min(...points.map(p => p.y)));
        expect(box.maxY).toBe(Math.max(...points.map(p => p.y)));
      })
    );
  });
});

describe('toRelativePoints', () => {
  it('translates so the minimum point sits on the origin', () => {
    expect(
      toRelativePoints([
        { x: 10, y: 20 },
        { x: 30, y: 5 },
      ])
    ).toEqual([
      { x: 0, y: 15 },
      { x: 20, y: 0 },
    ]);
  });

  it('keeps the point order and count', () => {
    const points: Point[] = Array.from({ length: 6 }, (_, i) => ({ x: i * 3 - 4, y: i * -2 + 7 }));
    expect(toRelativePoints(points)).toHaveLength(points.length);
    expect(toRelativePoints(points).map(p => p.x)).toEqual(
      points.map(p => p.x - getBoundingBox(points).minX)
    );
  });

  it('returns an empty list for no points', () => {
    expect(toRelativePoints([])).toEqual([]);
  });

  it('produces a bbox whose origin is (0, 0)', () => {
    fc.assert(
      fc.property(pointList, points => {
        const relative = toRelativePoints(points);
        const box = getBoundingBox(relative);
        expect(box.minX).toBe(0);
        expect(box.minY).toBe(0);
      })
    );
  });

  it('round-trips: relative point plus the bounding box origin is the original', () => {
    fc.assert(
      fc.property(pointList, points => {
        const box = getBoundingBox(points);
        const relative = toRelativePoints(points);
        relative.forEach((p, i) => {
          // Subtracting and adding a coordinate is not exactly the identity in
          // IEEE-754, so this is a tolerance check, not an equality check.
          expect(p.x + box.minX).toBeCloseTo(points[i]!.x, 8);
          expect(p.y + box.minY).toBeCloseTo(points[i]!.y, 8);
        });
      })
    );
  });

  it('never mutates its input', () => {
    const points: Point[] = [{ x: 5, y: 7 }];
    const before = JSON.stringify(points);
    toRelativePoints(points);
    expect(JSON.stringify(points)).toBe(before);
  });
});

describe('addPoint', () => {
  it('appends and leaves the original state untouched', () => {
    const state = stateWith([{ x: 0, y: 0 }]);
    const next = addPoint({ x: 1, y: 1 }, state);
    expect(next.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect(state.points).toHaveLength(1);
  });

  it('carries every other field through', () => {
    const state = { ...stateWith([]), isDragging: true, currentPoint: { x: 3, y: 3 } };
    expect(addPoint({ x: 1, y: 1 }, state)).toEqual({
      ...state,
      points: [{ x: 1, y: 1 }],
    });
  });

  it("stores the caller's point object by reference, not a copy", () => {
    // `[...state.points, point]` copies the ARRAY but not the point. Every tool
    // builds a fresh object per pointer event, so nothing is corrupted today,
    // but a caller that mutates a point after adding it would see the change
    // reach back into its own object. Pinned as current behaviour; note the
    // contrast with `getPathPoints`, which does clone.
    const appended = { x: 1, y: 1 };
    const next = addPoint(appended, stateWith([]));
    expect(next.points[0]).toBe(appended);
  });
});

describe('insertPointAt', () => {
  it('inserts before the given index', () => {
    const next = insertPointAt(
      1,
      { x: 9, y: 9 },
      stateWith([
        { x: 0, y: 0 },
        { x: 2, y: 2 },
      ])
    );
    expect(next.points.map(p => p.x)).toEqual([0, 9, 2]);
  });

  it('inserts at the front for index 0 and at the end for index length', () => {
    expect(insertPointAt(0, { x: -1, y: 0 }, stateWith([{ x: 1, y: 1 }])).points[0]!.x).toBe(-1);
    expect(insertPointAt(1, { x: 5, y: 0 }, stateWith([{ x: 1, y: 1 }])).points[1]!.x).toBe(5);
  });

  it('appends for a negative index, because splice counts from the end', () => {
    // splice(-1, 0, p) puts p before the last element, so this is splice
    // semantics, not clamping. Pinned so a change is noticed.
    expect(
      insertPointAt(
        -1,
        { x: 9, y: 0 },
        stateWith([
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ])
      ).points.map(p => p.x)
    ).toEqual([1, 9, 2]);
  });

  it('leaves the original state untouched', () => {
    const state = stateWith([{ x: 1, y: 1 }]);
    insertPointAt(0, { x: 9, y: 9 }, state);
    expect(state.points).toHaveLength(1);
  });
});

describe('removePoint', () => {
  it('removes the point at the index', () => {
    const next = removePoint(
      1,
      stateWith([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ])
    );
    expect(next.points.map(p => p.x)).toEqual([0, 2]);
  });

  it('refuses to go below the two-point floor by default', () => {
    const state = stateWith([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect(removePoint(0, state)).toBe(state);
  });

  it('returns the SAME object reference at the floor, so callers relying on identity see no change', () => {
    const state = stateWith([{ x: 0, y: 0 }]);
    expect(removePoint(0, state)).toBe(state);
  });

  it('honours a custom floor, which is how freedraw allows zero', () => {
    const state = stateWith([{ x: 0, y: 0 }]);
    const next = removePoint(0, state, 0);
    expect(next).not.toBe(state);
    expect(next.points).toEqual([]);
  });

  it('leaves the original state untouched', () => {
    const state = stateWith([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
    removePoint(1, state);
    expect(state.points).toHaveLength(3);
  });

  it('never removes while already at or below the floor, and never grows', () => {
    fc.assert(
      fc.property(
        fc.array(pointArb, { maxLength: 8 }),
        fc.integer({ min: -3, max: 10 }),
        fc.nat(),
        (points, index, floor) => {
          const next = removePoint(index, stateWith(points), floor);
          // The guard is `length <= minPoints`, so a list that STARTS at or below
          // the floor is returned untouched rather than grown to reach it.
          // Above the floor, an out-of-range splice removes nothing and an
          // in-range one removes exactly one, so either length is correct.
          if (points.length <= floor) expect(next.points.length).toBe(points.length);
          else expect([points.length, points.length - 1]).toContain(next.points.length);
        }
      )
    );
  });
});

describe('updatePoint', () => {
  it('replaces the point at the index', () => {
    const next = updatePoint(
      1,
      { x: 9, y: 9 },
      stateWith([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ])
    );
    expect(next.points[1]).toEqual({ x: 9, y: 9 });
  });

  it('leaves the original state untouched', () => {
    const state = stateWith([{ x: 0, y: 0 }]);
    updatePoint(0, { x: 9, y: 9 }, state);
    expect(state.points[0]).toEqual({ x: 0, y: 0 });
  });

  it('grows a sparse array for an out-of-range index rather than clamping', () => {
    // `newPoints[5] = p` on a 2-element array leaves holes at 2..4. Callers
    // must not do this; `getPathPoints` filters holes out, so the visible effect
    // is a silently dropped point. Pinned as current behaviour.
    const next = updatePoint(
      3,
      { x: 9, y: 9 },
      stateWith([
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ])
    );
    expect(next.points).toHaveLength(4);
    expect(next.points[3]).toEqual({ x: 9, y: 9 });
    // Indices 0, 1 and 3 exist; index 2 is a hole.
    expect(0 in next.points).toBe(true);
    expect(1 in next.points).toBe(true);
    expect(2 in next.points).toBe(false);
    expect(3 in next.points).toBe(true);
  });
});

describe('getMidpoint', () => {
  it('averages the two endpoints', () => {
    expect(getMidpoint({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
  });

  it('handles negative coordinates', () => {
    expect(getMidpoint({ x: -10, y: -4 }, { x: 2, y: 6 })).toEqual({ x: -4, y: 1 });
  });

  it('returns the point itself for identical endpoints', () => {
    expect(getMidpoint({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual({ x: 3, y: 3 });
  });
});

describe('snapPointToElements', () => {
  const box = (id: string, x: number, y: number, width = 100, height = 100): DriplElement =>
    ({ id, type: 'rectangle', x, y, width, height }) as DriplElement;

  it('returns the point untouched when nothing is within range', () => {
    const point = { x: 500, y: 500 };
    expect(snapPointToElements(point, [box('a', 0, 0)])).toBe(point);
  });

  it('snaps to an edge midpoint inside the threshold', () => {
    // Left-edge midpoint of a 0,0 100x100 box is (0, 50).
    expect(snapPointToElements({ x: 3, y: 52 }, [box('a', 0, 0)])).toEqual({ x: 0, y: 50 });
  });

  it('snaps to a corner', () => {
    expect(snapPointToElements({ x: 98, y: 98 }, [box('a', 0, 0)])).toEqual({ x: 100, y: 100 });
  });

  it('picks the NEAREST candidate across elements, not the first one found', () => {
    const near = box('near', 0, 0);
    const far = box('far', 40, 0, 100, 100);
    // (2, 0) is 2 from near's top-left corner (0,0) and 38 from far's (40,0).
    expect(snapPointToElements({ x: 2, y: 0 }, [far, near])).toEqual({ x: 0, y: 0 });
  });

  it('breaks an exact tie towards whichever candidate is scanned first', () => {
    // The comparison is `distance < minDistance`, so the first candidate to set
    // the minimum wins and an equal-distance later candidate is rejected. Both
    // of these are edges of the SAME element, so scan order decides.
    // Two overlapping boxes: left spans x 0..100, right x 90..190. Their
    // facing edge midpoints are (100,50) and (90,50), each 5 from a probe at
    // (95,50) and both inside the default 10px threshold.
    const left = box('left', 0, 0, 100, 100);
    const right = box('right', 90, 0, 100, 100);
    const probe = { x: 95, y: 50 };
    // `distance < minDistance` is strict, so the candidate that set the minimum
    // keeps it and the equal-distance one is rejected.
    expect(snapPointToElements(probe, [left, right])).toEqual({ x: 100, y: 50 });
    expect(snapPointToElements(probe, [right, left])).toEqual({ x: 90, y: 50 });
  });

  it('respects the threshold, exclusive', () => {
    // Distance exactly 10 is not < 10.
    expect(snapPointToElements({ x: 10, y: 50 }, [box('a', 0, 0)], undefined, 10)).toEqual({
      x: 10,
      y: 50,
    });
    expect(snapPointToElements({ x: 9.999, y: 50 }, [box('a', 0, 0)], undefined, 10)).toEqual({
      x: 0,
      y: 50,
    });
  });

  it('honours a custom threshold', () => {
    expect(snapPointToElements({ x: 30, y: 50 }, [box('a', 0, 0)], undefined, 5)).toEqual({
      x: 30,
      y: 50,
    });
    expect(snapPointToElements({ x: 30, y: 50 }, [box('a', 0, 0)], undefined, 40)).toEqual({
      x: 0,
      y: 50,
    });
  });

  it('never snaps to the excluded element', () => {
    expect(snapPointToElements({ x: 3, y: 52 }, [box('a', 0, 0)], 'a')).toEqual({ x: 3, y: 52 });
  });

  it('never snaps to a deleted element', () => {
    const deleted = { ...box('a', 0, 0), isDeleted: true } as DriplElement;
    expect(snapPointToElements({ x: 3, y: 52 }, [deleted])).toEqual({ x: 3, y: 52 });
  });

  it('considers all eight points of the box: four midpoints and four corners', () => {
    const target = box('a', 0, 0);
    const probes: Array<[Point, Point]> = [
      [
        { x: 3, y: 50 },
        { x: 0, y: 50 },
      ],
      [
        { x: 97, y: 50 },
        { x: 100, y: 50 },
      ],
      [
        { x: 50, y: 3 },
        { x: 50, y: 0 },
      ],
      [
        { x: 50, y: 97 },
        { x: 50, y: 100 },
      ],
      [
        { x: 3, y: 3 },
        { x: 0, y: 0 },
      ],
      [
        { x: 97, y: 3 },
        { x: 100, y: 0 },
      ],
      [
        { x: 3, y: 97 },
        { x: 0, y: 100 },
      ],
      [
        { x: 97, y: 97 },
        { x: 100, y: 100 },
      ],
    ];
    for (const [probe, expected] of probes) {
      expect(snapPointToElements(probe, [target])).toEqual(expected);
    }
  });

  it('never leaves the threshold', () => {
    fc.assert(
      fc.property(
        pointArb,
        fc.array(fc.record({ x: coord, y: coord, w: fc.nat(500), h: fc.nat(500) }), {
          maxLength: 4,
        }),
        (point, boxes) => {
          const elements = boxes.map((b, i) => box(`e${i}`, b.x, b.y, b.w, b.h));
          const snapped = snapPointToElements(point, elements, undefined, 10);
          const distance = Math.hypot(point.x - snapped.x, point.y - snapped.y);
          expect(distance).toBeLessThan(10);
          const isInput = snapped.x === point.x && snapped.y === point.y;
          expect(isInput || distance < 10).toBe(true);
        }
      )
    );
  });

  it('either returns the input or one of the eight box points', () => {
    fc.assert(
      fc.property(
        pointArb,
        fc.array(fc.record({ x: coord, y: coord, w: fc.nat(500), h: fc.nat(500) }), {
          maxLength: 4,
        }),
        (point, boxes) => {
          const elements = boxes.map((b, i) => box(`e${i}`, b.x, b.y, b.w, b.h));
          const snapped = snapPointToElements(point, elements, undefined, 25);
          const candidates: Point[] = [];
          for (const element of elements) {
            candidates.push(
              { x: element.x, y: element.y + element.height / 2 },
              { x: element.x + element.width, y: element.y + element.height / 2 },
              { x: element.x + element.width / 2, y: element.y },
              { x: element.x + element.width / 2, y: element.y + element.height },
              { x: element.x, y: element.y },
              { x: element.x + element.width, y: element.y },
              { x: element.x, y: element.y + element.height },
              { x: element.x + element.width, y: element.y + element.height }
            );
          }
          const isInput = snapped.x === point.x && snapped.y === point.y;
          const isCandidate = candidates.some(c => c.x === snapped.x && c.y === snapped.y);
          expect(isInput || isCandidate).toBe(true);
        }
      )
    );
  });
});

describe('createLineElement', () => {
  const lineState = (points: Point[]) => ({
    points,
    isComplete: true,
    isDragging: false,
    currentPoint: null,
    shiftKey: false,
  });

  it('anchors the element at the bounding box and stores relative points', () => {
    const element = createLineElement(
      lineState([
        { x: 10, y: 20 },
        { x: 40, y: 5 },
      ]),
      baseProps('l') as never
    );
    expect(element.type).toBe('line');
    expect([element.x, element.y, element.width, element.height]).toEqual([10, 5, 30, 15]);
    expect(element.points).toEqual([
      { x: 0, y: 15 },
      { x: 30, y: 0 },
    ]);
  });

  it('handles a single point as a zero-size element', () => {
    const element = createLineElement(lineState([{ x: 3, y: 4 }]), baseProps('l') as never);
    expect([element.x, element.y, element.width, element.height]).toEqual([3, 4, 0, 0]);
    expect(element.points).toEqual([{ x: 0, y: 0 }]);
  });

  it('throws on an empty point list rather than emitting an infinite bbox', () => {
    expect(() => createLineElement(lineState([]), baseProps('l') as never)).toThrow(
      'Line must have at least one point'
    );
  });

  it('round-trips every point through the element origin', () => {
    fc.assert(
      fc.property(pointList, points => {
        const element = createLineElement(
          lineState(points),
          baseProps('l') as never
        ) as LinearElement;
        expect(element.points).toHaveLength(points.length);
        element.points.forEach((p, i) => {
          expect(element.x + p.x).toBeCloseTo(points[i]!.x, 8);
          expect(element.y + p.y).toBeCloseTo(points[i]!.y, 8);
        });
        const box = getBoundingBox(points);
        expect(element.x).toBe(box.minX);
        expect(element.y).toBe(box.minY);
        expect(element.width).toBe(box.maxX - box.minX);
        expect(element.height).toBe(box.maxY - box.minY);
      })
    );
  });

  it('produces a schema-valid element for every two-or-more point line', () => {
    fc.assert(
      fc.property(fc.array(pointArb, { minLength: 2, maxLength: 12 }), points => {
        const element = createLineElement(lineState(points), baseProps('l') as never);
        expect(DriplElementSchema.safeParse(element).success).toBe(true);
      })
    );
  });

  it('produces an element the schema REJECTS for a single-point line', () => {
    // `LineElementSchema` requires `points.min(2)`, but the tool only guards
    // `length === 0`. Reported as a latent gap, not fixed: the live path seeds
    // two identical points (`createToolState`), so a one-point line is
    // unreachable from the UI.
    const element = createLineElement(lineState([{ x: 1, y: 2 }]), baseProps('l') as never);
    expect(element.points).toHaveLength(1);
    expect(DriplElementSchema.safeParse(element).success).toBe(false);
  });
});

describe('line state helpers', () => {
  const state = {
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    isComplete: false,
    isDragging: false,
    currentPoint: null,
    shiftKey: false,
  };

  it('adds a point immutably', () => {
    const next = addPointToLine({ x: 5, y: 5 }, state);
    expect(next.points).toHaveLength(3);
    expect(state.points).toHaveLength(2);
  });

  it('refuses to drop below two points', () => {
    expect(removePointFromLine(0, state)).toBe(state);
  });

  it('updates a point immutably', () => {
    const next = updatePointInLine(0, { x: 9, y: 9 }, state);
    expect(next.points[0]).toEqual({ x: 9, y: 9 });
    expect(state.points[0]).toEqual({ x: 0, y: 0 });
  });

  it('keeps the extra state fields the line tool carries', () => {
    const rich = { ...state, shiftKey: true, currentPoint: { x: 4, y: 4 } };
    expect(addPointToLine({ x: 1, y: 1 }, rich).shiftKey).toBe(true);
    expect(addPointToLine({ x: 1, y: 1 }, rich).currentPoint).toEqual({ x: 4, y: 4 });
  });
});

/**
 * The per-tool snap wrappers.
 *
 * These have no production callers — the live snapping is `snapPointToGrid` in
 * `hooks/canvas/useCanvasCoordinates.ts` — so they are dead exports rather than
 * live behaviour. They are pinned here only so that their defaults are recorded:
 * the arrow wrapper always uses the 10px default, and the line wrapper exposes
 * it.
 */
describe('snap wrappers', () => {
  const target = {
    id: 'a',
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  } as DriplElement;

  it('snapLineToElement uses the 10px default threshold', () => {
    expect(snapLineToElement({ x: 5, y: 52 }, [target])).toEqual({ x: 0, y: 50 });
    // 11px away is outside the default.
    expect(snapLineToElement({ x: 11, y: 50 }, [target])).toEqual({ x: 11, y: 50 });
  });

  it('snapLineToElement honours an explicit threshold', () => {
    expect(snapLineToElement({ x: 30, y: 50 }, [target], undefined, 50)).toEqual({ x: 0, y: 50 });
    expect(snapLineToElement({ x: 30, y: 50 }, [target], undefined, 5)).toEqual({ x: 30, y: 50 });
  });

  it('snapLineToElement honours the excluded id', () => {
    expect(snapLineToElement({ x: 5, y: 52 }, [target], 'a')).toEqual({ x: 5, y: 52 });
    expect(snapLineToElement({ x: 5, y: 52 }, [target], 'other')).toEqual({ x: 0, y: 50 });
  });

  it('snapArrowToElement uses the 10px default with no threshold parameter', () => {
    expect(snapArrowToElement({ x: 5, y: 52 }, [target])).toEqual({ x: 0, y: 50 });
    expect(snapArrowToElement({ x: 11, y: 50 }, [target])).toEqual({ x: 11, y: 50 });
    expect(snapArrowToElement({ x: 5, y: 52 }, [target], 'a')).toEqual({ x: 5, y: 52 });
  });

  it('both wrappers agree at the shared 10px default', () => {
    fc.assert(
      fc.property(pointArb, point => {
        expect(snapArrowToElement(point, [target])).toEqual(
          snapLineToElement(point, [target], undefined, 10)
        );
      })
    );
  });
});

describe('createArrowElement', () => {
  const arrowState = (points: Point[], label?: string) => ({
    points,
    isComplete: true,
    isDragging: false,
    currentPoint: null,
    ...(label === undefined ? {} : { label }),
  });

  it('anchors at the bbox and stores relative points, like a line', () => {
    const { arrow } = createArrowElement(
      arrowState([
        { x: 10, y: 20 },
        { x: 40, y: 20 },
      ]),
      baseProps('a') as never
    );
    expect(arrow.type).toBe('arrow');
    expect([arrow.x, arrow.y, arrow.width, arrow.height]).toEqual([10, 20, 30, 0]);
    expect(arrow.points).toEqual([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it('defaults to a head-less tail with a triangle tip, and no bindings', () => {
    const { arrow } = createArrowElement(
      arrowState([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
      baseProps('a') as never
    );
    expect(arrow.arrowHeads).toEqual({ start: 'none', end: 'triangle' });
    expect(arrow.arrowStyle).toBe('straight');
    expect(arrow.startBinding).toBeUndefined();
    expect(arrow.endBinding).toBeUndefined();
  });

  it('records the requested arrow style', () => {
    const { arrow } = createArrowElement(
      arrowState([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
      baseProps('a') as never,
      undefined,
      'curved'
    );
    expect(arrow.arrowStyle).toBe('curved');
  });

  it('records both bindings when given', () => {
    const startBinding = {
      elementId: 'r1',
      fixedPoint: { x: 0.5, y: 0.5 },
      mode: 'orbit' as const,
    };
    const endBinding = { elementId: 'r2', fixedPoint: { x: 1, y: 1 }, mode: 'inside' as const };
    const { arrow } = createArrowElement(
      arrowState([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
      baseProps('a') as never,
      {
        startBinding,
        endBinding,
      }
    );
    expect(arrow.startBinding).toEqual(startBinding);
    expect(arrow.endBinding).toEqual(endBinding);
  });

  it('returns no label when none is requested', () => {
    expect(
      createArrowElement(
        arrowState([
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ]),
        baseProps('a') as never
      ).label
    ).toBeUndefined();
  });

  it('returns no label for an empty label string', () => {
    const { arrow, label } = createArrowElement(
      arrowState(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        ''
      ),
      baseProps('a') as never
    );
    expect(label).toBeUndefined();
    expect(arrow.labelId).toBeUndefined();
  });

  it('creates a label centred on the arrow bbox and links the two by id', () => {
    const { arrow, label } = createArrowElement(
      arrowState(
        [
          { x: 0, y: 0 },
          { x: 100, y: 40 },
        ],
        'yes'
      ),
      baseProps('a') as never
    );
    expect(label).toBeDefined();
    expect(label!.id).toBe(arrow.labelId!);
    expect(label!.containerId).toBe(arrow.id);
    expect(label!.text).toBe('yes');
    expect(label!.originalText).toBe('yes');
    // bbox centre is (50, 20); the label is offset by (-25, -10) and 100x24.
    expect([label!.x, label!.y, label!.width, label!.height]).toEqual([25, 10, 100, 24]);
    expect(label!.fontSize).toBe(14);
    expect(label!.fontFamily).toBe(getDefaultFontFamily());
    expect(label!.opacity).toBe(1);
  });

  it('generates a fresh label id per call', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const { label } = createArrowElement(
        arrowState(
          [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
          'x'
        ),
        baseProps(`a${i}`) as never
      );
      ids.add(label!.id);
    }
    expect(ids.size).toBe(5);
  });

  it('uses the only point itself as the label anchor for a one-point arrow', () => {
    const { label } = createArrowElement(
      arrowState([{ x: 30, y: 40 }], 'x'),
      baseProps('a') as never
    );
    expect([label!.x, label!.y]).toEqual([5, 30]);
  });

  it('throws on an empty point list', () => {
    expect(() => createArrowElement(arrowState([]), baseProps('a') as never)).toThrow(
      'Arrow must have at least one point'
    );
  });

  it('produces schema-valid arrow and label for every two-or-more point arrow', () => {
    fc.assert(
      fc.property(
        fc.array(pointArb, { minLength: 2, maxLength: 12 }),
        fc.string(),
        (points, label) => {
          const { arrow, label: created } = createArrowElement(
            arrowState(points, label),
            baseProps('a') as never
          );
          expect(DriplElementSchema.safeParse(arrow).success).toBe(true);
          if (created) expect(DriplElementSchema.safeParse(created).success).toBe(true);
        }
      )
    );
  });

  it('produces an element the schema REJECTS for a single-point arrow, same gap as the line tool', () => {
    const { arrow } = createArrowElement(arrowState([{ x: 1, y: 2 }]), baseProps('a') as never);
    expect(DriplElementSchema.safeParse(arrow).success).toBe(false);
  });

  it('round-trips every point through the element origin', () => {
    fc.assert(
      fc.property(pointList, points => {
        const { arrow } = createArrowElement(arrowState(points), baseProps('a') as never);
        const box = getBoundingBox(points);
        expect(arrow.x).toBe(box.minX);
        expect(arrow.y).toBe(box.minY);
        arrow.points.forEach((p, i) => {
          expect(arrow.x + p.x).toBeCloseTo(points[i]!.x, 8);
          expect(arrow.y + p.y).toBeCloseTo(points[i]!.y, 8);
        });
      })
    );
  });
});

describe('arrow state helpers', () => {
  const state = {
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    isComplete: false,
    isDragging: false,
    currentPoint: null,
  };

  it('adds, inserts, updates and removes immutably', () => {
    expect(addPointToArrow({ x: 2, y: 2 }, state).points).toHaveLength(3);
    expect(insertPointIntoArrow(1, { x: 2, y: 2 }, state).points.map(p => p.x)).toEqual([0, 2, 1]);
    expect(updatePointInArrow(0, { x: 9, y: 9 }, state).points[0]).toEqual({ x: 9, y: 9 });
    expect(removePointFromArrow(0, state)).toBe(state);
    expect(state.points).toHaveLength(2);
  });

  it('midpoints two endpoints', () => {
    expect(getArrowMidpoint({ x: 0, y: 0 }, { x: 10, y: 10 })).toEqual({ x: 5, y: 5 });
  });
});

describe('createArrowLabel', () => {
  const arrow = (points: Point[], x = 0, y = 0): LinearElement =>
    ({
      id: 'a1',
      type: 'arrow',
      x,
      y,
      width: 0,
      height: 0,
      points,
    }) as LinearElement;

  it('anchors the label on the arrow origin plus the bbox centre, offset by (-25, -10)', () => {
    const label = createArrowLabel(
      arrow(
        [
          { x: 0, y: 0 },
          { x: 100, y: 40 },
        ],
        1000,
        2000
      )
    );
    expect([label.x, label.y]).toEqual([1000 + 50 - 25, 2000 + 20 - 10]);
  });

  it('links itself to the arrow as its container', () => {
    const label = createArrowLabel(
      arrow([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
      'caption'
    );
    expect(label.containerId).toBe('a1');
    expect(label.text).toBe('caption');
    expect(label.originalText).toBe('caption');
  });

  it('defaults to empty text rather than undefined', () => {
    expect(
      createArrowLabel(
        arrow([
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ])
      ).text
    ).toBe('');
  });

  it('generates a unique id per call', () => {
    const a = createArrowLabel(
      arrow([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ])
    );
    const b = createArrowLabel(
      arrow([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ])
    );
    expect(a.id).not.toBe(b.id);
  });

  it('agrees with the label createArrowElement builds for the same arrow', () => {
    const points: Point[] = [
      { x: 12, y: 34 },
      { x: 90, y: 8 },
    ];
    const box = getBoundingBox(points);
    const element = createArrowElement(
      { points, isComplete: true, isDragging: false, currentPoint: null, label: 'L' },
      baseProps('a') as never
    );
    const rebuilt = createArrowLabel(arrow(toRelativePoints(points), box.minX, box.minY), 'L');
    expect([rebuilt.x, rebuilt.y]).toEqual([element.label!.x, element.label!.y]);
  });

  it('always produces a schema-valid element', () => {
    fc.assert(
      fc.property(pointList, fc.string(), (points, text) => {
        const box = getBoundingBox(points);
        const label = createArrowLabel(arrow(toRelativePoints(points), box.minX, box.minY), text);
        expect(DriplElementSchema.safeParse(label).success).toBe(true);
      })
    );
  });
});

describe('createFreedrawElement', () => {
  const drawState = (points: Point[], extra: Record<string, unknown> = {}) => ({
    points,
    isComplete: true,
    ...extra,
  });

  it('anchors at the bbox and stores relative points', () => {
    const element = createFreedrawElement(
      drawState([
        { x: 4, y: 9 },
        { x: 40, y: 30 },
      ]),
      baseProps('f') as never
    );
    expect(element.type).toBe('freedraw');
    expect([element.x, element.y, element.width, element.height]).toEqual([4, 9, 36, 21]);
    expect(element.points).toEqual([
      { x: 0, y: 0 },
      { x: 36, y: 21 },
    ]);
  });

  it('defaults the brush to 2 and derives one width per processed point', () => {
    const element = createFreedrawElement(
      drawState([
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ]),
      baseProps('f') as never
    );
    expect(element.brushSize).toBe(2);
    expect(element.widths).toHaveLength(element.points.length);
  });

  it('honours an explicit brush size', () => {
    const element = createFreedrawElement(
      drawState(
        [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ],
        { brushSize: 8 }
      ),
      baseProps('f') as never
    );
    expect(element.brushSize).toBe(8);
  });

  it('scales each width to between 0.75x and 2x the brush size', () => {
    const element = createFreedrawElement(
      drawState(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 400, y: 0 },
        ],
        { brushSize: 4 }
      ),
      baseProps('f') as never
    ) as FreeDrawElement;
    for (const width of element.widths!) {
      expect(width).toBeGreaterThanOrEqual(4 * 0.75 - 1e-9);
      expect(width).toBeLessThanOrEqual(4 * 2 + 1e-9);
    }
  });

  it('drops near-collinear interior points but always keeps the first and last', () => {
    // Three points on one straight horizontal line: the middle one is within
    // the 0.85px simplification threshold, so it is discarded.
    const element = createFreedrawElement(
      drawState([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]),
      baseProps('f') as never
    );
    expect(element.points).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]);
  });

  it('keeps a point well off the line between its neighbours', () => {
    const element = createFreedrawElement(
      drawState([
        { x: 0, y: 0 },
        { x: 10, y: 40 },
        { x: 20, y: 0 },
      ]),
      baseProps('f') as never
    );
    expect(element.points).toHaveLength(3);
  });

  it('skips simplification entirely at two points or fewer', () => {
    for (const points of [
      [{ x: 0, y: 0 }],
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    ]) {
      const element = createFreedrawElement(drawState(points), baseProps('f') as never);
      expect(element.points).toHaveLength(points.length);
    }
  });

  it('handles a degenerate stroke where every point is identical', () => {
    const element = createFreedrawElement(
      drawState([
        { x: 5, y: 5 },
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ]),
      baseProps('f') as never
    );
    expect([element.x, element.y, element.width, element.height]).toEqual([5, 5, 0, 0]);
    // All three survive: with prev == next the chord length is 0, the
    // simplification branch keeps the point unconditionally, and the first and
    // last are always kept.
    expect(element.points).toHaveLength(3);
  });

  it('throws on an empty point list', () => {
    expect(() => createFreedrawElement(drawState([]), baseProps('f') as never)).toThrow(
      'Freedraw must have at least one point'
    );
  });

  it('keeps a caller-supplied pressure array of matching length', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 90, y: 0 },
    ];
    const element = createFreedrawElement(
      drawState(points, { pressureValues: [0.1, 0.2, 0.3] }),
      baseProps('f') as never
    );
    expect(element.pressureValues).toEqual([0.1, 0.2, 0.3]);
  });

  it('recomputes pressure when the supplied array does not match the point count', () => {
    const element = createFreedrawElement(
      drawState(
        [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
        ],
        { pressureValues: [0.9] }
      ),
      baseProps('f') as never
    );
    expect(element.pressureValues).toHaveLength(2);
  });

  it('produces pressures inside the schema band of 0..1', () => {
    fc.assert(
      fc.property(pointList, points => {
        const element = createFreedrawElement(drawState(points), baseProps('f') as never);
        for (const pressure of element.pressureValues!) {
          expect(pressure).toBeGreaterThanOrEqual(0);
          expect(pressure).toBeLessThanOrEqual(1);
        }
      })
    );
  });

  it('always produces a schema-valid element', () => {
    fc.assert(
      fc.property(pointList, points => {
        const element = createFreedrawElement(drawState(points), baseProps('f') as never);
        expect(DriplElementSchema.safeParse(element).success).toBe(true);
      })
    );
  });

  it('keeps the bbox consistent with the stored relative points, whatever it simplified away', () => {
    // `optimizePoints` can discard an interior extreme, so this is the invariant
    // that actually matters: the box describes the points that survived.
    fc.assert(
      fc.property(pointList, points => {
        const element = createFreedrawElement(drawState(points), baseProps('f') as never);
        const box = getBoundingBox(
          element.points.map(p => ({ x: p.x + element.x, y: p.y + element.y }))
        );
        expect(element.x).toBe(box.minX);
        expect(element.y).toBe(box.minY);
        expect(element.width).toBeCloseTo(box.maxX - box.minX, 8);
        expect(element.height).toBeCloseTo(box.maxY - box.minY, 8);
        expect(element.width).toBeGreaterThanOrEqual(0);
        expect(element.height).toBeGreaterThanOrEqual(0);
      })
    );
  });

  it('always keeps the first and last input point', () => {
    fc.assert(
      fc.property(pointList, points => {
        const element = createFreedrawElement(drawState(points), baseProps('f') as never);
        const world = element.points.map(p => ({ x: p.x + element.x, y: p.y + element.y }));
        expect(world[0]!.x).toBeCloseTo(points[0]!.x, 8);
        expect(world[0]!.y).toBeCloseTo(points[0]!.y, 8);
        const last = world.at(-1)!;
        expect(last.x).toBeCloseTo(points.at(-1)!.x, 8);
        expect(last.y).toBeCloseTo(points.at(-1)!.y, 8);
      })
    );
  });
});

describe('freedraw state helpers', () => {
  const state = {
    points: [{ x: 0, y: 0 }],
    isComplete: false,
    pressureValues: [0.5],
  };

  it('appends a point and records its pressure', () => {
    const next = addPointToFreedraw({ x: 30, y: 0 }, state);
    expect(next.points).toHaveLength(2);
    expect(next.pressureValues).toHaveLength(2);
    expect(next.pressure).toBeTypeOf('number');
    expect(next.pressure).toBeGreaterThanOrEqual(0);
    expect(next.pressure).toBeLessThanOrEqual(1);
  });

  it('falls back to 0.5 for the very first point, which has no predecessor', () => {
    const first = addPointToFreedraw({ x: 7, y: 7 }, { points: [], isComplete: false });
    expect(first.pressure).toBe(0.5);
  });

  it('thins pressure as the stroke speeds up', () => {
    const slow = addPointToFreedraw(
      { x: 1, y: 0 },
      { points: [{ x: 0, y: 0 }], isComplete: false }
    );
    const fast = addPointToFreedraw(
      { x: 500, y: 0 },
      { points: [{ x: 0, y: 0 }], isComplete: false }
    );
    expect(fast.pressure!).toBeLessThan(slow.pressure!);
  });

  it('never drops below the 0.3 floor pressure', () => {
    const fast = addPointToFreedraw(
      { x: 100_000, y: 0 },
      { points: [{ x: 0, y: 0 }], isComplete: false }
    );
    expect(fast.pressure).toBe(0.3);
  });

  it('allows removing down to zero points, unlike the line and arrow tools', () => {
    expect(removePointFromFreedraw(0, state).points).toEqual([]);
  });

  it('updates a point immutably', () => {
    const next = updatePointInFreedraw(0, { x: 9, y: 9 }, state);
    expect(next.points[0]).toEqual({ x: 9, y: 9 });
    expect(state.points[0]).toEqual({ x: 0, y: 0 });
  });

  it('leaves the original pressure array untouched', () => {
    const next = addPointToFreedraw({ x: 1, y: 0 }, state);
    next.pressureValues!.push(0.99);
    expect(state.pressureValues).toHaveLength(1);
  });
});

describe('createTextElement', () => {
  const state = (text: string, fontSize = 16) => ({
    position: { x: 10, y: 20 },
    text,
    fontSize,
    fontFamily: 'Inter',
  });

  it('anchors at the requested position with the requested text', () => {
    const element = createTextElement(state('Hello'), baseProps('t') as never);
    expect(element.type).toBe('text');
    expect([element.x, element.y]).toEqual([10, 20]);
    expect(element.text).toBe('Hello');
    expect(element.originalText).toBe('Hello');
    expect(element.fontSize).toBe(16);
    expect(element.fontFamily).toBe('Inter');
  });

  it('estimates the width as 0.6em per character with a 100px floor', () => {
    // 5 chars * 16 * 0.6 = 48, below the floor.
    expect(createTextElement(state('Hello'), baseProps('t') as never).width).toBe(100);
    // 200 chars * 16 * 0.6 = 1920, above the floor.
    expect(createTextElement(state('x'.repeat(200)), baseProps('t') as never).width).toBe(1920);
  });

  it('estimates the height as 1.25em', () => {
    expect(createTextElement(state('Hello', 16), baseProps('t') as never).height).toBe(20);
    expect(createTextElement(state('Hello', 40), baseProps('t') as never).height).toBe(50);
  });

  it('gives empty text a zero width estimate, floored to 100, and zero height at size 0', () => {
    const element = createTextElement(state('', 0), baseProps('t') as never);
    expect(element.width).toBe(100);
    expect(element.height).toBe(0);
  });

  it('produces a schema-valid element', () => {
    // `TextElementSchema.fontSize` is `min(1)`, so font size 0 is outside the
    // schema even though the tool happily computes a zero height from it.
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 200 }), (text, size) => {
        const element = createTextElement(state(text, size), baseProps('t') as never);
        expect(DriplElementSchema.safeParse(element).success).toBe(true);
      })
    );
  });

  it('produces an element the schema REJECTS for a zero font size', () => {
    expect(
      DriplElementSchema.safeParse(createTextElement(state('x', 0), baseProps('t') as never))
        .success
    ).toBe(false);
  });
});

describe('updateTextDimensions', () => {
  const element = (overrides: Partial<TextElement> = {}): TextElement =>
    ({
      id: 't1',
      type: 'text',
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      text: 'old',
      originalText: 'old',
      fontSize: 16,
      fontFamily: 'Inter',
      ...overrides,
    }) as TextElement;

  it('re-estimates with the same formula when no canvas is supplied', () => {
    // 20 chars * 16 * 0.6 = 192, above the 100px floor.
    const next = updateTextDimensions(element(), 'x'.repeat(20));
    expect(next.width).toBe(192);
    expect(next.height).toBe(20);
    expect(next.text).toBe('x'.repeat(20));
  });

  it('keeps the 100px width floor without a canvas', () => {
    expect(updateTextDimensions(element(), 'ab').width).toBe(100);
  });

  it('uses the canvas measurement when one is supplied, keeping the same floor', () => {
    const canvas = {
      getContext: () => ({ font: '', measureText: (_text: string) => ({ width: 321 }) }),
    } as unknown as HTMLCanvasElement;
    expect(updateTextDimensions(element(), 'anything', canvas).width).toBe(321);
    expect(updateTextDimensions(element(), 'anything', canvas).height).toBe(20);
  });

  it('sets the context font from the element before measuring', () => {
    const seen: string[] = [];
    const canvas = {
      getContext: () => ({
        set font(value: string) {
          seen.push(value);
        },
        measureText: () => ({ width: 1 }),
      }),
    } as unknown as HTMLCanvasElement;
    updateTextDimensions(element({ fontSize: 32, fontFamily: 'Mono' }), 'x', canvas);
    expect(seen).toEqual(['32px Mono']);
  });

  it('keeps the existing width when the canvas has no 2d context', () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(updateTextDimensions(element({ width: 777 }), 'new text', canvas).width).toBe(777);
  });

  it('never mutates the input element', () => {
    const before = element();
    updateTextDimensions(before, 'changed');
    expect(before.text).toBe('old');
    expect(before.width).toBe(100);
  });

  it('leaves every other field alone', () => {
    const next = updateTextDimensions(element({ x: 5, y: 6, opacity: 0.4 }), 'x');
    expect(next.id).toBe('t1');
    expect(next.x).toBe(5);
    expect(next.y).toBe(6);
    expect(next.opacity).toBe(0.4);
  });
});
