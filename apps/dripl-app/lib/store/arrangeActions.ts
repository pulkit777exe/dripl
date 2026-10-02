import type { StateCreator } from 'zustand';
import type { DriplElement } from '@dripl/common';
import { generateKeyBetween } from 'fractional-indexing';
import { invalidateElementCache } from '@dripl/element/staticScene';
import { clearShapeFromCache } from '@dripl/element/shape-cache';
import { sortElementsByZIndex } from '@/utils/zIndexUtils';
import { mutateElement } from '@dripl/element/mutateElement';
import { getElementBounds } from '@dripl/math/intersection';
import type { CanvasStoreState, CanvasSlice } from './types';
import {
  buildElementsById,
  generateFractionalIndexAfterAll,
  generateFractionalIndexBeforeAll,
  withHistoryBeforeMutation,
  commitPresentFromHistory,
} from './helpers';

/**
 * Arrange actions — extracted from `canvasSlice.ts`.
 *
 * Z-order (fractional-index), alignment, distribution, and grouping. All
 * mutations go through history and rebuild the id map, matching the CRUD
 * conventions in `elementActions.ts`.
 */
export const createArrangeActions: StateCreator<
  CanvasStoreState,
  [],
  [],
  Pick<
    CanvasSlice,
    | 'bringForward'
    | 'sendBackward'
    | 'bringToFront'
    | 'sendToBack'
    | 'alignElements'
    | 'distributeElements'
    | 'groupElements'
    | 'ungroupElements'
  >
> = (set, _get) => ({
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
          // Omit groupId to ungroup the element (rest siblings are ignored by the unused-vars rule).
          const { groupId: _omittedGroupId, ...rest } = element;
          void _omittedGroupId;
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
