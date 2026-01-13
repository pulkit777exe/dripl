import { Point } from "@dripl/common";

export interface Viewport {
  x: number; // panX
  y: number; // panY
  width: number;
  height: number;
  zoom: number;
}

/**
 * Convert screen coordinates to canvas coordinates
 */
export function screenToCanvas(
  screenX: number,
  screenY: number,
  viewport: Viewport
): Point {
  return {
    x: (screenX - viewport.x) / viewport.zoom,
    y: (screenY - viewport.y) / viewport.zoom,
  };
}

/**
 * Convert canvas coordinates to screen coordinates
 */
export function canvasToScreen(
  canvasX: number,
  canvasY: number,
  viewport: Viewport
): Point {
  return {
    x: canvasX * viewport.zoom + viewport.x,
    y: canvasY * viewport.zoom + viewport.y,
  };
}

/**
 * Get viewport bounds in canvas space
 */
export function getViewportBounds(viewport: Viewport): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: viewport.width / viewport.zoom,
    height: viewport.height / viewport.zoom,
  };
}
