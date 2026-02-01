"use client";

import { useCallback, useState } from "react";
import type { DriplElement, Point } from "@dripl/common";
import { getElementAtPoint, getElementsInSelectionRect } from "@dripl/math";
import { Bounds } from "@dripl/math";

export interface MarqueeSelection {
  start: Point;
  end: Point;
  active: boolean;
}

export interface UseEnhancedSelectionReturn {
  selectedIds: Set<string>;
  marqueeSelection: MarqueeSelection | null;
  selectElement: (id: string, addToSelection?: boolean) => void;
  deselectAll: () => void;
  handleClickSelection: (point: Point, shiftKey: boolean) => DriplElement | null;
  startMarqueeSelection: (point: Point) => void;
  updateMarqueeSelection: (point: Point) => void;
  endMarqueeSelection: () => void;
  selectAll: () => void;
  deleteSelected: () => string[];
  getSelectedElements: (elements: DriplElement[]) => DriplElement[];
}

export function useEnhancedSelection(): UseEnhancedSelectionReturn {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [marqueeSelection, setMarqueeSelection] = useState<MarqueeSelection | null>(null);

  const selectElement = useCallback((id: string, addToSelection = false) => {
    setSelectedIds((prev) => {
      if (addToSelection) {
        const newSet = new Set(prev);
        if (newSet.has(id)) {
          newSet.delete(id);
        } else {
          newSet.add(id);
        }
        return newSet;
      } else {
        return new Set([id]);
      }
    });
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleClickSelection = useCallback(
    (point: Point, shiftKey: boolean): DriplElement | null => {
      return null;
    },
    []
  );

  const startMarqueeSelection = useCallback((point: Point) => {
    setMarqueeSelection({
      start: point,
      end: point,
      active: true,
    });
  }, []);

  const updateMarqueeSelection = useCallback((point: Point) => {
    setMarqueeSelection((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        end: point,
      };
    });
  }, []);

  const endMarqueeSelection = useCallback(() => {
    setMarqueeSelection((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        active: false,
      };
    });
  }, []);

  const selectAll = useCallback((elements: DriplElement[]) => {
    setSelectedIds(new Set(elements.map((el) => el.id)));
  }, []);

  const deleteSelected = useCallback(() => {
    const ids = Array.from(selectedIds);
    setSelectedIds(new Set());
    return ids;
  }, [selectedIds]);

  const getSelectedElements = useCallback(
    (elements: DriplElement[]) => {
      return elements.filter((el) => selectedIds.has(el.id));
    },
    [selectedIds]
  );

  return {
    selectedIds,
    marqueeSelection,
    selectElement,
    deselectAll,
    handleClickSelection,
    startMarqueeSelection,
    updateMarqueeSelection,
    endMarqueeSelection,
    selectAll: () => {
    },
    deleteSelected,
    getSelectedElements,
  };
}

export function handleClickSelectionWithElements(
  point: Point,
  elements: DriplElement[],
  shiftKey: boolean,
  selectedIds: Set<string>,
  setSelectedIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void
): DriplElement | null {
  const clickedElement = getElementAtPoint(point, elements);

  if (clickedElement) {
    if (shiftKey) {
      setSelectedIds((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(clickedElement.id)) {
          newSet.delete(clickedElement.id);
        } else {
          newSet.add(clickedElement.id);
        }
        return newSet;
      });
    } else {
      if (!selectedIds.has(clickedElement.id)) {
        setSelectedIds(new Set([clickedElement.id]));
      }
    }
    return clickedElement;
  } else {
    if (!shiftKey) {
      setSelectedIds(new Set());
    }
    return null;
  }
}

export function handleMarqueeSelectionEnd(
  marqueeSelection: MarqueeSelection | null,
  elements: DriplElement[],
  setSelectedIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void,
  shiftKey: boolean
): void {
  if (!marqueeSelection || !marqueeSelection.active) return;

  const selectionRect: Bounds = {
    x: Math.min(marqueeSelection.start.x, marqueeSelection.end.x),
    y: Math.min(marqueeSelection.start.y, marqueeSelection.end.y),
    width: Math.abs(marqueeSelection.end.x - marqueeSelection.start.x),
    height: Math.abs(marqueeSelection.end.y - marqueeSelection.start.y),
  };

  const elementsInRect = getElementsInSelectionRect(selectionRect, elements);

  if (shiftKey) {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      elementsInRect.forEach((el) => newSet.add(el.id));
      return newSet;
    });
  } else {
    setSelectedIds(new Set(elementsInRect.map((el) => el.id)));
  }
}
