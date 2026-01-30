import type { DriplElement } from "@dripl/common";

// Default z-index values
const DEFAULT_Z_INDEX = 100;
const Z_INDEX_STEP = 10;

/**
 * Sort elements by z-index (ascending)
 */
export function sortElementsByZIndex(elements: DriplElement[]): DriplElement[] {
  return [...elements].sort((a, b) => {
    const aZ = a.zIndex ?? DEFAULT_Z_INDEX;
    const bZ = b.zIndex ?? DEFAULT_Z_INDEX;
    return aZ - bZ;
  });
}

/**
 * Sort elements by z-index (descending)
 */
export function sortElementsByZIndexDescending(elements: DriplElement[]): DriplElement[] {
  return [...elements].sort((a, b) => {
    const aZ = a.zIndex ?? DEFAULT_Z_INDEX;
    const bZ = b.zIndex ?? DEFAULT_Z_INDEX;
    return bZ - aZ;
  });
}

/**
 * Bring an element to the front
 */
export function bringToFront(element: DriplElement, elements: DriplElement[]): DriplElement {
  const maxZ = Math.max(...elements.map((el) => el.zIndex ?? DEFAULT_Z_INDEX), DEFAULT_Z_INDEX);
  return { ...element, zIndex: maxZ + Z_INDEX_STEP };
}

/**
 * Send an element to the back
 */
export function sendToBack(element: DriplElement, elements: DriplElement[]): DriplElement {
  const minZ = Math.min(...elements.map((el) => el.zIndex ?? DEFAULT_Z_INDEX), DEFAULT_Z_INDEX);
  return { ...element, zIndex: minZ - Z_INDEX_STEP };
}

/**
 * Bring an element forward
 */
export function bringForward(element: DriplElement, elements: DriplElement[]): DriplElement {
  const sortedElements = sortElementsByZIndex(elements);
  const currentIndex = sortedElements.findIndex((el) => el.id === element.id);
  
  if (currentIndex === -1 || currentIndex === sortedElements.length - 1) {
    return element;
  }

  const nextElement = sortedElements[currentIndex + 1];
  if (!nextElement) {
    return element;
  }

  const nextZ = nextElement.zIndex ?? DEFAULT_Z_INDEX;
  return { ...element, zIndex: nextZ + Z_INDEX_STEP / 2 };
}

/**
 * Send an element backward
 */
export function sendBackward(element: DriplElement, elements: DriplElement[]): DriplElement {
  const sortedElements = sortElementsByZIndex(elements);
  const currentIndex = sortedElements.findIndex((el) => el.id === element.id);
  
  if (currentIndex === -1 || currentIndex === 0) {
    return element;
  }

  const prevElement = sortedElements[currentIndex - 1];
  if (!prevElement) {
    return element;
  }

  const prevZ = prevElement.zIndex ?? DEFAULT_Z_INDEX;
  return { ...element, zIndex: prevZ - Z_INDEX_STEP / 2 };
}

/**
 * Update z-index for multiple elements
 */
export function updateElementsZIndex(
  elements: DriplElement[],
  updates: Array<{ id: string; zIndex: number }>
): DriplElement[] {
  return elements.map((element) => {
    const update = updates.find((u) => u.id === element.id);
    if (update) {
      return { ...element, zIndex: update.zIndex };
    }
    return element;
  });
}

/**
 * Get z-index range of selected elements
 */
export function getZIndexRange(selectedElements: DriplElement[]): { min: number; max: number } {
  const zIndices = selectedElements.map((el) => el.zIndex ?? DEFAULT_Z_INDEX);
  return {
    min: Math.min(...zIndices),
    max: Math.max(...zIndices),
  };
}

/**
 * Normalize z-index values to eliminate gaps and ensure consistent step
 */
export function normalizeZIndices(elements: DriplElement[]): DriplElement[] {
  const sortedElements = sortElementsByZIndex(elements);
  return sortedElements.map((element, index) => {
    return { ...element, zIndex: DEFAULT_Z_INDEX + index * Z_INDEX_STEP };
  });
}