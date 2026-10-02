import type { DriplElement } from '@dripl/common';
import { compareFractionalIndex } from '@dripl/common/reconciliation';
import { generateKeyBetween } from 'fractional-indexing';

/**
 * Total deterministic z-order comparison.
 *
 * Equal fractional indices break by element ID so every replica canonicalizes
 * identically instead of depending
 * on input/Map insertion order.
 */
export function compareZOrder(a: DriplElement, b: DriplElement): number {
  const order = compareFractionalIndex(a.fractionalIndex, b.fractionalIndex);
  if (order !== 0) return order;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * Sort elements by fractional index (ascending = back-to-front).
 * Equal indices fall back to element ID for a deterministic total order.
 */
export function sortElementsByZIndex(elements: DriplElement[]): DriplElement[] {
  return [...elements].sort(compareZOrder);
}

/**
 * Repair missing or duplicate fractional indices deterministically.
 *
 * Sorts by the total z-order first, then assigns fresh keys (appended after
 * the last unique key) to any element without an index or sharing one.
 * The returned array is sorted and has unique indices.
 */
export function repairFractionalIndexes(elements: DriplElement[]): DriplElement[] {
  const sorted = sortElementsByZIndex(elements);
  const seen = new Set<string>();
  let lastKey: string | null = null;
  // Seed lastKey with the greatest existing index so generated keys sort last.
  for (const el of sorted) {
    if (el.fractionalIndex != null && !seen.has(el.fractionalIndex)) {
      seen.add(el.fractionalIndex);
      if (lastKey === null || el.fractionalIndex > lastKey) lastKey = el.fractionalIndex;
    }
  }
  const repairedSeen = new Set<string>();
  return sorted.map(el => {
    if (el.fractionalIndex != null && !repairedSeen.has(el.fractionalIndex)) {
      repairedSeen.add(el.fractionalIndex);
      return el;
    }
    const newKey = generateKeyBetween(lastKey, null);
    lastKey = newKey;
    repairedSeen.add(newKey);
    return { ...el, fractionalIndex: newKey };
  });
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
