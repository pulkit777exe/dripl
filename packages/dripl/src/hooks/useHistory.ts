import { useCallback, useRef } from "react";
import { CanvasHistory, type HistoryState } from "../utils/history";
import type { DriplElement } from "@dripl/common";

export interface UseHistoryOptions {
  maxHistorySize?: number;
}

export interface UseHistoryReturn {
  push: (elements: readonly DriplElement[]) => void;
  undo: () => HistoryState | null;
  redo: () => HistoryState | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
  getCurrentState: () => HistoryState | null;
  getHistoryLength: () => number;
  getRedoLength: () => number;
}

export function useHistory(options: UseHistoryOptions = {}): UseHistoryReturn {
  const { maxHistorySize = 50 } = options;
  
  const historyRef = useRef<CanvasHistory | null>(null);
  
  const getHistory = useCallback(() => {
    if (!historyRef.current) {
      historyRef.current = new CanvasHistory(maxHistorySize);
    }
    return historyRef.current;
  }, [maxHistorySize]);

  const push = useCallback((elements: readonly DriplElement[]) => {
    getHistory().push(elements);
  }, [getHistory]);

  const undo = useCallback(() => {
    return getHistory().undo();
  }, [getHistory]);

  const redo = useCallback(() => {
    return getHistory().redo();
  }, [getHistory]);

  const canUndo = useCallback(() => {
    return getHistory().canUndo();
  }, [getHistory]);

  const canRedo = useCallback(() => {
    return getHistory().canRedo();
  }, [getHistory]);

  const clear = useCallback(() => {
    getHistory().clear();
  }, [getHistory]);

  const getCurrentState = useCallback(() => {
    return getHistory().getCurrentState();
  }, [getHistory]);

  const getHistoryLength = useCallback(() => {
    return getHistory().getHistoryLength();
  }, [getHistory]);

  const getRedoLength = useCallback(() => {
    return getHistory().getRedoLength();
  }, [getHistory]);

  return {
    push,
    undo,
    redo,
    canUndo,
    canRedo,
    clear,
    getCurrentState,
    getHistoryLength,
    getRedoLength,
  };
}

export default useHistory;