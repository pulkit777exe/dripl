import type { DriplElement, Point, LinearElement } from "@dripl/common";

export interface LineToolState {
  points: Point[];
  isComplete: boolean;
  isDragging: boolean;
  currentPoint: Point | null;
  shiftKey: boolean;
}

export function createLineElement(
  state: LineToolState,
  baseProps: Omit<
    DriplElement,
    "type" | "x" | "y" | "width" | "height" | "points"
  > & { id: string },
): LinearElement {
  if (state.points.length === 0) {
    throw new Error("Line must have at least one point");
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
    type: "line",
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    points: relativePoints,
  };
}

export function snapLineToElement(
  point: Point,
  elements: DriplElement[],
  excludeId?: string,
  snapThreshold: number = 10,
): Point {
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
        Math.pow(point.x - edge.x, 2) + Math.pow(point.y - edge.y, 2),
      );
      if (distance < snapThreshold && distance < minDistance) {
        minDistance = distance;
        snappedPoint = edge;
      }
    }
  }

  return snappedPoint;
}

export function addPointToLine(
  point: Point,
  state: LineToolState,
): LineToolState {
  return {
    ...state,
    points: [...state.points, point],
  };
}

export function removePointFromLine(
  index: number,
  state: LineToolState,
): LineToolState {
  if (state.points.length <= 2) {
    return state;
  }

  const newPoints = [...state.points];
  newPoints.splice(index, 1);
  return {
    ...state,
    points: newPoints,
  };
}

export function updatePointInLine(
  index: number,
  point: Point,
  state: LineToolState,
): LineToolState {
  const newPoints = [...state.points];
  newPoints[index] = point;
  return {
    ...state,
    points: newPoints,
  };
}
