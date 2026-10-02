import type { DriplElement } from '@dripl/common';

/**
 * Rotation geometry — pure helper extracted from `useCanvasPointerEvents`.
 *
 * The rotate handle maps the pointer angle around the element center to an
 * element angle: `atan2(dy, dx) + PI/2` so that pointing straight up is
 * angle 0. Kept separate so the convention is documented and unit-tested
 * rather than buried in a 1400-line gesture handler.
 */
export function computeRotationAngle(
  element: Pick<DriplElement, 'x' | 'y' | 'width' | 'height'>,
  pointerX: number,
  pointerY: number
): number {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  return Math.atan2(pointerY - cy, pointerX - cx) + Math.PI / 2;
}
