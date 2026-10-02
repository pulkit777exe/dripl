import type { DriplElement, Point } from '@dripl/common';
import { getElementBounds } from '@dripl/math/intersection';

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

function intersects(
  rect: MarqueeRect,
  bounds: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    bounds.x < rect.maxX &&
    bounds.x + bounds.width > rect.minX &&
    bounds.y < rect.maxY &&
    bounds.y + bounds.height > rect.minY
  );
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
 */
export function matchMarqueeElements(
  elements: Iterable<DriplElement>,
  rect: MarqueeRect,
  mode: MarqueeMode,
  candidateIds?: ReadonlySet<string> | null
): Set<string> {
  const hitIds = new Set<string>();
  const test = mode === 'contained' ? contains : intersects;
  for (const element of elements) {
    if (element.isDeleted) continue;
    if (candidateIds && !candidateIds.has(element.id)) continue;
    if (test(rect, getElementBounds(element))) hitIds.add(element.id);
  }
  return hitIds;
}
