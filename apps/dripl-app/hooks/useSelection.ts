import { useState, useCallback } from "react";
import { CanvasElement, Point } from "@/types/canvas";
import { isPointInElement } from "@/utils/canvasUtils";

interface UseSelectionProps {
  elements: CanvasElement[];
  setElements: React.Dispatch<React.SetStateAction<CanvasElement[]>>;
}

export const useSelection = ({ elements, setElements }: UseSelectionProps) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const selectElement = useCallback((id: string, multi: boolean = false) => {
    setSelectedIds((prev) => {
      if (multi) {
        return prev.includes(id)
          ? prev.filter((pid) => pid !== id)
          : [...prev, id];
      }
      return [id];
    });
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const handleSelection = useCallback(
    (point: Point, isShiftKey: boolean) => {
      // Find clicked element (reverse to find top-most first)
      const clickedElement = [...elements]
        .reverse()
        .find((el) => isPointInElement(point, el));

      if (clickedElement) {
        if (isShiftKey) {
          // Toggle selection
          setSelectedIds((prev) =>
            prev.includes(clickedElement.id)
              ? prev.filter((id) => id !== clickedElement.id)
              : [...prev, clickedElement.id]
          );
        } else {
          // Select single if not already selected
          if (!selectedIds.includes(clickedElement.id)) {
            setSelectedIds([clickedElement.id]);
          }
        }
      } else {
        // Deselect all if clicked empty space
        setSelectedIds([]);
      }

      return clickedElement;
    },
    [elements, selectedIds]
  );

  const deleteSelected = useCallback(() => {
    if (selectedIds.length > 0) {
      setElements((prev) => prev.filter((el) => !selectedIds.includes(el.id)));
      setSelectedIds([]);
      return true; // Deleted something
    }
    return false;
  }, [selectedIds, setElements]);

  const selectAll = useCallback(() => {
    setSelectedIds(elements.map((el) => el.id));
  }, [elements]);

  return {
    selectedIds,
    setSelectedIds,
    selectElement,
    deselectAll,
    handleSelection,
    deleteSelected,
    selectAll,
  };
};
