export interface ZoomSettings {
  minZoom: number;
  maxZoom: number;
  zoomFactor: number;
}

/**
 * Single source of truth for zoom limits. The wheel handler, keyboard
 * shortcuts, and the zoom controls all clamp against these values, so a
 * change here applies everywhere instead of only where literals were
 * previously duplicated.
 */
export const DEFAULT_ZOOM_SETTINGS: ZoomSettings = {
  minZoom: 0.1,
  maxZoom: 20,
  zoomFactor: 1.1,
};

/**
 * Exponential zoom intensity: one mouse notch (~100-120px) steps ~1.16x,
 * while small trackpad deltas produce proportionally small steps so a
 * continuous pinch gesture stays smooth instead of jumping a fixed factor
 * per event. Fabric.js uses the same `0.999 ** delta` shape.
 */
const WHEEL_ZOOM_INTENSITY = 0.0015;
/** Per-event delta clamp: bounds a single fast flick to a sane step. */
const MAX_WHEEL_DELTA_PX = 150;

export function wheelZoomFactor(normalizedDy: number): number {
  const clamped = Math.max(-MAX_WHEEL_DELTA_PX, Math.min(MAX_WHEEL_DELTA_PX, normalizedDy));
  return Math.exp(-clamped * WHEEL_ZOOM_INTENSITY);
}

export interface ZoomView {
  zoom: number;
  panX: number;
  panY: number;
}

/**
 * Zoom keeping the screen point (screenX, screenY) anchored: the world point
 * under the cursor before the zoom is still under it after. The incoming
 * zoom is clamped first so the pan anchor is computed for the zoom that
 * actually applies, never for one that gets clamped away afterwards.
 */
export function zoomToCursor(
  view: ZoomView,
  screenX: number,
  screenY: number,
  factor: number,
  minZoom: number,
  maxZoom: number
): ZoomView {
  const nextZoom = Math.max(minZoom, Math.min(maxZoom, view.zoom * factor));
  const worldX = (screenX - view.panX) / view.zoom;
  const worldY = (screenY - view.panY) / view.zoom;
  return {
    zoom: nextZoom,
    panX: screenX - worldX * nextZoom,
    panY: screenY - worldY * nextZoom,
  };
}

export function normalizeWheelDelta(e: WheelEvent): { dx: number; dy: number } {
  const LINE_HEIGHT = 16;
  const PAGE_HEIGHT = 600;
  let dx = e.deltaX;
  let dy = e.deltaY;
  if (e.deltaMode === 1) {
    dx *= LINE_HEIGHT;
    dy *= LINE_HEIGHT;
  } else if (e.deltaMode === 2) {
    dx *= PAGE_HEIGHT;
    dy *= PAGE_HEIGHT;
  }
  return { dx, dy };
}
