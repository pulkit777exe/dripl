import type { DriplElement, Point, FreeDrawElement } from "@dripl/common";

export interface FreedrawToolState {
  points: Point[];
  isComplete: boolean;
  pressure?: number; // 0-1, for variable width based on pressure
  brushSize?: number; // base brush size
}

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
      x: p1.x + (t * (p2.x - p0.x)) / 2,
      y: p1.y + (t * (p2.y - p0.y)) / 2,
    });
  }

  smoothed.push(points[points.length - 1]!);
  return smoothed;
}

function optimizePoints(points: Point[], threshold: number = 2): Point[] {
  if (points.length < 3) return points;

  const optimized: Point[] = [points[0]!];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = optimized[optimized.length - 1]!;
    const curr = points[i]!;
    const next = points[i + 1]!;

    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length > 0) {
      const distance = Math.abs(
        (dy * curr.x - dx * curr.y + next.x * prev.y - next.y * prev.x) /
          length,
      );

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

function calculatePressure(point: Point, points: Point[]): number {
  // Simple pressure simulation based on speed
  if (points.length < 2) return 0.5;

  const prevPoint = points[points.length - 2];
  if (!prevPoint) return 0.5;

  const dx = point.x - prevPoint.x;
  const dy = point.y - prevPoint.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Pressure decreases with speed
  const speed = distance / 16; // assuming 60fps
  const pressure = Math.max(0.3, Math.min(1, 1 - speed * 0.3));

  return pressure;
}

function calculateVariableWidth(
  points: Point[],
  baseWidth: number,
  pressureValues: number[],
): number[] {
  const widths = [];

  for (let i = 0; i < points.length; i++) {
    const pressure = pressureValues[i] ?? 0.5;
    widths.push(baseWidth * (0.5 + pressure * 1.5)); // 0.75x to 2x width
  }

  return widths;
}

export function createFreedrawElement(
  state: FreedrawToolState,
  baseProps: Omit<
    DriplElement,
    "type" | "x" | "y" | "width" | "height" | "points"
  > & { id: string },
): FreeDrawElement {
  if (state.points.length === 0) {
    throw new Error("Freedraw must have at least one point");
  }

  let processedPoints = state.points;
  if (processedPoints.length > 2) {
    processedPoints = smoothPath(processedPoints);
    processedPoints = optimizePoints(processedPoints);
  }

  const minX = Math.min(...processedPoints.map((p) => p.x));
  const minY = Math.min(...processedPoints.map((p) => p.y));
  const maxX = Math.max(...processedPoints.map((p) => p.x));
  const maxY = Math.max(...processedPoints.map((p) => p.y));

  const relativePoints = processedPoints.map((p) => ({
    x: p.x - minX,
    y: p.y - minY,
  }));

  // Calculate pressure values for variable width
  const pressureValues = state.points.map((point, index) =>
    calculatePressure(point, state.points.slice(0, index + 1)),
  );

  const brushSize = state.brushSize ?? 2;
  const widths = calculateVariableWidth(
    processedPoints,
    brushSize,
    pressureValues,
  );

  return {
    ...baseProps,
    type: "freedraw",
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    points: relativePoints,
    brushSize,
    pressureValues, // Store pressure values for rendering
    widths, // Store calculated widths for rendering
  };
}

export function addPointToFreedraw(
  point: Point,
  state: FreedrawToolState,
): FreedrawToolState {
  const pressure = calculatePressure(point, [...state.points, point]);
  return {
    ...state,
    points: [...state.points, point],
    pressure: pressure,
  };
}

export function removePointFromFreedraw(
  index: number,
  state: FreedrawToolState,
): FreedrawToolState {
  const newPoints = [...state.points];
  newPoints.splice(index, 1);
  return {
    ...state,
    points: newPoints,
  };
}

export function updatePointInFreedraw(
  index: number,
  point: Point,
  state: FreedrawToolState,
): FreedrawToolState {
  const newPoints = [...state.points];
  newPoints[index] = point;

  // Recalculate pressure values
  const newState = { ...state, points: newPoints };
  return newState;
}
