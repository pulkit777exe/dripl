"use client";

import { useCallback } from "react";
import type { DriplElement } from "@dripl/common";
import {
  sortElementsByZIndex,
  bringToFront,
  sendToBack,
  bringForward,
  sendBackward,
  getZIndexRange,
  normalizeZIndices,
} from "@/utils/zIndexUtils";

export interface UseZIndexManagementReturn {
  sortedElements: DriplElement[];
  bringToFront: (elementId: string) => void;
  sendToBack: (elementId: string) => void;
  bringForward: (elementId: string) => void;
  sendBackward: (elementId: string) => void;
  getZIndexRange: (elementIds: string[]) => { min: number; max: number };
  normalizeZIndices: () => void;
}

export function useZIndexManagement(
  elements: DriplElement[],
  onElementsChange: (newElements: DriplElement[]) => void
): UseZIndexManagementReturn {
  const sortedElements = sortElementsByZIndex(elements);

  const handleUpdate = useCallback(
    (newElements: DriplElement[]) => {
      onElementsChange(newElements);
    },
    [onElementsChange]
  );

  const bringToFrontCallback = useCallback(
    (elementId: string) => {
      const element = elements.find((el) => el.id === elementId);
      if (!element) return;

      const updatedElement = bringToFront(element, elements);
      const newElements = elements.map((el) =>
        el.id === elementId ? updatedElement : el
      );
      handleUpdate(newElements);
    },
    [elements, handleUpdate]
  );

  const sendToBackCallback = useCallback(
    (elementId: string) => {
      const element = elements.find((el) => el.id === elementId);
      if (!element) return;

      const updatedElement = sendToBack(element, elements);
      const newElements = elements.map((el) =>
        el.id === elementId ? updatedElement : el
      );
      handleUpdate(newElements);
    },
    [elements, handleUpdate]
  );

  const bringForwardCallback = useCallback(
    (elementId: string) => {
      const element = elements.find((el) => el.id === elementId);
      if (!element) return;

      const updatedElement = bringForward(element, elements);
      const newElements = elements.map((el) =>
        el.id === elementId ? updatedElement : el
      );
      handleUpdate(newElements);
    },
    [elements, handleUpdate]
  );

  const sendBackwardCallback = useCallback(
    (elementId: string) => {
      const element = elements.find((el) => el.id === elementId);
      if (!element) return;

      const updatedElement = sendBackward(element, elements);
      const newElements = elements.map((el) =>
        el.id === elementId ? updatedElement : el
      );
      handleUpdate(newElements);
    },
    [elements, handleUpdate]
  );

  const getZIndexRangeCallback = useCallback(
    (elementIds: string[]) => {
      const selectedElements = elements.filter((el) =>
        elementIds.includes(el.id)
      );
      return getZIndexRange(selectedElements);
    },
    [elements]
  );

  const normalizeZIndicesCallback = useCallback(() => {
    const normalizedElements = normalizeZIndices(elements);
    handleUpdate(normalizedElements);
  }, [elements, handleUpdate]);

  return {
    sortedElements,
    bringToFront: bringToFrontCallback,
    sendToBack: sendToBackCallback,
    bringForward: bringForwardCallback,
    sendBackward: sendBackwardCallback,
    getZIndexRange: getZIndexRangeCallback,
    normalizeZIndices: normalizeZIndicesCallback,
  };
}