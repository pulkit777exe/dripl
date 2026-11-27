import type { DriplElement, LinearElement } from '@dripl/common';
import { repairBindings as repairBindingsCommon } from '@dripl/common/arrow-binding';
import {
  bindArrowToElement,
  findBindableElementAtPoint,
  unbindAffectedByDeletion,
  unbindArrowFromElement,
} from '@/utils/arrow-binding';
import {
  buildBoundArrowsByShape,
  resolveGestureUpdates,
  updateBoundArrows,
  updateBoundLabels,
  type ElementLookup,
} from '@/lib/canvas/binding-sync';
import {
  bindCommittedArrow,
  detectArrowBindings,
  type ArrowBindingMatch,
  type DetectedArrowBindings,
} from '@/lib/draw/tool-state';

export type { ArrowBindingMatch, DetectedArrowBindings, ElementLookup };

/**
 * Arrow-binding coordinator (deep module).
 *
 * Centralizes arrow-binding orchestration behind a small interface. The
 * underlying pure helpers remain in their existing modules during the
 * strangler migration; this module is the preferred import for binding
 * workflows.
 */

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/** Detect endpoint bindings for a drawn arrow/line preview against scene shapes. */
export function detectBindingsForDrawnArrow(
  preview: DriplElement,
  elements: DriplElement[],
  bindMode: 'orbit' | 'inside'
): DetectedArrowBindings {
  return detectArrowBindings(preview, elements, bindMode);
}

/**
 * Apply committed arrow bindings to scene elements, updating target shapes'
 * reverse boundElements indexes. Returns the updated elements array.
 */
export function commitDrawnArrowBindings(
  committed: DriplElement,
  startMatch: ArrowBindingMatch | null,
  endMatch: ArrowBindingMatch | null,
  elements: DriplElement[]
): DriplElement[] {
  return bindCommittedArrow(committed, startMatch, endMatch, elements);
}

// ---------------------------------------------------------------------------
// Gesture follow-ups
// ---------------------------------------------------------------------------

/** Build shapeId -> bound arrowIds index for fast gesture follow-ups. */
export function buildBoundArrowIndex(
  elements: Iterable<DriplElement>
): Map<string, Set<string>> {
  return buildBoundArrowsByShape(elements);
}

/**
 * Resolve one gesture frame's binding follow-ups (bound arrows, labels) into a
 * single commit map. Delegates to binding-sync; behavior-preserving wrapper.
 */
export function resolveGestureBindingUpdates(
  previousById: ReadonlyMap<string, DriplElement>,
  primary: ReadonlyMap<string, Partial<DriplElement>>,
  boundArrowsByShape: ReadonlyMap<string, ReadonlySet<string>>,
  options: { includeBoundArrows?: boolean } = {}
): Map<string, Partial<DriplElement>> {
  return resolveGestureUpdates(previousById, primary, boundArrowsByShape, options);
}

/** Recompute endpoints of arrows bound to moved shapes. */
export function syncBoundArrowsAfterMove(
  movedElementIds: Set<string>,
  elementsById: ElementLookup,
  boundArrowsByShape: ReadonlyMap<string, ReadonlySet<string>>,
  updates: Map<string, Partial<DriplElement>>
): void {
  updateBoundArrows(movedElementIds, elementsById, boundArrowsByShape, updates);
}

/** Reposition text labels owned by moved shapes/arrows. */
export function syncBoundLabelsAfterMove(
  movedElementIds: Set<string>,
  elementsById: ElementLookup,
  updates: Map<string, Partial<DriplElement>>
): void {
  updateBoundLabels(movedElementIds, elementsById, updates);
}

// ---------------------------------------------------------------------------
// Deletion/lifecycle
// ---------------------------------------------------------------------------

/**
 * Detach bindings affected by element deletion.
 *
 * - Clears arrow/line bindings that point at deleted shapes (arrows survive).
 * - Removes deleted arrows/lines from target shapes' boundElements reverse index.
 *
 * Does not filter deleted elements out of the scene; callers own that.
 */
export function unbindBindingsForDeletion(
  deletedIds: Iterable<string>,
  elements: DriplElement[],
  elementsById?: ReadonlyMap<string, DriplElement>
): DriplElement[] {
  const idSet = deletedIds instanceof Set ? deletedIds : new Set(deletedIds);

  // Step 1: arrows bound to deleted shapes lose their bindings but survive.
  let nextElements = unbindAffectedByDeletion([...idSet], elements);

  // Step 2: deleted arrows/lines must be removed from target shape boundElements.
  for (const id of idSet) {
    const el = elementsById?.get(id) ?? elements.find(e => e.id === id);
    if (el && (el.type === 'arrow' || el.type === 'line')) {
      nextElements = unbindArrowFromElement(el as LinearElement, 'start', nextElements);
      const updated = nextElements.find(e => e.id === id) as LinearElement | undefined;
      if (updated) {
        nextElements = unbindArrowFromElement(updated, 'end', nextElements);
      }
    }
  }

  return nextElements;
}

/** Remove dangling bindings/references; returns same array reference when clean. */
export function repairDanglingBindings(elements: DriplElement[]): DriplElement[] {
  return repairBindingsCommon(elements);
}

// ---------------------------------------------------------------------------
// Low-level helpers (exposed for targeted use / migration)
// ---------------------------------------------------------------------------

export {
  bindArrowToElement,
  findBindableElementAtPoint,
  unbindAffectedByDeletion,
  unbindArrowFromElement,
};

// Compatibility aliases - preserve existing names for gradual migration.
export {
  detectArrowBindings,
  bindCommittedArrow,
  buildBoundArrowsByShape,
  resolveGestureUpdates,
  updateBoundArrows,
  updateBoundLabels,
};
