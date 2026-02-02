import type { DriplElement, Point } from "@dripl/common";
import { isPointInElement, getElementBounds } from "./intersection";
import { Bounds, boundsIntersect, LineSegment, distanceToSegment } from "./geometry";

export { isPointInElement, getElementBounds } from "./intersection";

export function isPointInSelectionRect(
  point: Point,
  selectionRect: Bounds
): boolean {
  return (
    point.x >= selectionRect.x &&
    point.x <= selectionRect.x + selectionRect.width &&
    point.y >= selectionRect.y &&
    point.y <= selectionRect.y + selectionRect.height
  );
}

export function elementIntersectsSelectionRect(
  element: DriplElement,
  selectionRect: Bounds
): boolean {
  const elementBounds = getElementBounds(element);
  if (!boundsIntersect(elementBounds, selectionRect)) {
    return false;
  }

  const selectionCorners: Point[] = [
    { x: selectionRect.x, y: selectionRect.y },
    { x: selectionRect.x + selectionRect.width, y: selectionRect.y },
    {
      x: selectionRect.x + selectionRect.width,
      y: selectionRect.y + selectionRect.height,
    },
    { x: selectionRect.x, y: selectionRect.y + selectionRect.height },
  ];

  for (const corner of selectionCorners) {
    if (isPointInElement(corner, element)) {
      return true;
    }
  }

  const elementCorners: Point[] = [
    { x: element.x, y: element.y },
    { x: element.x + element.width, y: element.y },
    { x: element.x + element.width, y: element.y + element.height },
    { x: element.x, y: element.y + element.height },
  ];

  const angle = (element.angle || 0) as number;
  if (angle !== 0) {
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    for (let i = 0; i < elementCorners.length; i++) {
      const corner = elementCorners[i]!;
      const dx = corner.x - cx;
      const dy = corner.y - cy;
      elementCorners[i] = {
        x: cx + dx * cos - dy * sin,
        y: cy + dx * sin + dy * cos,
      };
    }
  }

  for (const corner of elementCorners) {
    if (isPointInSelectionRect(corner, selectionRect)) {
      return true;
    }
  }

  if (
    element.type === "arrow" ||
    element.type === "line" ||
    element.type === "freedraw"
  ) {
    const points = (element as any).points || [];
    if (points.length > 1) {
      for (let i = 0; i < points.length - 1; i++) {
        const segment: LineSegment = {
          start: { x: element.x + points[i]!.x, y: element.y + points[i]!.y },
          end: {
            x: element.x + points[i + 1]!.x,
            y: element.y + points[i + 1]!.y,
          },
        };

        const segBounds: Bounds = {
          x: Math.min(segment.start.x, segment.end.x),
          y: Math.min(segment.start.y, segment.end.y),
          width: Math.abs(segment.end.x - segment.start.x),
          height: Math.abs(segment.end.y - segment.start.y),
        };

        if (boundsIntersect(segBounds, selectionRect)) {
          const selectionEdges: LineSegment[] = [
            {
              start: selectionCorners[0]!,
              end: selectionCorners[1]!,
            },
            {
              start: selectionCorners[1]!,
              end: selectionCorners[2]!,
            },
            {
              start: selectionCorners[2]!,
              end: selectionCorners[3]!,
            },
            {
              start: selectionCorners[3]!,
              end: selectionCorners[0]!,
            },
          ];

          for (const edge of selectionEdges) {
            const d1 =
              (edge.end.x - edge.start.x) * (segment.start.y - edge.start.y) -
              (edge.end.y - edge.start.y) * (segment.start.x - edge.start.x);
            const d2 =
              (edge.end.x - edge.start.x) * (segment.end.y - edge.start.y) -
              (edge.end.y - edge.start.y) * (segment.end.x - edge.start.x);
            const d3 =
              (segment.end.x - segment.start.x) * (edge.start.y - segment.start.y) -
              (segment.end.y - segment.start.y) * (edge.start.x - segment.start.x);
            const d4 =
              (segment.end.x - segment.start.x) * (edge.end.y - segment.start.y) -
              (segment.end.y - segment.start.y) * (edge.end.x - segment.start.x);

            if ((d1 < 0 && d2 > 0) || (d1 > 0 && d2 < 0)) {
              if ((d3 < 0 && d4 > 0) || (d3 > 0 && d4 < 0)) {
                return true;
              }
            }
          }
        }
      }
    }
  }

  return false;
}

export function getElementAtPoint(
  point: Point,
  elements: DriplElement[]
): DriplElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const element = elements[i];
    if (element && !element.isDeleted && isPointInElement(point, element)) {
      return element;
    }
  }
  return null;
}

export function getElementsInSelectionRect(
  selectionRect: Bounds,
  elements: DriplElement[]
): DriplElement[] {
  return elements.filter(
    (element) =>
      !element.isDeleted &&
      elementIntersectsSelectionRect(element, selectionRect)
  );
}
