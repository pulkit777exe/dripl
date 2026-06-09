import type { DriplElement, Point, LinearElement, TextElement } from '@dripl/common';
import { v4 as uuidv4 } from 'uuid';
import { getDefaultFontFamily } from '@/utils/fontPreferences';
import {
  addPoint as addPointToState,
  removePoint as removePointFromState,
  updatePoint as updatePointInState,
  snapPointToElements,
  getBoundingBox,
  toRelativePoints,
} from './shared';

export interface ArrowToolState {
  points: Point[];
  isComplete: boolean;
  isDragging: boolean;
  currentPoint: Point | null;
  label?: string;
}

export function createArrowElement(
  state: ArrowToolState,
  baseProps: Omit<DriplElement, 'type' | 'x' | 'y' | 'width' | 'height' | 'points'> & { id: string }
): { arrow: LinearElement; label?: TextElement } {
  if (state.points.length === 0) {
    throw new Error('Arrow must have at least one point');
  }

  const { minX, minY, maxX, maxY } = getBoundingBox(state.points);
  const relativePoints = toRelativePoints(state.points);

  const arrow: LinearElement = {
    ...baseProps,
    type: 'arrow',
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    points: relativePoints,
    arrowHeads: { start: false, end: true },
  };

  let label: TextElement | undefined;
  if (state.label) {
    const labelId = uuidv4();
    arrow.labelId = labelId;

    const midPoint = getMidPoint(state.points);

    label = {
      id: labelId,
      type: 'text',
      x: midPoint.x - 25,
      y: midPoint.y - 10,
      width: 100,
      height: 24,
      text: state.label,
      fontSize: 14,
      fontFamily: getDefaultFontFamily(),
      strokeColor: 'transparent',
      backgroundColor: 'transparent',
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

  const { minX, maxX, minY, maxY } = getBoundingBox(points);

  return {
    x: minX + (maxX - minX) / 2,
    y: minY + (maxY - minY) / 2,
  };
}

export function addPointToArrow(point: Point, state: ArrowToolState): ArrowToolState {
  return addPointToState(point, state);
}

export function removePointFromArrow(index: number, state: ArrowToolState): ArrowToolState {
  return removePointFromState(index, state, 2);
}

export function updatePointInArrow(
  index: number,
  point: Point,
  state: ArrowToolState
): ArrowToolState {
  return updatePointInState(index, point, state);
}

export function snapArrowToElement(
  point: Point,
  elements: DriplElement[],
  excludeId?: string
): Point {
  return snapPointToElements(point, elements, excludeId);
}
