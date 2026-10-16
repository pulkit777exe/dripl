import type { DriplElement, Point, FreeDrawElement } from '@dripl/common';
import {
  addPoint as addPointToState,
  removePoint as removePointFromState,
  updatePoint as updatePointInState,
  getBoundingBox,
  toRelativePoints,
} from './shared';

export interface FreedrawToolState {
  points: Point[];
  isComplete: boolean;
  pressure?: number; // 0-1, for variable width based on pressure
  brushSize?: number; // base brush size
  pressureValues?: number[];
}

function optimizeKeptIndices(points: Point[], threshold: number = 0.85): number[] {
  if (points.length < 3) return points.map((_, i) => i);
  const kept: number[] = [0];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[kept[kept.length - 1]!]!;
    const curr = points[i]!;
    const next = points[i + 1]!;

    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length > 0) {
      const distance = Math.abs(
        (dy * curr.x - dx * curr.y + next.x * prev.y - next.y * prev.x) / length
      );

      if (distance > threshold) {
        kept.push(i);
      }
    } else {
      kept.push(i);
    }
  }

  kept.push(points.length - 1);
  return kept;
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

export function createFreedrawElement(
  state: FreedrawToolState,
  baseProps: Omit<DriplElement, 'type' | 'x' | 'y' | 'width' | 'height' | 'points'> & {
    id: string;
  },
  options: { preview?: boolean } = {}
): FreeDrawElement {
  if (state.points.length === 0) {
    throw new Error('Freedraw must have at least one point');
  }

  // Carry (point, pressure) tuples through the optimize filter so kept
  // points keep their own pressures. Filtering points alone misaligned
  // `pressureValues` with the stored points, and the renderer then discarded
  // real stylus pressure as length-mismatched.
  const pressures =
    state.pressureValues && state.pressureValues.length === state.points.length
      ? state.pressureValues
      : state.points.map((point, index) =>
          calculatePressure(point, state.points.slice(0, index + 1))
        );

  let processedPoints = state.points;
  let processedPressures = pressures;
  // Draft previews rebuild on every frame (O(frames × samples) per stroke),
  // so they skip the optimize pass; the commit below still simplifies. The
  // preview box can exceed the committed box by the sub-pixel runs the
  // simplifier would have dropped — invisible at any zoom.
  if (!options.preview && processedPoints.length > 2) {
    const kept = optimizeKeptIndices(processedPoints, 0.85);
    processedPoints = kept.map(i => processedPoints[i]!);
    processedPressures = kept.map(i => processedPressures[i]!);
  }

  const { minX, minY, maxX, maxY } = getBoundingBox(processedPoints);
  const relativePoints = toRelativePoints(processedPoints);

  const brushSize = state.brushSize ?? 2;

  return {
    ...baseProps,
    type: 'freedraw',
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    points: relativePoints,
    brushSize,
    pressureValues: processedPressures,
  };
}

export function addPointToFreedraw(point: Point, state: FreedrawToolState): FreedrawToolState {
  const pressure = calculatePressure(point, [...state.points, point]);
  const base = addPointToState(point, state);
  return {
    ...base,
    pressure: pressure,
    pressureValues: [...(state.pressureValues ?? []), pressure],
  };
}

export function removePointFromFreedraw(
  index: number,
  state: FreedrawToolState
): FreedrawToolState {
  return removePointFromState(index, state, 0);
}

export function updatePointInFreedraw(
  index: number,
  point: Point,
  state: FreedrawToolState
): FreedrawToolState {
  return updatePointInState(index, point, state);
}
