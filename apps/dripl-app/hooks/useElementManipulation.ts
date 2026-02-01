"use client";

import { useCallback } from "react";
import type { DriplElement, Point } from "@dripl/common";
import { v4 as uuidv4 } from "uuid";

export interface UseElementManipulationProps {
  elements: DriplElement[];
  selectedIds: Set<string>;
  updateElement: (id: string, updates: Partial<DriplElement>) => void;
  addElement: (element: DriplElement) => void;
  deleteElements: (ids: string[]) => void;
  pushHistory: () => void;
  send?: (message: any) => void;
}

export interface UseElementManipulationReturn {
  moveElements: (delta: Point, elementIds?: string[]) => void;
  resizeElement: (
    elementId: string,
    handle: string,
    newPoint: Point,
    shiftKey: boolean
  ) => void;
  rotateElement: (elementId: string, angle: number, shiftKey: boolean) => void;
  duplicateElements: (elementIds?: string[]) => void;
  deleteSelectedElements: () => void;
}

export function useElementManipulation({
  elements,
  selectedIds,
  updateElement,
  addElement,
  deleteElements,
  pushHistory,
  send,
}: UseElementManipulationProps): UseElementManipulationReturn {
  const moveElements = useCallback(
    (delta: Point, elementIds?: string[]) => {
      const idsToMove = elementIds || Array.from(selectedIds);
      let hasChanges = false;

      idsToMove.forEach((id) => {
        const element = elements.find((el) => el.id === id);
        if (!element) return;

        const updatedElement: DriplElement = {
          ...element,
          x: element.x + delta.x,
          y: element.y + delta.y,
        };

        if ("points" in updatedElement && updatedElement.points) {
          updatedElement.points = updatedElement.points.map((p: { x: number; y: number }) => ({
            x: p.x + delta.x,
            y: p.y + delta.y,
          }));
        }

        updateElement(id, updatedElement);
        send?.({
          type: "update_element",
          element: updatedElement,
          timestamp: Date.now(),
        });
        hasChanges = true;
      });

      if (hasChanges) {
        pushHistory();
      }
    },
    [elements, selectedIds, updateElement, pushHistory, send]
  );

  const resizeElement = useCallback(
    (
      elementId: string,
      handle: string,
      newPoint: Point,
      shiftKey: boolean
    ) => {
      const element = elements.find((el) => el.id === elementId);
      if (!element) return;

      let newX = element.x;
      let newY = element.y;
      let newWidth = element.width;
      let newHeight = element.height;

      switch (handle) {
        case "se": // South-east
          newWidth = Math.max(1, newPoint.x - element.x);
          newHeight = Math.max(1, newPoint.y - element.y);
          if (shiftKey) {
            const size = Math.max(newWidth, newHeight);
            newWidth = size;
            newHeight = size;
          }
          break;
        case "sw":
          newWidth = Math.max(1, element.x + element.width - newPoint.x);
          newX = element.x + element.width - newWidth;
          newHeight = Math.max(1, newPoint.y - element.y);
          if (shiftKey) {
            const size = Math.max(newWidth, newHeight);
            newWidth = size;
            newHeight = size;
            newX = element.x + element.width - newWidth;
          }
          break;
        case "ne":
          newWidth = Math.max(1, newPoint.x - element.x);
          newHeight = Math.max(1, element.y + element.height - newPoint.y);
          newY = element.y + element.height - newHeight;
          if (shiftKey) {
            const size = Math.max(newWidth, newHeight);
            newWidth = size;
            newHeight = size;
            newY = element.y + element.height - newHeight;
          }
          break;
        case "nw":
          newWidth = Math.max(1, element.x + element.width - newPoint.x);
          newX = element.x + element.width - newWidth;
          newHeight = Math.max(1, element.y + element.height - newPoint.y);
          newY = element.y + element.height - newHeight;
          if (shiftKey) {
            const size = Math.max(newWidth, newHeight);
            newWidth = size;
            newHeight = size;
            newX = element.x + element.width - newWidth;
            newY = element.y + element.height - newHeight;
          }
          break;
        case "e":
          newWidth = Math.max(1, newPoint.x - element.x);
          if (shiftKey) {
            newHeight = (newWidth / element.width) * element.height;
          }
          break;
        case "w":
          newWidth = Math.max(1, element.x + element.width - newPoint.x);
          newX = element.x + element.width - newWidth;
          if (shiftKey) {
            newHeight = (newWidth / element.width) * element.height;
          }
          break;
        case "s":
          newHeight = Math.max(1, newPoint.y - element.y);
          if (shiftKey) {
            newWidth = (newHeight / element.height) * element.width;
          }
          break;
        case "n":
          newHeight = Math.max(1, element.y + element.height - newPoint.y);
          newY = element.y + element.height - newHeight;
          if (shiftKey) {
            newWidth = (newHeight / element.height) * element.width;
          }
          break;
      }

      const updatedElement: DriplElement = {
        ...element,
        x: newX,
        y: newY,
        width: newWidth,
        height: newHeight,
      };

      if (
        "points" in updatedElement &&
        "points" in element &&
        element.points &&
        (element.type === "arrow" ||
          element.type === "line" ||
          element.type === "freedraw")
      ) {
        const scaleX =
          element.width === 0 ? 1 : newWidth / element.width;
        const scaleY =
          element.height === 0 ? 1 : newHeight / element.height;

        updatedElement.points = element.points.map((p) => ({
          x: (p.x - element.x + newX) * scaleX,
          y: (p.y - element.y + newY) * scaleY,
        }));
      }

      updateElement(elementId, updatedElement);
      send?.({
        type: "update_element",
        element: updatedElement,
        timestamp: Date.now(),
      });
    },
    [elements, updateElement, send]
  );

  const rotateElement = useCallback(
    (elementId: string, angle: number, shiftKey: boolean) => {
      const element = elements.find((el) => el.id === elementId);
      if (!element) return;

      if (shiftKey) {
        const degrees = (angle * 180) / Math.PI;
        const snappedDegrees = Math.round(degrees / 15) * 15;
        angle = (snappedDegrees * Math.PI) / 180;
      }

      const updatedElement: DriplElement = {
        ...element,
        angle: angle,
      };

      updateElement(elementId, updatedElement);
      send?.({
        type: "update_element",
        element: updatedElement,
        timestamp: Date.now(),
      });
    },
    [elements, updateElement, send]
  );

  const duplicateElements = useCallback(
    (elementIds?: string[]) => {
      const idsToDuplicate = elementIds || Array.from(selectedIds);
      const offset = 10;

      idsToDuplicate.forEach((id) => {
        const element = elements.find((el) => el.id === id);
        if (!element) return;

        const duplicated: DriplElement = {
          ...element,
          id: uuidv4(),
          x: element.x + offset,
          y: element.y + offset,
        };

        if ("points" in duplicated && duplicated.points) {
          duplicated.points = duplicated.points.map((p: { x: number; y: number }) => ({
            x: p.x + offset,
            y: p.y + offset,
          }));
        }

        addElement(duplicated);
        send?.({
          type: "add_element",
          element: duplicated,
          timestamp: Date.now(),
        });
      });

      if (idsToDuplicate.length > 0) {
        pushHistory();
      }
    },
    [elements, selectedIds, addElement, pushHistory, send]
  );

  const deleteSelectedElements = useCallback(() => {
    const idsToDelete = Array.from(selectedIds);
    if (idsToDelete.length === 0) return;

    deleteElements(idsToDelete);
    idsToDelete.forEach((id) => {
      send?.({
        type: "delete_element",
        elementId: id,
        timestamp: Date.now(),
      });
    });
    pushHistory();
  }, [selectedIds, deleteElements, pushHistory, send]);

  return {
    moveElements,
    resizeElement,
    rotateElement,
    duplicateElements,
    deleteSelectedElements,
  };
}
