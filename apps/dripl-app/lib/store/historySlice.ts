import type { StateCreator } from 'zustand';
import { invalidateElementCache } from '@dripl/element/staticScene';
import type { CanvasStoreState, HistorySlice } from './types';
import {
  cloneElements,
  buildElementsById,
  pushPast,
  withHistoryBeforeMutation,
  commitPresentFromHistory,
} from './helpers';

const MAX_HISTORY = 100;

export const createHistorySlice: StateCreator<CanvasStoreState, [], [], HistorySlice> = (set) => ({
  past: [],
  future: [],

  undo: () =>
    set(state => {
      if (state.past.length === 0) return state;

      const previous = state.past[state.past.length - 1];
      if (!previous) return state;

      const past = state.past.slice(0, -1);
      const future = [cloneElements(state.elements), ...state.future].slice(0, MAX_HISTORY);
      // History snapshots are already cloned by pushPast(); shallow-copy the array only
      const elements = [...previous];
      const historyPayload = commitPresentFromHistory(past, future);

      elements.forEach(element => invalidateElementCache(element.id));

      return {
        elements,
        elementsById: buildElementsById(elements),
        past: historyPayload.past,
        future: historyPayload.future,
      };
    }),

  redo: () =>
    set(state => {
      if (state.future.length === 0) return state;

      const next = state.future[0];
      if (!next) return state;

      const future = state.future.slice(1);
      const past = pushPast(state.past, state.elements);
      // History snapshots are already cloned by pushPast(); shallow-copy the array only
      const elements = [...next];
      const historyPayload = commitPresentFromHistory(past, future);

      elements.forEach(element => invalidateElementCache(element.id));

      return {
        elements,
        elementsById: buildElementsById(elements),
        past: historyPayload.past,
        future: historyPayload.future,
      };
    }),

  pushHistory: () =>
    set(state => {
      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements
      );
      const historyPayload = commitPresentFromHistory(history.past, history.future);
      return {
        past: historyPayload.past,
        future: historyPayload.future,
      };
    }),

  clearHistory: () =>
    set(() => {
      return {
        past: [],
        future: [],
      };
    }),
});
