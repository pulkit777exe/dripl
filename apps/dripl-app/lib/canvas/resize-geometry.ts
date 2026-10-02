import type { DriplElement } from '@dripl/common';
import { inverseRotatePoint } from '@dripl/math/intersection';

export interface CanvasPoint {
  x: number;
  y: number;
}

const MIN_SIZE = 4;
const HISTORY_PUSH_THRESHOLD = 0.5;

/**
 * Resize geometry — pure helpers extracted from `useCanvasPointerEvents`.
 *
 * The gesture handler owns store writes, history, and binding detection;
 * everything here is closed-form geometry over the gesture-start snapshot,
 * so it is unit-testable and reusable. All three functions preserve the
 * exact arithmetic (including the 4px minimum and the 0.5px history gate)
 * of the inline code they replace.
 */

/** History-push gate: first move past half a pixel starts an undo step. */
export function shouldPushHistory(historyPushed: boolean, dx: number, dy: number): boolean {
  return (
    !historyPushed &&
    (Math.abs(dx) > HISTORY_PUSH_THRESHOLD || Math.abs(dy) > HISTORY_PUSH_THRESHOLD)
  );
}

function pointsOf(el: DriplElement): Array<CanvasPoint> | null {
  if (!('points' in el)) return null;
  const pts = (el as DriplElement & { points?: unknown }).points;
  if (!Array.isArray(pts) || pts.length < 2) return null;
  return pts as Array<CanvasPoint>;
}

/** Re-anchor absolute points to a tightened origin (4px minimum size). */
function reboxLinearElement(el: DriplElement, absPts: CanvasPoint[]): DriplElement {
  const allX = absPts.map(p => p.x);
  const allY = absPts.map(p => p.y);
  const newMinX = Math.min(...allX);
  const newMinY = Math.min(...allY);
  const newMaxX = Math.max(...allX);
  const newMaxY = Math.max(...allY);
  return {
    ...el,
    x: newMinX,
    y: newMinY,
    width: Math.max(MIN_SIZE, newMaxX - newMinX),
    height: Math.max(MIN_SIZE, newMaxY - newMinY),
    points: absPts.map(p => ({ x: p.x - newMinX, y: p.y - newMinY })),
  };
}

/**
 * Insert a midpoint on segment `index` (segment between points
 * `index - 1` and `index`) of a linear element. Returns `null` when the
 * element has no usable points or the index is out of range.
 */
export function insertLinearMidpoint(el: DriplElement, index: number): DriplElement | null {
  const pts = pointsOf(el);
  if (!pts || index < 1 || index >= pts.length) return null;
  const p1 = pts[index - 1];
  const p2 = pts[index];
  if (!p1 || !p2) return null;

  // Midpoint in absolute coordinates, stored relative to the origin.
  const midX = el.x + (p1.x + p2.x) / 2;
  const midY = el.y + (p1.y + p2.y) / 2;
  const newPts = [...pts];
  newPts.splice(index, 0, { x: midX - el.x, y: midY - el.y });

  return reboxLinearElement(
    el,
    newPts.map(p => ({ x: el.x + p.x, y: el.y + p.y }))
  );
}

export interface DragLinearPointResult {
  element: DriplElement;
  /** The moved point in absolute canvas coordinates (binding detection). */
  movedPoint: CanvasPoint;
}

/**
 * Drag one point of a linear element by a canvas delta. Rotation-aware:
 * rotated elements map the delta into local space first. Returns `null`
 * when the element has no usable points or the index is out of range.
 */
export function dragLinearPoint(
  el: DriplElement,
  index: number,
  dx: number,
  dy: number
): DragLinearPointResult | null {
  const pts = pointsOf(el);
  if (!pts || index < 0 || index >= pts.length) return null;
  const absPts = pts.map(p => ({ x: el.x + p.x, y: el.y + p.y }));
  const target = absPts[index];
  if (!target) return null;
  const angle = el.angle ?? 0;
  if (angle) {
    const localDelta = inverseRotatePoint({ x: dx, y: dy }, 0, 0, angle);
    target.x += localDelta.x;
    target.y += localDelta.y;
  } else {
    target.x += dx;
    target.y += dy;
  }
  return { element: reboxLinearElement(el, absPts), movedPoint: { ...target } };
}

export interface BoxResizeOptions {
  shiftKey: boolean;
  gridEnabled: boolean;
  gridSize: number;
  snapPoint: (point: CanvasPoint) => CanvasPoint;
}

/**
 * Axis-aligned box resize for a compass handle. Applies the handle delta,
 * shift-key aspect lock (from the gesture-start aspect), then grid snapping.
 * Returns the new frame; point remapping stays in @dripl/element.
 */
export function computeBoxResize(
  el: Pick<DriplElement, 'x' | 'y' | 'width' | 'height'>,
  handle: string,
  dx: number,
  dy: number,
  options: BoxResizeOptions
): { x: number; y: number; width: number; height: number } {
  let newX = el.x;
  let newY = el.y;
  let newWidth = el.width;
  let newHeight = el.height;
  const aspect = el.height !== 0 ? el.width / el.height : 1;

  switch (handle) {
    case 'se':
      newWidth = Math.max(MIN_SIZE, el.width + dx);
      newHeight = Math.max(MIN_SIZE, el.height + dy);
      break;
    case 'sw':
      newWidth = Math.max(MIN_SIZE, el.width - dx);
      newX = el.x + el.width - newWidth;
      newHeight = Math.max(MIN_SIZE, el.height + dy);
      break;
    case 'ne':
      newWidth = Math.max(MIN_SIZE, el.width + dx);
      newHeight = Math.max(MIN_SIZE, el.height - dy);
      newY = el.y + el.height - newHeight;
      break;
    case 'nw':
      newWidth = Math.max(MIN_SIZE, el.width - dx);
      newX = el.x + el.width - newWidth;
      newHeight = Math.max(MIN_SIZE, el.height - dy);
      newY = el.y + el.height - newHeight;
      break;
    case 'e':
      newWidth = Math.max(MIN_SIZE, el.width + dx);
      break;
    case 'w':
      newWidth = Math.max(MIN_SIZE, el.width - dx);
      newX = el.x + el.width - newWidth;
      break;
    case 's':
      newHeight = Math.max(MIN_SIZE, el.height + dy);
      break;
    case 'n':
      newHeight = Math.max(MIN_SIZE, el.height - dy);
      newY = el.y + el.height - newHeight;
      break;
  }

  if (options.shiftKey) {
    const base = Math.max(newWidth, newHeight);
    newWidth = base;
    newHeight = aspect !== 0 ? base / aspect : base;
    if (handle.includes('w')) {
      newX = el.x + el.width - newWidth;
    }
    if (handle.includes('n')) {
      newY = el.y + el.height - newHeight;
    }
  }

  if (options.gridEnabled) {
    const snapped = options.snapPoint({ x: newX, y: newY });
    newX = snapped.x;
    newY = snapped.y;
    newWidth = Math.max(MIN_SIZE, Math.round(newWidth / options.gridSize) * options.gridSize);
    newHeight = Math.max(MIN_SIZE, Math.round(newHeight / options.gridSize) * options.gridSize);
  }

  return { x: newX, y: newY, width: newWidth, height: newHeight };
}
