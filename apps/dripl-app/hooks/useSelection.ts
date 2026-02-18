import { useState, useCallback } from "react";
import type { DriplElement, Point } from "@dripl/common";
import { isPointInElement } from "@/utils/canvasUtils";

interface UseSelectionProps {
  elements: DriplElement[];
  setElements: React.Dispatch<React.SetStateAction<DriplElement[]>>;
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
      const clickedElement = [...elements]
        .reverse()
        .find((el) => isPointInElement(point, el));

      if (clickedElement) {
        if (isShiftKey) {
          setSelectedIds((prev) =>
            prev.includes(clickedElement.id)
              ? prev.filter((id) => id !== clickedElement.id)
              : [...prev, clickedElement.id],
          );
        } else {
          if (!selectedIds.includes(clickedElement.id)) {
            setSelectedIds([clickedElement.id]);
          }
        }
      } else {
        setSelectedIds([]);
      }

      return clickedElement;
    },
    [elements, selectedIds],
  );

  const deleteSelected = useCallback(() => {
    if (selectedIds.length > 0) {
      setElements((prev) => prev.filter((el) => !selectedIds.includes(el.id)));
      setSelectedIds([]);
      return true;
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
