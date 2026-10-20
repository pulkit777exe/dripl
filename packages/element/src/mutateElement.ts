import type { DriplElement } from '@dripl/common';
import { carryForwardElementCache, invalidateElementCache } from './staticScene';
import { carryForwardShapeCache, clearShapeFromCache } from './shape-cache';

/**
 * Centralized element mutation function.
 *
 * All element mutations should flow through this function to ensure:
 * 1. No-op guard (skip if nothing actually changed)
 * 2. Version bump (version + 1, new versionNonce)
 * 3. Cache invalidation (element canvas + shape cache)
 *
 * Usage:
 *   const updated = mutateElement(element, { x: 100, y: 200 });
 *   if (updated !== element) {
 *     // Element actually changed, update state
 *   }
 */

export interface ElementUpdate {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  angle?: number;
  opacity?: number;
  strokeColor?: string;
  backgroundColor?: string;
  strokeWidth?: number;
  roughness?: number;
  strokeStyle?: string;
  fillStyle?: string;
  groupId?: string;
  fractionalIndex?: string;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  points?: { x: number; y: number }[];
  src?: string;
  [key: string]: unknown;
}

/**
 * Compare two values for equality.
 * For primitives, uses strict equality.
 * For arrays, does element-by-element comparison.
 * For objects (except specific keys), always considers them changed.
 */
function valuesEqual(a: unknown, b: unknown, key: string): boolean {
  if (a === b) return true;

  // For point arrays, compare the public `{ x, y }` fields. The previous
  // implementation indexed each point as if it were a tuple (`[x, y]`),
  // which made every point-to-point comparison compare `undefined` to
  // `undefined` and incorrectly treated changed paths as no-ops.
  if (key === 'points' && Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const aPoint = a[i] as { x?: unknown; y?: unknown } | undefined;
      const bPoint = b[i] as { x?: unknown; y?: unknown } | undefined;
      if (!aPoint || !bPoint || aPoint.x !== bPoint.x || aPoint.y !== bPoint.y) {
        return false;
      }
    }
    return true;
  }

  // For groupId, compare as sets
  if (key === 'groupId') {
    return a === b;
  }

  return false;
}

/**
 * Mutate an element with updates. Returns the same element reference if
 * nothing changed (no-op guard), or a new element with bumped version.
 *
 * Side effects — one of two, chosen by whether the change can reach a cached
 * render:
 *
 * - **It can** (geometry, appearance, text, points, opacity …): the element
 *   canvas cache is invalidated by id and the shape cache is cleared, because
 *   both caches are keyed on element identity and the successor object has no
 *   entry to inherit.
 * - **It cannot** (`x`, `y`, `fractionalIndex`, and `angle` for everything but
 *   `freedraw`): both entries are *carried* to the successor object instead.
 *   The pixels a bitmap holds are position-independent by construction, so a
 *   drag that rebuilt one bitmap per selected element per frame was spending
 *   ~5 ms of a 16 ms frame on a 100-element selection to reproduce bytes it
 *   already had (`bench/drag-path.bench.ts`).
 *
 * `version` still bumps on every real change either way: it is the
 * collaboration freshness key and the spatial index re-indexs from it, and
 * carrying a bitmap must not weaken either.
 */
export function mutateElement<T extends DriplElement>(element: T, updates: ElementUpdate): T {
  let didChange = false;
  let reachesPixels = false;

  // Check each update field for actual changes.
  //
  // Unlike the no-op guard's earlier form this does not `break` on the first
  // difference: deciding whether the caches may be carried needs to know about
  // *every* field that actually changes, because one content key among five
  // position keys still makes the render stale. The update objects are small —
  // a handful of keys — so the extra comparisons cost less than the bitmap
  // rebuild they prevent.
  for (const key in updates) {
    const value = updates[key];
    if (typeof value === 'undefined') continue;

    const currentValue = (element as Record<string, unknown>)[key];

    // Use custom equality check for specific keys
    if (valuesEqual(currentValue, value, key)) continue;

    didChange = true;
    if (reachesCachedPixels(key)) reachesPixels = true;
  }

  // No-op guard: return same reference if nothing changed
  if (!didChange) {
    return element;
  }

  // Create updated element with bumped version
  const updated = {
    ...element,
    ...updates,
    version: (element.version ?? 0) + 1,
    versionNonce: Math.floor(Math.random() * 2_147_483_647),
    updated: Date.now(),
  } as T;

  if (reachesPixels) {
    // Both caches hold rendered output keyed on element identity, so they are
    // dropped rather than inherited: the successor object has no entry, and the
    // change is one their content depends on — geometry, or appearance such as
    // stroke colour.
    invalidateElementCache(element.id);
    clearShapeFromCache(element);
  } else {
    // Position/compositing-only. Move both entries to the successor so the next
    // frame hits instead of rebuilding; `carryForwardElementCache` re-checks
    // the one condition this function cannot see (whether the bitmap embeds a
    // label).
    carryForwardElementCache(element, updated);
    carryForwardShapeCache(element, updated);
  }

  return updated;
}

/**
 * Whether writing `key` can change what a cached bitmap or drawable contains.
 *
 * `x` and `y` cannot. The bitmap is generated in the element's local frame —
 * `generateElementCanvas` translates by `-element.x, -element.y` and
 * `drawElement` blits at `element.x - PADDING`, so the two cancel — and every
 * branch of `renderRoughElement` is position-free inside that frame. That is
 * also why a drag rebuild was pure waste: see `carryForwardElementCache` for
 * the full argument, including the world-coordinate freedraw case.
 *
 * `fractionalIndex` is z-order. Each element is rasterized into its own bitmap,
 * so the order other elements are drawn in never reaches these pixels.
 *
 * `angle` and `opacity` are compositing, applied when the finished bitmap is
 * placed: `drawElement` rotates around the element's centre and sets
 * `globalAlpha` at blit time, and `renderDraftElement` does the same for a
 * direct draw. Generation bakes neither — it used to bake both, which squared
 * the alpha and doubled the freedraw angle on the cached path.
 *
 * Everything else — geometry, colours, text, stroke points — reaches the
 * pixels and drops both caches.
 */
const CARRIABLE_KEYS: ReadonlySet<string> = new Set([
  'x',
  'y',
  'fractionalIndex',
  'angle',
  'opacity',
]);

function reachesCachedPixels(key: string): boolean {
  return !CARRIABLE_KEYS.has(key);
}

/**
 * Batch mutate multiple elements. Returns the same array reference if
 * nothing changed, or a new array with updated elements.
 */
export function mutateElements<T extends DriplElement>(
  elements: T[],
  updatesMap: Map<string, ElementUpdate>
): T[] {
  if (updatesMap.size === 0) return elements;

  let changed = false;
  const result = elements.map(element => {
    const updates = updatesMap.get(element.id);
    if (!updates) return element;

    const updated = mutateElement(element, updates);
    if (updated !== element) {
      changed = true;
      return updated;
    }
    return element;
  });

  return changed ? result : elements;
}
