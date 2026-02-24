import type {
  DriplElement,
  Point,
  LinearElement,
  TextElement,
} from "@dripl/common";
import { v4 as uuidv4 } from "uuid";

export interface ArrowToolState {
  points: Point[];
  isComplete: boolean;
  isDragging: boolean;
  currentPoint: Point | null;
  label?: string;
}

export function createArrowElement(
  state: ArrowToolState,
  baseProps: Omit<
    DriplElement,
    "type" | "x" | "y" | "width" | "height" | "points"
  > & { id: string },
): { arrow: LinearElement; label?: TextElement } {
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

  const arrow: LinearElement = {
    ...baseProps,
    type: "arrow",
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    points: relativePoints,
    arrowHeads: { start: false, end: true },
  };

  // Create label if specified
  let label: TextElement | undefined;
  if (state.label) {
    const labelId = uuidv4();
    arrow.labelId = labelId;

    // Calculate label position (midpoint of the arrow)
    const midPoint = getMidPoint(state.points);

    label = {
      id: labelId,
      type: "text",
      x: midPoint.x - 25,
      y: midPoint.y - 10,
      width: 100,
      height: 24,
      text: state.label,
      fontSize: 14,
      fontFamily: "Caveat",
      strokeColor: "transparent",
      backgroundColor: "transparent",
      strokeWidth: 0,
      opacity: 1,
      containerId: arrow.id,
    };
  }

  return { arrow, label };
}

function getMidPoint(points: Point[]): Point {
  if (points.length === 1) {
    return points[0] || { x: 0, y: 0 };
  }

  // For multi-point arrows, find the midpoint of the bounding box
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));

  return {
    x: minX + (maxX - minX) / 2,
    y: minY + (maxY - minY) / 2,
  };
}

export function addPointToArrow(
  point: Point,
  state: ArrowToolState,
): ArrowToolState {
  return {
    ...state,
    points: [...state.points, point],
  };
}

export function removePointFromArrow(
  index: number,
  state: ArrowToolState,
): ArrowToolState {
  if (state.points.length <= 2) {
    return state; // Need at least two points for an arrow
  }

  const newPoints = [...state.points];
  newPoints.splice(index, 1);
  return {
    ...state,
    points: newPoints,
  };
}

export function updatePointInArrow(
  index: number,
  point: Point,
  state: ArrowToolState,
): ArrowToolState {
  const newPoints = [...state.points];
  newPoints[index] = point;
  return {
    ...state,
    points: newPoints,
  };
}

export function snapArrowToElement(
  point: Point,
  elements: DriplElement[],
  excludeId?: string,
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
        Math.pow(point.x - edge.x, 2) + Math.pow(point.y - edge.y, 2),
      );
      if (distance < SNAP_THRESHOLD && distance < minDistance) {
        minDistance = distance;
        snappedPoint = edge;
      }
    }
  }

  return snappedPoint;
}
