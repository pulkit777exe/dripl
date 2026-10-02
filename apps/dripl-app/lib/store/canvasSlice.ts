import type { StateCreator } from 'zustand';
import type { DriplElement } from '@dripl/common';
import { invalidateElementCache } from '@dripl/element/staticScene';
import { sortElementsByZIndex } from '@/utils/zIndexUtils';
import { clearShapeFromCache } from '@dripl/element/shape-cache';
import type { CanvasStoreState, CanvasSlice } from './types';
import {
  buildElementsById,
  generateFractionalIndexAfterAll,
  withHistoryBeforeMutation,
  commitPresentFromHistory,
} from './helpers';
import { createElementActions } from './elementActions';
import { createArrangeActions } from './arrangeActions';
import {
  expandSelectionWithGroups as expandSelection,
  getSelectionBounds as selectionBounds,
} from './selection';

/**
 * Canvas slice — composition root for element state.
 *
 * Element CRUD lives in `elementActions.ts`, z-order/alignment/grouping in
 * `arrangeActions.ts`, pure selection math in `selection.ts`. This module
 * keeps initial state plus the one-line setters, draft lifecycle, and the
 * delegation wrappers, then spreads the composed factories below.
 */

export const createCanvasSlice: StateCreator<CanvasStoreState, [], [], CanvasSlice> = (
  set,
  get,
  api
) => ({
  ...createElementActions(set, get, api),
  ...createArrangeActions(set, get, api),

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
  canvasBackground: null,
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
  setCanvasBackground: canvasBackground => set({ canvasBackground }),
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

  // Pure selection helpers live in ./selection; thin wrappers keep the
  // `state.*` call sites (pointer events) untouched.
  expandSelectionWithGroups: (ids, sceneElements) => expandSelection(ids, sceneElements),

  getSelectionBounds: (selected, sceneElements) => selectionBounds(selected, sceneElements),
});
