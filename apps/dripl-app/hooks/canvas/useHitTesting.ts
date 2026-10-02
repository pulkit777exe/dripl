'use client';

import { useCallback } from 'react';
import {
  isPointNearElement,
  shouldTestInside,
  isPointOnElementOutline,
} from '@dripl/math/intersection';
import type { DriplElement } from '@dripl/common';
import { useCanvasStore } from '@/lib/store';
import type { SpatialIndexState } from './useSpatialIndex';

export interface HitBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Hit-testing helpers over the RBush spatial index.
 *
 * Extracted verbatim from RoughCanvas: front-to-back candidate ordering,
 * zoom-aware thresholds, collaborative/personal lock skips, and the bound-text
 * container redirect. Behavior is unchanged — only the home moved, so the
 * 884-line orchestrator shrinks toward an ActionManager-style composition
 * of focused hooks.
 */
export function useHitTesting(spatialIndex: SpatialIndexState) {
  const getOrderedSpatialCandidates = useCallback(
    (bounds: HitBounds): DriplElement[] =>
      spatialIndex.tree
        .search(bounds)
        .sort((a, b) => (spatialIndex.order.get(b.id) ?? 0) - (spatialIndex.order.get(a.id) ?? 0))
        .map(candidate => spatialIndex.byId.get(candidate.id))
        .filter((element): element is DriplElement => Boolean(element && !element.isDeleted)),
    [spatialIndex]
  );

  const getElementAtPosition = useCallback(
    (x: number, y: number): DriplElement | null => {
      const state = useCanvasStore.getState();
      // Zoom-aware hit threshold: wider tolerance at low zoom, narrower at high zoom
      const hitThreshold = Math.max(2, 8 / state.zoom);
      const candidates = getOrderedSpatialCandidates({
        minX: x - hitThreshold,
        minY: y - hitThreshold,
        maxX: x + hitThreshold,
        maxY: y + hitThreshold,
      });
      for (const element of candidates) {
        // Skip elements locked by other users (collaborative locks)
        if (
          state.elementLocks.has(element.id) &&
          state.elementLocks.get(element.id) !== state.userId
        ) {
          continue;
        }
        // Skip individually locked elements — they should not be selectable
        if (element.locked) continue;
        // Per-element zoom-aware tolerance: thin elements get extra slack at low zoom
        const elThreshold = Math.max((element.strokeWidth ?? 2) / 2 + 0.1, 8 / state.zoom);
        // For unfilled shapes, only test the stroke outline; for filled shapes, test inside + outline
        const hit = shouldTestInside(element)
          ? isPointNearElement({ x, y }, element, elThreshold)
          : isPointOnElementOutline({ x, y }, element, elThreshold);
        if (!hit) continue;
        if (element.type === 'text' && ('boundElementId' in element || 'containerId' in element)) {
          const containerId =
            ('boundElementId' in element ? element.boundElementId : undefined) ??
            ('containerId' in element ? element.containerId : undefined);
          if (containerId) {
            const container = state.elementsById.get(containerId);
            if (
              container &&
              !container.locked &&
              (!state.elementLocks.has(container.id) ||
                state.elementLocks.get(container.id) === state.userId)
            ) {
              return container;
            }
          }
        }
        return element;
      }
      return null;
    },
    [getOrderedSpatialCandidates]
  );

  /**
   * Returns ALL elements at a given point, ordered from highest to lowest z-index.
   * Used for overlap resolution (preferSelected, bounding-box tiebreak).
   */
  const getElementsAtPosition = useCallback(
    (x: number, y: number): DriplElement[] => {
      const state = useCanvasStore.getState();
      const hitThreshold = Math.max(2, 8 / state.zoom);
      const candidates = getOrderedSpatialCandidates({
        minX: x - hitThreshold,
        minY: y - hitThreshold,
        maxX: x + hitThreshold,
        maxY: y + hitThreshold,
      });
      const hits: DriplElement[] = [];
      for (const element of candidates) {
        if (
          state.elementLocks.has(element.id) &&
          state.elementLocks.get(element.id) !== state.userId
        ) {
          continue;
        }
        if (element.locked) continue;
        const elThreshold = Math.max((element.strokeWidth ?? 2) / 2 + 0.1, 8 / state.zoom);
        const hit = shouldTestInside(element)
          ? isPointNearElement({ x, y }, element, elThreshold)
          : isPointOnElementOutline({ x, y }, element, elThreshold);
        if (!hit) continue;
        // Skip bound text — hitting text hits the container
        if (element.type === 'text' && ('boundElementId' in element || 'containerId' in element)) {
          continue;
        }
        hits.push(element);
      }
      return hits;
    },
    [getOrderedSpatialCandidates]
  );

  return {
    getOrderedSpatialCandidates,
    getElementAtPosition,
    getElementsAtPosition,
  };
}
