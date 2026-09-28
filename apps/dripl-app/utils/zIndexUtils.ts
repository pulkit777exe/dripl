import type { DriplElement } from '@dripl/common';
import { compareFractionalIndex } from '@dripl/common/reconciliation';
import { generateKeyBetween } from 'fractional-indexing';

/**
 * Sort elements by fractional index (ascending = back-to-front)
 */
export function sortElementsByZIndex(elements: DriplElement[]): DriplElement[] {
  return [...elements].sort((a, b) => compareFractionalIndex(a.fractionalIndex, b.fractionalIndex));
}

/**
 * Sort elements by fractional index (descending = front-to-back)
 */
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
    afterNext?.fractionalIndex ?? null
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
    prevElement.fractionalIndex ?? null
  );
  return { ...element, fractionalIndex: newIdx };
}
