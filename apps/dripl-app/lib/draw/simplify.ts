import type { Point } from '@dripl/common';

/**
 * Stroke geometry — pure helpers extracted from `useDrawingTools`.
 *
 * Freedraw smoothing (Ramer–Douglas–Peucker) and shift-key angle snapping
 * are closed-form point math; they live here so the gesture hook owns only
 * store writes while the algorithms stay unit-tested.
 */

export function getDistance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Snap a pointer to the nearest `stepDegrees` increment from `start`. */
export function snapAngle(start: Point, end: Point, stepDegrees = 15): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance === 0) return end;
  const step = (stepDegrees * Math.PI) / 180;
  const snappedAngle = Math.round(Math.atan2(dy, dx) / step) * step;
  return {
    x: start.x + Math.cos(snappedAngle) * distance,
    y: start.y + Math.sin(snappedAngle) * distance,
  };
}

export function perpendicularDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return getDistance(point, start);
  }
  const numerator = Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x);
  const denominator = Math.sqrt(dx * dx + dy * dy);
  return numerator / denominator;
}

/**
 * Ramer–Douglas–Peucker polyline simplification. Collapses near-collinear
 * runs within `epsilon` px; passes through inputs of ≤2 points untouched.
 */
export function simplifyRdp(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points;

  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return points;

  let maxDistance = -1;
  let maxIndex = 0;

  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i];
    if (!point) continue;
    const distance = perpendicularDistance(point, first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  if (maxDistance <= epsilon) {
    return [first, last];
  }

  const left = simplifyRdp(points.slice(0, maxIndex + 1), epsilon);
  const right = simplifyRdp(points.slice(maxIndex), epsilon);
  return [...left.slice(0, -1), ...right];
}
