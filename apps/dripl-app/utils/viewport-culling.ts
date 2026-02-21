import type { DriplElement } from "@dripl/common";
import { getElementBounds } from "@dripl/math";
import { boundsIntersect, Bounds } from "@dripl/math";
import { getViewportBounds, Viewport } from "./canvas-coordinates";

function viewportCacheKey(viewport: Viewport): string {
  return `${viewport.zoom}-${viewport.x}-${viewport.y}-${viewport.width}-${viewport.height}`;
}

function elementsCacheKey(
  elements: DriplElement[],
  sceneVersion?: number,
): string {
  if (sceneVersion != null) return `v${sceneVersion}`;
  const n = elements.length;
  const first = elements[0];
  const last = n > 1 ? elements[n - 1] : first;
  return `${n}-${first?.id ?? ""}-${last?.id ?? ""}`;
}

// Cache for viewport culling: key by version/hash to avoid JSON.stringify
let lastElementsKey = "";
let lastViewportKey = "";
let lastVisibleElements: DriplElement[] = [];

/**
 * Optimized viewport culling with caching.
 * Use optional sceneVersion when the app tracks a monotonic scene version for cheap invalidation.
 */
export function getVisibleElements(
  elements: DriplElement[],
  viewport: Viewport,
  sceneVersion?: number,
): DriplElement[] {
  const elementsKey = elementsCacheKey(elements, sceneVersion);
  const viewportKey = viewportCacheKey(viewport);

  if (elementsKey === lastElementsKey && viewportKey === lastViewportKey) {
    return lastVisibleElements;
  }

  const viewportBounds = getViewportBounds(viewport);
  const viewportRect: Bounds = {
    x: viewportBounds.x,
    y: viewportBounds.y,
    width: viewportBounds.width,
    height: viewportBounds.height,
  };

  // When viewport has no size (e.g. before container is laid out), show all elements
  // so shapes are not hidden until the next layout.
  const hasValidViewport =
    viewportRect.width > 0 && viewportRect.height > 0;

  const visibleElements = hasValidViewport
    ? elements.filter((element) => {
        if (element.isDeleted) return false;
        const elementBounds = getElementBounds(element);
        return boundsIntersect(elementBounds, viewportRect);
      })
    : elements.filter((element) => !element.isDeleted);

  lastElementsKey = elementsKey;
  lastViewportKey = viewportKey;
  lastVisibleElements = visibleElements;

  return visibleElements;
}

/**
 * Clear viewport culling cache (e.g. when scene is reset).
 */
export function clearVisibleElementsCache(): void {
  lastElementsKey = "";
  lastViewportKey = "";
  lastVisibleElements = [];
}
