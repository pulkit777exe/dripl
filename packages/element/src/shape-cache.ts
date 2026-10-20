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

/**
 * Default theme for cache lookups when the caller does not say. Matches
 * `renderRoughElement`'s default so default-path callers generate once, not
 * once per theme.
 */
export const DEFAULT_CACHE_THEME = 'dark' as const;

const shapeCache = new WeakMap<DriplElement, CacheEntry>();

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get cached Rough.js shape for an element.
 * Returns `undefined` on a cache miss OR when the cached entry is stale
 * (version bumped or theme changed).
 */
export function getShapeFromCache(
  element: DriplElement,
  theme: 'light' | 'dark' = DEFAULT_CACHE_THEME
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
  theme: 'light' | 'dark' = DEFAULT_CACHE_THEME
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

/**
 * Move a cached Rough.js drawable onto the object a position-only mutation
 * returned, the shape-side counterpart to `carryForwardElementCache`.
 *
 * A `Drawable` is ops, not pixels: `generateShape` builds every kind at the
 * origin from width, height and style alone — it never reads `x`, `y`, `angle`
 * or `opacity`, and it is handed no scene, so it cannot have embedded a label
 * or any other element. Nothing in it can therefore be affected by where the
 * element sits or how it is composited, and unlike the bitmap this needs no
 * dependency condition.
 *
 * The version is refreshed to the successor's so `getShapeFromCache` sees a
 * hit; leaving the old number would make it evict the entry it had just been
 * handed. Theme is preserved because it is part of the key and this function is
 * only reached when the mutation touched nothing the drawable is built from —
 * position, z-order, rotation and opacity all carry; geometry, colours and
 * bound text drop the entry instead.
 */
export function carryForwardShapeCache(previous: DriplElement, next: DriplElement): void {
  const entry = shapeCache.get(previous);
  if (!entry) return;
  shapeCache.delete(previous);
  shapeCache.set(next, { ...entry, version: next.version ?? 0 });
}
