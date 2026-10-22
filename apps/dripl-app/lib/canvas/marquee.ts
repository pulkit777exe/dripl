import type { DriplElement, Point } from '@dripl/common';
import { elementIntersectsRect, getElementBounds } from '@dripl/math/intersection';

export interface MarqueeRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type MarqueeMode = 'intersecting' | 'contained';

/**
 * Marquee selection — pure helpers extracted from `useCanvasPointerEvents`.
 *
 * The gesture hook owns the spatial-index narrowing and the store writes;
 * normalization and the intersect/contained predicates live here so the
 * selection rule is documented and unit-tested instead of buried in the
 * pointer-up handler.
 */

/** Normalize a drag span into an axis-aligned rect. */
export function normalizeMarquee(start: Point, end: Point): MarqueeRect {
  return {
    minX: Math.min(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxX: Math.max(start.x, end.x),
    maxY: Math.max(start.y, end.y),
  };
}

function contains(
  rect: MarqueeRect,
  bounds: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    bounds.x >= rect.minX &&
    bounds.y >= rect.minY &&
    bounds.x + bounds.width <= rect.maxX &&
    bounds.y + bounds.height <= rect.maxY
  );
}

/**
 * Collect ids of `elements` matching `rect` under `mode`. When
 * `candidateIds` is provided (spatial-index narrowing), only those ids are
 * tested; otherwise every element is tested. Deleted elements never match.
 *
 * `contained` is still a pure bounds test: the element has to fit inside the
 * marquee. `intersecting` uses the outline-aware math helper so a marquee
 * drawn inside an unfilled shape's hollow does not select it, while crossing
 * the outline still does.
 */
export function matchMarqueeElements(
  elements: Iterable<DriplElement>,
  rect: MarqueeRect,
  mode: MarqueeMode,
  candidateIds?: ReadonlySet<string> | null
): Set<string> {
  const hitIds = new Set<string>();
  const rectBounds = {
    x: rect.minX,
    y: rect.minY,
    width: rect.maxX - rect.minX,
    height: rect.maxY - rect.minY,
  };
  for (const element of elements) {
    if (element.isDeleted) continue;
    if (candidateIds && !candidateIds.has(element.id)) continue;
    const hit =
      mode === 'contained'
        ? contains(rect, getElementBounds(element))
        : elementIntersectsRect(element, rectBounds);
    if (hit) hitIds.add(element.id);
  }
  return hitIds;
}
