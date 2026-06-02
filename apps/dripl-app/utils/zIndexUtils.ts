import type { DriplElement } from '@dripl/common';
import { generateKeyBetween } from 'fractional-indexing';

/**
 * Sort elements by fractional index (ascending = back-to-front)
 */
export function sortElementsByZIndex(elements: DriplElement[]): DriplElement[] {
  return [...elements].sort((a, b) => {
    const ai = a.fractionalIndex ?? '';
    const bi = b.fractionalIndex ?? '';
    if (ai === bi) return 0;
    if (ai === '') return -1;
    if (bi === '') return 1;
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });
}

/**
 * Sort elements by fractional index (descending = front-to-back)
 */
export function sortElementsByZIndexDescending(elements: DriplElement[]): DriplElement[] {
  return sortElementsByZIndex(elements).reverse();
}

/**
 * Bring an element to the front (highest fractional index)
 */
export function bringToFront(element: DriplElement, elements: DriplElement[]): DriplElement {
  const sorted = sortElementsByZIndex(elements);
  const last = sorted[sorted.length - 1];
  const newIdx = generateKeyBetween(last?.fractionalIndex ?? null, null);
  return { ...element, fractionalIndex: newIdx };
}

/**
 * Send an element to the back (lowest fractional index)
 */
export function sendToBack(element: DriplElement, elements: DriplElement[]): DriplElement {
  const sorted = sortElementsByZIndex(elements);
  const first = sorted[0];
  const newIdx = generateKeyBetween(null, first?.fractionalIndex ?? null);
  return { ...element, fractionalIndex: newIdx };
}

/**
 * Bring an element forward by one position
 */
export function bringForward(element: DriplElement, elements: DriplElement[]): DriplElement {
  const sorted = sortElementsByZIndex(elements);
  const currentIndex = sorted.findIndex(el => el.id === element.id);

  if (currentIndex === -1 || currentIndex === sorted.length - 1) {
    return element;
  }

  const nextElement = sorted[currentIndex + 1];
  const afterNext = sorted[currentIndex + 2];
  if (!nextElement) return element;

  const newIdx = generateKeyBetween(
    nextElement.fractionalIndex ?? null,
    afterNext?.fractionalIndex ?? null,
  );
  return { ...element, fractionalIndex: newIdx };
}

/**
 * Send an element backward by one position
 */
export function sendBackward(element: DriplElement, elements: DriplElement[]): DriplElement {
  const sorted = sortElementsByZIndex(elements);
  const currentIndex = sorted.findIndex(el => el.id === element.id);

  if (currentIndex === -1 || currentIndex === 0) {
    return element;
  }

  const prevElement = sorted[currentIndex - 1];
  const beforePrev = sorted[currentIndex - 2];
  if (!prevElement) return element;

  const newIdx = generateKeyBetween(
    beforePrev?.fractionalIndex ?? null,
    prevElement.fractionalIndex ?? null,
  );
  return { ...element, fractionalIndex: newIdx };
}

/**
 * Get z-index range of selected elements (by fractional index position)
 */
export function getZIndexRange(selectedElements: DriplElement[]): {
  min: number;
  max: number;
} {
  const sorted = sortElementsByZIndex(selectedElements);
  return {
    min: 0,
    max: sorted.length - 1,
  };
}

/**
 * Normalize fractional index values to eliminate gaps
 */
export function normalizeZIndices(elements: DriplElement[]): DriplElement[] {
  const sorted = sortElementsByZIndex(elements);
  return sorted.map((element, index) => ({
    ...element,
    fractionalIndex: generateKeyBetween(
      index === 0 ? null : sorted[index - 1]?.fractionalIndex ?? null,
      null,
    ),
  }));
}
