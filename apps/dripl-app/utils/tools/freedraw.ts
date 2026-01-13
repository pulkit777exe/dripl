import type { DriplElement, Point, FreeDrawElement } from "@dripl/common";

export interface FreedrawToolState {
  points: Point[];
  isComplete: boolean;
}

/**
 * Smooth a path using Catmull-Rom splines
 */
function smoothPath(points: Point[], tension: number = 0.5): Point[] {
  if (points.length < 3) return points;

  const smoothed: Point[] = [points[0]!];

  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;

    // Catmull-Rom interpolation
    const t = tension;
    smoothed.push({
      x: p1.x + t * (p2.x - p0.x) / 2,
      y: p1.y + t * (p2.y - p0.y) / 2,
    });
  }

  smoothed.push(points[points.length - 1]!);
  return smoothed;
}

/**
 * Optimize point count by removing redundant points
 */
function optimizePoints(points: Point[], threshold: number = 2): Point[] {
  if (points.length < 3) return points;

  const optimized: Point[] = [points[0]!];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = optimized[optimized.length - 1]!;
    const curr = points[i]!;
    const next = points[i + 1]!;

    // Calculate distance from current point to line between prev and next
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length > 0) {
      const distance =
        Math.abs(
          (dy * curr.x - dx * curr.y + next.x * prev.y - next.y * prev.x) / length
        );

      // Keep point if it's far enough from the line
      if (distance > threshold) {
        optimized.push(curr);
      }
    } else {
      optimized.push(curr);
    }
  }

  optimized.push(points[points.length - 1]!);
  return optimized;
}

/**
 * Create a freedraw element with smoothed and optimized path
 */
export function createFreedrawElement(
  state: FreedrawToolState,
  baseProps: Omit<DriplElement, "type" | "x" | "y" | "width" | "height" | "points">
): FreeDrawElement {
  if (state.points.length === 0) {
    throw new Error("Freedraw must have at least one point");
  }

  // Smooth and optimize the path
  let processedPoints = state.points;
  if (processedPoints.length > 2) {
    processedPoints = smoothPath(processedPoints);
    processedPoints = optimizePoints(processedPoints);
  }

  // Calculate bounds
  const minX = Math.min(...processedPoints.map((p) => p.x));
  const minY = Math.min(...processedPoints.map((p) => p.y));
  const maxX = Math.max(...processedPoints.map((p) => p.x));
  const maxY = Math.max(...processedPoints.map((p) => p.y));

  // Points are stored relative to element position
  const relativePoints = processedPoints.map((p) => ({
    x: p.x - minX,
    y: p.y - minY,
  }));

  return {
    ...baseProps,
    type: "freedraw",
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    points: relativePoints,
  };
}
