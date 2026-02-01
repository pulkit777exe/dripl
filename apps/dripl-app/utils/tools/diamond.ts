import type { DriplElement, Point } from "@dripl/common";

export interface DiamondToolState {
  startPoint: Point;
  currentPoint: Point;
  shiftKey: boolean;
}
export function createDiamondElement(
  state: DiamondToolState,
  baseProps: Omit<DriplElement, "type" | "x" | "y" | "width" | "height"> & { id: string }
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

  const size = Math.max(Math.abs(width), Math.abs(height));
  const centerX = x + size / 2;
  const centerY = y + size / 2;

  return {
    ...baseProps,
    type: "diamond",
    x: centerX - size / 2,
    y: centerY - size / 2,
    width: size,
    height: size,
  };
}
