import type { DriplElement, LinearElement, NormalizedBinding, Point } from '@dripl/common';
import { getElementBounds } from '@dripl/math/intersection';

const DEFAULT_BINDING_THRESHOLD = 24;

function isLinearElement(element: DriplElement): element is LinearElement {
  return element.type === 'arrow' || element.type === 'line';
}

function distanceToBounds(point: Point, element: DriplElement): number {
  const bounds = getElementBounds(element);
  const nearestX = Math.max(bounds.x, Math.min(point.x, bounds.x + bounds.width));
  const nearestY = Math.max(bounds.y, Math.min(point.y, bounds.y + bounds.height));
  return Math.hypot(point.x - nearestX, point.y - nearestY);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function getAbsolutePoints(element: LinearElement): Point[] {
  return element.points.map(point => ({
    x: element.x + point.x,
    y: element.y + point.y,
  }));
}

export function getBindingPoint(element: DriplElement, binding: NormalizedBinding): Point {
  const bounds = getElementBounds(element);
  return {
    x: bounds.x + clamp01(binding.fixedPoint.x) * bounds.width,
    y: bounds.y + clamp01(binding.fixedPoint.y) * bounds.height,
  };
}

export function calculateBinding(point: Point, element: DriplElement): NormalizedBinding {
  const bounds = getElementBounds(element);
  const width = bounds.width || 1;
  const height = bounds.height || 1;
  const localX = clamp01((point.x - bounds.x) / width);
  const localY = clamp01((point.y - bounds.y) / height);

  const edgeDistances = [
    { point: { x: 0, y: localY }, distance: localX },
    { point: { x: 1, y: localY }, distance: 1 - localX },
    { point: { x: localX, y: 0 }, distance: localY },
    { point: { x: localX, y: 1 }, distance: 1 - localY },
  ];
  edgeDistances.sort((a, b) => a.distance - b.distance);

  return {
    elementId: element.id,
    fixedPoint: edgeDistances[0]?.point ?? { x: localX, y: localY },
    mode: 'orbit',
  };
}

export function findNearestBindableElement(
  point: Point,
  elements: DriplElement[],
  options: {
    excludeIds?: Set<string>;
    threshold?: number;
  } = {}
): { element: DriplElement; binding: NormalizedBinding; point: Point } | null {
  const threshold = options.threshold ?? DEFAULT_BINDING_THRESHOLD;
  let closest: { element: DriplElement; binding: NormalizedBinding; point: Point; distance: number } | null = null;

  for (const element of elements) {
    if (options.excludeIds?.has(element.id)) continue;
    if (isLinearElement(element) || element.type === 'freedraw' || element.type === 'text') continue;

    const distance = distanceToBounds(point, element);
    if (distance > threshold || (closest && distance >= closest.distance)) continue;

    const binding = calculateBinding(point, element);
    closest = {
      element,
      binding,
      point: getBindingPoint(element, binding),
      distance,
    };
  }

  return closest ? { element: closest.element, binding: closest.binding, point: closest.point } : null;
}

export function setLinearEndpoint(
  element: LinearElement,
  terminal: 'start' | 'end',
  point: Point
): LinearElement {
  const absolutePoints = getAbsolutePoints(element);
  const index = terminal === 'start' ? 0 : absolutePoints.length - 1;
  if (index < 0) return element;

  absolutePoints[index] = point;

  const minX = Math.min(...absolutePoints.map(p => p.x));
  const minY = Math.min(...absolutePoints.map(p => p.y));
  const maxX = Math.max(...absolutePoints.map(p => p.x));
  const maxY = Math.max(...absolutePoints.map(p => p.y));

  return {
    ...element,
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    points: absolutePoints.map(p => ({ x: p.x - minX, y: p.y - minY })),
  };
}

export function attachLinearElementBindings(
  element: LinearElement,
  elements: DriplElement[],
  options: {
    suppressBinding?: boolean;
    threshold?: number;
  } = {}
): LinearElement {
  if (options.suppressBinding || element.points.length < 2) return element;

  const absolutePoints = getAbsolutePoints(element);
  const start = absolutePoints[0];
  const end = absolutePoints[absolutePoints.length - 1];
  if (!start || !end) return element;

  const excludeIds = new Set([element.id]);
  const startMatch = findNearestBindableElement(start, elements, {
    excludeIds,
    threshold: options.threshold,
  });
  const endMatch = findNearestBindableElement(end, elements, {
    excludeIds: new Set([...excludeIds, startMatch?.element.id ?? '']),
    threshold: options.threshold,
  });

  let next = element;
  if (startMatch) {
    next = setLinearEndpoint(next, 'start', startMatch.point);
    next.startBinding = startMatch.binding;
  }
  if (endMatch) {
    next = setLinearEndpoint(next, 'end', endMatch.point);
    next.endBinding = endMatch.binding;
  }

  return next;
}

export function updateBoundLinearElements(
  elements: DriplElement[],
  changedElementIds: Set<string>
): DriplElement[] {
  let changed = false;
  const byId = new Map(elements.map(element => [element.id, element]));
  const nextElements = elements.map(element => {
    if (!isLinearElement(element)) return element;

    let next = element;
    const startTargetId = element.startBinding?.elementId;
    const endTargetId = element.endBinding?.elementId;

    if (startTargetId && changedElementIds.has(startTargetId) && element.startBinding) {
      const target = byId.get(startTargetId);
      if (target) {
        next = setLinearEndpoint(next, 'start', getBindingPoint(target, element.startBinding));
      }
    }
    if (endTargetId && changedElementIds.has(endTargetId) && element.endBinding) {
      const target = byId.get(endTargetId);
      if (target) {
        next = setLinearEndpoint(next, 'end', getBindingPoint(target, element.endBinding));
      }
    }

    if (next !== element) changed = true;
    return next;
  });

  return changed ? nextElements : elements;
}

