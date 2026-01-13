import type { DriplElement, Point } from "@dripl/common";

export interface DiamondToolState {
  startPoint: Point;
  currentPoint: Point;
  shiftKey: boolean;
}

/**
 * Create a diamond (rotated square) element
 * The diamond is created by rotating a square 45 degrees
 */
export function createDiamondElement(
  state: DiamondToolState,
  baseProps: Omit<DriplElement, "type" | "x" | "y" | "width" | "height" | "angle">
): DriplElement {
  let width = state.currentPoint.x - state.startPoint.x;
  let height = state.currentPoint.y - state.startPoint.y;

  // If shift is held, make it a square
  if (state.shiftKey) {
    const size = Math.max(Math.abs(width), Math.abs(height));
    width = width < 0 ? -size : size;
    height = height < 0 ? -size : size;
  }

  const x = width < 0 ? state.startPoint.x + width : state.startPoint.x;
  const y = height < 0 ? state.startPoint.y + height : state.startPoint.y;

  // Diamond is a square rotated 45 degrees
  const size = Math.max(Math.abs(width), Math.abs(height));
  const centerX = x + size / 2;
  const centerY = y + size / 2;

  return {
    ...baseProps,
    type: "rectangle", // Use rectangle type with rotation
    x: centerX - size / 2,
    y: centerY - size / 2,
    width: size,
    height: size,
    angle: Math.PI / 4, // 45 degrees in radians
  };
}
