import { useMemo, useRef } from 'react';
import RBush from 'rbush';
import type { DriplElement } from '@dripl/common';
import { getElementBounds } from '@dripl/math/intersection';
import { useCanvasStore } from '@/lib/store';
import type { Viewport } from '@/utils/canvas-coordinates';

export interface SpatialItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
}

export interface SpatialIndexState {
  tree: RBush<SpatialItem>;
  byId: Map<string, DriplElement>;
  elementIds: Set<string>;
  order: Map<string, number>;
}

/**
 * Incremental RBush spatial index plus viewport culling, extracted verbatim
 * from RoughCanvas. Purely algorithmic: no DOM, no socket, no canvas.
 *
 * The index keeps a rebuild heuristic (full rebuild past 40% churn), a
 * transient-hint fast path for in-flight edits, and a scene-order map. The
 * culling result is identity-stable: the previous array is reused when the
 * ordered ID sequence is unchanged.
 */
export function useSpatialIndex(
  elements: DriplElement[],
  viewport: Viewport
): { spatialIndex: SpatialIndexState; visibleElements: DriplElement[] } {
  // ── Spatial index ──────────────────────────────────────────────────────────
  const spatialIndexRef = useRef<SpatialIndexState>({
    tree: new RBush<SpatialItem>(),
    byId: new Map<string, DriplElement>(),
    elementIds: new Set<string>(),
    order: new Map<string, number>(),
  });

  const spatialVersion = useCanvasStore(s => s.spatialVersion);
  const spatialChangedIds = useCanvasStore(s => s.spatialChangedIds);
  const spatialChangedIdsVersion = useCanvasStore(s => s.spatialChangedIdsVersion);
  const spatialIndex = useMemo<SpatialIndexState>(() => {
    const prev = spatialIndexRef.current;
    const currentElementsById = useCanvasStore.getState().elementsById;
    const hasTransientHints =
      spatialChangedIdsVersion === spatialVersion && spatialChangedIds.length > 0;
    const canApplyTransientHints =
      hasTransientHints &&
      spatialChangedIds.every(id => prev.elementIds.has(id) && currentElementsById.has(id));

    if (canApplyTransientHints) {
      for (const id of spatialChangedIds) {
        const previous = prev.byId.get(id);
        const next = currentElementsById.get(id);
        if (!previous || !next) continue;

        // Re-index whenever the element changed at all, not only when the
        // obvious geometry fields differ. `getElementBounds` also depends on
        // `points` and `strokeWidth`, so a polyline can move in the tree while
        // keeping the same x/y/width/height. Comparing versions is cheaper to
        // reason about and still O(changed), which is the point of this path.
        const needsReindex = previous.version !== next.version;
        if (needsReindex) {
          const previousBounds = getElementBounds(previous);
          prev.tree.remove({
            minX: previousBounds.x,
            minY: previousBounds.y,
            maxX: previousBounds.x + previousBounds.width,
            maxY: previousBounds.y + previousBounds.height,
            id,
          });
          const nextBounds = getElementBounds(next);
          prev.tree.insert({
            minX: nextBounds.x,
            minY: nextBounds.y,
            maxX: nextBounds.x + nextBounds.width,
            maxY: nextBounds.y + nextBounds.height,
            id,
          });
        }
        prev.byId.set(id, next);
      }
      return prev;
    }

    const prevIds = prev.elementIds;
    const currentIds = new Set(elements.map(e => e.id));

    const added = elements.filter(e => !prevIds.has(e.id));
    const removed = [...prevIds].filter(id => !currentIds.has(id));
    const updated = elements.filter(e => {
      const prevEl = prev.byId.get(e.id);
      if (!prevEl) return true;
      return (
        prevEl.x !== e.x ||
        prevEl.y !== e.y ||
        prevEl.width !== e.width ||
        prevEl.height !== e.height ||
        prevEl.angle !== e.angle
      );
    });

    if (added.length + removed.length + updated.length > elements.length * 0.4) {
      const tree = new RBush<SpatialItem>();
      const byId = new Map<string, DriplElement>();
      const elementIds = new Set<string>();
      const order = new Map<string, number>();
      elements.forEach((element, index) => {
        const bounds = getElementBounds(element);
        tree.insert({
          minX: bounds.x,
          minY: bounds.y,
          maxX: bounds.x + bounds.width,
          maxY: bounds.y + bounds.height,
          id: element.id,
        });
        byId.set(element.id, element);
        elementIds.add(element.id);
        order.set(element.id, index);
      });
      spatialIndexRef.current = { tree, byId, elementIds, order };
    } else {
      for (const id of removed) {
        const prevEl = prev.byId.get(id);
        if (prevEl) {
          const bounds = getElementBounds(prevEl);
          prev.tree.remove({
            minX: bounds.x,
            minY: bounds.y,
            maxX: bounds.x + bounds.width,
            maxY: bounds.y + bounds.height,
            id,
          });
          prev.byId.delete(id);
          prevIds.delete(id);
        }
      }
      for (const el of added) {
        const bounds = getElementBounds(el);
        prev.tree.insert({
          minX: bounds.x,
          minY: bounds.y,
          maxX: bounds.x + bounds.width,
          maxY: bounds.y + bounds.height,
          id: el.id,
        });
        prev.byId.set(el.id, el);
        prevIds.add(el.id);
      }
      for (const el of updated) {
        const prevEl = prev.byId.get(el.id);
        if (prevEl) {
          const prevBounds = getElementBounds(prevEl);
          prev.tree.remove({
            minX: prevBounds.x,
            minY: prevBounds.y,
            maxX: prevBounds.x + prevBounds.width,
            maxY: prevBounds.y + prevBounds.height,
            id: el.id,
          });
        }
        const bounds = getElementBounds(el);
        prev.tree.insert({
          minX: bounds.x,
          minY: bounds.y,
          maxX: bounds.x + bounds.width,
          maxY: bounds.y + bounds.height,
          id: el.id,
        });
        prev.byId.set(el.id, el);
      }
    }

    // Geometry determines tree membership, but rendering also depends on
    // style, text, and binding fields. Keep the object payload and scene
    // order current even when an update does not change bounds.
    const currentIndex = spatialIndexRef.current;
    currentIndex.order.clear();
    elements.forEach((element, index) => {
      currentIndex.byId.set(element.id, element);
      currentIndex.order.set(element.id, index);
    });

    return spatialIndexRef.current;
  }, [spatialChangedIds, spatialChangedIdsVersion, spatialVersion, elements]);

  // The spatial index is already maintained for hit testing. Reuse its query
  // result for rendering as well so the static layer does not walk every
  // scene element on each frame. Keep a full-scene fallback during the first
  // index build to avoid a blank frame.
  const visibleElementsRef = useRef<DriplElement[]>([]);
  const visibleElementsSourceRef = useRef<DriplElement[] | null>(null);
  const visibleElementsIndexRef = useRef<SpatialIndexState | null>(null);
  const visibleElements = useMemo<DriplElement[]>(() => {
    if (elements.length === 0) {
      visibleElementsRef.current = [];
      visibleElementsSourceRef.current = elements;
      visibleElementsIndexRef.current = spatialIndex;
      return visibleElementsRef.current;
    }
    if (spatialIndex.elementIds.size === 0) {
      visibleElementsRef.current = elements;
      visibleElementsSourceRef.current = elements;
      visibleElementsIndexRef.current = spatialIndex;
      return elements;
    }

    const padding = 20;
    const zoom = Math.max(viewport.zoom, 0.0001);
    const worldLeft = -viewport.x / zoom - padding;
    const worldTop = -viewport.y / zoom - padding;
    const worldRight = worldLeft + viewport.width / zoom + padding * 2;
    const worldBottom = worldTop + viewport.height / zoom + padding * 2;
    const candidates = spatialIndex.tree.search({
      minX: worldLeft,
      minY: worldTop,
      maxX: worldRight,
      maxY: worldBottom,
    });

    const nextVisibleElements = candidates
      .map(candidate => spatialIndex.byId.get(candidate.id))
      .filter((element): element is DriplElement => Boolean(element && !element.isDeleted))
      .sort((a, b) => (spatialIndex.order.get(a.id) ?? 0) - (spatialIndex.order.get(b.id) ?? 0));
    const previousVisibleElements = visibleElementsRef.current;
    const sameSource =
      visibleElementsSourceRef.current === elements &&
      visibleElementsIndexRef.current === spatialIndex;
    const sameIds =
      previousVisibleElements.length === nextVisibleElements.length &&
      previousVisibleElements.every(
        (element, index) => element.id === nextVisibleElements[index]?.id
      );

    if (sameSource && sameIds) return previousVisibleElements;
    visibleElementsRef.current = nextVisibleElements;
    visibleElementsSourceRef.current = elements;
    visibleElementsIndexRef.current = spatialIndex;
    return nextVisibleElements;
  }, [elements, spatialIndex, viewport]);

  return { spatialIndex, visibleElements };
}
