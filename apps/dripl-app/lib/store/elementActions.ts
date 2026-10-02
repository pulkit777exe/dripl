import type { StateCreator } from 'zustand';
import type { DriplElement, LinearElement, TextElement } from '@dripl/common';
import { collectCascadeDeleteIds } from '@dripl/common/cascade-delete';
import { generateKeyBetween } from 'fractional-indexing';
import { invalidateElementCache } from '@dripl/element/staticScene';
import { sortElementsByZIndex } from '@/utils/zIndexUtils';
import { mutateElement } from '@dripl/element/mutateElement';
import { unbindAffectedByDeletion, unbindArrowFromElement } from '@/utils/arrow-binding';
import { updateArrowLabelPosition } from '@/utils/textBindingUtils';
import {
  buildBoundArrowsByShape,
  updateBoundArrows,
  updateBoundLabels,
} from '@/lib/canvas/binding-sync';
import { projectStyleForElement } from '@/lib/canvas/style-transfer';
import type { CanvasStoreState, CanvasSlice } from './types';
import {
  cloneElements,
  sortedInsert,
  buildElementsById,
  ensureFractionalIndexes,
  generateFractionalIndexAfterAll,
  withHistoryBeforeMutation,
  commitPresentFromHistory,
} from './helpers';

/**
 * Element CRUD actions — extracted from `canvasSlice.ts`.
 *
 * Everything that mutates the element array with history: full replaces,
 * adds, versioned updates, transient (history-free) updates, deletes with
 * cascade unbinding, and the store-backed cascade-id resolver. Owns the
 * transient spatial-index hint bookkeeping via `mergeTransientChangedIds`.
 */

function mergeTransientChangedIds(state: CanvasStoreState, ids: Iterable<string>): string[] {
  const previous =
    state.spatialChangedIdsVersion === state.spatialVersion ? state.spatialChangedIds : [];
  return Array.from(new Set([...previous, ...ids]));
}

export const createElementActions: StateCreator<
  CanvasStoreState,
  [],
  [],
  Pick<
    CanvasSlice,
    | 'setElements'
    | 'addElement'
    | 'addElements'
    | 'updateElement'
    | 'updateElementTransient'
    | 'updateElementsTransient'
    | 'deleteElements'
    | 'collectCascadeDeleteIds'
    | 'translateElements'
    | 'applyStyleToElements'
  >
> = (set, get) => ({
  setElements: (elements, options) =>
    set(state => {
      if (options?.skipHistory) {
        elements.forEach(el => {
          const prev = state.elementsById.get(el.id);
          if (prev && prev.version !== (el.version ?? 0)) {
            invalidateElementCache(el.id);
          }
        });
        const withIndexes = ensureFractionalIndexes(elements);
        const sorted = sortElementsByZIndex(withIndexes);
        const next = cloneElements(sorted);
        const nextIds = new Set(next.map(element => element.id));
        for (const id of state.elementsById.keys()) {
          if (!nextIds.has(id)) invalidateElementCache(id);
        }
        return {
          elements: next,
          elementsById: buildElementsById(next),
          spatialVersion: state.spatialVersion + 1,
        };
      }
      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );
      const withIndexes = ensureFractionalIndexes(elements);
      const sorted = sortElementsByZIndex(withIndexes);
      const nextElements = cloneElements(sorted);
      const nextIds = new Set(nextElements.map(element => element.id));
      for (const id of state.elementsById.keys()) {
        if (!nextIds.has(id)) invalidateElementCache(id);
      }
      const historyPayload = commitPresentFromHistory(history.past, history.future);
      return {
        elements: nextElements,
        elementsById: buildElementsById(nextElements),
        past: historyPayload.past,
        future: historyPayload.future,
        spatialVersion: state.spatialVersion + 1,
      };
    }),

  addElement: element =>
    set(state => {
      if (state.elementsById.has(element.id)) {
        return state;
      }
      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );
      const withIndex =
        element.fractionalIndex != null
          ? element
          : { ...element, fractionalIndex: generateFractionalIndexAfterAll(state.elements) };
      const nextElements = sortedInsert(state.elements, withIndex);
      const nextMap = new Map(state.elementsById);
      nextMap.set(withIndex.id, withIndex);
      const historyPayload = commitPresentFromHistory(history.past, history.future);
      return {
        elements: nextElements,
        elementsById: nextMap,
        past: historyPayload.past,
        future: historyPayload.future,
        spatialVersion: state.spatialVersion + 1,
      };
    }),

  addElements: elements =>
    set(state => {
      if (elements.length === 0) return state;
      const deduped = elements.filter(element => !state.elementsById.has(element.id));
      if (deduped.length === 0) return state;

      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );
      let lastKey = state.elements[state.elements.length - 1]?.fractionalIndex ?? null;
      const prepared = deduped.map(element => {
        if (element.fractionalIndex != null) return element;
        lastKey = generateKeyBetween(lastKey, null);
        return { ...element, fractionalIndex: lastKey };
      });
      const currentElements = sortElementsByZIndex([...state.elements, ...prepared]);
      const nextMap = new Map(state.elementsById);
      for (const element of prepared) {
        nextMap.set(element.id, element);
      }
      const historyPayload = commitPresentFromHistory(history.past, history.future);

      return {
        elements: currentElements,
        elementsById: nextMap,
        past: historyPayload.past,
        future: historyPayload.future,
        spatialVersion: state.spatialVersion + 1,
      };
    }),

  updateElement: (id, updates) =>
    set(state => {
      const previous = state.elementsById.get(id);
      if (!previous) return state;

      const updated = mutateElement(previous, updates);

      // No-op guard: if nothing changed, skip history and state update
      if (updated === previous) return state;

      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );

      const nextElements = state.elements.map(e => (e.id === id ? updated : e));
      const nextMap = new Map(state.elementsById);
      nextMap.set(id, updated);

      // Auto-reposition arrow label if arrow points changed
      if (updated.type === 'arrow' && updated.labelId) {
        const pointsChanged = 'points' in updates;
        if (pointsChanged) {
          const labelElement = state.elementsById.get(updated.labelId) as TextElement | undefined;
          if (labelElement) {
            const positionedLabel = updateArrowLabelPosition(
              updated as LinearElement,
              labelElement
            );
            if (positionedLabel !== labelElement) {
              // Keep the label as a single scene element. Appending the
              // repositioned label created a duplicate on every arrow move,
              // while the id-to-element map silently contained only the last
              // copy. Update the existing entry in both representations.
              const repositioned = mutateElement(labelElement, {
                x: positionedLabel.x,
                y: positionedLabel.y,
              });
              const labelIndex = nextElements.findIndex(element => element.id === repositioned.id);
              if (labelIndex === -1) {
                nextElements.push(repositioned);
              } else {
                nextElements[labelIndex] = repositioned;
              }
              nextMap.set(repositioned.id, repositioned);
            }
          }
        }
      }

      const historyPayload = commitPresentFromHistory(history.past, history.future);
      return {
        elements: nextElements,
        elementsById: nextMap,
        past: historyPayload.past,
        future: historyPayload.future,
        spatialVersion: state.spatialVersion + 1,
      };
    }),

  updateElementTransient: (id, updates) =>
    set(state => {
      const previous = state.elementsById.get(id);
      if (!previous) return state;

      const updated = mutateElement(previous, updates);

      // No-op guard: if nothing changed, skip state update
      if (updated === previous) return state;

      const nextElements = state.elements.map(e => (e.id === id ? updated : e));
      // Transient gestures update the same map in place. The array identity
      // still changes (and drives React/render invalidation), while avoiding a
      // full O(n) Map clone for every pointer move.
      state.elementsById.set(id, updated);

      return {
        elements: nextElements,
        elementsById: state.elementsById,
        spatialVersion: state.spatialVersion + 1,
        spatialChangedIds: mergeTransientChangedIds(state, [id]),
        spatialChangedIdsVersion: state.spatialVersion + 1,
      };
    }),

  updateElementsTransient: updates =>
    set(state => {
      if (updates.size === 0) return state;

      const nextElements = state.elements.slice();
      const indexById = new Map(state.elements.map((element, index) => [element.id, index]));
      let changed = false;

      for (const [id, elementUpdates] of updates) {
        const previous = state.elementsById.get(id);
        const index = indexById.get(id);
        if (!previous || index === undefined) continue;

        const updated = mutateElement(previous, elementUpdates);
        if (updated === previous) continue;

        nextElements[index] = updated;
        state.elementsById.set(id, updated);
        changed = true;
      }

      if (!changed) return state;
      const nextSpatialVersion = state.spatialVersion + 1;
      return {
        elements: nextElements,
        elementsById: state.elementsById,
        spatialVersion: nextSpatialVersion,
        spatialChangedIds: mergeTransientChangedIds(state, updates.keys()),
        spatialChangedIdsVersion: nextSpatialVersion,
      };
    }),

  deleteElements: ids =>
    set(state => {
      if (ids.length === 0) return state;
      const idSet = new Set(ids);

      // Step 1: Unbind arrows that were bound to deleted shapes (arrows survive)
      let nextElements = unbindAffectedByDeletion([...idSet], state.elements);

      // Step 2: If deleting an arrow/line, remove it from any shape's boundElements
      for (const id of idSet) {
        const el = state.elementsById.get(id);
        if (el && (el.type === 'arrow' || el.type === 'line')) {
          nextElements = unbindArrowFromElement(el as LinearElement, 'start', nextElements);
          const updated = nextElements.find(e => e.id === id) as LinearElement | undefined;
          if (updated) {
            nextElements = unbindArrowFromElement(updated, 'end', nextElements);
          }
        }
      }

      // Step 3: Filter out the deleted elements themselves
      const finalElements = nextElements.filter(el => !idSet.has(el.id));
      if (finalElements.length === state.elements.length) return state;

      // Step 4: Invalidate caches, push history
      idSet.forEach(id => invalidateElementCache(id));

      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );
      const nextMap = new Map(state.elementsById);
      idSet.forEach(id => nextMap.delete(id));
      const historyPayload = commitPresentFromHistory(history.past, history.future);
      return {
        elements: finalElements,
        elementsById: nextMap,
        selectedIds: new Set(
          Array.from(state.selectedIds).filter(selectedId => !idSet.has(selectedId))
        ),
        past: historyPayload.past,
        future: historyPayload.future,
        spatialVersion: state.spatialVersion + 1,
      };
    }),
  collectCascadeDeleteIds: seedIds => {
    const state = get();
    return collectCascadeDeleteIds(seedIds, state.elements);
  },

  translateElements: (ids, dx, dy) =>
    set(state => {
      if (ids.length === 0 || (dx === 0 && dy === 0)) return state;
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return state;
      const idSet = new Set(ids);

      const nextElements = state.elements.map(el => {
        if (!idSet.has(el.id) || el.locked) return el;
        return mutateElement(el, { x: el.x + dx, y: el.y + dy });
      });
      const movedIds = new Set<string>();
      nextElements.forEach((el, i) => {
        if (el !== state.elements[i]) movedIds.add(el.id);
      });
      if (movedIds.size === 0) return state;

      // Keep bound arrows/labels glued, mirroring the drag path: binding
      // updates are computed against the moved scene, then committed in the
      // same history entry.
      const nextMap = buildElementsById(nextElements);
      const boundUpdates = new Map<string, Partial<DriplElement>>();
      updateBoundArrows(movedIds, nextMap, buildBoundArrowsByShape(nextElements), boundUpdates);
      updateBoundLabels(movedIds, nextMap, boundUpdates);
      boundUpdates.forEach((partial, id) => {
        const prev = nextMap.get(id);
        if (!prev) return;
        const updated = mutateElement(prev, partial);
        if (updated === prev) return;
        const index = nextElements.findIndex(el => el.id === id);
        if (index !== -1) nextElements[index] = updated;
        nextMap.set(id, updated);
        movedIds.add(id);
      });

      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );
      const historyPayload = commitPresentFromHistory(history.past, history.future);
      return {
        elements: nextElements,
        elementsById: nextMap,
        past: historyPayload.past,
        future: historyPayload.future,
        spatialVersion: state.spatialVersion + 1,
      };
    }),

  applyStyleToElements: (ids, style) =>
    set(state => {
      if (ids.length === 0) return state;
      const idSet = new Set(ids);
      let changed = false;
      const nextElements = state.elements.map(el => {
        if (!idSet.has(el.id) || el.locked) return el;
        const updated = mutateElement(el, projectStyleForElement(style, el));
        if (updated !== el) changed = true;
        return updated;
      });
      if (!changed) return state;
      const nextMap = buildElementsById(nextElements);
      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );
      const historyPayload = commitPresentFromHistory(history.past, history.future);
      return {
        elements: nextElements,
        elementsById: nextMap,
        past: historyPayload.past,
        future: historyPayload.future,
        spatialVersion: state.spatialVersion + 1,
      };
    }),
});
