import {
  DriplElement,
  Point,
  FreeDrawElement,
  LinearElement,
} from "@dripl/common";
import {
  Bounds,
  LineSegment,
  getBounds,
  boundsIntersect,
  distanceToSegment,
  segmentIntersectsPolygon,
  pointInPolygon,
  distance,
} from "./geometry";

/**
 * Helpers to handle rotation and coordinate spaces.
 * Elements store `points` relative to element.x/element.y and may have an `angle`.
 */
function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function rotatePoint(
  p: Point,
  cx: number,
  cy: number,
  angleRad: number
): Point {
  const dx = p.x - cx;
  const dy = p.y - cy;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

function inverseRotatePoint(
  p: Point,
  cx: number,
  cy: number,
  angleRad: number
): Point {
  // rotate by -angle
  return rotatePoint(p, cx, cy, -angleRad);
}

/**
 * Convert element-local points to world coordinates (apply element.x/y + rotation).
 */
function elementLocalPointToWorld(el: DriplElement, pt: Point): Point {
  const world = { x: el.x + pt.x, y: el.y + pt.y };
  const angle = (el.angle || 0) as number;
  if (!angle) return world;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  return rotatePoint(world, cx, cy, degToRad(angle));
}

/**
 * Compute the tight axis-aligned bounding box for any element, taking rotation
 * and strokeWidth into account.
 */
export const getElementBounds = (element: DriplElement): Bounds => {
  const padding = (element.strokeWidth || 0) / 2;

  if (
    element.type === "freedraw" ||
    element.type === "arrow" ||
    element.type === "line"
  ) {
    const points = (
      (element as FreeDrawElement | LinearElement).points || []
    ).map((p) => elementLocalPointToWorld(element, p));

    if (points.length === 0) {
      return {
        x: element.x - padding,
        y: element.y - padding,
        width: padding * 2,
        height: padding * 2,
      };
    }

    const b = getBounds(points);
    return {
      x: b.x - padding,
      y: b.y - padding,
      width: b.width + padding * 2,
      height: b.height + padding * 2,
    };
  }

  // rectangle, ellipse, text, image
  // compute corners and apply rotation
  const corners: Point[] = [
    { x: element.x, y: element.y },
    { x: element.x + element.width, y: element.y },
    { x: element.x + element.width, y: element.y + element.height },
    { x: element.x, y: element.y + element.height },
  ];

  const angle = (element.angle || 0) as number;
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;

  const worldCorners = angle
    ? corners.map((c) => rotatePoint(c, cx, cy, degToRad(angle)))
    : corners;

  const b = getBounds(worldCorners);
  return {
    x: b.x - padding,
    y: b.y - padding,
    width: b.width + padding * 2,
    height: b.height + padding * 2,
  };
};

/**
 * Tests whether a world-space point lies inside an element.
 * For stroked linear elements (line/arrow/freedraw) we use distance-to-segment
 * with strokeWidth as tolerance. For filled shapes we use containment tests.
 */
export const isPointInElement = (
  point: Point,
  element: DriplElement
): boolean => {
  // Fast reject using AABB in world-space
  const bounds = getElementBounds(element);
  if (
    point.x < bounds.x ||
    point.x > bounds.x + bounds.width ||
    point.y < bounds.y ||
    point.y > bounds.y + bounds.height
  ) {
    return false;
  }

  // For rectangle/text/image: transform point to element-local unrotated space
  if (
    element.type === "rectangle" ||
    element.type === "text" ||
    element.type === "image"
  ) {
    const angle = (element.angle || 0) as number;
    let local = point;
    if (angle) {
      const cx = element.x + element.width / 2;
      const cy = element.y + element.height / 2;
      local = inverseRotatePoint(point, cx, cy, degToRad(angle));
    }

    return (
      local.x >= element.x &&
      local.x <= element.x + element.width &&
      local.y >= element.y &&
      local.y <= element.y + element.height
    );
  }

  // Ellipse: use normalized coordinates in element-space
  if (element.type === "ellipse") {
    const angle = (element.angle || 0) as number;
    let local = point;
    if (angle) {
      const cx = element.x + element.width / 2;
      const cy = element.y + element.height / 2;
      local = inverseRotatePoint(point, cx, cy, degToRad(angle));
    }

    const rx = element.width / 2;
    const ry = element.height / 2;
    const cx = element.x + rx;
    const cy = element.y + ry;
    const nx = (local.x - cx) / rx;
    const ny = (local.y - cy) / ry;
    return nx * nx + ny * ny <= 1;
  }

  // Linear / freedraw: distance to segment with tolerance
  if (
    element.type === "freedraw" ||
    element.type === "arrow" ||
    element.type === "line"
  ) {
    const pts = (element as FreeDrawElement | LinearElement).points || [];
    const worldPts = pts.map((p) => elementLocalPointToWorld(element, p));
    const tolerance = (element.strokeWidth || 0) / 2 + 2; // small extra leeway

    if (worldPts.length === 1) {
      const only = worldPts[0]!;
      return distance(only, point) <= tolerance;
    }

    for (let i = 0; i < worldPts.length - 1; i++) {
      const seg: LineSegment = { start: worldPts[i]!, end: worldPts[i + 1]! };
      if (distanceToSegment(point, seg) <= tolerance) return true;
    }

    // For freedraw, if there are >2 points and path is closed, also consider polygon containment
    // Heuristic: if first and last points are very close, treat as closed
    if (element.type === "freedraw" && worldPts.length > 2) {
      const first = worldPts[0]!;
      const last = worldPts[worldPts.length - 1]!;
      if (distance(first, last) <= (element.strokeWidth || 0) / 2 + 1) {
        return pointInPolygon(point, worldPts);
      }
    }

    return false;
  }

  return false;
};

/**
 * Check whether a world-space line segment intersects with an element.
 * We first perform a fast AABB check, then type-specific tests.
 */
export const elementIntersectsSegment = (
  element: DriplElement,
  segment: LineSegment,
  threshold: number = 0
): boolean => {
  // Fast AABB check (include stroke width and threshold)
  const elBounds = getElementBounds(element);
  const segBounds: Bounds = {
    x: Math.min(segment.start.x, segment.end.x) - threshold,
    y: Math.min(segment.start.y, segment.end.y) - threshold,
    width: Math.abs(segment.end.x - segment.start.x) + threshold * 2,
    height: Math.abs(segment.end.y - segment.start.y) + threshold * 2,
  };

  if (!boundsIntersect(elBounds, segBounds)) return false;

  // If either endpoint lies within the element, it's an intersection
  if (
    isPointInElement(segment.start, element) ||
    isPointInElement(segment.end, element)
  )
    return true;

  // Type-specific checks
  if (
    element.type === "rectangle" ||
    element.type === "text" ||
    element.type === "image"
  ) {
    const corners: Point[] = [
      { x: element.x, y: element.y },
      { x: element.x + element.width, y: element.y },
      { x: element.x + element.width, y: element.y + element.height },
      { x: element.x, y: element.y + element.height },
    ];

    const angle = (element.angle || 0) as number;
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    const worldCorners = angle
      ? corners.map((c) => rotatePoint(c, cx, cy, degToRad(angle)))
      : corners;

    return segmentIntersectsPolygon(segment, worldCorners);
  }

  if (element.type === "ellipse") {
    // approximate ellipse by polygon for intersection test
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    const rx = element.width / 2;
    const ry = element.height / 2;
    const segments = 32;
    const pts: Point[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }
    // apply rotation
    const angle = (element.angle || 0) as number;
    const centerX = cx;
    const centerY = cy;
    const worldPts = angle
      ? pts.map((p) => rotatePoint(p, centerX, centerY, degToRad(angle)))
      : pts;
    return segmentIntersectsPolygon(segment, worldPts);
  }

  if (
    element.type === "freedraw" ||
    element.type === "arrow" ||
    element.type === "line"
  ) {
    const pts = (element as FreeDrawElement | LinearElement).points || [];
    const worldPts = pts.map((p) => elementLocalPointToWorld(element, p));
    const tolerance = (element.strokeWidth || 0) / 2 + threshold;

    // Check distance to each segment of the path
    for (let i = 0; i < worldPts.length - 1; i++) {
      const pathSeg: LineSegment = {
        start: worldPts[i]!,
        end: worldPts[i + 1]!,
      };
      // If the two segments are close to each other, consider intersecting
      const d1 = distanceToSegment(segment.start, pathSeg);
      const d2 = distanceToSegment(segment.end, pathSeg);
      const d3 = distanceToSegment(pathSeg.start, segment);
      const d4 = distanceToSegment(pathSeg.end, segment);
      if (Math.min(d1, d2, d3, d4) <= tolerance) return true;
    }

    // For closed freedraw paths, also check polygon intersection
    if (element.type === "freedraw" && worldPts.length > 2) {
      const first = worldPts[0]!;
      const last = worldPts[worldPts.length - 1]!;
      if (distance(first, last) <= (element.strokeWidth || 0) / 2 + 1) {
        return segmentIntersectsPolygon(segment, worldPts);
      }
    }

    return false;
  }

  return false;
};

/**
 * For freedraw elements, outline is simply their local points translated to world.
 */
export const getFreedrawOutline = (element: FreeDrawElement): Point[] => {
  return (element.points || []).map((p) =>
    elementLocalPointToWorld(element, p)
  );
}
