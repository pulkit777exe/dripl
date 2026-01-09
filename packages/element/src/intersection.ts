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
} from "@dripl/math";

/**
 * Get the bounding box for any element
 */
export const getElementBounds = (element: DriplElement): Bounds => {
  if (
    element.type === "freedraw" ||
    element.type === "arrow" ||
    element.type === "line"
  ) {
    const points = (element as FreeDrawElement | LinearElement).points;
    const bounds = getBounds(points);

    // Add padding for stroke width
    const padding = element.strokeWidth / 2;
    return {
      x: bounds.x - padding,
      y: bounds.y - padding,
      width: bounds.width + padding * 2,
      height: bounds.height + padding * 2,
    };
  }

  // For rectangle, ellipse, text
  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  };
};

/**
 * Get outline points for freedraw elements
 */
export const getFreedrawOutline = (element: FreeDrawElement): Point[] => {
  return element.points;
};

/**
 * Check if a point is inside an element
 */
export const isPointInElement = (
  point: Point,
  element: DriplElement
): boolean => {
  if (element.type === "rectangle") {
    return (
      point.x >= element.x &&
      point.x <= element.x + element.width &&
      point.y >= element.y &&
      point.y <= element.y + element.height
    );
  }

  if (element.type === "ellipse") {
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    const rx = element.width / 2;
    const ry = element.height / 2;

    const normalizedX = (point.x - cx) / rx;
    const normalizedY = (point.y - cy) / ry;

    return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
  }

  if (element.type === "freedraw") {
    const outline = getFreedrawOutline(element as FreeDrawElement);
    return pointInPolygon(point, outline);
  }

  if (element.type === "text" || element.type === "image") {
    return (
      point.x >= element.x &&
      point.x <= element.x + element.width &&
      point.y >= element.y &&
      point.y <= element.y + element.height
    );
  }

  return false;
};

/**
 * Check if a line segment intersects with an element
 */
export const elementIntersectsSegment = (
  element: DriplElement,
  segment: LineSegment,
  threshold: number = 10
): boolean => {
  // Fast bounds check first
  const elementBounds = getElementBounds(element);
  const segmentBounds: Bounds = {
    x: Math.min(segment.start.x, segment.end.x) - threshold,
    y: Math.min(segment.start.y, segment.end.y) - threshold,
    width: Math.abs(segment.end.x - segment.start.x) + threshold * 2,
    height: Math.abs(segment.end.y - segment.start.y) + threshold * 2,
  };

  if (!boundsIntersect(elementBounds, segmentBounds)) {
    return false;
  }

  // Check if segment endpoints are inside element
  if (
    isPointInElement(segment.start, element) ||
    isPointInElement(segment.end, element)
  ) {
    return true;
  }

  // Type-specific intersection tests
  if (element.type === "rectangle") {
    const corners: Point[] = [
      { x: element.x, y: element.y },
      { x: element.x + element.width, y: element.y },
      { x: element.x + element.width, y: element.y + element.height },
      { x: element.x, y: element.y + element.height },
    ];

    return segmentIntersectsPolygon(segment, corners);
  }

  if (element.type === "ellipse") {
    // Approximate ellipse with polygon
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    const rx = element.width / 2;
    const ry = element.height / 2;
    const segments = 16;
    const points: Point[] = [];

    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push({
        x: cx + Math.cos(angle) * rx,
        y: cy + Math.sin(angle) * ry,
      });
    }

    return segmentIntersectsPolygon(segment, points);
  }

  if (
    element.type === "freedraw" ||
    element.type === "arrow" ||
    element.type === "line"
  ) {
    const points = (element as FreeDrawElement | LinearElement).points;

    // Check distance to each segment of the path
    for (let i = 0; i < points.length - 1; i++) {
      const pathSegment: LineSegment = {
        start: points[i]!,
        end: points[i + 1]!,
      };

      // Check if segments are close enough
      const dist1 = distanceToSegment(segment.start, pathSegment);
      const dist2 = distanceToSegment(segment.end, pathSegment);
      const dist3 = distanceToSegment(pathSegment.start, segment);
      const dist4 = distanceToSegment(pathSegment.end, segment);

      if (Math.min(dist1, dist2, dist3, dist4) <= threshold) {
        return true;
      }
    }

    // For freedraw, also check if segment is inside the closed path
    if (element.type === "freedraw" && points.length > 2) {
      return segmentIntersectsPolygon(segment, points);
    }
  }

  if (element.type === "text" || element.type === "image") {
    const corners: Point[] = [
      { x: element.x, y: element.y },
      { x: element.x + element.width, y: element.y },
      { x: element.x + element.width, y: element.y + element.height },
      { x: element.x, y: element.y + element.height },
    ];

    return segmentIntersectsPolygon(segment, corners);
  }

  return false;
};
