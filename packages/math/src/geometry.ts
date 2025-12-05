import { Point } from "@dripl/common";

export const distance = (a: Point, b: Point): number => {
  return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
};

export const rotate = (
  x: number,
  y: number,
  cx: number,
  cy: number,
  angle: number
): [number, number] => {
  return [
    (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle) + cx,
    (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle) + cy,
  ];
};

export const isPointInRect = (
  point: Point,
  rect: { x: number; y: number; width: number; height: number }
): boolean => {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
};

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
export const distanceToSegment = (
  point: Point,
  segment: LineSegment
): number => {
  const { start, end } = segment;
  const l2 = Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2);

  if (l2 === 0) return distance(point, start);

  let t =
    ((point.x - start.x) * (end.x - start.x) +
      (point.y - start.y) * (end.y - start.y)) /
    l2;
  t = Math.max(0, Math.min(1, t));

  const projection = {
    x: start.x + t * (end.x - start.x),
    y: start.y + t * (end.y - start.y),
  };

  return distance(point, projection);
};

/**
 * Check if two line segments intersect
 */
export const segmentsIntersect = (
  seg1: LineSegment,
  seg2: LineSegment
): boolean => {
  const { start: p1, end: p2 } = seg1;
  const { start: p3, end: p4 } = seg2;

  const ccw = (a: Point, b: Point, c: Point) => {
    return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  };

  return (
    ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4)
  );
};

/**
 * Get bounding box for an array of points
 */
export const getBounds = (points: Point[]): Bounds => {
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
};

/**
 * Check if two bounding boxes intersect
 */
export const boundsIntersect = (bounds1: Bounds, bounds2: Bounds): boolean => {
  return !(
    bounds1.x + bounds1.width < bounds2.x ||
    bounds2.x + bounds2.width < bounds1.x ||
    bounds1.y + bounds1.height < bounds2.y ||
    bounds2.y + bounds2.height < bounds1.y
  );
};

/**
 * Point in polygon test using ray casting algorithm
 */
export const pointInPolygon = (point: Point, polygon: Point[]): boolean => {
  if (polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]!.x;
    const yi = polygon[i]!.y;
    const xj = polygon[j]!.x;
    const yj = polygon[j]!.y;

    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
};

/**
 * Check if a line segment intersects with a polygon
 */
export const segmentIntersectsPolygon = (
  segment: LineSegment,
  polygon: Point[]
): boolean => {
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
  if (
    pointInPolygon(segment.start, polygon) ||
    pointInPolygon(segment.end, polygon)
  ) {
    return true;
  }

  return false;
};
