import type { DriplElement, Point, LinearElement } from "@dripl/common";

export interface ArrowToolState {
  points: Point[];
  isComplete: boolean;
}

/**
 * Create an arrow element
 * Supports multi-segment arrows (click multiple points)
 */
export function createArrowElement(
  state: ArrowToolState,
  baseProps: Omit<DriplElement, "type" | "x" | "y" | "width" | "height" | "points">
): LinearElement {
  if (state.points.length === 0) {
    throw new Error("Arrow must have at least one point");
  }

  // Calculate bounds
  const minX = Math.min(...state.points.map((p) => p.x));
  const minY = Math.min(...state.points.map((p) => p.y));
  const maxX = Math.max(...state.points.map((p) => p.x));
  const maxY = Math.max(...state.points.map((p) => p.y));

  // Points are stored relative to element position
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

/**
 * Snap arrow endpoint to nearest element edge (magnetic snap)
 */
export function snapArrowToElement(
  point: Point,
  elements: DriplElement[],
  excludeId?: string
): Point {
  const SNAP_THRESHOLD = 10; // pixels
  let snappedPoint = point;
  let minDistance = Infinity;

  for (const element of elements) {
    if (element.id === excludeId || element.isDeleted) continue;

    // Get element bounds
    const bounds = {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    };

    // Check each edge of the element
    const edges = [
      { x: bounds.x, y: bounds.y + bounds.height / 2 }, // left
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 }, // right
      { x: bounds.x + bounds.width / 2, y: bounds.y }, // top
      { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height }, // bottom
      { x: bounds.x, y: bounds.y }, // top-left
      { x: bounds.x + bounds.width, y: bounds.y }, // top-right
      { x: bounds.x, y: bounds.y + bounds.height }, // bottom-left
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, // bottom-right
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
