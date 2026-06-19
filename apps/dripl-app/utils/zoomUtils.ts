import type { DriplElement, Point } from '@dripl/common';
import { getBounds } from '@dripl/math/geometry';
import { AnimationController } from './animationController';
import { useCanvasStore } from '@/lib/canvas-store';

export interface ZoomSettings {
  minZoom: number;
  maxZoom: number;
  zoomFactor: number;
}

export const DEFAULT_ZOOM_SETTINGS: ZoomSettings = {
  minZoom: 0.1,
  maxZoom: 20,
  zoomFactor: 1.1,
};

const SMOOTH_ZOOM_KEY = 'smooth-zoom';
const ZOOM_DURATION_MS = 150;

function getElementPoints(element: DriplElement): Point[] {
  if (element.points) {
    return element.points.map((point: Point) => ({
      x: element.x + point.x,
      y: element.y + point.y,
    }));
  }

  return [
    { x: element.x, y: element.y },
    { x: element.x + element.width, y: element.y },
    { x: element.x, y: element.y + element.height },
    { x: element.x + element.width, y: element.y + element.height },
  ];
}

export function zoomToFit(
  elements: DriplElement[],
  canvasWidth: number,
  canvasHeight: number,
  padding: number = 20
): { zoom: number; centerX: number; centerY: number } {
  if (elements.length === 0) {
    return { zoom: 1, centerX: canvasWidth / 2, centerY: canvasHeight / 2 };
  }

  const allPoints: Point[] = [];
  elements.forEach(element => {
    allPoints.push(...getElementPoints(element));
  });

  const bounds = getBounds(allPoints);

  const horizontalZoom = (canvasWidth - padding * 2) / bounds.width;
  const verticalZoom = (canvasHeight - padding * 2) / bounds.height;
  const fitZoom = Math.min(horizontalZoom, verticalZoom);

  const finalZoom = Math.min(
    Math.max(fitZoom, DEFAULT_ZOOM_SETTINGS.minZoom),
    DEFAULT_ZOOM_SETTINGS.maxZoom
  );

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  return {
    zoom: finalZoom,
    centerX,
    centerY,
  };
}

export function zoomToSelection(
  selectedElements: DriplElement[],
  canvasWidth: number,
  canvasHeight: number,
  padding: number = 20
): { zoom: number; centerX: number; centerY: number } | null {
  if (selectedElements.length === 0) {
    return null;
  }

  const allPoints: Point[] = [];
  selectedElements.forEach(element => {
    allPoints.push(...getElementPoints(element));
  });

  const bounds = getBounds(allPoints);

  const horizontalZoom = (canvasWidth - padding * 2) / bounds.width;
  const verticalZoom = (canvasHeight - padding * 2) / bounds.height;
  const fitZoom = Math.min(horizontalZoom, verticalZoom);

  const finalZoom = Math.min(
    Math.max(fitZoom, DEFAULT_ZOOM_SETTINGS.minZoom),
    DEFAULT_ZOOM_SETTINGS.maxZoom
  );

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  return {
    zoom: finalZoom,
    centerX,
    centerY,
  };
}

export function calculateZoom(
  currentZoom: number,
  delta: number,
  minZoom: number = DEFAULT_ZOOM_SETTINGS.minZoom,
  maxZoom: number = DEFAULT_ZOOM_SETTINGS.maxZoom,
  factor: number = DEFAULT_ZOOM_SETTINGS.zoomFactor
): number {
  const direction = delta > 0 ? 1 : -1;
  const newZoom = Math.max(minZoom, Math.min(maxZoom, currentZoom * Math.pow(factor, direction)));
  return newZoom;
}

export function smoothZoom(
  targetZoom: number,
  targetPanX: number,
  targetPanY: number,
  setZoom: (zoom: number) => void,
  setPan: (x: number, y: number) => void
): void {
  AnimationController.stop(SMOOTH_ZOOM_KEY);

  const startZoom = AnimationController.getState(SMOOTH_ZOOM_KEY)?.zoom ?? null;
  const startPanX = AnimationController.getState(SMOOTH_ZOOM_KEY)?.panX ?? null;
  const startPanY = AnimationController.getState(SMOOTH_ZOOM_KEY)?.panY ?? null;

  const { zoom: currentZoom, panX: currentPanX, panY: currentPanY } =
    useCanvasStore.getState();

  const fromZoom = startZoom ?? currentZoom;
  const fromPanX = startPanX ?? currentPanX;
  const fromPanY = startPanY ?? currentPanY;
  const startTime = performance.now();

  // Set shouldCacheIgnoreZoom to true during animation for smooth zoom
  useCanvasStore.getState().setShouldCacheIgnoreZoom(true);

  AnimationController.start(
    SMOOTH_ZOOM_KEY,
    (state) => {
      const elapsed = performance.now() - state.startTime;
      const t = Math.min(1, elapsed / ZOOM_DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3);

      const zoom = fromZoom + (targetZoom - fromZoom) * eased;
      const panX = fromPanX + (targetPanX - fromPanX) * eased;
      const panY = fromPanY + (targetPanY - fromPanY) * eased;

      setZoom(zoom);
      setPan(panX, panY);

      if (t < 1) {
        return { ...state, zoom, panX, panY };
      }

      // Animation complete - restore cache behavior
      useCanvasStore.getState().setShouldCacheIgnoreZoom(false);
      return undefined;
    },
    { startTime, zoom: fromZoom, panX: fromPanX, panY: fromPanY }
  );
}

export function normalizeWheelDelta(e: WheelEvent): { dx: number; dy: number } {
  const LINE_HEIGHT = 16;
  const PAGE_HEIGHT = 600;
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= LINE_HEIGHT;
  else if (e.deltaMode === 2) dy *= PAGE_HEIGHT;
  return { dx: e.deltaX, dy };
}

export function getScaledDimensions(
  width: number,
  height: number,
  zoom: number
): { width: number; height: number } {
  return {
    width: width * zoom,
    height: height * zoom,
  };
}

export function getScaledPoint(point: Point, zoom: number): Point {
  return {
    x: point.x * zoom,
    y: point.y * zoom,
  };
}

export function getMousePosition(
  event: React.MouseEvent<HTMLDivElement>,
  viewport: {
    x: number;
    y: number;
    width: number;
    height: number;
    zoom: number;
  }
): Point {
  return {
    x: (event.clientX - viewport.x) / viewport.zoom,
    y: (event.clientY - viewport.y) / viewport.zoom,
  };
}
