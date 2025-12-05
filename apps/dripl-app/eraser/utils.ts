import { Point } from "@dripl/common";
import { EraserPoint } from "./types";

/**
 * Easing function for smooth fade-out animation
 */
export const easeOut = (t: number): number => {
  return 1 - Math.pow(1 - t, 3);
};

/**
 * Streamline points to reduce noise and create smoother trails
 */
export const streamlinePoints = (
  points: EraserPoint[],
  streamline: number = 0.5
): EraserPoint[] => {
  if (points.length < 2) return points;

  const result: EraserPoint[] = [points[0]!];

  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1]!;
    const curr = points[i]!;

    result.push({
      x: prev.x + (curr.x - prev.x) * (1 - streamline),
      y: prev.y + (curr.y - prev.y) * (1 - streamline),
      timestamp: curr.timestamp,
      pressure: curr.pressure,
    });
  }

  return result;
};

/**
 * Calculate distance between two points
 */
export const distance = (a: Point, b: Point): number => {
  return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
};

/**
 * Get the current time for animations
 */
export const now = (): number => {
  return performance.now();
};
