import type { DriplElement, Point } from '@dripl/common';

export function addPoint<T extends { points: Point[] }>(point: Point, state: T): T {
  return {
    ...state,
    points: [...state.points, point],
  };
}

export function removePoint<T extends { points: Point[] }>(
  index: number,
  state: T,
  minPoints: number = 2
): T {
  if (state.points.length <= minPoints) {
    return state;
  }

  const newPoints = [...state.points];
  newPoints.splice(index, 1);
  return {
    ...state,
    points: newPoints,
  };
}

export function updatePoint<T extends { points: Point[] }>(
  index: number,
  point: Point,
  state: T
): T {
  const newPoints = [...state.points];
  newPoints[index] = point;
  return {
    ...state,
    points: newPoints,
  };
}

export function snapPointToElements(
  point: Point,
  elements: DriplElement[],
  excludeId?: string,
  snapThreshold: number = 10
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
      const distance = Math.sqrt(Math.pow(point.x - edge.x, 2) + Math.pow(point.y - edge.y, 2));
      if (distance < snapThreshold && distance < minDistance) {
        minDistance = distance;
        snappedPoint = edge;
      }
    }
  }

  return snappedPoint;
}

export function getBoundingBox(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const minX = Math.min(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxX = Math.max(...points.map(p => p.x));
  const maxY = Math.max(...points.map(p => p.y));
  return { minX, minY, maxX, maxY };
}

export function toRelativePoints(points: Point[]): Point[] {
  const { minX, minY } = getBoundingBox(points);
  return points.map(p => ({
    x: p.x - minX,
    y: p.y - minY,
  }));
}
