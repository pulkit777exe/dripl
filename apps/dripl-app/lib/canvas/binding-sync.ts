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

/**
 * Resolve one gesture frame into a single store commit.
 *
 * Drag/resize/rotate compute primary updates, then binding follow-ups (bound
 * arrows, labels) against the post-primary scene. Committing those as two
 * store writes re-renders the canvas subtree twice per frame for a single
 * visible frame. Folding the follow-ups into the primary map keeps one commit
 * per frame with an identical end state: the store's own `mutateElement`
 * still owns version bumps and no-op guards at commit time, so an element
 * touched by both halves is bumped once instead of twice and a follow-up
 * that changes nothing still washes out.
 *
 * The follow-ups read from a post-primary *view* — primaries overlaid on a
 * copy — so the store map is never mutated here and the commit below still
 * sees pre-frame state. An element in both halves keeps its primary geometry
 * with the follow-up spread over it, which is what the two-commit sequence
 * produced.
 *
 * Rotation passes `includeBoundArrows: false`: the rotate path has only ever
 * repositioned labels, and rebinding arrow endpoints mid-rotate is a behavior
 * change of its own, not batching.
 */
export function resolveGestureUpdates(
  previousById: ReadonlyMap<string, DriplElement>,
  primary: ReadonlyMap<string, Partial<DriplElement>>,
  boundArrowsByShape: ReadonlyMap<string, ReadonlySet<string>>,
  options: { includeBoundArrows?: boolean } = {}
): Map<string, Partial<DriplElement>> {
  if (primary.size === 0) return new Map();
  const view = new Map<string, DriplElement>();
  for (const [id, element] of previousById) view.set(id, element);
  for (const [id, partial] of primary) {
    const previous = view.get(id);
    // `previous` is complete and the partial only overrides present keys —
    // the same spread the commit path runs — so the result is complete.
    if (previous) view.set(id, { ...previous, ...partial } as DriplElement);
  }
  const movedIds = new Set(primary.keys());
  const bound = new Map<string, Partial<DriplElement>>();
  if (options.includeBoundArrows !== false) {
    updateBoundArrows(movedIds, view, boundArrowsByShape, bound);
  }
  updateBoundLabels(movedIds, view, bound);
  if (bound.size === 0) return new Map(primary);
  const merged = new Map<string, Partial<DriplElement>>(primary);
  for (const [id, partial] of bound) {
    const existing = merged.get(id);
    merged.set(id, existing ? { ...existing, ...partial } : partial);
  }
  return merged;
}
