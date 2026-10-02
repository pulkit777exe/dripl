import type { DriplElement } from '@dripl/common';
import { getElementBounds } from '@dripl/math/intersection';

/**
 * Selection helpers — pure functions extracted from `canvasSlice.ts`.
 *
 * Group expansion and bounds measurement close over nothing; the slice
 * keeps one-line delegating actions so existing `state.*` call sites
 * (pointer events) are untouched. Directly unit-testable.
 */

/** Expand ids with every element sharing their groups. */
export function expandSelectionWithGroups(
  ids: Set<string>,
  sceneElements: DriplElement[]
): Set<string> {
  const expanded = new Set(ids);
  if (ids.size === 0) return expanded;

  const groupIds = new Set<string>();
  sceneElements.forEach(element => {
    if (ids.has(element.id) && element.groupId) {
      groupIds.add(element.groupId);
    }
  });

  if (groupIds.size === 0) return expanded;

  sceneElements.forEach(element => {
    if (element.groupId && groupIds.has(element.groupId)) {
      expanded.add(element.id);
    }
  });

  return expanded;
}

export interface SelectionBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Axis-aligned bounds of the selected elements, or null when empty. */
export function getSelectionBounds(
  selected: Set<string>,
  sceneElements: DriplElement[]
): SelectionBounds | null {
  const selectedElements = sceneElements.filter(element => selected.has(element.id));
  if (selectedElements.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  selectedElements.forEach(element => {
    const bounds = getElementBounds(element);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  });

  return { minX, minY, maxX, maxY };
}
