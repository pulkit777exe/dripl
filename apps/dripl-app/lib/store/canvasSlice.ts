import type { StateCreator } from 'zustand';
import type { DriplElement, LinearElement, TextElement } from '@dripl/common';
import { collectCascadeDeleteIds } from '@dripl/common/cascade-delete';
import { generateKeyBetween } from 'fractional-indexing';
import { invalidateElementCache } from '@dripl/element/staticScene';
import { sortElementsByZIndex } from '@/utils/zIndexUtils';
import { clearShapeFromCache } from '@dripl/element/shape-cache';
import { mutateElement } from '@dripl/element/mutateElement';
import { getElementBounds } from '@dripl/math/intersection';
import type { CanvasStoreState, CanvasSlice } from './types';
import {
  cloneElements,
  sortedInsert,
  buildElementsById,
  ensureFractionalIndexes,
  generateFractionalIndexAfterAll,
  generateFractionalIndexBeforeAll,
  withHistoryBeforeMutation,
  commitPresentFromHistory,
} from './helpers';
import { unbindAffectedByDeletion, unbindArrowFromElement } from '@/utils/arrow-binding';
import { updateArrowLabelPosition } from '@/utils/textBindingUtils';

function mergeTransientChangedIds(state: CanvasStoreState, ids: Iterable<string>): string[] {
  const previous =
    state.spatialChangedIdsVersion === state.spatialVersion ? state.spatialChangedIds : [];
  return Array.from(new Set([...previous, ...ids]));
}

export const createCanvasSlice: StateCreator<CanvasStoreState, [], [], CanvasSlice> = (
  set,
  get
) => ({
  elements: [],
  elementsById: new Map(),
  selectedIds: new Set<string>(),
  activeTool: 'select',
  toolLocked: false,
  zoom: 1,
  panX: 0,
  panY: 0,
  gridEnabled: false,
  gridSize: 20,
  marqueeSelectionMode: 'intersecting',
  currentStrokeColor: '#1e1e1e',
  currentBackgroundColor: 'transparent',
  currentStrokeWidth: 2,
  currentRoughness: 1,
  currentStrokeStyle: 'solid',
  currentFillStyle: 'hachure',
  currentArrowStyle: 'straight',
  drawingLifecycle: 'idle',
  draftElement: null,
  isEditingElementId: null,
  clipboard: [],
  shouldCacheIgnoreZoom: false,
  pendingEmbed: null,
  spatialVersion: 0,
  spatialChangedIds: [],
  spatialChangedIdsVersion: 0,

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

  bringForward: ids =>
    set(state => {
      if (ids.length === 0) return state;
      const selected = new Set(ids);
      const sorted = sortElementsByZIndex(state.elements);
      const nextElements = sorted.map(el => ({ ...el }));
      let changed = false;

      for (let i = nextElements.length - 2; i >= 0; i -= 1) {
        const current = nextElements[i];
        const above = nextElements[i + 1];
        if (!current || !above) continue;
        if (selected.has(current.id) && !selected.has(above.id)) {
          const newIdx = generateKeyBetween(
            above.fractionalIndex ?? null,
            (i + 2 < nextElements.length ? nextElements[i + 2]?.fractionalIndex : null) ?? null
          );
          // Use mutateElement to bump version and invalidate caches
          const updated = mutateElement(current, { fractionalIndex: newIdx });
          if (updated !== current) {
            nextElements[i] = updated;
            changed = true;
          }
        }
      }
      if (!changed) return state;

      const reordered = sortElementsByZIndex(nextElements);
      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );
      const historyPayload = commitPresentFromHistory(history.past, history.future);
      return {
        elements: reordered,
        elementsById: buildElementsById(reordered),
        spatialVersion: state.spatialVersion + 1,
        past: historyPayload.past,
        future: historyPayload.future,
      };
    }),

  sendBackward: ids =>
    set(state => {
      if (ids.length === 0) return state;
      const selected = new Set(ids);
      const sorted = sortElementsByZIndex(state.elements);
      const nextElements = sorted.map(el => ({ ...el }));
      let changed = false;

      for (let i = 1; i < nextElements.length; i += 1) {
        const current = nextElements[i];
        const below = nextElements[i - 1];
        if (!current || !below) continue;
        if (selected.has(current.id) && !selected.has(below.id)) {
          const newIdx = generateKeyBetween(
            (i - 2 >= 0 ? nextElements[i - 2]?.fractionalIndex : null) ?? null,
            below.fractionalIndex ?? null
          );
          // Use mutateElement to bump version and invalidate caches
          const updated = mutateElement(current, { fractionalIndex: newIdx });
          if (updated !== current) {
            nextElements[i] = updated;
            changed = true;
          }
        }
      }
      if (!changed) return state;

      const reordered = sortElementsByZIndex(nextElements);
      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );
      const historyPayload = commitPresentFromHistory(history.past, history.future);
      return {
        elements: reordered,
        elementsById: buildElementsById(reordered),
        spatialVersion: state.spatialVersion + 1,
        past: historyPayload.past,
        future: historyPayload.future,
      };
    }),

  bringToFront: ids =>
    set(state => {
      if (ids.length === 0) return state;
      const selected = new Set(ids);
      const sorted = sortElementsByZIndex(state.elements);
      const moving = sorted.filter(el => selected.has(el.id));
      if (moving.length === 0) return state;

      const newFrontier = generateFractionalIndexAfterAll(sorted);
      const nextElements = sorted.map(el => {
        if (selected.has(el.id)) {
          const idx = generateKeyBetween(newFrontier, null);
          // Use mutateElement to bump version and invalidate caches
          return mutateElement(el, { fractionalIndex: idx });
        }
        return { ...el };
      });

      const reordered = sortElementsByZIndex(nextElements);
      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );
      const historyPayload = commitPresentFromHistory(history.past, history.future);
      return {
        elements: reordered,
        elementsById: buildElementsById(reordered),
        spatialVersion: state.spatialVersion + 1,
        past: historyPayload.past,
        future: historyPayload.future,
      };
    }),

  sendToBack: ids =>
    set(state => {
      if (ids.length === 0) return state;
      const selected = new Set(ids);
      const sorted = sortElementsByZIndex(state.elements);
      const moving = sorted.filter(el => selected.has(el.id));
      if (moving.length === 0) return state;

      const newBackier = generateFractionalIndexBeforeAll(sorted);
      const nextElements = sorted.map(el => {
        if (selected.has(el.id)) {
          const idx = generateKeyBetween(null, newBackier);
          // Use mutateElement to bump version and invalidate caches
          return mutateElement(el, { fractionalIndex: idx });
        }
        return { ...el };
      });

      const reordered = sortElementsByZIndex(nextElements);
      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );
      const historyPayload = commitPresentFromHistory(history.past, history.future);
      return {
        elements: reordered,
        elementsById: buildElementsById(reordered),
        spatialVersion: state.spatialVersion + 1,
        past: historyPayload.past,
        future: historyPayload.future,
      };
    }),

  alignElements: mode =>
    set(state => {
      const selected = new Set(state.selectedIds);
      const selectedElements = state.elements.filter(element => selected.has(element.id));
      if (selectedElements.length < 2) return state;

      const bounds = selectedElements.map(element => ({
        element,
        bounds: getElementBounds(element),
      }));
      const minX = Math.min(...bounds.map(item => item.bounds.x));
      const minY = Math.min(...bounds.map(item => item.bounds.y));
      const maxX = Math.max(...bounds.map(item => item.bounds.x + item.bounds.width));
      const maxY = Math.max(...bounds.map(item => item.bounds.y + item.bounds.height));
      const nextById = new Map<string, DriplElement>();
      let changed = false;

      for (const { element, bounds: elementBounds } of bounds) {
        let deltaX = 0;
        let deltaY = 0;
        if (mode === 'left') deltaX = minX - elementBounds.x;
        if (mode === 'center') {
          deltaX = (minX + maxX) / 2 - (elementBounds.x + elementBounds.width / 2);
        }
        if (mode === 'right') deltaX = maxX - (elementBounds.x + elementBounds.width);
        if (mode === 'top') deltaY = minY - elementBounds.y;
        if (mode === 'middle') {
          deltaY = (minY + maxY) / 2 - (elementBounds.y + elementBounds.height / 2);
        }
        if (mode === 'bottom') deltaY = maxY - (elementBounds.y + elementBounds.height);
        if (deltaX === 0 && deltaY === 0) {
          nextById.set(element.id, element);
          continue;
        }
        const updated = mutateElement(element, { x: element.x + deltaX, y: element.y + deltaY });
        nextById.set(element.id, updated);
        changed ||= updated !== element;
      }

      if (!changed) return state;
      const nextElements = state.elements.map(element => nextById.get(element.id) ?? element);
      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );
      const historyPayload = commitPresentFromHistory(history.past, history.future);
      return {
        elements: nextElements,
        elementsById: buildElementsById(nextElements),
        spatialVersion: state.spatialVersion + 1,
        past: historyPayload.past,
        future: historyPayload.future,
      };
    }),

  distributeElements: axis =>
    set(state => {
      const selected = new Set(state.selectedIds);
      const selectedElements = state.elements.filter(element => selected.has(element.id));
      if (selectedElements.length < 3) return state;

      const ordered = selectedElements
        .map(element => ({ element, bounds: getElementBounds(element) }))
        .sort((a, b) =>
          axis === 'horizontal' ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y
        );
      const first = ordered[0]!.bounds;
      const last = ordered[ordered.length - 1]!.bounds;
      const totalSize = ordered.reduce(
        (sum, item) => sum + item.bounds.width + item.bounds.height,
        0
      );
      const outerSpan =
        axis === 'horizontal' ? last.x + last.width - first.x : last.y + last.height - first.y;
      const totalPrimarySize = ordered.reduce(
        (sum, item) => sum + (axis === 'horizontal' ? item.bounds.width : item.bounds.height),
        0
      );
      const gap = (outerSpan - totalPrimarySize) / (ordered.length - 1);
      const nextById = new Map<string, DriplElement>();
      let cursor = axis === 'horizontal' ? first.x : first.y;
      let changed = false;

      for (const item of ordered) {
        const current = axis === 'horizontal' ? item.bounds.x : item.bounds.y;
        const delta = cursor - current;
        if (delta === 0) {
          nextById.set(item.element.id, item.element);
        } else {
          const updated = mutateElement(
            item.element,
            axis === 'horizontal' ? { x: item.element.x + delta } : { y: item.element.y + delta }
          );
          nextById.set(item.element.id, updated);
          changed ||= updated !== item.element;
        }
        cursor += (axis === 'horizontal' ? item.bounds.width : item.bounds.height) + gap;
      }

      if (!changed || !Number.isFinite(totalSize) || !Number.isFinite(gap)) return state;
      const nextElements = state.elements.map(element => nextById.get(element.id) ?? element);
      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );
      const historyPayload = commitPresentFromHistory(history.past, history.future);
      return {
        elements: nextElements,
        elementsById: buildElementsById(nextElements),
        spatialVersion: state.spatialVersion + 1,
        past: historyPayload.past,
        future: historyPayload.future,
      };
    }),

  setSelectedIds: selectedIds => set({ selectedIds }),
  selectElement: (id, addToSelection = false) =>
    set(state => {
      const selectedIds = new Set(addToSelection ? state.selectedIds : []);
      selectedIds.add(id);
      return { selectedIds };
    }),
  clearSelection: () => set({ selectedIds: new Set<string>() }),
  setActiveTool: activeTool => set({ activeTool }),
  setToolLocked: toolLocked => set({ toolLocked }),

  setCurrentStrokeColor: currentStrokeColor => set({ currentStrokeColor }),
  setCurrentBackgroundColor: currentBackgroundColor => set({ currentBackgroundColor }),
  setCurrentStrokeWidth: currentStrokeWidth => set({ currentStrokeWidth }),
  setCurrentRoughness: currentRoughness => set({ currentRoughness }),
  setCurrentStrokeStyle: currentStrokeStyle => set({ currentStrokeStyle }),
  setCurrentFillStyle: currentFillStyle => set({ currentFillStyle }),
  setCurrentArrowStyle: currentArrowStyle => set({ currentArrowStyle }),

  setDraftElement: element =>
    set({
      draftElement: element,
      drawingLifecycle: element ? 'drawing' : 'idle',
    }),

  updateDraftElement: updates =>
    set(state => ({
      draftElement:
        state.draftElement !== null
          ? ({ ...state.draftElement, ...updates } as DriplElement)
          : null,
    })),

  commitDraft: () => {
    const state = get();
    const draft = state.draftElement;
    if (!draft) return null;
    if (state.elements.some(element => element.id === draft.id)) {
      set({ draftElement: null, drawingLifecycle: 'idle' });
      return null;
    }

    const history = withHistoryBeforeMutation(
      { past: state.past, future: state.future },
      state.elements
    );

    const committed: DriplElement = {
      ...draft,
      fractionalIndex: draft.fractionalIndex ?? generateFractionalIndexAfterAll(state.elements),
      version: (draft.version ?? 0) + 1,
      versionNonce: Math.floor(Math.random() * 2_147_483_647),
      updated: Date.now(),
    };
    clearShapeFromCache(committed);
    invalidateElementCache(committed.id);
    const elements = sortElementsByZIndex([...state.elements, committed]);
    const historyPayload = commitPresentFromHistory(history.past, history.future);

    set({
      elements,
      elementsById: buildElementsById(elements),
      draftElement: null,
      drawingLifecycle: 'idle',
      past: historyPayload.past,
      future: historyPayload.future,
      spatialVersion: state.spatialVersion + 1,
    });
    return committed;
  },

  setDrawingLifecycle: drawingLifecycle => set({ drawingLifecycle }),
  setEditingElementId: isEditingElementId => set({ isEditingElementId }),

  setZoom: zoom => set({ zoom: Math.max(0.1, Math.min(20, zoom)) }),
  setPan: (panX, panY) => set({ panX, panY }),
  setViewport: (zoom, panX, panY) => set({ zoom: Math.max(0.1, Math.min(20, zoom)), panX, panY }),
  setShouldCacheIgnoreZoom: shouldCacheIgnoreZoom => set({ shouldCacheIgnoreZoom }),
  setPendingEmbed: (url, title) => set({ pendingEmbed: { url, title } }),
  clearPendingEmbed: () => set({ pendingEmbed: null }),
  setGridEnabled: gridEnabled => set({ gridEnabled }),
  setGridSize: gridSize => set({ gridSize: Math.max(4, gridSize) }),
  setMarqueeSelectionMode: mode => set({ marqueeSelectionMode: mode }),

  setClipboard: elements => set({ clipboard: elements }),
  clearClipboard: () => set({ clipboard: [] }),

  // Drawing state (moved from RoughCanvas local state)
  isDrawing: false,
  marqueeSelection: null,
  eraserPath: [],
  cursorPosition: null,

  setIsDrawing: isDrawing => set({ isDrawing }),
  setMarqueeSelection: marqueeSelection => set({ marqueeSelection }),
  setEraserPath: eraserPath =>
    set(state => ({
      eraserPath: typeof eraserPath === 'function' ? eraserPath(state.eraserPath) : eraserPath,
    })),
  setCursorPosition: cursorPosition => set({ cursorPosition }),

  // Helper functions (moved from RoughCanvas)
  expandSelectionWithGroups: (ids, sceneElements) => {
    const expanded = new Set(ids);
    if (ids.size === 0) return expanded;

    const groupIds = new Set<string>();
    sceneElements.forEach(element => {
      if (ids.has(element.id) && element.groupId) {
        groupIds.add(element.groupId);
      }
    });

    if (groupIds.size === 0) return expanded;

    sceneElements.forEach(element => {
      if (element.groupId && groupIds.has(element.groupId)) {
        expanded.add(element.id);
      }
    });

    return expanded;
  },

  getSelectionBounds: (selected, sceneElements) => {
    const selectedElements = sceneElements.filter(element => selected.has(element.id));
    if (selectedElements.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    selectedElements.forEach(element => {
      const bounds = getElementBounds(element);
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      maxY = Math.max(maxY, bounds.y + bounds.height);
    });

    return { minX, minY, maxX, maxY };
  },

  collectCascadeDeleteIds: seedIds => {
    const state = get();
    return collectCascadeDeleteIds(seedIds, state.elements);
  },

  groupElements: ids =>
    set(state => {
      if (ids.length < 2) return state;
      const idSet = new Set(ids);
      const groupId = crypto.randomUUID();

      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );

      const nextElements = state.elements.map(element => {
        if (idSet.has(element.id)) {
          // Use mutateElement to bump version and invalidate caches
          return mutateElement(element, { groupId });
        }
        return element;
      });

      const historyPayload = commitPresentFromHistory(history.past, history.future);

      return {
        elements: nextElements,
        elementsById: buildElementsById(nextElements),
        past: historyPayload.past,
        future: historyPayload.future,
      };
    }),

  ungroupElements: ids =>
    set(state => {
      if (ids.length === 0) return state;

      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );

      const nextElements = state.elements.map(element => {
        if (ids.includes(element.id) && element.groupId) {
          /* eslint-disable @typescript-eslint/no-unused-vars -- groupId is
             destructured out to ungroup the element */
          const { groupId, ...rest } = element;
          /* eslint-enable @typescript-eslint/no-unused-vars */
          const updated = {
            ...rest,
            version: (rest.version ?? 0) + 1,
            versionNonce: Math.floor(Math.random() * 2000000000),
            updated: Date.now(),
          } as DriplElement;
          // Invalidate caches for the updated element
          invalidateElementCache(element.id);
          clearShapeFromCache(element);
          return updated;
        }
        return element;
      });

      const historyPayload = commitPresentFromHistory(history.past, history.future);

      return {
        elements: nextElements,
        elementsById: buildElementsById(nextElements),
        past: historyPayload.past,
        future: historyPayload.future,
      };
    }),
});
