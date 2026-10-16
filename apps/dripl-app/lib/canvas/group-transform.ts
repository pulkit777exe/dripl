import type { DriplElement, Point } from '@dripl/common';
import { getElementBounds, rotatePoint } from '@dripl/math/intersection';

/**
 * Multi-selection transform geometry — pure helpers for the group resize and
 * group rotate gestures.
 *
 * Single-element gestures live in `resize-geometry.ts` / `rotation.ts`; those
 * map one handle delta onto one element frame. A group gesture instead scales
 * (or rotates) every selected element about a shared fixed point derived from
 * the group's union frame, so the selection moves as one rigid sheet like in
 * Excalidraw. The pointer-event hook owns store writes; everything closed-form
 * lives here, unit-tested.
 */

export interface GroupFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_GROUP_SIZE = 4;

/** Axis-aligned union of the members' (rotation-aware) bounds. */
export function unionFrame(elements: readonly DriplElement[]): GroupFrame | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let seen = false;
  for (const element of elements) {
    if (!element || element.isDeleted) continue;
    const bounds = getElementBounds(element);
    seen = true;
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }
  if (!seen) return null;
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

export interface GroupResizeOptions {
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Map every snapshot member through a group resize about the fixed point.
 *
 * The fixed point is the corner opposite the dragged handle (the group's
 * center with Alt, mirroring the single-element from-center path). Scale
 * factors come from the resized union frame; each member's origin maps
 * through the fixed point while its relative linear/freedraw points scale
 * about its own origin — the composition is exactly "scale the world about
 * F", so shafts stay glued to their endpoints. Text scales its font by the
 * mean factor so labels shrink with their containers.
 */
export function groupResizeMapping(
  snapshot: ReadonlyMap<string, DriplElement>,
  frame: GroupFrame,
  handle: string,
  dx: number,
  dy: number,
  options: GroupResizeOptions
): Map<string, DriplElement> {
  const aspect = frame.height !== 0 ? frame.width / frame.height : 1;
  const xSign = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const ySign = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;

  let fixedX: number;
  let fixedY: number;
  let newWidth: number;
  let newHeight: number;

  if (options.altKey) {
    fixedX = frame.x + frame.width / 2;
    fixedY = frame.y + frame.height / 2;
    newWidth = xSign === 0 ? frame.width : Math.max(MIN_GROUP_SIZE, frame.width + 2 * xSign * dx);
    newHeight =
      ySign === 0 ? frame.height : Math.max(MIN_GROUP_SIZE, frame.height + 2 * ySign * dy);
  } else {
    fixedX = handle.includes('e') ? frame.x : frame.x + frame.width;
    fixedY = handle.includes('s') ? frame.y : frame.y + frame.height;
    // Direction folded into the sign: 'e' grows with +dx, 'w' with -dx.
    newWidth =
      xSign === 0
        ? frame.width
        : Math.max(MIN_GROUP_SIZE, frame.width + (handle.includes('e') ? dx : -dx));
    newHeight =
      ySign === 0
        ? frame.height
        : Math.max(MIN_GROUP_SIZE, frame.height + (handle.includes('s') ? dy : -dy));
  }

  if (options.shiftKey) {
    const base = Math.max(newWidth, newHeight);
    newWidth = base;
    newHeight = aspect !== 0 ? base / aspect : base;
  }

  // A zero-extent axis (a perfectly horizontal arrow's height) cannot scale —
  // treat it as "do not scale this axis", like the single-linear path does.
  const sx = frame.width > 0 ? newWidth / frame.width : 1;
  const sy = frame.height > 0 ? newHeight / frame.height : 1;

  const next = new Map<string, DriplElement>();
  snapshot.forEach((initial, id) => {
    const fontScale = (sx + sy) / 2;
    const mapped: DriplElement = {
      ...initial,
      x: fixedX + (initial.x - fixedX) * sx,
      y: fixedY + (initial.y - fixedY) * sy,
      width: Math.max(MIN_GROUP_SIZE, initial.width * sx),
      height: Math.max(MIN_GROUP_SIZE, initial.height * sy),
    };
    if (initial.type === 'text' && typeof initial.fontSize === 'number') {
      (mapped as DriplElement & { fontSize: number }).fontSize = Math.max(
        1,
        initial.fontSize * fontScale
      );
    }
    if (
      (initial.type === 'arrow' || initial.type === 'line' || initial.type === 'freedraw') &&
      Array.isArray(initial.points)
    ) {
      (mapped as DriplElement & { points: Point[] }).points = initial.points.map(p => ({
        x: p.x * sx,
        y: p.y * sy,
      }));
    }
    next.set(id, mapped);
  });
  return next;
}

/** Normalize a rotation delta to (-PI, PI] so pointer wrap-around cannot spin the group. */
export function normalizeRotationDelta(delta: number): number {
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  return delta;
}

/**
 * Map every snapshot member through a group rotation: each center orbits the
 * group center by `deltaAngle` and each angle advances by the same delta, so
 * relative layout is preserved while members spin in place like the group
 * does. Linear/freedraw points need no remapping — they rotate rigidly with
 * their element's angle.
 */
export function groupRotateMapping(
  snapshot: ReadonlyMap<string, DriplElement>,
  center: Point,
  deltaAngle: number
): Map<string, DriplElement> {
  const next = new Map<string, DriplElement>();
  snapshot.forEach((initial, id) => {
    const c0 = { x: initial.x + initial.width / 2, y: initial.y + initial.height / 2 };
    const c1 = rotatePoint(c0, center.x, center.y, deltaAngle);
    next.set(id, {
      ...initial,
      x: c1.x - initial.width / 2,
      y: c1.y - initial.height / 2,
      angle: (initial.angle ?? 0) + deltaAngle,
    });
  });
  return next;
}
