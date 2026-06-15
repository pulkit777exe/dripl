import type { DriplElement, Point, FreeDrawElement, LinearElement } from '@dripl/common';
import type { Bounds, LineSegment } from './geometry';
import {
  getBounds,
  boundsIntersect,
  distanceToSegment,
  segmentIntersectsPolygon,
  pointInPolygon,
  distance,
  rotatePoint,
} from './geometry';

export { rotatePoint } from './geometry';

/**
 * Threshold for determining if the first and last points of a path form a loop.
 * Points within this distance are considered the same point.
 */
const LINE_CONFIRM_THRESHOLD = 10;

/**
 * Checks if a background color is considered transparent (i.e., not a visible fill).
 * Empty string, 'transparent', 'rgba(0,0,0,0)', etc. are all transparent.
 */
function isTransparent(color?: string): boolean {
  if (!color) return true;
  if (color === 'transparent') return true;
  if (color.startsWith('rgba(')) {
    const match = color.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/);
    if (match && parseFloat(match[1]!) === 0) return true;
  }
  return false;
}

/**
 * Determines whether clicking *inside* the element's fill area counts as a hit.
 * Returns false for shapes that should only be hittable on their stroke/outline.
 *
 * Mirrors Excalidraw's shouldTestInside logic:
 * - Arrow: never (stroke only)
 * - Line/Freedraw: only if closed loop AND has non-transparent fill
 * - Rectangle/Diamond/Ellipse/Frame: only if has non-transparent bg or bound text
 * - Text/Image/Ifame: always true
 */
export function shouldTestInside(element: DriplElement): boolean {
  if (element.type === 'arrow') {
    return false;
  }

  const hasBackground =
    element.backgroundColor && !isTransparent(element.backgroundColor);
  const hasBoundText = element.boundElements?.some(b => b.type === 'text') ?? false;
  const isText = element.type === 'text';
  const isImage = element.type === 'image';

  const isDraggableFromInside = hasBackground || hasBoundText || isText;

  if (element.type === 'line') {
    return isDraggableFromInside && isPathALoop(element);
  }

  if (element.type === 'freedraw') {
    return isDraggableFromInside && isPathALoop(element);
  }

  return isDraggableFromInside || isImage;
}

/**
 * Checks if a freedraw or line element's points form a closed loop.
 * Uses LINE_CONFIRM_THRESHOLD to determine if endpoints are close enough.
 */
export function isPathALoop(element: FreeDrawElement | LinearElement): boolean {
  const pts = element.points || [];
  if (pts.length < 3) return false;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  return distance(first, last) <= LINE_CONFIRM_THRESHOLD;
}

export function inverseRotatePoint(p: Point, cx: number, cy: number, angleRad: number): Point {
  return rotatePoint(p, cx, cy, -angleRad);
}

export function elementLocalPointToWorld(el: DriplElement, pt: Point): Point {
  const world = { x: el.x + pt.x, y: el.y + pt.y };
  const angle = (el.angle || 0) as number;
  if (!angle) return world;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  return rotatePoint(world, cx, cy, angle);
}

export const getElementBounds = (element: DriplElement): Bounds => {
  const padding = (element.strokeWidth || 0) / 2;

  if (element.type === 'freedraw' || element.type === 'arrow' || element.type === 'line') {
    const points = ((element as FreeDrawElement | LinearElement).points || []).map(p =>
      elementLocalPointToWorld(element, p)
    );

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

  const corners: Point[] = [
    { x: element.x, y: element.y },
    { x: element.x + element.width, y: element.y },
    { x: element.x + element.width, y: element.y + element.height },
    { x: element.x, y: element.y + element.height },
  ];

  const angle = (element.angle || 0) as number;
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;

  const worldCorners = angle ? corners.map(c => rotatePoint(c, cx, cy, angle)) : corners;

  const b = getBounds(worldCorners);
  return {
    x: b.x - padding,
    y: b.y - padding,
    width: b.width + padding * 2,
    height: b.height + padding * 2,
  };
};

export const isPointInElement = (point: Point, element: DriplElement): boolean => {
  const bounds = getElementBounds(element);
  if (
    point.x < bounds.x ||
    point.x > bounds.x + bounds.width ||
    point.y < bounds.y ||
    point.y > bounds.y + bounds.height
  ) {
    return false;
  }

  if (element.type === 'rectangle' || element.type === 'text' || element.type === 'image') {
    const angle = (element.angle || 0) as number;
    let local = point;
    if (angle) {
      const cx = element.x + element.width / 2;
      const cy = element.y + element.height / 2;
      local = inverseRotatePoint(point, cx, cy, angle);
    }

    return (
      local.x >= element.x &&
      local.x <= element.x + element.width &&
      local.y >= element.y &&
      local.y <= element.y + element.height
    );
  }

  if (element.type === 'ellipse') {
    const angle = (element.angle || 0) as number;
    let local = point;
    if (angle) {
      const cx = element.x + element.width / 2;
      const cy = element.y + element.height / 2;
      local = inverseRotatePoint(point, cx, cy, angle);
    }

    const rx = element.width / 2;
    const ry = element.height / 2;
    const cx = element.x + rx;
    const cy = element.y + ry;
    const nx = (local.x - cx) / rx;
    const ny = (local.y - cy) / ry;
    return nx * nx + ny * ny <= 1;
  }

  if (element.type === 'diamond') {
    const angle = (element.angle || 0) as number;
    let local = point;
    if (angle) {
      const cx = element.x + element.width / 2;
      const cy = element.y + element.height / 2;
      local = inverseRotatePoint(point, cx, cy, angle);
    }

    const vertices: Point[] = [
      { x: element.x + element.width / 2, y: element.y },
      { x: element.x + element.width, y: element.y + element.height / 2 },
      { x: element.x + element.width / 2, y: element.y + element.height },
      { x: element.x, y: element.y + element.height / 2 },
    ];

    return pointInPolygon(local, vertices);
  }

  if (element.type === 'freedraw' || element.type === 'arrow' || element.type === 'line') {
    const pts = (element as FreeDrawElement | LinearElement).points || [];
    const worldPts = pts.map(p => elementLocalPointToWorld(element, p));
    const tolerance = (element.strokeWidth || 0) / 2 + 2;

    if (worldPts.length === 1) {
      const only = worldPts[0]!;
      return distance(only, point) <= tolerance;
    }

    for (let i = 0; i < worldPts.length - 1; i++) {
      const seg: LineSegment = { start: worldPts[i]!, end: worldPts[i + 1]! };
      if (distanceToSegment(point, seg) <= tolerance) return true;
    }

    if (element.type === 'freedraw' && worldPts.length > 2) {
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

export const elementIntersectsSegment = (
  element: DriplElement,
  segment: LineSegment,
  threshold: number = 0
): boolean => {
  const elBounds = getElementBounds(element);
  const segBounds: Bounds = {
    x: Math.min(segment.start.x, segment.end.x) - threshold,
    y: Math.min(segment.start.y, segment.end.y) - threshold,
    width: Math.abs(segment.end.x - segment.start.x) + threshold * 2,
    height: Math.abs(segment.end.y - segment.start.y) + threshold * 2,
  };

  if (!boundsIntersect(elBounds, segBounds)) return false;

  if (isPointInElement(segment.start, element) || isPointInElement(segment.end, element))
    return true;

  if (element.type === 'rectangle' || element.type === 'text' || element.type === 'image') {
    const corners: Point[] = [
      { x: element.x, y: element.y },
      { x: element.x + element.width, y: element.y },
      { x: element.x + element.width, y: element.y + element.height },
      { x: element.x, y: element.y + element.height },
    ];

    const angle = (element.angle || 0) as number;
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    const worldCorners = angle ? corners.map(c => rotatePoint(c, cx, cy, angle)) : corners;

    return segmentIntersectsPolygon(segment, worldCorners);
  }

  if (element.type === 'diamond') {
    const vertices: Point[] = [
      { x: element.x + element.width / 2, y: element.y },
      { x: element.x + element.width, y: element.y + element.height / 2 },
      { x: element.x + element.width / 2, y: element.y + element.height },
      { x: element.x, y: element.y + element.height / 2 },
    ];

    const angle = (element.angle || 0) as number;
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    const worldVertices = angle ? vertices.map(v => rotatePoint(v, cx, cy, angle)) : vertices;

    return segmentIntersectsPolygon(segment, worldVertices);
  }

  if (element.type === 'ellipse') {
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
    const angle = (element.angle || 0) as number;
    const centerX = cx;
    const centerY = cy;
    const worldPts = angle ? pts.map(p => rotatePoint(p, centerX, centerY, angle)) : pts;
    return segmentIntersectsPolygon(segment, worldPts);
  }

  if (element.type === 'freedraw' || element.type === 'arrow' || element.type === 'line') {
    const pts = (element as FreeDrawElement | LinearElement).points || [];
    const worldPts = pts.map(p => elementLocalPointToWorld(element, p));
    const tolerance = (element.strokeWidth || 0) / 2 + threshold;

    for (let i = 0; i < worldPts.length - 1; i++) {
      const pathSeg: LineSegment = {
        start: worldPts[i]!,
        end: worldPts[i + 1]!,
      };
      const d1 = distanceToSegment(segment.start, pathSeg);
      const d2 = distanceToSegment(segment.end, pathSeg);
      const d3 = distanceToSegment(pathSeg.start, segment);
      const d4 = distanceToSegment(pathSeg.end, segment);
      if (Math.min(d1, d2, d3, d4) <= tolerance) return true;
    }

    if (element.type === 'freedraw' && worldPts.length > 2) {
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

export const getFreedrawOutline = (element: FreeDrawElement): Point[] => {
  const points = element.points || [];
  if (points.length === 0) return [];

  const world = points.map(p => ({ x: element.x + p.x, y: element.y + p.y }));
  const angle = (element.angle || 0) as number;

  if (!angle) return world;

  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;

  return world.map(p => rotatePoint(p, cx, cy, angle));
};

/**
 * Distance from a point to the nearest edge of an element's bounding box.
 */
export const getDistanceToBounds = (point: Point, element: DriplElement): number => {
  const bounds = getElementBounds(element);
  const nearestX = Math.max(bounds.x, Math.min(point.x, bounds.x + bounds.width));
  const nearestY = Math.max(bounds.y, Math.min(point.y, bounds.y + bounds.height));
  const dx = point.x - nearestX;
  const dy = point.y - nearestY;
  return Math.sqrt(dx * dx + dy * dy);
};

/**
 * Whether a point is within tolerance of an element (inside or near its bounds).
 */
export const isPointNearElement = (
  point: Point,
  element: DriplElement,
  tolerance: number
): boolean => {
  if (isPointInElement(point, element)) return true;
  return getDistanceToBounds(point, element) <= tolerance;
};

/**
 * Tests if a point is within tolerance of the element's stroke/outline path.
 * Does NOT test the interior — only the drawn stroke.
 * Used for unfilled shapes where only the border should be hittable.
 */
export function isPointOnElementOutline(
  point: Point,
  element: DriplElement,
  threshold: number
): boolean {
  const angle = (element.angle || 0) as number;
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;

  // Counter-rotate the test point to work in element-local coordinates
  const local = angle ? inverseRotatePoint(point, cx, cy, angle) : point;

  if (element.type === 'rectangle' || element.type === 'text' || element.type === 'image' || element.type === 'frame') {
    // Test distance to each of the 4 sides
    const x1 = element.x;
    const y1 = element.y;
    const x2 = element.x + element.width;
    const y2 = element.y + element.height;

    const top: LineSegment = { start: { x: x1, y: y1 }, end: { x: x2, y: y1 } };
    const right: LineSegment = { start: { x: x2, y: y1 }, end: { x: x2, y: y2 } };
    const bottom: LineSegment = { start: { x: x1, y: y2 }, end: { x: x2, y: y2 } };
    const left: LineSegment = { start: { x: x1, y: y2 }, end: { x: x1, y: y1 } };

    const minDist = Math.min(
      distanceToSegment(local, top),
      distanceToSegment(local, right),
      distanceToSegment(local, bottom),
      distanceToSegment(local, left)
    );
    return minDist <= threshold;
  }

  if (element.type === 'diamond') {
    // Diamond vertices at midpoints of bounding box edges
    const vertices: Point[] = [
      { x: element.x + element.width / 2, y: element.y },
      { x: element.x + element.width, y: element.y + element.height / 2 },
      { x: element.x + element.width / 2, y: element.y + element.height },
      { x: element.x, y: element.y + element.height / 2 },
    ];

    let minDist = Infinity;
    for (let i = 0; i < vertices.length; i++) {
      const j = (i + 1) % vertices.length;
      const seg: LineSegment = { start: vertices[i]!, end: vertices[j]! };
      minDist = Math.min(minDist, distanceToSegment(local, seg));
    }
    return minDist <= threshold;
  }

  if (element.type === 'ellipse') {
    // Approximate ellipse with polygon and test distance to each segment
    const rx = element.width / 2;
    const ry = element.height / 2;
    const ecx = element.x + rx;
    const ecy = element.y + ry;
    const segments = 32;
    let minDist = Infinity;

    for (let i = 0; i < segments; i++) {
      const a1 = (i / segments) * Math.PI * 2;
      const a2 = ((i + 1) / segments) * Math.PI * 2;
      const p1: Point = { x: ecx + Math.cos(a1) * rx, y: ecy + Math.sin(a1) * ry };
      const p2: Point = { x: ecx + Math.cos(a2) * rx, y: ecy + Math.sin(a2) * ry };
      const seg: LineSegment = { start: p1, end: p2 };
      minDist = Math.min(minDist, distanceToSegment(local, seg));
    }
    return minDist <= threshold;
  }

  if (element.type === 'freedraw' || element.type === 'arrow' || element.type === 'line') {
    const pts = (element as FreeDrawElement | LinearElement).points || [];
    const worldPts = pts.map(p => elementLocalPointToWorld(element, p));
    const tolerance = (element.strokeWidth || 0) / 2 + threshold;

    for (let i = 0; i < worldPts.length - 1; i++) {
      const seg: LineSegment = { start: worldPts[i]!, end: worldPts[i + 1]! };
      if (distanceToSegment(point, seg) <= tolerance) return true;
    }
    return false;
  }

  return false;
}
