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

// ===== ADVANCED GEOMETRY OPERATIONS =====

/**
 * Calculate center point of a bounds
 */
export const getCenter = (bounds: Bounds): Point => {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
};

/**
 * Calculate midpoint between two points
 */
export const getMidpoint = (p1: Point, p2: Point): Point => {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
  };
};

/**
 * Calculate vector between two points
 */
export const getVector = (from: Point, to: Point): Point => {
  return {
    x: to.x - from.x,
    y: to.y - from.y,
  };
};

/**
 * Normalize a vector
 */
export const normalizeVector = (vector: Point): Point => {
  const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y);
  if (length === 0) return { x: 0, y: 0 };
  return {
    x: vector.x / length,
    y: vector.y / length,
  };
};

/**
 * Calculate angle between two points
 */
export const getAngle = (p1: Point, p2: Point): number => {
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
};

/**
 * Calculate distance from point to rectangle
 */
export const distanceToRect = (point: Point, rect: Bounds): number => {
  const dx = Math.max(Math.max(rect.x - point.x, 0), point.x - (rect.x + rect.width));
  const dy = Math.max(Math.max(rect.y - point.y, 0), point.y - (rect.y + rect.height));
  return Math.sqrt(dx * dx + dy * dy);
};

/**
 * Calculate intersection point of two lines
 */
export const getLineIntersection = (
  line1: LineSegment,
  line2: LineSegment
): Point | null => {
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
};

/**
 * Calculate bounding box that contains all given bounds
 */
export const getUnionBounds = (boundsList: Bounds[]): Bounds => {
  if (boundsList.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  boundsList.forEach((bounds) => {
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
};

/**
 * Calculate bounding box intersection
 */
export const getIntersectionBounds = (bounds1: Bounds, bounds2: Bounds): Bounds | null => {
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
};

/**
 * Rotate bounds around center
 */
export const rotateBounds = (bounds: Bounds, center: Point, angle: number): Bounds => {
  // Rotate all corners
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ].map((p) => {
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
};

/**
 * Scale bounds around center
 */
export const scaleBounds = (bounds: Bounds, center: Point, scale: number): Bounds => {
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
};
