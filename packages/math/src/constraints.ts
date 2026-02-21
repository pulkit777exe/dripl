/**
 * Constraint helpers for Phase 4: binding endpoints and frame ordering.
 * Spec §5.3 Binding Constraint System, §5.4 Frame Constraint System.
 */
import type { DriplElement, NormalizedBinding, Point } from "@dripl/common";
import { getElementBounds } from "./intersection";
import type { Bounds } from "./geometry";

/**
 * Derive world-space endpoint from a normalized binding.
 * fixedPoint (0–1) maps to element bounds; for linear elements, fixedPoint.x is t along the path.
 */
export function deriveBindingEndpoint(
  element: DriplElement,
  fixedPoint: Point,
): Point {
  const b = getElementBounds(element);
  if (
    element.type === "arrow" ||
    element.type === "line"
  ) {
    const points = (element as { points?: Point[] }).points;
    if (points && points.length >= 2) {
      const t = Math.max(0, Math.min(1, fixedPoint.x));
      const i0 = Math.floor(t * (points.length - 1));
      const i1 = Math.min(i0 + 1, points.length - 1);
      const t0 = i0 / (points.length - 1);
      const t1 = i1 / (points.length - 1);
      const s = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
      const p0 = points[i0]!;
      const p1 = points[i1]!;
      return {
        x: element.x + p0.x + s * (p1.x - p0.x),
        y: element.y + p0.y + s * (p1.y - p0.y),
      };
    }
  }
  return {
    x: b.x + fixedPoint.x * b.width,
    y: b.y + fixedPoint.y * b.height,
  };
}

/**
 * Get world point for a NormalizedBinding given the target element.
 */
export function getBindingEndpoint(
  binding: NormalizedBinding,
  elements: ReadonlyArray<DriplElement>,
): Point | null {
  const el = elements.find((e) => e.id === binding.elementId);
  if (!el) return null;
  return deriveBindingEndpoint(el, binding.fixedPoint);
}

/**
 * Containment: is the point (or element bounds center) inside the given bounds?
 */
export function boundsContain(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Check if an element is contained inside a frame's bounds (by geometry).
 * Use when frameId is not yet on the model; otherwise prefer frameId.
 */
export function isElementInFrame(
  element: DriplElement,
  frame: DriplElement,
  elements: ReadonlyArray<DriplElement>,
): boolean {
  if (frame.type !== "frame") return false;
  const frameBounds = getElementBounds(frame);
  const elementBounds = getElementBounds(element);
  return boundsContain(frameBounds, elementBounds);
}

/**
 * Return elements in draw order satisfying: children before their frame (Spec §5.4).
 * When elements have frameId, orders so that index(child) < index(frame).
 * For now preserves input order; extend when frameId is added to the model.
 */
export function getOrderedElementsWithFrames(
  elements: ReadonlyArray<DriplElement>,
): DriplElement[] {
  const list = [...elements].filter((el) => !el.isDeleted);
  const frameIds = new Set(
    list.filter((el) => el.type === "frame").map((el) => el.id),
  );
  const withFrame = list.filter(
    (el) => (el as DriplElement & { frameId?: string }).frameId != null,
  );
  if (withFrame.length === 0) return list;
  const byFrame = new Map<string, DriplElement[]>();
  const withoutFrame: DriplElement[] = [];
  for (const el of list) {
    const fid = (el as DriplElement & { frameId?: string }).frameId;
    if (fid && frameIds.has(fid)) {
      const arr = byFrame.get(fid) ?? [];
      arr.push(el);
      byFrame.set(fid, arr);
    } else if (el.type !== "frame") {
      withoutFrame.push(el);
    }
  }
  const frames = list.filter((el) => el.type === "frame");
  const out: DriplElement[] = [];
  const added = new Set<string>();
  function add(id: string) {
    if (added.has(id)) return;
    added.add(id);
    const children = byFrame.get(id);
    if (children) {
      for (const c of children) add(c.id);
    }
    const el = list.find((e) => e.id === id);
    if (el) out.push(el);
  }
  for (const el of withoutFrame) {
    if (!(el as DriplElement & { frameId?: string }).frameId) add(el.id);
  }
  for (const f of frames) add(f.id);
  for (const el of list) {
    if (!added.has(el.id)) out.push(el);
  }
  return out;
}
