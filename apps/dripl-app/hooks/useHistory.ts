import { useRef, useCallback } from "react";
import { CanvasElement } from "@/types/canvas";
import { CanvasHistory } from "@/utils/canvasHistory";

interface UseHistoryProps {
  setElements: (elements: CanvasElement[]) => void;
  setSelectedIds: (ids: string[]) => void;
}

export const useHistory = ({
  setElements,
  setSelectedIds,
}: UseHistoryProps) => {
  const historyRef = useRef(new CanvasHistory());

  const saveHistory = useCallback(
    (elements: CanvasElement[], selectedIds: string[]) => {
      historyRef.current.pushState({ elements, selectedIds });
    },
    []
  );

  const undo = useCallback(() => {
    const state = historyRef.current.undo();
    if (state) {
      setElements(state.elements);
      setSelectedIds(state.selectedIds);
    }
  }, [setElements, setSelectedIds]);

  const redo = useCallback(() => {
    const state = historyRef.current.redo();
    if (state) {
      setElements(state.elements);
      setSelectedIds(state.selectedIds);
    }
  }, [setElements, setSelectedIds]);

  const canUndo = useCallback(() => historyRef.current.canUndo(), []);
  const canRedo = useCallback(() => historyRef.current.canRedo(), []);
  const clearHistory = useCallback(() => historyRef.current.clear(), []);

  return {
    saveHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    clearHistory,
    historyRef,
  };
};
