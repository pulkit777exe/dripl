import rough from "roughjs";
import type { DriplElement } from "@dripl/common";

const generator = rough.generator();

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

/**
 * Generate Rough.js shape for an element without requiring a canvas
 */
export function generateElementShape(element: DriplElement): Drawable | Drawable[] {
  const {
    width,
    height,
    strokeColor,
    backgroundColor,
    strokeWidth,
    roughness = 1,
    strokeStyle = "solid",
    fillStyle = "hachure",
    seed,
    roundness = 0,
  } = element as any;

  const options = {
    stroke: strokeColor,
    strokeWidth,
    roughness,
    fill: backgroundColor !== "transparent" ? backgroundColor : undefined,
    fillStyle,
    seed,
    strokeLineDash:
      strokeStyle === "dashed"
        ? [10, 5]
        : strokeStyle === "dotted"
          ? [2, 3]
          : undefined,
    hachureAngle: 45,
    hachureGap: strokeWidth * 2,
    curveStepCount: 9,
    simplification: 0.5,
    roundness,
  };

  switch (element.type) {
    case "rectangle":
      return generator.rectangle(0, 0, width, height, options);

    case "ellipse":
      return generator.ellipse(width / 2, height / 2, width, height, options);

    case "diamond": {
      const topX = width / 2;
      const topY = 0;
      const rightX = width;
      const rightY = height / 2;
      const bottomX = width / 2;
      const bottomY = height;
      const leftX = 0;
      const leftY = height / 2;
      return generator.polygon(
        [
          [topX, topY],
          [rightX, rightY],
          [bottomX, bottomY],
          [leftX, leftY],
        ],
        options,
      );
    }

    case "line":
    case "arrow":
    case "freedraw": {
      if ("points" in element && element.points.length > 1) {
        const pts = element.points.map(
          (p: any) => [p.x, p.y] as [number, number],
        );
        return generator.linearPath(pts, options);
      }
      return [];
    }

    default:
      return [];
  }
}
