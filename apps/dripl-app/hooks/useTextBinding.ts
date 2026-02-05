"use client";

import { useCallback } from "react";
import type { DriplElement, TextElement } from "@dripl/common";
import {
  hasBoundText,
  getBoundText,
  createBoundText,
  updateBoundTextPosition,
  updateAllBoundTextPositions,
  deleteBoundText,
  getElementsWithBoundText,
  createTextElement,
} from "@/utils/textBindingUtils";

export interface UseTextBindingReturn {
  hasBoundText: (element: DriplElement) => boolean;
  getBoundText: (element: DriplElement) => TextElement | null;
  createBoundText: (
    text: string,
    boundElement: DriplElement,
    baseProps?: Partial<TextElement>,
  ) => void;
  updateBoundTextPosition: (
    boundElement: DriplElement,
    textElement: TextElement,
  ) => void;
  updateAllBoundTextPositions: () => void;
  deleteBoundText: (elementId: string) => void;
  getElementsWithBoundText: () => Array<{
    element: DriplElement;
    boundText: TextElement | null;
  }>;
  createTextElement: (
    text: string,
    point: { x: number; y: number },
    baseProps?: Partial<TextElement>,
  ) => void;
}

export function useTextBinding(
  elements: DriplElement[],
  onElementsChange: (newElements: DriplElement[]) => void,
): UseTextBindingReturn {
  const hasBoundTextCallback = useCallback(
    (element: DriplElement) => hasBoundText(element, elements),
    [elements],
  );

  const getBoundTextCallback = useCallback(
    (element: DriplElement) => getBoundText(element, elements),
    [elements],
  );

  const createBoundTextCallback = useCallback(
    (
      text: string,
      boundElement: DriplElement,
      baseProps?: Partial<TextElement>,
    ) => {
      const newTextElement = createBoundText(text, boundElement, baseProps);
      onElementsChange([...elements, newTextElement]);
    },
    [elements, onElementsChange],
  );

  const updateBoundTextPositionCallback = useCallback(
    (boundElement: DriplElement, textElement: TextElement) => {
      const updatedTextElement = updateBoundTextPosition(
        boundElement,
        textElement,
      );
      onElementsChange(
        elements.map((el) =>
          el.id === textElement.id ? updatedTextElement : el,
        ),
      );
    },
    [elements, onElementsChange],
  );

  const updateAllBoundTextPositionsCallback = useCallback(() => {
    const updatedElements = updateAllBoundTextPositions(elements);
    onElementsChange(updatedElements);
  }, [elements, onElementsChange]);

  const deleteBoundTextCallback = useCallback(
    (elementId: string) => {
      const updatedElements = deleteBoundText(elementId, elements);
      onElementsChange(updatedElements);
    },
    [elements, onElementsChange],
  );

  const getElementsWithBoundTextCallback = useCallback(() => {
    return getElementsWithBoundText(elements);
  }, [elements]);

  const createTextElementCallback = useCallback(
    (
      text: string,
      point: { x: number; y: number },
      baseProps?: Partial<TextElement>,
    ) => {
      const newTextElement = createTextElement(text, point, baseProps);
      onElementsChange([...elements, newTextElement]);
    },
    [elements, onElementsChange],
  );

  return {
    hasBoundText: hasBoundTextCallback,
    getBoundText: getBoundTextCallback,
    createBoundText: createBoundTextCallback,
    updateBoundTextPosition: updateBoundTextPositionCallback,
    updateAllBoundTextPositions: updateAllBoundTextPositionsCallback,
    deleteBoundText: deleteBoundTextCallback,
    getElementsWithBoundText: getElementsWithBoundTextCallback,
    createTextElement: createTextElementCallback,
  };
}
