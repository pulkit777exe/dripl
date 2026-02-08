"use client";

import { useCallback } from "react";
import type { DriplElement } from "@dripl/common";
import {
  duplicateElement,
  duplicateElements,
  duplicateElementWithBoundText,
  duplicateGroupWithBoundText,
  smartDuplicateElements,
  duplicateSymmetrically,
} from "@/utils/duplicationUtils";

export interface UseDuplicationReturn {
  duplicateElement: (element: DriplElement) => DriplElement;
  duplicateElements: (selectedIds: string[]) => DriplElement[];
  duplicateElementWithBoundText: (element: DriplElement) => DriplElement[];
  duplicateGroupWithBoundText: (groupId: string) => DriplElement[];
  smartDuplicateElements: (
    selectedIds: string[],
    previousOffset?: number,
  ) => DriplElement[];
  duplicateSymmetrically: (
    selectedIds: string[],
    axis?: "horizontal" | "vertical",
    offset?: number,
  ) => DriplElement[];
}

export function useDuplication(
  elements: DriplElement[],
  onElementsChange: (newElements: DriplElement[]) => void,
): UseDuplicationReturn {
  const duplicateElementCallback = useCallback(
    (element: DriplElement) => {
      const duplicate = duplicateElement(element);
      onElementsChange([...elements, duplicate]);
      return duplicate;
    },
    [elements, onElementsChange],
  );

  const duplicateElementsCallback = useCallback(
    (selectedIds: string[]) => {
      const newElements = duplicateElements(elements, selectedIds);
      onElementsChange(newElements);
      return newElements;
    },
    [elements, onElementsChange],
  );

  const duplicateElementWithBoundTextCallback = useCallback(
    (element: DriplElement) => {
      const duplicates = duplicateElementWithBoundText(element, elements);
      onElementsChange([...elements, ...duplicates]);
      return duplicates;
    },
    [elements, onElementsChange],
  );

  const duplicateGroupWithBoundTextCallback = useCallback(
    (groupId: string) => {
      const duplicates = duplicateGroupWithBoundText(elements, groupId);
      onElementsChange([...elements, ...duplicates]);
      return duplicates;
    },
    [elements, onElementsChange],
  );

  const smartDuplicateElementsCallback = useCallback(
    (selectedIds: string[], previousOffset?: number) => {
      const newElements = smartDuplicateElements(
        elements,
        selectedIds,
        previousOffset,
      );
      onElementsChange(newElements);
      return newElements;
    },
    [elements, onElementsChange],
  );

  const duplicateSymmetricallyCallback = useCallback(
    (
      selectedIds: string[],
      axis?: "horizontal" | "vertical",
      offset?: number,
    ) => {
      const newElements = duplicateSymmetrically(
        elements,
        selectedIds,
        axis,
        offset,
      );
      onElementsChange(newElements);
      return newElements;
    },
    [elements, onElementsChange],
  );

  return {
    duplicateElement: duplicateElementCallback,
    duplicateElements: duplicateElementsCallback,
    duplicateElementWithBoundText: duplicateElementWithBoundTextCallback,
    duplicateGroupWithBoundText: duplicateGroupWithBoundTextCallback,
    smartDuplicateElements: smartDuplicateElementsCallback,
    duplicateSymmetrically: duplicateSymmetricallyCallback,
  };
}
