import type { DriplElement, Point } from "@dripl/common";
import { getBounds, rotateBounds } from "@dripl/math";

export interface ZoomSettings {
  minZoom: number;
  maxZoom: number;
  zoomStep: number;
}

export const DEFAULT_ZOOM_SETTINGS: ZoomSettings = {
  minZoom: 0.1,
  maxZoom: 5,
  zoomStep: 0.1,
};

export function zoomToFit(
  elements: DriplElement[],
  canvasWidth: number,
  canvasHeight: number,
  padding: number = 20
): { zoom: number; centerX: number; centerY: number } {
  if (elements.length === 0) {
    return { zoom: 1, centerX: canvasWidth / 2, centerY: canvasHeight / 2 };
  }

  // Calculate combined bounds of all elements
  const allPoints: Point[] = [];
  elements.forEach((element) => {
    if (element.points) {
      // For linear elements (lines, arrows, freedraw)
      element.points.forEach((point: Point) => {
        allPoints.push({ x: element.x + point.x, y: element.y + point.y });
      });
    } else {
      // For rectangular elements
      allPoints.push({ x: element.x, y: element.y });
      allPoints.push({ x: element.x + element.width, y: element.y });
      allPoints.push({ x: element.x, y: element.y + element.height });
      allPoints.push({ x: element.x + element.width, y: element.y + element.height });
    }
  });

  const bounds = getBounds(allPoints);

  // Calculate required zoom level
  const horizontalZoom = (canvasWidth - padding * 2) / bounds.width;
  const verticalZoom = (canvasHeight - padding * 2) / bounds.height;
  const fitZoom = Math.min(horizontalZoom, verticalZoom);

  // Ensure zoom stays within limits
  const finalZoom = Math.min(
    Math.max(fitZoom, DEFAULT_ZOOM_SETTINGS.minZoom),
    DEFAULT_ZOOM_SETTINGS.maxZoom
  );

  // Calculate center point
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

  // Calculate combined bounds of selected elements
  const allPoints: Point[] = [];
  selectedElements.forEach((element) => {
    if (element.points) {
      // For linear elements (lines, arrows, freedraw)
      element.points.forEach((point: Point) => {
        allPoints.push({ x: element.x + point.x, y: element.y + point.y });
      });
    } else {
      // For rectangular elements
      allPoints.push({ x: element.x, y: element.y });
      allPoints.push({ x: element.x + element.width, y: element.y });
      allPoints.push({ x: element.x, y: element.y + element.height });
      allPoints.push({ x: element.x + element.width, y: element.y + element.height });
    }
  });

  const bounds = getBounds(allPoints);

  // Calculate required zoom level
  const horizontalZoom = (canvasWidth - padding * 2) / bounds.width;
  const verticalZoom = (canvasHeight - padding * 2) / bounds.height;
  const fitZoom = Math.min(horizontalZoom, verticalZoom);

  // Ensure zoom stays within limits
  const finalZoom = Math.min(
    Math.max(fitZoom, DEFAULT_ZOOM_SETTINGS.minZoom),
    DEFAULT_ZOOM_SETTINGS.maxZoom
  );

  // Calculate center point
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  return {
    zoom: finalZoom,
    centerX,
    centerY,
  };
}

export function getVisibleElements(
  elements: DriplElement[],
  viewport: { x: number; y: number; width: number; height: number; zoom: number }
): DriplElement[] {
  const visibleBounds = {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: viewport.width / viewport.zoom,
    height: viewport.height / viewport.zoom,
  };

  return elements.filter((element) => {
    const elementBounds = element.points
      ? getBounds(element.points.map((p: Point) => ({
          x: element.x + p.x,
          y: element.y + p.y,
        })))
      : {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
        };

    // Check if element bounds intersect with visible bounds
    return (
      elementBounds.x + elementBounds.width > visibleBounds.x &&
      elementBounds.x < visibleBounds.x + visibleBounds.width &&
      elementBounds.y + elementBounds.height > visibleBounds.y &&
      elementBounds.y < visibleBounds.y + visibleBounds.height
    );
  });
}

export function calculateZoom(
  currentZoom: number,
  delta: number,
  minZoom: number = DEFAULT_ZOOM_SETTINGS.minZoom,
  maxZoom: number = DEFAULT_ZOOM_SETTINGS.maxZoom,
  step: number = DEFAULT_ZOOM_SETTINGS.zoomStep
): number {
  const direction = delta > 0 ? 1 : -1;
  let newZoom = currentZoom + direction * step;

  // Ensure zoom stays within limits
  newZoom = Math.max(minZoom, Math.min(maxZoom, newZoom));

  // Snap to common zoom levels at higher zoom
  if (newZoom > 1) {
    const snapped = Math.round(newZoom * 2) / 2;
    if (Math.abs(newZoom - snapped) < step / 2) {
      newZoom = snapped;
    }
  }

  return newZoom;
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
  viewport: { x: number; y: number; width: number; height: number; zoom: number }
): Point {
  return {
    x: (event.clientX - viewport.x) / viewport.zoom,
    y: (event.clientY - viewport.y) / viewport.zoom,
  };
}