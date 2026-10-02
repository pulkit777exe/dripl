/**
 * Pinch-zoom geometry — pure helpers extracted from `useCanvasPointerEvents`.
 *
 * Both the two-finger setup (pointerdown) and the zoom-apply step
 * (pointermove) shared the same distance/midpoint math inline; the hook
 * keeps gesture state + store writes while everything closed-form lives
 * here, unit-tested.
 */

export interface PinchPoint {
  x: number;
  y: number;
}

/** Finger separation in px, floored at 1 to keep the zoom ratio finite. */
export function pinchDistance(a: PinchPoint, b: PinchPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.max(1, Math.sqrt(dx * dx + dy * dy));
}

export function pinchMidpoint(a: PinchPoint, b: PinchPoint): PinchPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export interface PinchStart {
  mid: PinchPoint;
  zoom: number;
  pan: PinchPoint;
  distance: number;
}

/**
 * Zoom transform that keeps the world point under the gesture midpoint
 * fixed: anchor the start midpoint in world space, scale around it, then
 * re-anchor under the current midpoint. Zoom clamps to [0.1, 20].
 */
export function pinchZoomTransform(
  start: PinchStart,
  currentMid: PinchPoint,
  currentDistance: number
): { zoom: number; panX: number; panY: number } {
  const worldX = (start.mid.x - start.pan.x) / start.zoom;
  const worldY = (start.mid.y - start.pan.y) / start.zoom;
  const zoom = Math.max(0.1, Math.min(20, start.zoom * (currentDistance / start.distance)));
  return {
    zoom,
    panX: currentMid.x - worldX * zoom,
    panY: currentMid.y - worldY * zoom,
  };
}
