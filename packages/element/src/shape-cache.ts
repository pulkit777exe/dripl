import type { DriplElement } from '@dripl/common';
import type { Drawable } from './rough-renderer';

/**
 * Shape cache keyed by element object reference (WeakMap).
 *
 * Design rationale:
 * - Keyed by element object reference so that garbage collection automatically
 *   reclaims entries when elements are removed from state.
 * - Stores `{ shape, version, theme }` so we can detect both version changes
 *   and theme changes and regenerate accordingly.
 * - `isExporting` callers bypass the cache entirely (handled in rough-renderer.ts).
 */
interface CacheEntry {
  shape: Drawable | Drawable[];
  version: number;
  theme: 'light' | 'dark';
}

const shapeCache = new WeakMap<DriplElement, CacheEntry>();

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
  const entry = shapeCache.get(element);
  if (!entry) return undefined;
  const version = element.version ?? 0;
  // Stale if version changed OR theme changed – evict and return miss.
  if (entry.version !== version || entry.theme !== theme) {
    shapeCache.delete(element);
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
  const version = element.version ?? 0;
  shapeCache.set(element, { shape, version, theme });
}

/**
 * Remove a single element from cache.
 * Call this whenever an element is mutated in-place.
 *
 * Note: With WeakMap, this is optional for normal mutations since old element
 * objects will be GC'd automatically. But explicit deletion is still useful
 * for theme changes or when you want immediate cleanup.
 */
export function clearShapeFromCache(element: DriplElement): void {
  shapeCache.delete(element);
}
