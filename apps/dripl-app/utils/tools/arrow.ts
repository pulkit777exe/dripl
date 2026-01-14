import type { DriplElement, Point, LinearElement } from "@dripl/common";

export interface ArrowToolState {
  points: Point[];
  isComplete: boolean;
}

export function createArrowElement(
  state: ArrowToolState,
  baseProps: Omit<DriplElement, "type" | "x" | "y" | "width" | "height" | "points">
): LinearElement {
  if (state.points.length === 0) {
    throw new Error("Arrow must have at least one point");
  }

  const minX = Math.min(...state.points.map((p) => p.x));
  const minY = Math.min(...state.points.map((p) => p.y));
  const maxX = Math.max(...state.points.map((p) => p.x));
  const maxY = Math.max(...state.points.map((p) => p.y));

  const relativePoints = state.points.map((p) => ({
    x: p.x - minX,
    y: p.y - minY,
  }));

  return {
    ...baseProps,
    type: "arrow",
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    points: relativePoints,
  };
}

export function snapArrowToElement(
  point: Point,
  elements: DriplElement[],
  excludeId?: string
): Point {
  const SNAP_THRESHOLD = 10;
  let snappedPoint = point;
  let minDistance = Infinity;

  for (const element of elements) {
    if (element.id === excludeId || element.isDeleted) continue;

    const bounds = {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    };

    const edges = [
      { x: bounds.x, y: bounds.y + bounds.height / 2 },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 },
      { x: bounds.x + bounds.width / 2, y: bounds.y },
      { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height },
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y },
      { x: bounds.x, y: bounds.y + bounds.height },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    ];

    for (const edge of edges) {
      const distance = Math.sqrt(
        Math.pow(point.x - edge.x, 2) + Math.pow(point.y - edge.y, 2)
      );
      if (distance < SNAP_THRESHOLD && distance < minDistance) {
        minDistance = distance;
        snappedPoint = edge;
      }
    }
  }

  return snappedPoint;
}
