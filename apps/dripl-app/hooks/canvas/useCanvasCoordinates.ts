'use client';

import { useCallback, type RefObject } from 'react';
import { screenToCanvas, type Viewport } from '@/utils/canvas-coordinates';

export interface CanvasPoint {
  x: number;
  y: number;
}

interface UseCanvasCoordinatesOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  viewport: Viewport;
  gridEnabled: boolean;
  gridSize: number;
}

/**
 * Pointer → canvas coordinate helpers.
 *
 * Extracted verbatim from RoughCanvas: DOM hit resolution plus grid
 * snapping. Pure mapping logic — no store writes, no socket.
 */
export function useCanvasCoordinates({
  containerRef,
  viewport,
  gridEnabled,
  gridSize,
}: UseCanvasCoordinatesOptions) {
  const getCanvasCoordinates = useCallback(
    (e: React.MouseEvent | React.DragEvent | React.PointerEvent): CanvasPoint => {
      const target = e.target as Node;
      const canvas =
        target && target instanceof HTMLCanvasElement
          ? target
          : containerRef.current?.querySelector('canvas');
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const pixelX = e.clientX - rect.left;
      const pixelY = e.clientY - rect.top;
      return screenToCanvas(pixelX, pixelY, viewport);
    },
    // Viewport is derived from pan/zoom/size; depend on the whole object so
    // the callback never closes over a stale transform.
    [containerRef, viewport]
  );

  const snapPointToGrid = useCallback(
    (point: CanvasPoint): CanvasPoint => {
      if (!gridEnabled || gridSize <= 1) return point;
      return {
        x: Math.round(point.x / gridSize) * gridSize,
        y: Math.round(point.y / gridSize) * gridSize,
      };
    },
    [gridEnabled, gridSize]
  );

  return { getCanvasCoordinates, snapPointToGrid };
}
