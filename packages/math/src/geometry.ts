import type { Point } from '@dripl/common';

export function distance(a: Point, b: Point): number {
  return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
}

export function rotate(
  x: number,
  y: number,
  cx: number,
  cy: number,
  angle: number
): [number, number] {
  return [
    (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle) + cx,
    (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle) + cy,
  ];
}

export function rotatePoint(p: Point, cx: number, cy: number, angleRad: number): Point {
  const dx = p.x - cx;
  const dy = p.y - cy;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

export function isPointInRect(
  point: Point,
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

// ===== NEW ERASER UTILITIES =====

export interface LineSegment {
  start: Point;
  end: Point;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Calculate the shortest distance from a point to a line segment
 */
export function distanceToSegment(point: Point, segment: LineSegment): number {
  const { start, end } = segment;
  const l2 = Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2);

  if (l2 === 0) return distance(point, start);

  let t = ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / l2;
  t = Math.max(0, Math.min(1, t));

  const projection = {
    x: start.x + t * (end.x - start.x),
    y: start.y + t * (end.y - start.y),
  };

  return distance(point, projection);
}

/**
 * Check if two line segments intersect.
 *
 * Segments are treated as closed sets, so touching at a shared endpoint counts
 * as an intersection, and collinear overlap counts too. The previous strict
 * `ccw(a) !== ccw(b)` form got both of those wrong and did so
 * inconsistently: two segments meeting perpendicular at (5,0) reported
 * `true` while two collinear segments meeting at the same (5,0) reported
 * `false`.
 */
export function segmentsIntersect(seg1: LineSegment, seg2: LineSegment): boolean {
  const { start: p1, end: p2 } = seg1;
  const { start: p3, end: p4 } = seg2;

  // Sign of the cross product (p1 -> p2) x (p1 -> p3): 1 left, -1 right, 0 collinear.
  const orient = (a: Point, b: Point, c: Point): -1 | 0 | 1 => {
    const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    return v > 0 ? 1 : v < 0 ? -1 : 0;
  };

  const liesWithin = (a: Point, b: Point, p: Point): boolean =>
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y);

  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);

  const straddles = (s1: -1 | 0 | 1, s2: -1 | 0 | 1): boolean => s1 * s2 < 0;
  if (straddles(d1, d2) && straddles(d3, d4)) return true;

  // Collinear overlap and shared endpoints: one endpoint sits on the other segment.
  if (d1 === 0 && liesWithin(p3, p4, p1)) return true;
  if (d2 === 0 && liesWithin(p3, p4, p2)) return true;
  if (d3 === 0 && liesWithin(p1, p2, p3)) return true;
  if (d4 === 0 && liesWithin(p1, p2, p4)) return true;

  return false;
}

/**
 * Get bounding box for an array of points
 */
export function getBounds(points: Point[]): Bounds {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Check if two bounding boxes intersect
 */
export function boundsIntersect(bounds1: Bounds, bounds2: Bounds): boolean {
  return !(
    bounds1.x + bounds1.width < bounds2.x ||
    bounds2.x + bounds2.width < bounds1.x ||
    bounds1.y + bounds1.height < bounds2.y ||
    bounds2.y + bounds2.height < bounds1.y
  );
}

/**
 * Point in polygon test using ray casting algorithm.
 *
 * Points lying exactly on the boundary count as inside. The crossing-number
 * sweep alone cannot deliver that: it is direction-dependent, so for an
 * axis-aligned square it reported the left and top edges as inside and the
 * right and bottom edges as outside. `isPointInElement` pre-filters with a
 * closed (`<=`) box test and then delegates the shape test here, so a
 * diamond's top, right and bottom vertices were not hit-testable while its
 * left vertex was.
 */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!;
    const b = polygon[i]!;
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (
      cross === 0 &&
      point.x >= Math.min(a.x, b.x) &&
      point.x <= Math.max(a.x, b.x) &&
      point.y >= Math.min(a.y, b.y) &&
      point.y <= Math.max(a.y, b.y)
    ) {
      return true;
    }
  }

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]!.x;
    const yi = polygon[i]!.y;
    const xj = polygon[j]!.x;
    const yj = polygon[j]!.y;

    const intersect =
      yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Check if a line segment intersects with a polygon
 */
export function segmentIntersectsPolygon(segment: LineSegment, polygon: Point[]): boolean {
  if (polygon.length < 2) return false;

  // Check if segment intersects any edge of the polygon
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const edge: LineSegment = {
      start: polygon[i]!,
      end: polygon[j]!,
    };

    if (segmentsIntersect(segment, edge)) {
      return true;
    }
  }

  // Check if segment is entirely inside polygon
  if (pointInPolygon(segment.start, polygon) || pointInPolygon(segment.end, polygon)) {
    return true;
  }

  return false;
}

// ===== ADVANCED GEOMETRY OPERATIONS =====

/**
 * Calculate center point of a bounds
 */
export function getCenter(bounds: Bounds): Point {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

/**
 * Calculate midpoint between two points
 */
export function getMidpoint(p1: Point, p2: Point): Point {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
  };
}

/**
 * Calculate vector between two points
 */
export function getVector(from: Point, to: Point): Point {
  return {
    x: to.x - from.x,
    y: to.y - from.y,
  };
}

/**
 * Normalize a vector
 */
export function normalizeVector(vector: Point): Point {
  const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y);
  if (length === 0) return { x: 0, y: 0 };
  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

/**
 * Calculate angle between two points
 */
export function getAngle(p1: Point, p2: Point): number {
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

/**
 * Calculate distance from point to rectangle
 */
export function distanceToRect(point: Point, rect: Bounds): number {
  const dx = Math.max(Math.max(rect.x - point.x, 0), point.x - (rect.x + rect.width));
  const dy = Math.max(Math.max(rect.y - point.y, 0), point.y - (rect.y + rect.height));
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate intersection point of two lines
 */
export function getLineIntersection(line1: LineSegment, line2: LineSegment): Point | null {
  const { start: p1, end: p2 } = line1;
  const { start: p3, end: p4 } = line2;

  const denominator = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);

  if (denominator === 0) return null; // Parallel lines

  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / denominator;
  const u = -((p1.x - p2.x) * (p1.y - p3.y) - (p1.y - p2.y) * (p1.x - p3.x)) / denominator;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: p1.x + t * (p2.x - p1.x),
      y: p1.y + t * (p2.y - p1.y),
    };
  }

  return null;
}

/**
 * Calculate bounding box that contains all given bounds
 */
export function getUnionBounds(boundsList: Bounds[]): Bounds {
  if (boundsList.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  boundsList.forEach(bounds => {
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  });

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Calculate bounding box intersection
 */
export function getIntersectionBounds(bounds1: Bounds, bounds2: Bounds): Bounds | null {
  const x1 = Math.max(bounds1.x, bounds2.x);
  const y1 = Math.max(bounds1.y, bounds2.y);
  const x2 = Math.min(bounds1.x + bounds1.width, bounds2.x + bounds2.width);
  const y2 = Math.min(bounds1.y + bounds1.height, bounds2.y + bounds2.height);

  if (x1 < x2 && y1 < y2) {
    return {
      x: x1,
      y: y1,
      width: x2 - x1,
      height: y2 - y1,
    };
  }

  return null;
}

/**
 * Rotate bounds around center
 */
export function rotateBounds(bounds: Bounds, center: Point, angle: number): Bounds {
  // Rotate all corners
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ].map(p => {
    const [x, y] = rotate(p.x, p.y, center.x, center.y, angle);
    return { x, y };
  });

  // Calculate new bounds
  const minX = Math.min(...corners.map(p => p.x));
  const minY = Math.min(...corners.map(p => p.y));
  const maxX = Math.max(...corners.map(p => p.x));
  const maxY = Math.max(...corners.map(p => p.y));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Scale bounds around center
 */
export function scaleBounds(bounds: Bounds, center: Point, scale: number): Bounds {
  const dx = (bounds.x - center.x) * scale;
  const dy = (bounds.y - center.y) * scale;
  const newWidth = bounds.width * scale;
  const newHeight = bounds.height * scale;

  return {
    x: center.x + dx,
    y: center.y + dy,
    width: newWidth,
    height: newHeight,
  };
}
