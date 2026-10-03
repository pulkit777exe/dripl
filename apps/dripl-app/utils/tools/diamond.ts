import type { DriplElement, Point } from '@dripl/common';

export interface DiamondToolState {
  startPoint: Point;
  currentPoint: Point;
  shiftKey: boolean;
}
export function createDiamondElement(
  state: DiamondToolState,
  baseProps: Omit<DriplElement, 'type' | 'x' | 'y' | 'width' | 'height'> & {
    id: string;
  }
): DriplElement {
  let width = state.currentPoint.x - state.startPoint.x;
  let height = state.currentPoint.y - state.startPoint.y;

  if (state.shiftKey) {
    const size = Math.max(Math.abs(width), Math.abs(height));
    width = width < 0 ? -size : size;
    height = height < 0 ? -size : size;
  }

  const x = width < 0 ? state.startPoint.x + width : state.startPoint.x;
  const y = height < 0 ? state.startPoint.y + height : state.startPoint.y;

  // The box is the drag rectangle, exactly as for `rectangle` and `ellipse`:
  // Shift squares it, and the renderer fits a rhombus to whatever box it gets
  // (`renderDiamond` puts its four vertices on the edge midpoints), so nothing
  // downstream needs the element to be square.
  //
  // It used to be forced to a `max(|width|, |height|)` square anchored at the
  // drag rect's top-left. That made the element overshoot the drag on the short
  // axis (a purely horizontal 100px drag committed a 100x100 diamond), and it
  // made `isTinyPreview`'s `height < TINY_SHAPE_PX` guard unreachable for
  // diamonds, since the produced height could never be smaller than the width.
  return {
    ...baseProps,
    type: 'diamond',
    x,
    y,
    width: Math.abs(width),
    height: Math.abs(height),
  };
}
