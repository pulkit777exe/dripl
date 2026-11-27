import type { DriplElement, LinearElement, Point } from '@dripl/common';
import { repairBindings as repairBindingsCommon } from '@dripl/common/arrow-binding';
import {
  bindArrowToElement,
  findBindableElementAtPoint,
  unbindAffectedByDeletion,
  unbindArrowFromElement,
} from '@/utils/arrow-binding';
import { calculateArrowBinding } from '@/utils/arrow-routing';
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
// Endpoint drag binding
// ---------------------------------------------------------------------------

export interface EndpointDragBindingResult {
  /** Arrow element to apply as the transient update (may be unchanged). */
  updatedArrow: LinearElement;
  /** Shape-side reverse-index updates to apply transiently. */
  shapeSideUpdates: Map<string, Partial<DriplElement>>;
  /** Shape id to highlight as hovered binding target, or null. */
  hoveredBindingId: string | null;
}

function collectShapeSideBindingUpdates(
  before: readonly DriplElement[],
  after: readonly DriplElement[],
  excludeId: string
): Map<string, Partial<DriplElement>> {
  const previous = new Map(before.map((e) => [e.id, e]));
  const updates = new Map<string, Partial<DriplElement>>();
  for (const element of after) {
    if (element.id === excludeId) continue;
    if (previous.get(element.id) === element) continue;
    updates.set(element.id, element);
  }
  return updates;
}

/**
 * Resolve endpoint-drag binding for an arrow/line handle move.
 *
 * Encapsulates: live-binding composition (snapshot geometry + live binding
 * state), nearby bindable shape detection, bind/unbind decisions, and shape-side
 * reverse index diff computation. Returns structured effects; callers own store
 * updates and hovered-binding view state.
 */
export function resolveEndpointDragBinding(params: {
  arrow: LinearElement;
  startOrEnd: 'start' | 'end';
  target: Point;
  elements: DriplElement[];
  threshold?: number;
}): EndpointDragBindingResult {
  const { arrow, startOrEnd, target, elements, threshold = 20 } = params;

  const liveArrow = elements.find((e) => e.id === arrow.id) as LinearElement | undefined;
  const arrowWithLiveBinding = {
    ...arrow,
    startBinding: liveArrow?.startBinding ?? arrow.startBinding,
    endBinding: liveArrow?.endBinding ?? arrow.endBinding,
  } as LinearElement;
  const currentBinding =
    startOrEnd === 'start'
      ? arrowWithLiveBinding.startBinding
      : arrowWithLiveBinding.endBinding;
  const nearbyShape = findBindableElementAtPoint(target, elements, arrow.id, threshold);

  if (nearbyShape) {
    if (!currentBinding || currentBinding.elementId !== nearbyShape.id) {
      let newElements = currentBinding
        ? unbindArrowFromElement(arrowWithLiveBinding, startOrEnd, elements)
        : elements;
      const binding = calculateArrowBinding(target, nearbyShape);
      if (binding) {
        newElements = bindArrowToElement(
          arrowWithLiveBinding,
          nearbyShape.id,
          startOrEnd,
          { x: binding.focus, y: 0.5 },
          'orbit',
          newElements
        );
        const boundArrow = newElements.find((e) => e.id === arrow.id) as LinearElement | undefined;
        if (boundArrow) {
          return {
            updatedArrow: boundArrow,
            shapeSideUpdates: collectShapeSideBindingUpdates(elements, newElements, arrow.id),
            hoveredBindingId: nearbyShape.id,
          };
        }
      }
    }
    return {
      updatedArrow: arrow,
      shapeSideUpdates: new Map(),
      hoveredBindingId: nearbyShape.id,
    };
  }

  if (currentBinding) {
    const newElements = unbindArrowFromElement(
      arrowWithLiveBinding,
      startOrEnd,
      elements
    );
    const unboundArrow = newElements.find((e) => e.id === arrow.id) as LinearElement | undefined;
    return {
      updatedArrow: unboundArrow ?? arrow,
      shapeSideUpdates: collectShapeSideBindingUpdates(elements, newElements, arrow.id),
      hoveredBindingId: null,
    };
  }

  return {
    updatedArrow: arrow,
    shapeSideUpdates: new Map(),
    hoveredBindingId: null,
  };
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
