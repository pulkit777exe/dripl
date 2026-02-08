import type { DriplElement } from "@dripl/common";
import type { Bounds } from "./geometry";
import { getElementBounds } from "./intersection";

export function isElementInViewport(
  element: DriplElement,
  viewport: Bounds,
  padding: number = 50,
): boolean {
  const bounds = getElementBounds(element);

  const paddedViewport = {
    x: viewport.x - padding,
    y: viewport.y - padding,
    width: viewport.width + padding * 2,
    height: viewport.height + padding * 2,
  };

  return (
    bounds.x < paddedViewport.x + paddedViewport.width &&
    bounds.x + bounds.width > paddedViewport.x &&
    bounds.y < paddedViewport.y + paddedViewport.height &&
    bounds.y + bounds.height > paddedViewport.y
  );
}

export function getViewportBounds(
  canvasWidth: number,
  canvasHeight: number,
  panX: number,
  panY: number,
  zoom: number,
): Bounds {
  return {
    x: -panX / zoom,
    y: -panY / zoom,
    width: canvasWidth / zoom,
    height: canvasHeight / zoom,
  };
}

export function getVisibleElements(
  elements: DriplElement[],
  viewport: Bounds,
): DriplElement[] {
  return elements.filter((element) => {
    if (element.isDeleted) return false;
    return isElementInViewport(element, viewport);
  });
}

export function getDirtyRegion(
  changedElements: DriplElement[],
  previousBounds: Map<string, Bounds>,
): Bounds | null {
  if (changedElements.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const element of changedElements) {
    const bounds = getElementBounds(element);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);

    const prevBounds = previousBounds.get(element.id);
    if (prevBounds) {
      minX = Math.min(minX, prevBounds.x);
      minY = Math.min(minY, prevBounds.y);
      maxX = Math.max(maxX, prevBounds.x + prevBounds.width);
      maxY = Math.max(maxY, prevBounds.y + prevBounds.height);
    }
  }

  if (!isFinite(minX)) return null;

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return function (...args: Parameters<T>) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), ms);
  };
}

export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return function (...args: Parameters<T>) {
    const now = Date.now();
    const remaining = ms - (now - lastCall);

    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastCall = now;
      fn(...args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        fn(...args);
      }, remaining);
    }
  };
}
