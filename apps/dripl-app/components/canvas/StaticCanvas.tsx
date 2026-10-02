'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type { DriplElement } from '@dripl/common';
import type { Viewport } from '@/utils/canvas-coordinates';
import {
  renderStaticScene,
  getInvalidateCallCount,
  resetInvalidateCallCount,
  getElementBitmapCacheStatsForTest,
  type StaticSceneFrameStats,
} from '@dripl/element/staticScene';
import { useCanvasRenderLoop } from '@/hooks/canvas/useCanvasRenderLoop';

type StaticFrameStatsWindow = Window & {
  __driplStaticFrames?: StaticSceneFrameStats[];
  __driplInvalidateCalls?: number;
  __driplResetInvalidate?: () => void;
  __driplBitmapCache?: { entries: number; trackedBytes: number };
};

const perfEnabled = process.env.NODE_ENV !== 'production';
const MAX_RECORDED_FRAMES = 300;

/**
 * Record the per-frame counters in development only.
 *
 * Timing a static frame cannot tell you whether the cost was allocating
 * per-element bitmaps or blitting thousands of them, and a single frame cannot
 * show whether viewport culling dropped elements. Recording every frame answers
 * both.
 */
function publishFrameStats(stats: StaticSceneFrameStats): void {
  if (!perfEnabled || typeof window === 'undefined') return;
  const target = window as StaticFrameStatsWindow;
  target.__driplInvalidateCalls = getInvalidateCallCount();
  target.__driplResetInvalidate = resetInvalidateCallCount;
  target.__driplBitmapCache = getElementBitmapCacheStatsForTest();
  const frames = target.__driplStaticFrames ?? [];
  frames.push(stats);
  if (frames.length > MAX_RECORDED_FRAMES) {
    frames.splice(0, frames.length - MAX_RECORDED_FRAMES);
  }
  target.__driplStaticFrames = frames;
}

interface StaticCanvasProps {
  containerRef?: React.RefObject<HTMLDivElement>;
  /** Complete scene, retained for relationship-aware rendering. */
  elements: DriplElement[];
  /** Viewport candidates from the spatial index. */
  visibleElements?: readonly DriplElement[];
  viewport: Viewport;
  gridEnabled?: boolean;
  gridSize?: number;
  theme: 'light' | 'dark';
  shouldCacheIgnoreZoom?: boolean;
}

const areEqual = (prev: StaticCanvasProps, next: StaticCanvasProps): boolean =>
  prev.elements === next.elements &&
  prev.visibleElements === next.visibleElements &&
  prev.viewport.x === next.viewport.x &&
  prev.viewport.y === next.viewport.y &&
  prev.viewport.zoom === next.viewport.zoom &&
  prev.viewport.width === next.viewport.width &&
  prev.viewport.height === next.viewport.height &&
  prev.gridEnabled === next.gridEnabled &&
  prev.gridSize === next.gridSize &&
  prev.theme === next.theme &&
  prev.shouldCacheIgnoreZoom === next.shouldCacheIgnoreZoom;

const StaticCanvas: React.FC<StaticCanvasProps> = ({
  containerRef,
  elements,
  visibleElements,
  viewport,
  gridEnabled = false,
  gridSize = 20,
  theme,
  shouldCacheIgnoreZoom = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dprRef = useRef(1);
  const sizeRef = useRef({ width: 0, height: 0 });
  const markDirtyRef = useRef<() => void>(() => undefined);
  /**
   * Elements still waiting for a cached bitmap after a frame that hit its
   * allocation budget. They were drawn directly, so the scene is already
   * correct; this only tracks that follow-up frames are still owed.
   */
  const deferredRef = useRef(0);
  const propsRef = useRef({
    elements,
    visibleElements,
    viewport,
    gridEnabled,
    gridSize,
    theme,
    shouldCacheIgnoreZoom,
  });

  const handleFrameStats = useCallback((stats: StaticSceneFrameStats) => {
    publishFrameStats(stats);
    if (stats.bitmapsDeferred > 0) {
      // Schedule one more frame so the deferred elements get their cached
      // bitmaps. The render loop coalesces, so this cannot stack frames.
      deferredRef.current = stats.bitmapsDeferred;
      markDirtyRef.current();
    } else {
      deferredRef.current = 0;
    }
  }, []);

  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const props = propsRef.current;
    renderStaticScene(
      canvas,
      props.elements,
      {
        x: props.viewport.x,
        y: props.viewport.y,
        width: sizeRef.current.width,
        height: sizeRef.current.height,
        zoom: props.viewport.zoom,
      },
      {
        gridEnabled: props.gridEnabled,
        gridSize: props.gridSize,
        zoom: props.viewport.zoom,
        theme: props.theme,
        dpr: dprRef.current,
        shouldCacheIgnoreZoom: props.shouldCacheIgnoreZoom,
        elements: props.elements,
        visibleElements: props.visibleElements,
        onAssetLoad: () => markDirtyRef.current(),
        onFrameStats: handleFrameStats,
      }
    );
  }, []);
  const markDirty = useCanvasRenderLoop(renderFrame, 'canvas:static');
  markDirtyRef.current = markDirty;

  useEffect(() => {
    propsRef.current = {
      elements,
      visibleElements,
      viewport,
      gridEnabled,
      gridSize,
      theme,
      shouldCacheIgnoreZoom,
    };
    markDirty();
  }, [
    elements,
    visibleElements,
    viewport,
    gridEnabled,
    gridSize,
    theme,
    shouldCacheIgnoreZoom,
    markDirty,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef?.current;
    if (!canvas) return;

    const resize = () => {
      const sourceWidth = container?.offsetWidth || viewport.width || window.innerWidth;
      const sourceHeight = container?.offsetHeight || viewport.height || window.innerHeight;
      const width = Math.max(1, sourceWidth);
      const height = Math.max(1, sourceHeight);
      const dpr = window.devicePixelRatio || 1;
      dprRef.current = dpr;
      sizeRef.current = { width, height };

      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      markDirty();
    };

    resize();
    window.addEventListener('resize', resize);

    let observer: ResizeObserver | null = null;
    if (container && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(resize);
      observer.observe(container);
    }

    return () => {
      window.removeEventListener('resize', resize);
      observer?.disconnect();
    };
  }, [containerRef, viewport.width, viewport.height, markDirty]);

  const canvasStyle = useMemo<React.CSSProperties>(
    () => ({
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      zIndex: 1,
      touchAction: 'none',
      imageRendering: 'crisp-edges',
      pointerEvents: 'none',
    }),
    []
  );

  return (
    <canvas
      ref={canvasRef}
      className="canvas-surface pointer-events-none"
      style={canvasStyle}
      aria-hidden="true"
      tabIndex={-1}
    />
  );
};

export default React.memo(StaticCanvas, areEqual);
