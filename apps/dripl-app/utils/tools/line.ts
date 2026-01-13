import type { DriplElement, Point, LinearElement } from "@dripl/common";

export interface LineToolState {
  points: Point[];
  isComplete: boolean;
  shiftKey: boolean; // For 45° angle snapping
}

/**
 * Create a line element
 * Supports multi-segment lines
 */
export function createLineElement(
  state: LineToolState,
  baseProps: Omit<DriplElement, "type" | "x" | "y" | "width" | "height" | "points">
): LinearElement {
  if (state.points.length === 0) {
    throw new Error("Line must have at least one point");
  }

  let points = state.points;

  // Apply 45° angle snapping if shift is held
  if (state.shiftKey && points.length >= 2) {
    const lastPoint = points[points.length - 1]!;
    const prevPoint = points[points.length - 2]!;
    const dx = lastPoint.x - prevPoint.x;
    const dy = lastPoint.y - prevPoint.y;
    const angle = Math.atan2(dy, dx);
    const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
    const distance = Math.sqrt(dx * dx + dy * dy);
    points = [
      ...points.slice(0, -1),
      {
        x: prevPoint.x + Math.cos(snappedAngle) * distance,
        y: prevPoint.y + Math.sin(snappedAngle) * distance,
      },
    ];
  }

  // Calculate bounds
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxX = Math.max(...points.map((p) => p.x));
  const maxY = Math.max(...points.map((p) => p.y));

  // Points are stored relative to element position
  const relativePoints = points.map((p) => ({
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
