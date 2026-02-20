import type { DriplElement } from "@dripl/common";
import { getElementBounds } from "@dripl/math";
import { boundsIntersect, Bounds } from "@dripl/math";
import { getViewportBounds, Viewport } from "./canvas-coordinates";

// Cache for viewport culling results to avoid redundant calculations
let lastElements: DriplElement[] = [];
let lastViewport: Viewport | null = null;
let lastVisibleElements: DriplElement[] = [];

/**
 * Optimized viewport culling with caching
 */
export function getVisibleElements(
  elements: DriplElement[],
  viewport: Viewport,
): DriplElement[] {
  // Check if elements or viewport have changed significantly
  const elementsChanged = JSON.stringify(elements) !== JSON.stringify(lastElements);
  const viewportChanged = JSON.stringify(viewport) !== JSON.stringify(lastViewport);
  
  if (!elementsChanged && !viewportChanged) {
    return lastVisibleElements; // Return cached results
  }

  const viewportBounds = getViewportBounds(viewport);
  const viewportRect: Bounds = {
    x: viewportBounds.x,
    y: viewportBounds.y,
    width: viewportBounds.width,
    height: viewportBounds.height,
  };

  const visibleElements = elements.filter((element) => {
    if (element.isDeleted) return false;
    const elementBounds = getElementBounds(element);
    return boundsIntersect(elementBounds, viewportRect);
  });

  // Update cache
  lastElements = elements;
  lastViewport = viewport;
  lastVisibleElements = visibleElements;

  return visibleElements;
}

/**
 * Clear viewport culling cache (should be called when scene changes)
 */
export function clearVisibleElementsCache(): void {
  lastElements = [];
  lastViewport = null;
  lastVisibleElements = [];
}
