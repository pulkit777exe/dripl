import type { DriplElement } from '@dripl/common';

export type Drawable = any;

/**
 * Shape cache keyed by `${element.id}:${theme}`.
 *
 * Design rationale:
 * - Keyed by element ID only (not version) so that a single lookup replaces
 *   the stale entry on version change instead of accumulating infinite entries.
 * - Stores `{ shape, version, theme }` so we can detect both version changes
 *   and theme changes and regenerate accordingly. (Fixes TODO #29 + #30)
 * - `isExporting` callers bypass the cache entirely (TODO #32 handled in
 *   rough-renderer.ts).
 */
interface CacheEntry {
  shape: Drawable | Drawable[];
  version: number;
  theme: 'light' | 'dark';
}

const shapeCache = new Map<string, CacheEntry>();

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get cached Rough.js shape for an element.
 * Returns `undefined` on a cache miss OR when the cached entry is stale
 * (version bumped or theme changed).
 */
export function getShapeFromCache(
  element: DriplElement,
  theme: 'light' | 'dark' = 'light'
): Drawable | Drawable[] | undefined {
  const entry = shapeCache.get(element.id);
  if (!entry) return undefined;
  const version = (element as any).version ?? 0;
  // Stale if version changed OR theme changed – evict and return miss.
  if (entry.version !== version || entry.theme !== theme) {
    shapeCache.delete(element.id);
    return undefined;
  }
  return entry.shape;
}

/**
 * Store Rough.js shape in cache.
 */
export function setShapeInCache(
  element: DriplElement,
  shape: Drawable | Drawable[],
  theme: 'light' | 'dark' = 'light'
): void {
  const version = (element as any).version ?? 0;
  shapeCache.set(element.id, { shape, version, theme });
}

/**
 * Remove a single element from cache.
 * Call this whenever an element is mutated in-place.
 */
export function clearShapeFromCache(element: DriplElement): void {
  shapeCache.delete(element.id);
}

/**
 * Clear all cached shapes.
 * Useful when:
 * - Theme changes (theme-key in entry already handles gradual eviction, but
 *   bulk clear is faster if many elements are visible)
 * - Rough.js config changes
 * - Major canvas reset
 */
export function clearAllShapeCache(): void {
  shapeCache.clear();
}

/**
 * Optional: limit cache size (safety valve for very large canvases).
 * Evicts oldest entries (Map insertion order).
 */
export function pruneShapeCache(maxSize: number = 5000): void {
  if (shapeCache.size <= maxSize) return;
  const extra = shapeCache.size - maxSize;
  const keys = Array.from(shapeCache.keys());
  for (let i = 0; i < extra; i++) {
    shapeCache.delete(keys[i]!);
  }
}

/**
 * Get cache statistics for monitoring.
 */
export function getShapeCacheStats(): { size: number; maxSize: number } {
  return {
    size: shapeCache.size,
    maxSize: 5000,
  };
}
