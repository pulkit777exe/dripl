import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  distance,
  rotate,
  rotatePoint,
  isPointInRect,
  getBounds,
  boundsIntersect,
  pointInPolygon,
  segmentsIntersect,
  segmentIntersectsPolygon,
  distanceToSegment,
  distanceToRect,
  getCenter,
  getMidpoint,
  getVector,
  normalizeVector,
  getAngle,
  getLineIntersection,
  getUnionBounds,
  getIntersectionBounds,
  rotateBounds,
  scaleBounds,
  type Bounds,
  type LineSegment,
} from './geometry';
import type { Point } from '@dripl/common';

// Property seeds are pinned so any failure is reproducible from this file
// alone: fast-check prints the seed and path, and both are constants here.
const SEED = 20_260_902;

const pt = (x: number, y: number): Point => ({ x, y });
const num = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const fcPoint: fc.Arbitrary<Point> = fc.record({ x: num(-500, 500), y: num(-500, 500) });
const fcAngle = num(-Math.PI * 2, Math.PI * 2);
const seg = (a: Point, b: Point): LineSegment => ({ start: a, end: b });
const RUNS = 300;

describe('math/geometry', () => {
  describe('distance', () => {
    it('should calculate distance between two points', () => {
      expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
      expect(distance({ x: 1, y: 1 }, { x: 4, y: 5 })).toBe(5);
      expect(distance({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0);
    });

    it('is symmetric and matches the closed-form 3-4-5 in both axes', () => {
      expect(distance({ x: 0, y: 0 }, { x: -3, y: -4 })).toBe(5);
      fc.assert(
        fc.property(fcPoint, fcPoint, (a, b) => {
          expect(distance(a, b)).toBeCloseTo(Math.hypot(b.x - a.x, b.y - a.y), 9);
          expect(distance(a, b)).toBe(distance(b, a));
          expect(distance(a, a)).toBe(0);
        }),
        { seed: SEED, numRuns: RUNS }
      );
    });
  });

  describe('rotate', () => {
    it('should rotate a point around a center', () => {
      // Rotate (1, 0) 90 degrees around (0,0)
      const [x, y] = rotate(1, 0, 0, 0, Math.PI / 2);
      expect(x).toBeCloseTo(0);
      expect(y).toBeCloseTo(1);
    });

    it('agrees with rotatePoint and is the identity at angle 0', () => {
      fc.assert(
        fc.property(fcPoint, fcPoint, fcAngle, (p, c, a) => {
          const [x, y] = rotate(p.x, p.y, c.x, c.y, a);
          const q = rotatePoint(p, c.x, c.y, a);
          expect(x).toBeCloseTo(q.x, 9);
          expect(y).toBeCloseTo(q.y, 9);
        }),
        { seed: SEED, numRuns: RUNS }
      );
      const [x, y] = rotate(7, -3, 100, 100, 0);
      expect(x).toBeCloseTo(7, 12);
      expect(y).toBeCloseTo(-3, 12);
    });
  });

  describe('rotatePoint', () => {
    it('rotates 90 degrees clockwise in screen space about a non-origin pivot', () => {
      // Pivot (10, 20); (20, 20) sits 10 to the right of it and lands 10 below it.
      const r = rotatePoint(pt(20, 20), 10, 20, Math.PI / 2);
      expect(r.x).toBeCloseTo(10, 12);
      expect(r.y).toBeCloseTo(30, 12);
    });

    it('preserves the distance to the pivot', () => {
      fc.assert(
        fc.property(fcPoint, fcPoint, fcAngle, (p, c, a) => {
          const before = distance(p, c);
          const after = rotatePoint(p, c.x, c.y, a);
          expect(distance(after, c)).toBeCloseTo(before, 6);
        }),
        { seed: SEED, numRuns: RUNS }
      );
    });

    it('composing with the inverse rotation returns the original point', () => {
      fc.assert(
        fc.property(fcPoint, fcPoint, fcAngle, (p, c, a) => {
          const back = rotatePoint(rotatePoint(p, c.x, c.y, a), c.x, c.y, -a);
          expect(back.x).toBeCloseTo(p.x, 6);
          expect(back.y).toBeCloseTo(p.y, 6);
        }),
        { seed: SEED, numRuns: RUNS }
      );
    });
  });

  describe('isPointInRect', () => {
    it('should check if a point is inside a rectangle', () => {
      const rect = { x: 0, y: 0, width: 10, height: 10 };
      expect(isPointInRect({ x: 5, y: 5 }, rect)).toBe(true);
      expect(isPointInRect({ x: -1, y: 5 }, rect)).toBe(false);
      expect(isPointInRect({ x: 5, y: 11 }, rect)).toBe(false);
    });

    it('treats all four edges as inside', () => {
      const rect = { x: 0, y: 0, width: 10, height: 10 };
      expect(isPointInRect(pt(0, 0), rect)).toBe(true);
      expect(isPointInRect(pt(10, 10), rect)).toBe(true);
      expect(isPointInRect(pt(10, 0), rect)).toBe(true);
      expect(isPointInRect(pt(0, 10), rect)).toBe(true);
    });
  });

  describe('getBounds', () => {
    it('should calculate bounds from points', () => {
      const points = [
        { x: 1, y: 2 },
        { x: 5, y: 3 },
        { x: 3, y: 7 },
      ];
      expect(getBounds(points)).toEqual({
        x: 1,
        y: 2,
        width: 4,
        height: 5,
      });
    });

    it('returns a zero-sized box for empty and single-point input', () => {
      expect(getBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
      expect(getBounds([pt(-4, 9)])).toEqual({ x: -4, y: 9, width: 0, height: 0 });
    });

    it('contains every input point and is never negative', () => {
      fc.assert(
        fc.property(fc.array(fcPoint, { minLength: 1, maxLength: 20 }), points => {
          const b = getBounds(points);
          expect(b.width).toBeGreaterThanOrEqual(0);
          expect(b.height).toBeGreaterThanOrEqual(0);
          for (const p of points) {
            expect(p.x).toBeGreaterThanOrEqual(b.x - 1e-9);
            expect(p.x).toBeLessThanOrEqual(b.x + b.width + 1e-9);
            expect(p.y).toBeGreaterThanOrEqual(b.y - 1e-9);
            expect(p.y).toBeLessThanOrEqual(b.y + b.height + 1e-9);
          }
        }),
        { seed: SEED, numRuns: RUNS }
      );
    });
  });

  describe('boundsIntersect', () => {
    it('should check if two bounds intersect', () => {
      const b1 = { x: 0, y: 0, width: 10, height: 10 };
      const b2 = { x: 5, y: 5, width: 10, height: 10 };
      const b3 = { x: 15, y: 15, width: 10, height: 10 };

      expect(boundsIntersect(b1, b2)).toBe(true);
      expect(boundsIntersect(b1, b3)).toBe(false);
    });

    it('is reflexive, symmetric, and closed for edge-touching boxes', () => {
      const b1 = { x: 0, y: 0, width: 10, height: 10 };
      const touching = { x: 10, y: 0, width: 10, height: 10 };
      expect(boundsIntersect(b1, b1)).toBe(true);
      expect(boundsIntersect(b1, touching)).toBe(true);
      expect(boundsIntersect(touching, b1)).toBe(true);

      fc.assert(
        fc.property(
          fc.record({
            a: fc.record({
              x: num(-100, 100),
              y: num(-100, 100),
              width: num(1, 100),
              height: num(1, 100),
            }),
            b: fc.record({
              x: num(-100, 100),
              y: num(-100, 100),
              width: num(1, 100),
              height: num(1, 100),
            }),
          }),
          ({ a, b }) => {
            expect(boundsIntersect(a, b)).toBe(boundsIntersect(b, a));
            expect(boundsIntersect(a, a)).toBe(true);
          }
        ),
        { seed: SEED, numRuns: RUNS }
      );
    });
  });

  describe('pointInPolygon', () => {
    const square = [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)];

    it('should check if a point is inside a polygon', () => {
      expect(pointInPolygon(pt(5, 5), square)).toBe(true);
      expect(pointInPolygon(pt(15, 5), square)).toBe(false);
    });

    it('rejects degenerate polygons', () => {
      expect(pointInPolygon(pt(0, 0), [])).toBe(false);
      expect(pointInPolygon(pt(0, 0), [pt(0, 0), pt(10, 0)])).toBe(false);
    });

    it('treats every edge of a square as inside, not just the left and top', () => {
      // Regression: the ray-cast sweep is direction-dependent, so it used to
      // answer `true` for the left/top edges and `false` for right/bottom.
      expect(pointInPolygon(pt(0, 0), square)).toBe(true);
      expect(pointInPolygon(pt(10, 0), square)).toBe(true);
      expect(pointInPolygon(pt(10, 10), square)).toBe(true);
      expect(pointInPolygon(pt(0, 10), square)).toBe(true);
      expect(pointInPolygon(pt(5, 0), square)).toBe(true);
      expect(pointInPolygon(pt(10, 5), square)).toBe(true);
      expect(pointInPolygon(pt(5, 10), square)).toBe(true);
      expect(pointInPolygon(pt(0, 5), square)).toBe(true);
    });

    it('still rejects points just outside every edge', () => {
      expect(pointInPolygon(pt(-0.001, 5), square)).toBe(false);
      expect(pointInPolygon(pt(10.001, 5), square)).toBe(false);
      expect(pointInPolygon(pt(5, -0.001), square)).toBe(false);
      expect(pointInPolygon(pt(5, 10.001), square)).toBe(false);
    });

    it('a point inside a convex polygon is inside some triangle of its fan triangulation', () => {
      const convex = [pt(0, 0), pt(10, 0), pt(14, 6), pt(7, 12), pt(1, 9)];
      const fan = convex
        .slice(1)
        .map((_, i) => [convex[0]!, convex[i + 1]!, convex[i + 2] ?? convex[0]!]);
      fc.assert(
        fc.property(
          fcPoint.map(p => ({
            x: convex[0]!.x + (p.x - convex[0]!.x) * 0.05,
            y: convex[0]!.y + (p.y - convex[0]!.y) * 0.05,
          })),
          point => {
            if (!pointInPolygon(point, convex)) return;
            const covered = fan.some(triangle => pointInPolygon(point, triangle));
            if (!covered) throw new Error(`point ${JSON.stringify(point)} uncovered by fan`);
            expect(covered).toBe(true);
          }
        ),
        { seed: SEED, numRuns: RUNS }
      );
    });
  });

  describe('segmentsIntersect', () => {
    it('should check if two segments intersect', () => {
      const s1 = { start: { x: 0, y: 0 }, end: { x: 10, y: 10 } };
      const s2 = { start: { x: 0, y: 10 }, end: { x: 10, y: 0 } };
      const s3 = { start: { x: 15, y: 0 }, end: { x: 25, y: 10 } };

      expect(segmentsIntersect(s1, s2)).toBe(true);
      expect(segmentsIntersect(s1, s3)).toBe(false);
    });

    it('reports collinear overlap as an intersection', () => {
      // Regression: the strict ccw test answered false here.
      expect(segmentsIntersect(seg(pt(0, 0), pt(10, 0)), seg(pt(5, 0), pt(15, 0)))).toBe(true);
      expect(segmentsIntersect(seg(pt(5, 0), pt(15, 0)), seg(pt(0, 0), pt(10, 0)))).toBe(true);
    });

    it('reports a shared endpoint as an intersection regardless of orientation', () => {
      // Regression: the perpendicular case answered true, the collinear one false.
      expect(segmentsIntersect(seg(pt(0, 0), pt(5, 0)), seg(pt(5, 0), pt(5, 5)))).toBe(true);
      expect(segmentsIntersect(seg(pt(0, 0), pt(5, 0)), seg(pt(5, 0), pt(10, 0)))).toBe(true);
    });

    it('rejects collinear segments that only touch in projection', () => {
      expect(segmentsIntersect(seg(pt(0, 0), pt(5, 0)), seg(pt(6, 0), pt(10, 0)))).toBe(false);
      expect(segmentsIntersect(seg(pt(0, 0), pt(5, 5)), seg(pt(6, 0), pt(10, 9)))).toBe(false);
    });

    it('agrees with an independent parametric solve', () => {
      // Independent reference: solve p1 + t*(p2-p1) = p3 + u*(p4-p3) by Cramer's
      // rule, and fall back to a 1-D projection overlap when the lines are parallel.
      const reference = (s1: LineSegment, s2: LineSegment): boolean => {
        const r = { x: s1.end.x - s1.start.x, y: s1.end.y - s1.start.y };
        const s = { x: s2.end.x - s2.start.x, y: s2.end.y - s2.start.y };
        const qp = { x: s2.start.x - s1.start.x, y: s2.start.y - s1.start.y };
        const cross = (u: Point, v: Point) => u.x * v.y - u.y * v.x;
        const denom = cross(r, s);
        if (denom !== 0) {
          const t = cross(qp, s) / denom;
          const u = cross(qp, r) / denom;
          return t >= 0 && t <= 1 && u >= 0 && u <= 1;
        }
        if (cross(qp, r) !== 0) return false; // parallel, not collinear
        const rr = r.x * r.x + r.y * r.y;
        if (rr === 0)
          return s.x * s.x + s.y * s.y === 0 ? distance(s1.start, s2.start) === 0 : false;
        const t1 = 0;
        const t2 = (qp.x * r.x + qp.y * r.y) / rr;
        const [lo, hi] = [Math.min(t1, t2), Math.max(t1, t2)];
        const ss = s.x * s.x + s.y * s.y;
        if (ss === 0) return qp.x * r.x + qp.y * r.y >= 0 && qp.x * r.x + qp.y * r.y <= rr;
        const u1 = 0;
        const u2 = -(qp.x * s.x + qp.y * s.y) / ss;
        return Math.max(lo, Math.min(u1, u2)) <= Math.min(hi, Math.max(u1, u2));
      };
      const whole = fc.integer({ min: -20, max: 20 });
      fc.assert(
        fc.property(
          fc.array(whole, { minLength: 4, maxLength: 4 }),
          fc.array(whole, { minLength: 4, maxLength: 4 }),
          (a, b) => {
            const s1 = seg(pt(a[0]!, a[1]!), pt(a[2]!, a[3]!));
            const s2 = seg(pt(b[0]!, b[1]!), pt(b[2]!, b[3]!));
            expect(segmentsIntersect(s1, s2)).toBe(reference(s1, s2));
            expect(segmentsIntersect(s2, s1)).toBe(reference(s1, s2));
          }
        ),
        { seed: SEED, numRuns: RUNS }
      );
    });
  });

  describe('segmentIntersectsPolygon', () => {
    const square = [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)];

    it('rejects polygons with fewer than two points and segments clear of the shape', () => {
      expect(segmentIntersectsPolygon(seg(pt(1, 1), pt(2, 2)), [])).toBe(false);
      expect(segmentIntersectsPolygon(seg(pt(1, 1), pt(2, 2)), [pt(0, 0)])).toBe(false);
      expect(segmentIntersectsPolygon(seg(pt(1, 1), pt(2, 2)), [pt(0, 0), pt(3, 0)])).toBe(false);
      expect(segmentIntersectsPolygon(seg(pt(20, 20), pt(30, 30)), square)).toBe(false);
    });

    it('detects a crossing and a fully contained segment', () => {
      expect(segmentIntersectsPolygon(seg(pt(-5, 5), pt(15, 5)), square)).toBe(true);
      expect(segmentIntersectsPolygon(seg(pt(2, 2), pt(8, 8)), square)).toBe(true);
    });

    it('detects a segment running along an edge', () => {
      expect(segmentIntersectsPolygon(seg(pt(-5, 0), pt(5, 0)), square)).toBe(true);
    });
  });

  describe('distanceToSegment', () => {
    it('should calculate distance from point to segment', () => {
      const segment = { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
      expect(distanceToSegment({ x: 5, y: 5 }, segment)).toBe(5);
      expect(distanceToSegment({ x: 15, y: 5 }, segment)).toBeCloseTo(Math.sqrt(25 + 25));
    });

    it('clamps to the nearer endpoint outside the segment span', () => {
      const s = seg(pt(0, 0), pt(10, 0));
      expect(distanceToSegment(pt(-3, 4), s)).toBe(5);
      expect(distanceToSegment(pt(13, 4), s)).toBe(5);
    });

    it('falls back to point distance for a degenerate segment', () => {
      expect(distanceToSegment(pt(3, 4), seg(pt(0, 0), pt(0, 0)))).toBe(5);
    });

    it('never exceeds the distance to either endpoint', () => {
      fc.assert(
        fc.property(fcPoint, fcPoint, fcPoint, (a, b, p) => {
          const d = distanceToSegment(p, seg(a, b));
          expect(d).toBeGreaterThanOrEqual(0);
          expect(d).toBeLessThanOrEqual(distance(p, a) + 1e-9);
          expect(d).toBeLessThanOrEqual(distance(p, b) + 1e-9);
          expect(d).toBeCloseTo(distanceToSegment(p, seg(b, a)), 9);
        }),
        { seed: SEED, numRuns: RUNS }
      );
    });

    it('matches the clamped parametric projection', () => {
      fc.assert(
        fc.property(fcPoint, fcPoint, fcPoint, (a, b, p) => {
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len2 = dx * dx + dy * dy;
          if (len2 === 0) return;
          const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
          expect(distanceToSegment(p, seg(a, b))).toBeCloseTo(
            distance(p, pt(a.x + t * dx, a.y + t * dy)),
            6
          );
        }),
        { seed: SEED, numRuns: RUNS }
      );
    });

    it('is zero when the projection parameter lands on the point', () => {
      fc.assert(
        fc.property(fcPoint, num(0.2, 5), num(0, 1), (a, len, t) => {
          const b = pt(a.x + len, a.y);
          const p = pt(a.x + len * t, a.y);
          expect(distanceToSegment(p, seg(a, b))).toBeCloseTo(0, 6);
        }),
        { seed: SEED, numRuns: RUNS }
      );
    });
  });

  describe('distanceToRect', () => {
    const rect: Bounds = { x: 0, y: 0, width: 10, height: 10 };

    it('is zero inside and on the border', () => {
      expect(distanceToRect(pt(5, 5), rect)).toBe(0);
      expect(distanceToRect(pt(0, 0), rect)).toBe(0);
      expect(distanceToRect(pt(10, 10), rect)).toBe(0);
    });

    it('returns the edge gap on each side and the corner gap off a corner', () => {
      expect(distanceToRect(pt(-3, 5), rect)).toBe(3);
      expect(distanceToRect(pt(13, 5), rect)).toBe(3);
      expect(distanceToRect(pt(5, -4), rect)).toBe(4);
      expect(distanceToRect(pt(5, 14), rect)).toBe(4);
      expect(distanceToRect(pt(-3, -4), rect)).toBe(5);
    });
  });

  describe('point helpers', () => {
    it('getCenter is the box midpoint', () => {
      expect(getCenter({ x: 0, y: 0, width: 10, height: 4 })).toEqual({ x: 5, y: 2 });
    });

    it('getMidpoint is the average of the endpoints', () => {
      expect(getMidpoint(pt(0, 0), pt(3, 7))).toEqual({ x: 1.5, y: 3.5 });
    });

    it('getVector is the displacement', () => {
      expect(getVector(pt(1, 2), pt(4, 6))).toEqual({ x: 3, y: 4 });
    });

    it('normalizeVector yields a unit vector and maps zero to zero', () => {
      expect(normalizeVector(pt(3, 4))).toEqual({ x: 0.6, y: 0.8 });
      expect(normalizeVector(pt(0, 0))).toEqual({ x: 0, y: 0 });
      // Sampled as magnitude + angle: fast-check's raw double stream includes
      // denormals, whose squared length underflows to zero.
      const v = fc.record({ r: fc.double({ min: 1e-3, max: 1e6 }), a: num(-Math.PI, Math.PI) });
      fc.assert(
        fc.property(v, ({ r, a }) => {
          const vec = pt(r * Math.cos(a), r * Math.sin(a));
          const n = normalizeVector(vec);
          expect(Math.hypot(n.x, n.y)).toBeCloseTo(1, 9);
          expect(Math.sign(n.x)).toBe(Math.sign(vec.x));
          expect(Math.sign(n.y)).toBe(Math.sign(vec.y));
        }),
        { seed: SEED, numRuns: RUNS }
      );
    });

    it('getAngle returns atan2 of the displacement, wrapped to (-pi, pi]', () => {
      expect(getAngle(pt(0, 0), pt(1, 1))).toBeCloseTo(Math.PI / 4, 12);
      expect(getAngle(pt(5, 5), pt(5, 5))).toBe(0);
      fc.assert(
        fc.property(fcPoint, fcPoint, (a, b) => {
          expect(getAngle(a, b)).toBeCloseTo(Math.atan2(b.y - a.y, b.x - a.x), 9);
        }),
        { seed: SEED, numRuns: RUNS }
      );
    });
  });

  describe('getLineIntersection', () => {
    it('finds a crossing and places it on both segments', () => {
      const hit = getLineIntersection(seg(pt(0, 0), pt(10, 0)), seg(pt(2, -5), pt(2, 2)));
      expect(hit).not.toBeNull();
      expect(hit!.x).toBeCloseTo(2, 9);
      expect(hit!.y).toBeCloseTo(0, 9);
    });

    it('finds the crossing of a diagonal X', () => {
      const hit = getLineIntersection(seg(pt(0, 0), pt(10, 10)), seg(pt(0, 10), pt(10, 0)));
      expect(hit!.x).toBeCloseTo(5, 9);
      expect(hit!.y).toBeCloseTo(5, 9);
    });

    it('returns null for parallel and for disjoint segments', () => {
      expect(getLineIntersection(seg(pt(0, 0), pt(10, 0)), seg(pt(0, 5), pt(10, 5)))).toBeNull();
      expect(getLineIntersection(seg(pt(0, 0), pt(1, 0)), seg(pt(5, -1), pt(5, 1)))).toBeNull();
    });

    it('returns null when the lines cross outside one segment', () => {
      expect(getLineIntersection(seg(pt(0, 0), pt(1, 0)), seg(pt(5, -1), pt(6, 1)))).toBeNull();
    });

    it('whatever it returns lies on both segments', () => {
      const liesOn = (p: Point, a: Point, b: Point) => {
        const len = distance(a, b);
        if (len === 0) return distance(p, a) < 1e-6;
        return Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len < 1e-6;
      };
      fc.assert(
        fc.property(fcPoint, fcPoint, fcPoint, fcPoint, (a, b, c, d) => {
          const hit = getLineIntersection(seg(a, b), seg(c, d));
          if (!hit) return;
          expect(liesOn(hit, a, b)).toBe(true);
          expect(liesOn(hit, c, d)).toBe(true);
        }),
        { seed: SEED, numRuns: 400 }
      );
    });
  });

  describe('getUnionBounds', () => {
    it('returns an empty box for no input and the input itself for one box', () => {
      expect(getUnionBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
      const one: Bounds = { x: 2, y: 3, width: 4, height: 5 };
      expect(getUnionBounds([one])).toEqual(one);
    });

    it('covers every input box', () => {
      const a: Bounds = { x: 0, y: 0, width: 10, height: 10 };
      const b: Bounds = { x: 5, y: -5, width: 2, height: 40 };
      const u = getUnionBounds([a, b]);
      expect(u).toEqual({ x: 0, y: -5, width: 10, height: 40 });
      expect(getUnionBounds([a, b])).toEqual(getUnionBounds([b, a]));

      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              x: num(-200, 200),
              y: num(-200, 200),
              width: num(0, 100),
              height: num(0, 100),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          boxes => {
            const u = getUnionBounds(boxes);
            for (const b of boxes) {
              expect(b.x).toBeGreaterThanOrEqual(u.x - 1e-9);
              expect(b.y).toBeGreaterThanOrEqual(u.y - 1e-9);
              expect(b.x + b.width).toBeLessThanOrEqual(u.x + u.width + 1e-9);
              expect(b.y + b.height).toBeLessThanOrEqual(u.y + u.height + 1e-9);
            }
          }
        ),
        { seed: SEED, numRuns: RUNS }
      );
    });
  });

  describe('getIntersectionBounds', () => {
    it('returns the overlap of two crossing boxes', () => {
      expect(
        getIntersectionBounds(
          { x: 0, y: 0, width: 10, height: 10 },
          { x: 5, y: 5, width: 10, height: 10 }
        )
      ).toEqual({
        x: 5,
        y: 5,
        width: 5,
        height: 5,
      });
    });

    it('returns the smaller box when one contains the other', () => {
      const inner: Bounds = { x: 2, y: 2, width: 3, height: 3 };
      expect(getIntersectionBounds({ x: 0, y: 0, width: 10, height: 10 }, inner)).toEqual(inner);
    });

    it('returns null for disjoint boxes and for zero-area touching', () => {
      expect(
        getIntersectionBounds(
          { x: 0, y: 0, width: 10, height: 10 },
          { x: 40, y: 40, width: 5, height: 5 }
        )
      ).toBeNull();
      // Note the deliberate asymmetry with `boundsIntersect`, which answers true
      // for this same touching pair: this function reports only positive-area
      // overlap. Both are documented behaviour of an untested dead export.
      expect(
        getIntersectionBounds(
          { x: 0, y: 0, width: 10, height: 10 },
          { x: 10, y: 10, width: 5, height: 5 }
        )
      ).toBeNull();
    });

    it('when non-null the result lies inside both inputs', () => {
      fc.assert(
        fc.property(
          fc.record({
            x: num(-100, 100),
            y: num(-100, 100),
            width: num(1, 100),
            height: num(1, 100),
          }),
          fc.record({
            x: num(-100, 100),
            y: num(-100, 100),
            width: num(1, 100),
            height: num(1, 100),
          }),
          (a, b) => {
            const i = getIntersectionBounds(a, b);
            if (!i) return;
            for (const box of [a, b]) {
              expect(i.x).toBeGreaterThanOrEqual(box.x - 1e-9);
              expect(i.y).toBeGreaterThanOrEqual(box.y - 1e-9);
              expect(i.x + i.width).toBeLessThanOrEqual(box.x + box.width + 1e-9);
              expect(i.y + i.height).toBeLessThanOrEqual(box.y + box.height + 1e-9);
            }
            expect(boundsIntersect(a, b)).toBe(true);
          }
        ),
        { seed: SEED, numRuns: RUNS }
      );
    });
  });

  describe('rotateBounds', () => {
    const box: Bounds = { x: 0, y: 0, width: 10, height: 10 };

    it('leaves the box alone at angle 0', () => {
      expect(rotateBounds(box, pt(0, 0), 0)).toEqual(box);
    });

    it('maps a square to itself under a quarter turn about its own centre', () => {
      const r = rotateBounds(box, pt(5, 5), Math.PI / 2);
      expect(r.x).toBeCloseTo(0, 9);
      expect(r.y).toBeCloseTo(0, 9);
      expect(r.width).toBeCloseTo(10, 9);
      expect(r.height).toBeCloseTo(10, 9);
    });

    it('swaps width and height for a rectangle under a quarter turn', () => {
      const r = rotateBounds({ x: 0, y: 0, width: 20, height: 10 }, pt(10, 5), Math.PI / 2);
      expect(r.width).toBeCloseTo(10, 9);
      expect(r.height).toBeCloseTo(20, 9);
    });

    it('45 degrees gives width = height = side * sqrt(2)', () => {
      const r = rotateBounds(box, pt(5, 5), Math.PI / 4);
      expect(r.width).toBeCloseTo(10 * Math.SQRT2, 9);
      expect(r.height).toBeCloseTo(10 * Math.SQRT2, 9);
    });

    it('moves the box centre exactly like a rotated point', () => {
      fc.assert(
        fc.property(
          num(-200, 200),
          num(-200, 200),
          num(1, 300),
          num(1, 300),
          fcPoint,
          fcAngle,
          (x, y, w, h, c, a) => {
            const r = rotateBounds({ x, y, width: w, height: h }, c, a);
            const expected = rotatePoint(pt(x + w / 2, y + h / 2), c.x, c.y, a);
            expect(r.x + r.width / 2).toBeCloseTo(expected.x, 6);
            expect(r.y + r.height / 2).toBeCloseTo(expected.y, 6);
          }
        ),
        { seed: SEED, numRuns: RUNS }
      );
    });

    it('bounds of a rotated box cover every rotated corner', () => {
      fc.assert(
        fc.property(
          num(-100, 100),
          num(-100, 100),
          num(1, 200),
          num(1, 200),
          fcPoint,
          fcAngle,
          (x, y, w, h, c, a) => {
            const b = { x, y, width: w, height: h };
            const r = rotateBounds(b, c, a);
            for (const corner of [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)]) {
              const p = rotatePoint(corner, c.x, c.y, a);
              expect(p.x).toBeGreaterThanOrEqual(r.x - 1e-6);
              expect(p.x).toBeLessThanOrEqual(r.x + r.width + 1e-6);
              expect(p.y).toBeGreaterThanOrEqual(r.y - 1e-6);
              expect(p.y).toBeLessThanOrEqual(r.y + r.height + 1e-6);
            }
          }
        ),
        { seed: SEED, numRuns: RUNS }
      );
    });
  });

  describe('scaleBounds', () => {
    it('doubles the box about its own centre', () => {
      expect(scaleBounds({ x: 0, y: 0, width: 10, height: 10 }, pt(5, 5), 2)).toEqual({
        x: -5,
        y: -5,
        width: 20,
        height: 20,
      });
    });

    it('halves the box about its own centre', () => {
      expect(scaleBounds({ x: 0, y: 0, width: 10, height: 10 }, pt(5, 5), 0.5)).toEqual({
        x: 2.5,
        y: 2.5,
        width: 5,
        height: 5,
      });
    });

    it('is the identity at scale 1 and moves the centre like a scaled point', () => {
      const b: Bounds = { x: 3, y: 4, width: 20, height: 8 };
      expect(scaleBounds(b, pt(13, 8), 1)).toEqual(b);
      fc.assert(
        fc.property(num(1, 200), num(1, 200), fcPoint, num(0.1, 5), (w, h, c, s) => {
          const r = scaleBounds({ x: 0, y: 0, width: w, height: h }, c, s);
          // The pivot itself is a fixed point of the scaling.
          expect(r.width).toBeCloseTo(w * s, 9);
          expect(r.height).toBeCloseTo(h * s, 9);
          // The box centre maps like any other point about the same pivot.
          const centre = { x: w / 2, y: h / 2 };
          expect(r.x + r.width / 2).toBeCloseTo(c.x + (centre.x - c.x) * s, 6);
          expect(r.y + r.height / 2).toBeCloseTo(c.y + (centre.y - c.y) * s, 6);
        }),
        { seed: SEED, numRuns: RUNS }
      );
    });
  });
});
