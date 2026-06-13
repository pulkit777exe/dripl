import type { DriplElement } from '@dripl/common';
import { generateKeyBetween } from 'fractional-indexing';
import { sortElementsByZIndex } from '@/utils/zIndexUtils';

export const MAX_HISTORY = 100;
export { sortElementsByZIndex as sortByFractionalIndex } from '@/utils/zIndexUtils';

export type DrawingLifecycle = 'idle' | 'drawing' | 'committing';

export interface RemoteUser {
  userId: string;
  userName: string;
  color: string;
}

export interface RemoteCursor {
  x: number;
  y: number;
  userName: string;
  color: string;
  updatedAt: number;
}

export type Theme = 'light' | 'dark' | 'system';

export type ActiveTool =
  | 'select'
  | 'hand'
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'arrow'
  | 'line'
  | 'freedraw'
  | 'text'
  | 'image'
  | 'frame'
  | 'eraser'
  | 'laser';

export type FillStyle = 'hachure' | 'solid' | 'zigzag' | 'cross-hatch' | 'dots' | 'dashed' | 'zigzag-line';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';

export interface HistoryState {
  past: DriplElement[][];
  future: DriplElement[][];
}

export function cloneElements(elements: readonly DriplElement[]): DriplElement[] {
  return structuredClone(elements) as DriplElement[];
}

export function ensureFractionalIndexes(elements: DriplElement[]): DriplElement[] {
  let needsMigration = false;
  for (const el of elements) {
    if (el.fractionalIndex == null) {
      needsMigration = true;
      break;
    }
  }
  if (!needsMigration) return elements;

  let lastKey: string | null = null;
  return sortElementsByZIndex(elements).map((el) => {
    if (el.fractionalIndex != null) {
      lastKey = el.fractionalIndex;
      return el;
    }
    const newKey = generateKeyBetween(lastKey, null);
    lastKey = newKey;
    return { ...el, fractionalIndex: newKey };
  });
}

export function generateFractionalIndexBetween(
  elements: readonly DriplElement[],
  beforeId: string | null,
  afterId: string | null,
): string {
  const before = beforeId ? elements.find(e => e.id === beforeId)?.fractionalIndex ?? null : null;
  const after = afterId ? elements.find(e => e.id === afterId)?.fractionalIndex ?? null : null;
  return generateKeyBetween(before, after);
}

export function generateFractionalIndexAfterAll(elements: readonly DriplElement[]): string {
  const sorted = sortElementsByZIndex(elements as DriplElement[]);
  const last = sorted[sorted.length - 1];
  return generateKeyBetween(last?.fractionalIndex ?? null, null);
}

export function generateFractionalIndexBeforeAll(elements: readonly DriplElement[]): string {
  const sorted = sortElementsByZIndex(elements as DriplElement[]);
  const first = sorted[0];
  return generateKeyBetween(null, first?.fractionalIndex ?? null);
}

export function buildElementsById(elements: readonly DriplElement[]): Map<string, DriplElement> {
  const map = new Map<string, DriplElement>();
  for (const el of elements) {
    map.set(el.id, el);
  }
  return map;
}

export function sortedInsert(elements: DriplElement[], newElement: DriplElement): DriplElement[] {
  const newIndex = newElement.fractionalIndex ?? '';
  let lo = 0;
  let hi = elements.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const midIndex = elements[mid]?.fractionalIndex ?? '';
    if (midIndex < newIndex) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const result = [...elements];
  result.splice(lo, 0, newElement);
  return result;
}

export function pushPast(
  past: readonly DriplElement[][],
  snapshot: readonly DriplElement[]
): DriplElement[][] {
  const next = [...past, cloneElements(snapshot)];
  if (next.length <= MAX_HISTORY) return next;
  return next.slice(next.length - MAX_HISTORY);
}

export function withHistoryBeforeMutation(
  history: HistoryState,
  currentElements: readonly DriplElement[]
): HistoryState {
  return {
    past: pushPast(history.past, currentElements),
    future: [],
  };
}

export function commitPresentFromHistory(
  past: readonly DriplElement[][],
  future: readonly DriplElement[][],
) {
  return {
    past: [...past],
    future: [...future],
  };
}
