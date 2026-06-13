import type { StateCreator } from 'zustand';
import type { DriplElement, LinearElement } from '@dripl/common';
import { collectCascadeDeleteIds } from '@dripl/common/cascade-delete';
import { generateKeyBetween } from 'fractional-indexing';
import { invalidateElementCache } from '@dripl/element/staticScene';
import { clearShapeFromCache, clearAllShapeCache } from '@dripl/element/shape-cache';
import { getElementBounds } from '@dripl/math/intersection';
import type { CanvasStoreState, CanvasSlice } from './types';
import {
  cloneElements,
  sortedInsert,
  sortByFractionalIndex,
  buildElementsById,
  ensureFractionalIndexes,
  generateFractionalIndexAfterAll,
  generateFractionalIndexBeforeAll,
  withHistoryBeforeMutation,
  commitPresentFromHistory,
} from './helpers';
import { unbindAffectedByDeletion, unbindArrowFromElement } from '@/utils/arrow-binding';

export const createCanvasSlice: StateCreator<CanvasStoreState, [], [], CanvasSlice> = (set, get) => ({
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
  drawingLifecycle: 'idle',
  draftElement: null,
  isEditingElementId: null,
  clipboard: [],

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
        const sorted = sortByFractionalIndex(withIndexes);
        const next = cloneElements(sorted);
        return { elements: next, elementsById: buildElementsById(next) };
      }
      clearAllShapeCache();
      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );
      const withIndexes = ensureFractionalIndexes(elements);
      const sorted = sortByFractionalIndex(withIndexes);
      const nextElements = cloneElements(sorted);
      const historyPayload = commitPresentFromHistory(history.past, history.future);
      return {
        elements: nextElements,
        elementsById: buildElementsById(nextElements),
        past: historyPayload.past,
        future: historyPayload.future,
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
      const withIndex = element.fractionalIndex != null
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
      let currentElements = state.elements;
      const nextMap = new Map(state.elementsById);
      for (const el of deduped) {
        const withIndex = el.fractionalIndex != null
          ? el
          : { ...el, fractionalIndex: generateFractionalIndexAfterAll(currentElements) };
        currentElements = sortedInsert(currentElements, withIndex);
        nextMap.set(withIndex.id, withIndex);
      }
      const historyPayload = commitPresentFromHistory(history.past, history.future);

      return {
        elements: currentElements,
        elementsById: nextMap,
        past: historyPayload.past,
        future: historyPayload.future,
      };
    }),

  updateElement: (id, updates) =>
    set(state => {
      const previous = state.elementsById.get(id);
      if (!previous) return state;

      invalidateElementCache(id);
      clearShapeFromCache(previous);

      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );
      const updated: DriplElement = {
        ...previous,
        ...updates,
        version: (previous.version ?? 0) + 1,
        versionNonce: Math.floor(Math.random() * 2_147_483_647),
        updated: Date.now(),
      } as DriplElement;

      const nextElements = state.elements.map(e => (e.id === id ? updated : e));
      const nextMap = new Map(state.elementsById);
      nextMap.set(id, updated);
      const historyPayload = commitPresentFromHistory(history.past, history.future);
      return {
        elements: nextElements,
        elementsById: nextMap,
        past: historyPayload.past,
        future: historyPayload.future,
      };
    }),

  updateElementTransient: (id, updates) =>
    set(state => {
      const previous = state.elementsById.get(id);
      if (!previous) return state;

      const updated = {
        ...previous,
        ...updates,
      } as DriplElement;

      const nextElements = state.elements.map(e => (e.id === id ? updated : e));
      const nextMap = new Map(state.elementsById);
      nextMap.set(id, updated);

      return {
        elements: nextElements,
        elementsById: nextMap,
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
      };
    }),

  bringForward: ids =>
    set(state => {
      if (ids.length === 0) return state;
      const selected = new Set(ids);
      const sorted = sortByFractionalIndex(state.elements);
      const nextElements = sorted.map(el => ({ ...el }));
      let changed = false;

      for (let i = nextElements.length - 2; i >= 0; i -= 1) {
        const current = nextElements[i];
        const above = nextElements[i + 1];
        if (!current || !above) continue;
        if (selected.has(current.id) && !selected.has(above.id)) {
          const newIdx = generateKeyBetween(
            above.fractionalIndex ?? null,
            (i + 2 < nextElements.length ? nextElements[i + 2]?.fractionalIndex : null) ?? null,
          );
          current.fractionalIndex = newIdx;
          changed = true;
        }
      }
      if (!changed) return state;

      const reordered = sortByFractionalIndex(nextElements);
      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );
      const historyPayload = commitPresentFromHistory(history.past, history.future);
      return {
        elements: reordered,
        elementsById: buildElementsById(reordered),
        past: historyPayload.past,
        future: historyPayload.future,
      };
    }),

  sendBackward: ids =>
    set(state => {
      if (ids.length === 0) return state;
      const selected = new Set(ids);
      const sorted = sortByFractionalIndex(state.elements);
      const nextElements = sorted.map(el => ({ ...el }));
      let changed = false;

      for (let i = 1; i < nextElements.length; i += 1) {
        const current = nextElements[i];
        const below = nextElements[i - 1];
        if (!current || !below) continue;
        if (selected.has(current.id) && !selected.has(below.id)) {
          const newIdx = generateKeyBetween(
            (i - 2 >= 0 ? nextElements[i - 2]?.fractionalIndex : null) ?? null,
            below.fractionalIndex ?? null,
          );
          current.fractionalIndex = newIdx;
          changed = true;
        }
      }
      if (!changed) return state;

      const reordered = sortByFractionalIndex(nextElements);
      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );
      const historyPayload = commitPresentFromHistory(history.past, history.future);
      return {
        elements: reordered,
        elementsById: buildElementsById(reordered),
        past: historyPayload.past,
        future: historyPayload.future,
      };
    }),

  bringToFront: ids =>
    set(state => {
      if (ids.length === 0) return state;
      const selected = new Set(ids);
      const sorted = sortByFractionalIndex(state.elements);
      const moving = sorted.filter(el => selected.has(el.id));
      if (moving.length === 0) return state;

      const newFrontier = generateFractionalIndexAfterAll(sorted);
      const nextElements = sorted.map(el => {
        if (selected.has(el.id)) {
          const idx = generateKeyBetween(newFrontier, null);
          return { ...el, fractionalIndex: idx };
        }
        return { ...el };
      });

      const reordered = sortByFractionalIndex(nextElements);
      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );
      const historyPayload = commitPresentFromHistory(history.past, history.future);
      return {
        elements: reordered,
        elementsById: buildElementsById(reordered),
        past: historyPayload.past,
        future: historyPayload.future,
      };
    }),

  sendToBack: ids =>
    set(state => {
      if (ids.length === 0) return state;
      const selected = new Set(ids);
      const sorted = sortByFractionalIndex(state.elements);
      const moving = sorted.filter(el => selected.has(el.id));
      if (moving.length === 0) return state;

      const newBackier = generateFractionalIndexBeforeAll(sorted);
      const nextElements = sorted.map(el => {
        if (selected.has(el.id)) {
          const idx = generateKeyBetween(null, newBackier);
          return { ...el, fractionalIndex: idx };
        }
        return { ...el };
      });

      const reordered = sortByFractionalIndex(nextElements);
      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );
      const historyPayload = commitPresentFromHistory(history.past, history.future);
      return {
        elements: reordered,
        elementsById: buildElementsById(reordered),
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
    const elements = sortByFractionalIndex([...state.elements, committed]);
    const historyPayload = commitPresentFromHistory(history.past, history.future);

    set({
      elements,
      elementsById: buildElementsById(elements),
      draftElement: null,
      drawingLifecycle: 'idle',
      past: historyPayload.past,
      future: historyPayload.future,
    });
    return committed;
  },

  setDrawingLifecycle: drawingLifecycle => set({ drawingLifecycle }),
  setEditingElementId: isEditingElementId => set({ isEditingElementId }),

  setZoom: zoom => set({ zoom: Math.max(0.1, Math.min(20, zoom)) }),
  setPan: (panX, panY) => set({ panX, panY }),
  setViewport: (zoom, panX, panY) => set({ zoom: Math.max(0.1, Math.min(20, zoom)), panX, panY }),
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
          return {
            ...element,
            groupId,
            version: (element.version ?? 0) + 1,
            versionNonce: Math.floor(Math.random() * 2000000000),
            updated: Date.now(),
          } as DriplElement;
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
          const { groupId, ...rest } = element;
          return {
            ...rest,
            version: (rest.version ?? 0) + 1,
            versionNonce: Math.floor(Math.random() * 2000000000),
            updated: Date.now(),
          } as DriplElement;
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
