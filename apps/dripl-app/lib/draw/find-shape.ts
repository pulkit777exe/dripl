import type { DriplElement, NormalizedBinding, Point } from '@dripl/common';
import { getDistanceToBounds } from '@dripl/math/intersection';
import { calculateArrowBinding } from '@/utils/arrow-routing';

const BINDING_SNAP_THRESHOLD = 20;

/**
 * Binding target search — pure helper extracted from `useDrawingTools`.
 *
 * Finds the nearest bindable shape within the snap threshold of `point`,
 * skipping the element being drawn and other linear elements. Returns the
 * shape plus a normalized orbit/inside binding, or `null` when nothing is
 * close enough.
 */
export function findNearestShape(
  point: Point,
  elements: DriplElement[],
  excludeId: string,
  bindMode: 'orbit' | 'inside' = 'orbit'
): { element: DriplElement; binding: NormalizedBinding } | null {
  let bestMatch: { element: DriplElement; binding: NormalizedBinding } | null = null;
  let bestDistance = BINDING_SNAP_THRESHOLD;

  for (const el of elements) {
    if (el.id === excludeId) continue;
    if (el.type === 'arrow' || el.type === 'line' || el.type === 'freedraw') continue;

    const binding = calculateArrowBinding(point, el);
    if (!binding) continue;

    const dist = getDistanceToBounds(point, el);

    if (dist < bestDistance) {
      bestDistance = dist;
      bestMatch = {
        element: el,
        binding: {
          elementId: el.id,
          fixedPoint: { x: binding.focus, y: 0.5 },
          mode: bindMode,
        },
      };
    }
  }

  return bestMatch;
}
