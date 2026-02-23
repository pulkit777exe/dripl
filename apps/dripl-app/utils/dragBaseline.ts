/**
 * Baseline-derived drag: compute positions from PointerDownState + delta.
 * Spec §4.6 Interaction Engine — avoids incremental drift, single commit on pointer up.
 */
import type { DriplElement, Point } from "@dripl/common";
import type { PointerDownState } from "@dripl/common";

/**
 * Collect element ids to move when dragging selection (selected + arrow labels + text containers).
 */
export function getDragTargetIds(
  selectedIds: Set<string>,
  elements: readonly DriplElement[],
): Set<string> {
  const ids = new Set(selectedIds);
  selectedIds.forEach((id) => {
    const el = elements.find((e) => e.id === id);
    if (!el) return;
    if (el.type === "arrow" && "labelId" in el && el.labelId)
      ids.add(el.labelId);
    if (el.type === "text" && "containerId" in el && el.containerId)
      ids.add(el.containerId);
  });
  return ids;
}

/** Build PointerDownState for the current selection. */
export function captureDragBaseline(
  downPoint: Point,
  selectedIds: Set<string>,
  elements: readonly DriplElement[],
  pointerId: number,
): PointerDownState {
  const elementIds = getDragTargetIds(selectedIds, elements);
  const originalElements = elements.filter(
    (el) => el.id && elementIds.has(el.id),
  );
  return {
    pointerId,
    downPoint: { ...downPoint },
    originalElements: originalElements.map((el) => ({ ...el })),
    elementIds: [...elementIds],
    timestamp: Date.now(),
  };
}

/** Apply a single delta to baseline elements; returns new elements (immutable). */
export function applyDeltaToBaseline(
  baseline: PointerDownState,
  delta: Point,
): DriplElement[] {
  return baseline.originalElements.map((el) => {
    const next: DriplElement = {
      ...el,
      x: el.x + delta.x,
      y: el.y + delta.y,
    };
    if ("points" in next && next.points) {
      next.points = next.points.map((p: Point) => ({
        x: p.x + delta.x,
        y: p.y + delta.y,
      }));
    }
    return next;
  });
}

/**
 * Merge current scene elements with drag preview: non-dragged from scene,
 * dragged from baseline + totalDelta. Use for rendering during drag.
 */
export function mergeDragPreview(
  sceneElements: readonly DriplElement[],
  baseline: PointerDownState,
  totalDelta: Point,
): DriplElement[] {
  const draggedIds = new Set(baseline.elementIds);
  const previewElements = applyDeltaToBaseline(baseline, totalDelta);
  const previewById = new Map(previewElements.map((el) => [el.id, el]));
  return sceneElements.map((el) =>
    draggedIds.has(el.id) ? (previewById.get(el.id) ?? el) : el,
  );
}
