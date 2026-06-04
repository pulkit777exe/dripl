import type { DriplElement } from '@dripl/common';
import type { Bounds } from '@dripl/math';
import { getElementBounds, isPointInElement } from '@dripl/math';
import RBush from 'rbush';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Point {
  x: number;
  y: number;
}

export interface SpatialItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
}

// ── Worker State ──────────────────────────────────────────────────────────────

let tree = new RBush<SpatialItem>();
const byId = new Map<string, DriplElement>();

// ── Message Handlers ──────────────────────────────────────────────────────────

function handleBuildIndex(elements: DriplElement[]): { treeData: unknown; bounds: Array<{ id: string; bounds: Bounds }> } {
  tree.clear();
  byId.clear();

  const items: SpatialItem[] = [];
  const boundsMap: Array<{ id: string; bounds: Bounds }> = [];

  for (const element of elements) {
    const bounds = getElementBounds(element);
    items.push({
      minX: bounds.x,
      minY: bounds.y,
      maxX: bounds.x + bounds.width,
      maxY: bounds.y + bounds.height,
      id: element.id,
    });
    byId.set(element.id, element);
    boundsMap.push({ id: element.id, bounds });
  }

  tree.load(items);
  return { treeData: tree.toJSON(), bounds: boundsMap };
}

function handleHitTest(
  x: number,
  y: number,
  hitThreshold: number,
  elements: DriplElement[],
  lockedIds: string[],
  userId: string | null,
): { id: string | null } {
  const lockedSet = new Set(lockedIds);
  const candidates = tree.search({
    minX: x - hitThreshold,
    minY: y - hitThreshold,
    maxX: x + hitThreshold,
    maxY: y + hitThreshold,
  });
  const candidateIds = new Set(candidates.map(c => c.id));

  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i];
    if (!element) continue;
    if (!candidateIds.has(element.id)) continue;
    if (lockedSet.has(element.id)) continue;

    const elThreshold = Math.max((element.strokeWidth ?? 2) / 2 + 0.1, hitThreshold);
    if (!isPointNearElement({ x, y }, element, elThreshold)) continue;

    return { id: element.id };
  }
  return { id: null };
}

function handleViewportQuery(
  viewportBounds: { minX: number; minY: number; maxX: number; maxY: number },
): string[] {
  const items = tree.search(viewportBounds);
  return items.map(item => item.id);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPointNearElement(point: Point, element: DriplElement, threshold: number): boolean {
  if (!isPointInElement(point, element)) return false;

  if (element.type === 'line' || element.type === 'arrow') {
    const points = (element as { points?: Point[] }).points ?? [];
    if (points.length < 2) return false;

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i]!;
      const p2 = points[i + 1]!;
      const seg = {
        start: { x: p1.x + element.x, y: p1.y + element.y },
        end: { x: p2.x + element.x, y: p2.y + element.y },
      };
      const dist = pointToSegmentDistance(point, seg);
      if (dist <= threshold) return true;
    }
    return false;
  }

  return true;
}

function pointToSegmentDistance(point: Point, seg: { start: Point; end: Point }): number {
  const dx = seg.end.x - seg.start.x;
  const dy = seg.end.y - seg.start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(point.x - seg.start.x, point.y - seg.start.y);

  let t = ((point.x - seg.start.x) * dx + (point.y - seg.start.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  return Math.hypot(point.x - (seg.start.x + t * dx), point.y - (seg.start.y + t * dy));
}

// ── Message Dispatch ──────────────────────────────────────────────────────────

interface WorkerMessage {
  id: string;
  type: string;
  payload: unknown;
}

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { id, type, payload } = e.data;

  try {
    switch (type) {
      case 'build-index': {
        const elements = payload as DriplElement[];
        const result = handleBuildIndex(elements);
        self.postMessage({ id, type: 'index-built', payload: result });
        break;
      }
      case 'hit-test': {
        const { x, y, hitThreshold, elements, lockedIds, userId } = payload as {
          x: number;
          y: number;
          hitThreshold: number;
          elements: DriplElement[];
          lockedIds: string[];
          userId: string | null;
        };
        const result = handleHitTest(x, y, hitThreshold, elements, lockedIds, userId);
        self.postMessage({ id, type: 'hit-result', payload: result });
        break;
      }
      case 'query-viewport': {
        const viewportBounds = payload as { minX: number; minY: number; maxX: number; maxY: number };
        const result = handleViewportQuery(viewportBounds);
        self.postMessage({ id, type: 'viewport-result', payload: result });
        break;
      }
      default:
        self.postMessage({ id, type: 'error', payload: `Unknown message type: ${type}` });
    }
  } catch (err) {
    self.postMessage({
      id,
      type: 'error',
      payload: err instanceof Error ? err.message : String(err),
    });
  }
};
