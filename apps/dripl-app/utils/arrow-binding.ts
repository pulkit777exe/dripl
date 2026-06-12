import type { DriplElement, LinearElement, NormalizedBinding, Point } from '@dripl/common';
import { isBindableElement } from '@dripl/common/arrow-binding';

/**
 * Find the nearest bindable element to a point.
 * Prefers smaller shapes on overlap (matching Excalidraw's collision.ts:361-367).
 */
export function findBindableElementAtPoint(
  point: Point,
  elements: DriplElement[],
  excludeId: string,
  threshold: number = 20
): DriplElement | null {
  let best: DriplElement | null = null;
  let bestArea = Infinity;

  for (const el of elements) {
    if (el.id === excludeId) continue;
    if (el.isDeleted) continue;
    if (!isBindableElement(el)) continue;

    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const dist = Math.hypot(point.x - cx, point.y - cy);
    if (dist > threshold) continue;

    const area = el.width * el.height;
    if (area < bestArea) {
      bestArea = area;
      best = el;
    }
  }
  return best;
}

/**
 * Bind an arrow endpoint to a target element.
 * Sets binding on arrow AND appends to target's boundElements.
 * Pure function: returns new array.
 */
export function bindArrowToElement(
  arrow: LinearElement,
  targetId: string,
  startOrEnd: 'start' | 'end',
  fixedPoint: Point,
  mode: 'inside' | 'orbit',
  elements: DriplElement[]
): DriplElement[] {
  const binding: NormalizedBinding = { elementId: targetId, fixedPoint, mode };
  const bindingKey = startOrEnd === 'start' ? 'startBinding' : 'endBinding';

  const updatedArrow = { ...arrow, [bindingKey]: binding };

  const target = elements.find(e => e.id === targetId);
  if (!target) return elements.map(e => (e.id === arrow.id ? updatedArrow : e));

  const existingBounds = (target as DriplElement & { boundElements?: Array<{ id: string; type: string }> }).boundElements;
  const alreadyBound = existingBounds?.some(b => b.id === arrow.id);
  const newBounds = alreadyBound
    ? existingBounds
    : [...(existingBounds || []), { id: arrow.id, type: 'arrow' as const }];

  const updatedTarget = { ...target, boundElements: newBounds };

  return elements.map(e => {
    if (e.id === arrow.id) return updatedArrow;
    if (e.id === targetId) return updatedTarget;
    return e;
  });
}

/**
 * Unbind an arrow endpoint from its target.
 * Nulls binding on arrow AND removes from target's boundElements.
 * Pure function: returns new array.
 */
export function unbindArrowFromElement(
  arrow: LinearElement,
  startOrEnd: 'start' | 'end',
  elements: DriplElement[]
): DriplElement[] {
  const bindingKey = startOrEnd === 'start' ? 'startBinding' : 'endBinding';
  const binding = arrow[bindingKey];
  if (!binding) return elements;

  const updatedArrow = { ...arrow, [bindingKey]: null };

  // Only remove from boundElements if other end isn't bound to same element
  const otherKey = startOrEnd === 'start' ? 'endBinding' : 'startBinding';
  const otherBinding = arrow[otherKey];
  const shouldRemoveFromTarget = !otherBinding || otherBinding.elementId !== binding.elementId;

  if (!shouldRemoveFromTarget) {
    return elements.map(e => (e.id === arrow.id ? updatedArrow : e));
  }

  const target = elements.find(e => e.id === binding.elementId);
  if (!target) return elements.map(e => (e.id === arrow.id ? updatedArrow : e));

  const existingBounds = (target as DriplElement & { boundElements?: Array<{ id: string; type: string }> }).boundElements;
  const updatedTarget = {
    ...target,
    boundElements: existingBounds?.filter(b => b.id !== arrow.id) ?? [],
  };

  return elements.map(e => {
    if (e.id === arrow.id) return updatedArrow;
    if (e.id === binding.elementId) return updatedTarget;
    return e;
  });
}

/**
 * Unbind all arrows that reference deleted elements.
 * Arrows survive with null bindings (matching Excalidraw's fixBindingsAfterDeletion).
 */
export function unbindAffectedByDeletion(
  deletedIds: string[],
  elements: DriplElement[]
): DriplElement[] {
  const deletedSet = new Set(deletedIds);
  let result = elements;

  for (const el of elements) {
    if (el.type !== 'arrow' && el.type !== 'line') continue;
    const arrow = el as LinearElement;

    if (arrow.startBinding && deletedSet.has(arrow.startBinding.elementId)) {
      result = unbindArrowFromElement(arrow, 'start', result);
    }
    // Re-fetch arrow from result since unbindArrowFromElement returns new array
    const updatedArrow = result.find(e => e.id === arrow.id) as LinearElement | undefined;
    if (updatedArrow?.endBinding && deletedSet.has(updatedArrow.endBinding.elementId)) {
      result = unbindArrowFromElement(updatedArrow, 'end', result);
    }
  }

  return result;
}
