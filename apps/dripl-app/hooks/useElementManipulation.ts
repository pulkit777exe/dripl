'use client';

import { useCallback } from 'react';
import type { DriplElement, Point, LinearElement, TextElement } from '@dripl/common';
import { v4 as uuidv4 } from 'uuid';
import { resizeSingleElement } from '@dripl/element/resizeElements';

export interface UseElementManipulationProps {
  elements: DriplElement[];
  selectedIds: Set<string>;
  updateElement: (id: string, updates: Partial<DriplElement>) => void;
  addElement: (element: DriplElement) => void;
  deleteElements: (ids: string[]) => void;
  pushHistory: () => void;
}

export interface UseElementManipulationReturn {
  moveElements: (delta: Point, elementIds?: string[]) => void;
  resizeElement: (elementId: string, handle: string, newPoint: Point, shiftKey: boolean) => void;
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
}: UseElementManipulationProps): UseElementManipulationReturn {
  const moveElements = useCallback(
    (delta: Point, elementIds?: string[]) => {
      const idsToMove = elementIds || Array.from(selectedIds);
      let hasChanges = false;

      const allIdsToMove = new Set<string>();

      idsToMove.forEach(id => {
        allIdsToMove.add(id);

        const element = elements.find(el => el.id === id);
        if (element && element.type === 'arrow' && 'labelId' in element) {
          const arrowElement = element as LinearElement;
          if (arrowElement.labelId) {
            allIdsToMove.add(arrowElement.labelId);
          }
        }

        if (element && element.type === 'text' && 'containerId' in element) {
          const textElement = element as TextElement;
          if (textElement.containerId) {
            allIdsToMove.add(textElement.containerId);
          }
        }
      });

      allIdsToMove.forEach(id => {
        const element = elements.find(el => el.id === id);
        if (!element) return;

        const updatedElement: DriplElement = {
          ...element,
          x: element.x + delta.x,
          y: element.y + delta.y,
        };

        updateElement(id, updatedElement);
        hasChanges = true;
      });

      if (hasChanges) {
        pushHistory();
      }
    },
    [elements, selectedIds, updateElement, pushHistory]
  );

  const resizeElement = useCallback(
    (
      elementId: string,
      handle: string,
      newPoint: Point,
      shiftKey: boolean,
      altKey: boolean = false
    ) => {
      const element = elements.find(el => el.id === elementId);
      if (!element) return;

      let newX = element.x;
      let newY = element.y;
      let newWidth = element.width;
      let newHeight = element.height;

      switch (handle) {
        case 'se': // South-east
          newWidth = Math.max(1, newPoint.x - element.x);
          newHeight = Math.max(1, newPoint.y - element.y);
          if (shiftKey) {
            const aspectRatio = element.width / element.height;
            if (newWidth / newHeight > aspectRatio) {
              newHeight = newWidth / aspectRatio;
            } else {
              newWidth = newHeight * aspectRatio;
            }
          }
          break;
        case 'sw':
          newWidth = Math.max(1, element.x + element.width - newPoint.x);
          newX = element.x + element.width - newWidth;
          newHeight = Math.max(1, newPoint.y - element.y);
          if (shiftKey) {
            const aspectRatio = element.width / element.height;
            if (newWidth / newHeight > aspectRatio) {
              newHeight = newWidth / aspectRatio;
            } else {
              newWidth = newHeight * aspectRatio;
            }
            newX = element.x + element.width - newWidth;
          }
          break;
        case 'ne':
          newWidth = Math.max(1, newPoint.x - element.x);
          newHeight = Math.max(1, element.y + element.height - newPoint.y);
          newY = element.y + element.height - newHeight;
          if (shiftKey) {
            const aspectRatio = element.width / element.height;
            if (newWidth / newHeight > aspectRatio) {
              newHeight = newWidth / aspectRatio;
            } else {
              newWidth = newHeight * aspectRatio;
            }
            newY = element.y + element.height - newHeight;
          }
          break;
        case 'nw':
          newWidth = Math.max(1, element.x + element.width - newPoint.x);
          newX = element.x + element.width - newWidth;
          newHeight = Math.max(1, element.y + element.height - newPoint.y);
          newY = element.y + element.height - newHeight;
          if (shiftKey) {
            const aspectRatio = element.width / element.height;
            if (newWidth / newHeight > aspectRatio) {
              newHeight = newWidth / aspectRatio;
            } else {
              newWidth = newHeight * aspectRatio;
            }
            newX = element.x + element.width - newWidth;
            newY = element.y + element.height - newHeight;
          }
          break;
        case 'e':
          newWidth = Math.max(1, newPoint.x - element.x);
          if (shiftKey) {
            newHeight = (newWidth / element.width) * element.height;
          }
          break;
        case 'w':
          newWidth = Math.max(1, element.x + element.width - newPoint.x);
          newX = element.x + element.width - newWidth;
          if (shiftKey) {
            newHeight = (newWidth / element.width) * element.height;
          }
          break;
        case 's':
          newHeight = Math.max(1, newPoint.y - element.y);
          if (shiftKey) {
            newWidth = (newHeight / element.height) * element.width;
          }
          break;
        case 'n':
          newHeight = Math.max(1, element.y + element.height - newPoint.y);
          newY = element.y + element.height - newHeight;
          if (shiftKey) {
            newWidth = (newHeight / element.height) * element.width;
          }
          break;
      }

      let resizedProperties = resizeSingleElement(
        newWidth,
        newHeight,
        element,
        element,
        handle as 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw',
        {
          shouldMaintainAspectRatio: shiftKey,
          shouldResizeFromCenter: altKey,
        }
      );

      const updatedElement = {
        ...element,
        ...resizedProperties,
      } as DriplElement;

      updateElement(elementId, updatedElement);
    },
    [elements, updateElement]
  );

  const rotateElement = useCallback(
    (elementId: string, angle: number, shiftKey: boolean) => {
      const element = elements.find(el => el.id === elementId);
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
    },
    [elements, updateElement]
  );

  const duplicateElements = useCallback(
    (elementIds?: string[]) => {
      const idsToDuplicate = elementIds || Array.from(selectedIds);
      const offset = 10;

      const allElementsToDuplicate: DriplElement[] = [];

      idsToDuplicate.forEach(id => {
        const element = elements.find(el => el.id === id);
        if (element) {
          allElementsToDuplicate.push(element);

          if (element && element.type === 'arrow' && 'labelId' in element) {
            const arrowElement = element as LinearElement;
            if (arrowElement.labelId) {
              const label = elements.find(el => el.id === arrowElement.labelId);
              if (label) {
                allElementsToDuplicate.push(label);
              }
            }
          }
        }
      });

      const idMap = new Map<string, string>();

      allElementsToDuplicate.forEach(element => {
        const duplicated: DriplElement = {
          ...element,
          id: uuidv4(),
          x: element.x + offset,
          y: element.y + offset,
        };

        idMap.set(element.id, duplicated.id);

        if (duplicated.type === 'arrow' && 'labelId' in duplicated) {
          const arrowDuplicated = duplicated as LinearElement;
          if (arrowDuplicated.labelId) {
            arrowDuplicated.labelId = idMap.get(arrowDuplicated.labelId) || arrowDuplicated.labelId;
          }
        }
        if (duplicated.type === 'text' && 'containerId' in duplicated) {
          const textDuplicated = duplicated as TextElement;
          if (textDuplicated.containerId) {
            textDuplicated.containerId = idMap.get(textDuplicated.containerId) || textDuplicated.containerId;
          }
        }

        addElement(duplicated);
      });

      if (idsToDuplicate.length > 0) {
        pushHistory();
      }
    },
    [elements, selectedIds, addElement, pushHistory]
  );

  const deleteSelectedElements = useCallback(() => {
    const idsToDelete = Array.from(selectedIds);
    if (idsToDelete.length === 0) return;

    const allIdsToDelete = new Set<string>(idsToDelete);

    idsToDelete.forEach(id => {
      const element = elements.find(el => el.id === id);
      if (element && element.type === 'arrow' && 'labelId' in element) {
        const arrowElement = element as LinearElement;
        if (arrowElement.labelId) {
          allIdsToDelete.add(arrowElement.labelId);
        }
      }
    });

    deleteElements(Array.from(allIdsToDelete));
    pushHistory();
  }, [selectedIds, deleteElements, pushHistory]);

  return {
    moveElements,
    resizeElement,
    rotateElement,
    duplicateElements,
    deleteSelectedElements,
  };
}
