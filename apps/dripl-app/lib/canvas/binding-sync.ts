import type { DriplElement, LinearElement } from '@dripl/common';
import { recalculateBinding } from '@/utils/arrow-routing';
import { updateArrowLabelPosition, updateBoundTextPosition } from '@/utils/textBindingUtils';

/**
 * Binding sync — pure helpers extracted from `useCanvasPointerEvents`.
 *
 * When a shape moves, arrows bound to it must follow and text labels must
 * track their owners. These functions compute the follow-up partial updates
 * into a caller-owned map without touching the store, so drag/resize/rotate
 * paths can batch primary + binding updates in one state commit. The index
 * (`shapeId → bound arrowIds`) makes the per-move cost O(bound) instead of
 * O(scene).
 */

/** Index every arrow bound to a shape: `shapeId → arrowIds`. */
export function buildBoundArrowsByShape(
  elements: Iterable<DriplElement>
): Map<string, Set<string>> {
  const boundArrowsByShape = new Map<string, Set<string>>();
  for (const el of elements) {
    const boundElements = (
      el as DriplElement & {
        boundElements?: Array<{ id: string; type: 'arrow' | 'text' }>;
      }
    ).boundElements;
    if (!boundElements) continue;
    for (const bound of boundElements) {
      if (bound.type !== 'arrow') continue;
      let arrowSet = boundArrowsByShape.get(el.id);
      if (!arrowSet) {
        arrowSet = new Set();
        boundArrowsByShape.set(el.id, arrowSet);
      }
      arrowSet.add(bound.id);
    }
  }
  return boundArrowsByShape;
}

/**
 * Recompute endpoints of arrows bound to any of `movedElementIds`.
 * Results accumulate in `updates` (element id → partial element).
 */
export function updateBoundArrows(
  movedElementIds: Set<string>,
  elementsById: ReadonlyMap<string, DriplElement>,
  boundArrowsByShape: ReadonlyMap<string, ReadonlySet<string>>,
  updates: Map<string, Partial<DriplElement>>
): void {
  // Only process arrows that are bound to moved shapes (O(k) where k = number of bound arrows)
  const arrowsToUpdate = new Set<string>();
  for (const movedId of movedElementIds) {
    const boundArrows = boundArrowsByShape.get(movedId);
    if (boundArrows) {
      for (const arrowId of boundArrows) {
        arrowsToUpdate.add(arrowId);
      }
    }
  }

  for (const arrowId of arrowsToUpdate) {
    const el = elementsById.get(arrowId);
    if (!el || (el.type !== 'arrow' && el.type !== 'line')) continue;
    const linearEl = el as LinearElement;
    let updatedLinear = linearEl;

    let needsUpdate = false;

    if (linearEl.startBinding && movedElementIds.has(linearEl.startBinding.elementId)) {
      const targetEl = elementsById.get(linearEl.startBinding.elementId);
      if (targetEl) {
        const startPoint = recalculateBinding(
          { elementId: targetEl.id, focus: linearEl.startBinding.fixedPoint.x },
          targetEl
        );
        const relStart = { x: startPoint.x - el.x, y: startPoint.y - el.y };
        if (el.points.length > 0) {
          const newPoints = [...updatedLinear.points];
          newPoints[0] = relStart;
          updatedLinear = { ...updatedLinear, points: newPoints };
          needsUpdate = true;
        }
      }
    }

    if (linearEl.endBinding && movedElementIds.has(linearEl.endBinding.elementId)) {
      const targetEl = elementsById.get(linearEl.endBinding.elementId);
      if (targetEl) {
        const endPoint = recalculateBinding(
          { elementId: targetEl.id, focus: linearEl.endBinding.fixedPoint.x },
          targetEl
        );
        const relEnd = { x: endPoint.x - el.x, y: endPoint.y - el.y };
        if (updatedLinear.points.length > 1) {
          const newPoints = [...updatedLinear.points];
          newPoints[newPoints.length - 1] = relEnd;
          updatedLinear = { ...updatedLinear, points: newPoints };
          needsUpdate = true;
        }
      }
    }

    if (needsUpdate) {
      updates.set(el.id, updatedLinear);
    }
  }
}

/**
 * Reposition text labels owned by any of `movedElementIds` (container labels
 * via `labelId`, arrow labels via bound `text` entries).
 */
export function updateBoundLabels(
  movedElementIds: Set<string>,
  elementsById: ReadonlyMap<string, DriplElement>,
  updates: Map<string, Partial<DriplElement>>
): void {
  for (const ownerId of movedElementIds) {
    const owner = elementsById.get(ownerId);
    if (!owner) continue;
    const labelIds = new Set<string>();
    if (owner.labelId) labelIds.add(owner.labelId);
    for (const bound of owner.boundElements ?? []) {
      if (bound.type === 'text') labelIds.add(bound.id);
    }
    for (const labelId of labelIds) {
      const label = elementsById.get(labelId);
      if (!label || label.type !== 'text') continue;
      const updatedLabel =
        owner.type === 'arrow' || owner.type === 'line'
          ? updateArrowLabelPosition(owner as LinearElement, label)
          : updateBoundTextPosition(owner, label);
      updates.set(labelId, updatedLabel);
    }
  }
}
