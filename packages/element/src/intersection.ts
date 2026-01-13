/**
 * Re-export intersection functions from @dripl/math for backward compatibility
 * These functions have been moved to @dripl/math to break the cyclic dependency
 */
export {
  isPointInElement,
  getElementBounds,
  elementIntersectsSegment,
  getFreedrawOutline,
} from "@dripl/math";
