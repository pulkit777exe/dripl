'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';
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
 * DOM hit resolution plus grid snapping. Pure mapping logic — no store
 * writes, no socket. The canvas origin is read once per animation frame and
 * the viewport transform is held in a ref, so per-frame pointer traffic pays
 * one layout and mints no new callbacks while pan/zoom churn.
 */
export function useCanvasCoordinates({
  containerRef,
  viewport,
  gridEnabled,
  gridSize,
}: UseCanvasCoordinatesOptions) {
  /**
   * The viewport transform is read at event time, not render time. The
   * viewport object is rebuilt on every pan/zoom commit, so closing over it
   * would mint a new `getCanvasCoordinates` — and downstream a new
   * `handlePointerMove` and a new InteractiveCanvas `onPointerMove` prop — on
   * every frame of a gesture. The ref keeps the callback (and everything
   * memoized on it) stable while always applying the latest transform.
   */
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  /**
   * Canvas origin, cached for the remainder of the current animation frame.
   *
   * `getBoundingClientRect` forces layout, and the canvas box does not move
   * within a frame: viewport changes are applied as a canvas draw transform,
   * not as DOM movement. A freehand stroke replays every coalesced sample in
   * one frame, so reading per sample paid one layout per sample for the same
   * box. The entry self-clears on the next frame, so a resize between frames
   * is never served stale — and every sample in a frame shares one origin,
   * which is the consistent reading anyway.
   */
  const originCacheRef = useRef<{ canvas: HTMLCanvasElement; left: number; top: number } | null>(
    null
  );
  const clearFrameRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (clearFrameRef.current !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(clearFrameRef.current);
      }
    },
    []
  );

  const readCanvasOrigin = useCallback((canvas: HTMLCanvasElement) => {
    const cached = originCacheRef.current;
    if (cached && cached.canvas === canvas) return cached;
    const rect = canvas.getBoundingClientRect();
    const entry = { canvas, left: rect.left, top: rect.top };
    originCacheRef.current = entry;
    if (typeof requestAnimationFrame !== 'undefined') {
      if (clearFrameRef.current !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(clearFrameRef.current);
      }
      clearFrameRef.current = requestAnimationFrame(() => {
        originCacheRef.current = null;
        clearFrameRef.current = null;
      });
    }
    return entry;
  }, []);

  const getCanvasCoordinates = useCallback(
    (e: React.MouseEvent | React.DragEvent | React.PointerEvent): CanvasPoint => {
      const target = e.target as Node;
      const canvas =
        target && target instanceof HTMLCanvasElement
          ? target
          : containerRef.current?.querySelector('canvas');
      if (!canvas) return { x: 0, y: 0 };
      const rect = readCanvasOrigin(canvas);
      const pixelX = e.clientX - rect.left;
      const pixelY = e.clientY - rect.top;
      return screenToCanvas(pixelX, pixelY, viewportRef.current);
    },
    // The viewport transform is read from a ref at event time, so the callback
    // stays stable while pan/zoom churn. Depending on the viewport object would
    // mint a new callback (and, downstream, a new pointer-move handler and a new
    // InteractiveCanvas `onPointerMove` prop) on every frame of a pan or zoom.
    [containerRef, readCanvasOrigin]
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
