import type { DriplElement } from '@dripl/common';
import { invalidateElementCache } from './staticScene';
import { clearShapeFromCache } from './shape-cache';

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
 * Side effects:
 * - Invalidates element canvas cache if geometry changed
 * - Clears shape cache if geometry changed
 */
export function mutateElement<T extends DriplElement>(element: T, updates: ElementUpdate): T {
  let didChange = false;

  // Check each update field for actual changes
  for (const key in updates) {
    const value = updates[key];
    if (typeof value === 'undefined') continue;

    const currentValue = (element as Record<string, unknown>)[key];

    // Use custom equality check for specific keys
    if (valuesEqual(currentValue, value, key)) continue;

    didChange = true;
    break;
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

  // Both caches hold rendered output keyed on element identity, so they must be
  // dropped for any change that affects rendering: geometry (bounds, which the
  // spatial index is keyed on) as well as appearance such as opacity or stroke
  // color. This used to branch on a `geometryChanged` check whose two arms ran
  // identical statements, so the branch and its computation were both dead.
  invalidateElementCache(element.id);
  clearShapeFromCache(element);

  return updated;
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
