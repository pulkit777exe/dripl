import {
  DriplElement,
  Point,
  FreeDrawElement,
  LinearElement,
  DiamondElement,
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

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function rotatePoint(
  p: Point,
  cx: number,
  cy: number,
  angleRad: number,
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
  angleRad: number,
): Point {
  return rotatePoint(p, cx, cy, -angleRad);
}

function elementLocalPointToWorld(el: DriplElement, pt: Point): Point {
  const world = { x: el.x + pt.x, y: el.y + pt.y };
  const angle = (el.angle || 0) as number;
  if (!angle) return world;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  return rotatePoint(world, cx, cy, degToRad(angle));
}

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

export const isPointInElement = (
  point: Point,
  element: DriplElement,
): boolean => {
  const bounds = getElementBounds(element);
  if (
    point.x < bounds.x ||
    point.x > bounds.x + bounds.width ||
    point.y < bounds.y ||
    point.y > bounds.y + bounds.height
  ) {
    return false;
  }

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

  if (element.type === "diamond") {
    const angle = (element.angle || 0) as number;
    let local = point;
    if (angle) {
      const cx = element.x + element.width / 2;
      const cy = element.y + element.height / 2;
      local = inverseRotatePoint(point, cx, cy, degToRad(angle));
    }

    const vertices: Point[] = [
      { x: element.x + element.width / 2, y: element.y },
      { x: element.x + element.width, y: element.y + element.height / 2 },
      { x: element.x + element.width / 2, y: element.y + element.height },
      { x: element.x, y: element.y + element.height / 2 },
    ];

    return pointInPolygon(local, vertices);
  }

  if (
    element.type === "freedraw" ||
    element.type === "arrow" ||
    element.type === "line"
  ) {
    const pts = (element as FreeDrawElement | LinearElement).points || [];
    const worldPts = pts.map((p) => elementLocalPointToWorld(element, p));
    const tolerance = (element.strokeWidth || 0) / 2 + 2;

    if (worldPts.length === 1) {
      const only = worldPts[0]!;
      return distance(only, point) <= tolerance;
    }

    for (let i = 0; i < worldPts.length - 1; i++) {
      const seg: LineSegment = { start: worldPts[i]!, end: worldPts[i + 1]! };
      if (distanceToSegment(point, seg) <= tolerance) return true;
    }

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

export const elementIntersectsSegment = (
  element: DriplElement,
  segment: LineSegment,
  threshold: number = 0,
): boolean => {
  const elBounds = getElementBounds(element);
  const segBounds: Bounds = {
    x: Math.min(segment.start.x, segment.end.x) - threshold,
    y: Math.min(segment.start.y, segment.end.y) - threshold,
    width: Math.abs(segment.end.x - segment.start.x) + threshold * 2,
    height: Math.abs(segment.end.y - segment.start.y) + threshold * 2,
  };

  if (!boundsIntersect(elBounds, segBounds)) return false;

  if (
    isPointInElement(segment.start, element) ||
    isPointInElement(segment.end, element)
  )
    return true;

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

  if (element.type === "diamond") {
    const vertices: Point[] = [
      { x: element.x + element.width / 2, y: element.y },
      { x: element.x + element.width, y: element.y + element.height / 2 },
      { x: element.x + element.width / 2, y: element.y + element.height },
      { x: element.x, y: element.y + element.height / 2 },
    ];

    const angle = (element.angle || 0) as number;
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    const worldVertices = angle
      ? vertices.map((v) => rotatePoint(v, cx, cy, degToRad(angle)))
      : vertices;

    return segmentIntersectsPolygon(segment, worldVertices);
  }

  if (element.type === "ellipse") {
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

export const getFreedrawOutline = (element: FreeDrawElement): Point[] => {
  const points = element.points || [];
  if (points.length === 0) return [];

  const world = points.map((p) => ({ x: element.x + p.x, y: element.y + p.y }));
  const angle = (element.angle || 0) as number;

  if (!angle) return world;

  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;

  return world.map((p) => rotatePoint(p, cx, cy, degToRad(angle)));
};
