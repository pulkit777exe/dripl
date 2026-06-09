import type { DriplElement, Point, LinearElement } from '@dripl/common';
import {
  addPoint as addPointToState,
  removePoint as removePointFromState,
  updatePoint as updatePointInState,
  snapPointToElements,
  getBoundingBox,
  toRelativePoints,
} from './shared';

export interface LineToolState {
  points: Point[];
  isComplete: boolean;
  isDragging: boolean;
  currentPoint: Point | null;
  shiftKey: boolean;
}

export function createLineElement(
  state: LineToolState,
  baseProps: Omit<DriplElement, 'type' | 'x' | 'y' | 'width' | 'height' | 'points'> & { id: string }
): LinearElement {
  if (state.points.length === 0) {
    throw new Error('Line must have at least one point');
  }

  const { minX, minY, maxX, maxY } = getBoundingBox(state.points);
  const relativePoints = toRelativePoints(state.points);

  return {
    ...baseProps,
    type: 'line',
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
  snapThreshold: number = 10
): Point {
  return snapPointToElements(point, elements, excludeId, snapThreshold);
}

export function addPointToLine(point: Point, state: LineToolState): LineToolState {
  return addPointToState(point, state);
}

export function removePointFromLine(index: number, state: LineToolState): LineToolState {
  return removePointFromState(index, state, 2);
}

export function updatePointInLine(
  index: number,
  point: Point,
  state: LineToolState
): LineToolState {
  return updatePointInState(index, point, state);
}
