import type { DriplElement } from '@dripl/common';
import { generateKeyBetween } from 'fractional-indexing';
import { compareZOrder, sortElementsByZIndex } from '@/utils/zIndexUtils';

export const MAX_HISTORY = 100;
export const MAX_HISTORY_BYTES = 10 * 1024 * 1024; // 10 MB budget for undo history

export type DrawingLifecycle = 'idle' | 'drawing';

export interface RemoteUser {
  userId: string;
  userName: string;
  color: string;
  /**
   * Last proof of presence (join, sync, or cursor-move). The cursor sweeper
   * evicts users unseen for much longer than the cursor TTL, so a missed
   * user-leave cannot pin an avatar (or a 0,0 collaborator) forever, while
   * an idle-but-connected reader keeps theirs.
   */
  lastSeenAt: number;
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
  | 'embed'
  | 'eraser'
  | 'laser';

export type FillStyle =
  'hachure' | 'solid' | 'zigzag' | 'cross-hatch' | 'dots' | 'dashed' | 'zigzag-line';
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
  return sortElementsByZIndex(elements).map(el => {
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
  afterId: string | null
): string {
  const before = beforeId ? (elements.find(e => e.id === beforeId)?.fractionalIndex ?? null) : null;
  const after = afterId ? (elements.find(e => e.id === afterId)?.fractionalIndex ?? null) : null;
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
  let lo = 0;
  let hi = elements.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (compareZOrder(elements[mid]!, newElement) < 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const result = [...elements];
  result.splice(lo, 0, newElement);
  return result;
}

function estimateSnapshotBytes(snapshot: readonly DriplElement[]): number {
  // Rough estimate: base overhead per element plus payload for variable-length
  // arrays. Points/pressures run ~30B+/point serialized, so a 2000-point
  // stroke is ~100KB — counting it as 250B let stroke-heavy scenes blow past
  // the budget with 100 deep snapshots.
  let bytes = 0;
  for (const element of snapshot) {
    bytes += 250;
    if (Array.isArray(element.points)) bytes += element.points.length * 32;
    if (Array.isArray(element.pressureValues)) {
      bytes += (element.pressureValues as number[]).length * 8;
    }
    if (typeof element.text === 'string') bytes += element.text.length * 2;
  }
  return bytes;
}

/**
 * Whether two snapshots hold the same scene state, without cloning.
 *
 * Fast path first: reference-equal elements are trivially equal. Otherwise an
 * element counts as unchanged when its identity and all three freshness
 * markers match — every mutation through `mutateElement` bumps `version` and
 * mints a new `versionNonce`, so markers that agree mean the app's own sync
 * layer would also call the pair identical. Elements carrying none of the
 * markers (legacy/imported scenes, and several unit fixtures) fall back to a
 * JSON comparison for that pair only, so a real change can never hide behind
 * absent markers.
 */
function snapshotsEqual(a: readonly DriplElement[], b: readonly DriplElement[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ea = a[i] as DriplElement | undefined;
    const eb = b[i] as DriplElement | undefined;
    if (ea === eb) continue;
    if (!ea || !eb || ea.id !== eb.id) return false;
    const eaMarked =
      ea.version !== undefined || ea.versionNonce !== undefined || ea.updated !== undefined;
    const ebMarked =
      eb.version !== undefined || eb.versionNonce !== undefined || eb.updated !== undefined;
    if (eaMarked && ebMarked) {
      if (
        ea.version !== eb.version ||
        ea.versionNonce !== eb.versionNonce ||
        ea.updated !== eb.updated
      )
        return false;
    } else if (JSON.stringify(ea) !== JSON.stringify(eb)) {
      return false;
    }
  }
  return true;
}

export function pushPast(
  past: readonly DriplElement[][],
  snapshot: readonly DriplElement[]
): DriplElement[][] {
  // Skip no-op pushes: a snapshot identical to the latest entry would create
  // an undo step that restores exactly what is already on screen (≈8 ms of
  // structuredClone at 5k elements for zero effect). Undo depth only shrinks
  // by steps that were never steps — `canUndo` still answers past.length > 0.
  const last = past[past.length - 1];
  if (last && snapshotsEqual(last, snapshot)) {
    return [...past];
  }

  const next = [...past, cloneElements(snapshot)];

  // Enforce count limit
  if (next.length > MAX_HISTORY) {
    return next.slice(next.length - MAX_HISTORY);
  }

  // Enforce byte budget — trim oldest snapshots first
  let totalBytes = 0;
  let trimIndex = 0;
  for (let i = 0; i < next.length; i++) {
    const snap = next[i];
    if (snap) {
      totalBytes += estimateSnapshotBytes(snap);
      if (totalBytes > MAX_HISTORY_BYTES) {
        trimIndex = i;
        break;
      }
    }
  }
  if (trimIndex > 0) {
    return next.slice(trimIndex);
  }

  return next;
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
  future: readonly DriplElement[][]
) {
  return {
    past: [...past],
    future: [...future],
  };
}
