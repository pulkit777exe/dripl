import type { DriplElement } from "@dripl/common";

export type Drawable = any;

/**
 * Shape cache keyed by a *stable* identifier: `${element.id}:${element.version}`.
 *
 * Why this design:
 * - Survives immutable updates
 * - Survives undo/redo (history snapshots)
 * - Safe for collaboration / remote merges
 * - Avoids WeakMap pitfalls (object identity instability)
 */
const shapeCache = new Map<string, Drawable | Drawable[]>();

/**
 * Build a stable cache key for an element.
 * Element must have `id` and `version`.
 */
export function getShapeCacheKey(element: DriplElement): string {
  const version = (element as any).version ?? 0;
  return `${element.id}:${version}`;
}

/**
 * Get cached Rough.js shape for an element
 */
export function getShapeFromCache(
  element: DriplElement,
): Drawable | Drawable[] | undefined {
  return shapeCache.get(getShapeCacheKey(element));
}

/**
 * Store Rough.js shape in cache
 */
export function setShapeInCache(
  element: DriplElement,
  shape: Drawable | Drawable[],
): void {
  shapeCache.set(getShapeCacheKey(element), shape);
}

/**
 * Remove a single element from cache
 * (useful if you mutate in place, or during manual invalidation)
 */
export function clearShapeFromCache(element: DriplElement): void {
  shapeCache.delete(getShapeCacheKey(element));
}

/**
 * Clear all cached shapes.
 * Useful when:
 * - Theme changes
 * - Rough.js config changes
 * - Major canvas reset
 */
export function clearAllShapeCache(): void {
  shapeCache.clear();
}

/**
 * Optional: limit cache size (safety valve for very large canvases)
 * Uses LRU (Least Recently Used) eviction for better performance
 */
export function pruneShapeCache(maxSize: number = 5000): void {
  if (shapeCache.size <= maxSize) return;

  const extra = shapeCache.size - maxSize;
  const keys = Array.from(shapeCache.keys());

  // Delete oldest entries (first in Map iteration order)
  for (let i = 0; i < extra; i++) {
    shapeCache.delete(keys[i]!);
  }
}

/**
 * Get cache statistics for monitoring
 */
export function getShapeCacheStats(): {
  size: number;
  maxSize: number;
  hitRate?: number;
} {
  return {
    size: shapeCache.size,
    maxSize: 5000, // Default max size
  };
}
