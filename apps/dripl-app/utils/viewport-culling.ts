import type { DriplElement } from "@dripl/common";
import { getElementBounds } from "@dripl/math";
import { boundsIntersect, Bounds } from "@dripl/math";
import { getViewportBounds, Viewport } from "./canvas-coordinates";

export function getVisibleElements(
  elements: DriplElement[],
  viewport: Viewport
): DriplElement[] {
  const viewportBounds = getViewportBounds(viewport);
  const viewportRect: Bounds = {
    x: viewportBounds.x,
    y: viewportBounds.y,
    width: viewportBounds.width,
    height: viewportBounds.height,
  };

  return elements.filter((element) => {
    if (element.isDeleted) return false;
    const elementBounds = getElementBounds(element);
    return boundsIntersect(elementBounds, viewportRect);
  });
}
