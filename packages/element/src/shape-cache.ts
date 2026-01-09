import { DriplElement } from "@dripl/common";

type Drawable = any; // Rough.js Drawable type

// WeakMap to store cached shapes for each element
// Using WeakMap ensures that when element objects are garbage collected,
// their cached shapes are also removed automatically
const shapeCache = new WeakMap<DriplElement, Drawable | Drawable[]>();

/**
 * Get cached shape for an element
 */
export function getShapeFromCache(
  element: DriplElement
): Drawable | Drawable[] | undefined {
  return shapeCache.get(element);
}

/**
 * Set cached shape for an element
 */
export function setShapeInCache(
  element: DriplElement,
  shape: Drawable | Drawable[]
): void {
  shapeCache.set(element, shape);
}

/**
 * Clear cache for an element (e.g. when it changes)
 * Note: Since we use immutable updates for elements in the store,
 * a changed element is a new object, so we don't strictly need to delete
 * from the WeakMap unless we are mutating objects in place.
 * However, if we do mutate, this is useful.
 */
export function clearShapeFromCache(element: DriplElement): void {
  shapeCache.delete(element);
}
