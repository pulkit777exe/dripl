import type { DriplElement, Point } from '@dripl/common';

export interface EllipseToolState {
  startPoint: Point;
  currentPoint: Point;
  shiftKey: boolean;
  altKey?: boolean;
}

export function createEllipseElement(
  state: EllipseToolState,
  baseProps: Omit<DriplElement, 'type' | 'x' | 'y' | 'width' | 'height'> & {
    id: string;
  }
): DriplElement {
  const fromCenter = state.altKey === true;
  const startPoint = fromCenter
    ? {
        x: state.startPoint.x * 2 - state.currentPoint.x,
        y: state.startPoint.y * 2 - state.currentPoint.y,
      }
    : state.startPoint;

  let width = state.currentPoint.x - startPoint.x;
  let height = state.currentPoint.y - startPoint.y;

  if (state.shiftKey) {
    const size = Math.max(Math.abs(width), Math.abs(height));
    width = width < 0 ? -size : size;
    height = height < 0 ? -size : size;
  }

  const x = width < 0 ? startPoint.x + width : startPoint.x;
  const y = height < 0 ? startPoint.y + height : startPoint.y;

  return {
    ...baseProps,
    type: 'ellipse',
    x,
    y,
    width: Math.abs(width),
    height: Math.abs(height),
  };
}
