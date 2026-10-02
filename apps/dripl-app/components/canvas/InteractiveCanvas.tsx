'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type { DriplElement, Point } from '@dripl/common';
import type { Viewport } from '@/utils/canvas-coordinates';
import { renderInteractiveScene, type CollaboratorCursor } from '@/renderer/interactiveScene';
import { useCanvasRenderLoop } from '@/hooks/canvas/useCanvasRenderLoop';
import { usePointerMoveQueue } from '@/hooks/canvas/usePointerMoveQueue';

interface InteractiveCanvasProps {
  containerRef: React.RefObject<HTMLDivElement>;
  elements: DriplElement[];
  selectedIds: Set<string>;
  draftElement: DriplElement | null;
  eraserPath: Point[];
  viewport: Viewport;
  theme?: 'light' | 'dark';
  onPointerDown?: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove?: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp?: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  cursorPosition?: Point | null;
  isDragging?: boolean;
  isResizing?: boolean;
  isDrawing?: boolean;
  marqueeSelection?: {
    start: Point;
    end: Point;
    active: boolean;
  } | null;
  collaborators?: CollaboratorCursor[];
  lockOwners?: ReadonlyMap<string, string>;
  localUserId?: string | null;
  hoveredBindingId?: string | null;
  startPointBindingId?: string | null;
  /** Preserve intermediate samples for freehand/eraser gestures. */
  preservePointerSamples?: boolean;
}

const areEqual = (prev: InteractiveCanvasProps, next: InteractiveCanvasProps): boolean => {
  const selectionChanged =
    prev.selectedIds.size !== next.selectedIds.size ||
    Array.from(prev.selectedIds).some(id => !next.selectedIds.has(id));
  const viewportChanged =
    prev.viewport.x !== next.viewport.x ||
    prev.viewport.y !== next.viewport.y ||
    prev.viewport.zoom !== next.viewport.zoom ||
    prev.viewport.width !== next.viewport.width ||
    prev.viewport.height !== next.viewport.height;

  return !(
    selectionChanged ||
    viewportChanged ||
    prev.elements !== next.elements ||
    prev.draftElement !== next.draftElement ||
    prev.eraserPath !== next.eraserPath ||
    prev.theme !== next.theme ||
    prev.marqueeSelection !== next.marqueeSelection ||
    prev.collaborators !== next.collaborators ||
    prev.lockOwners !== next.lockOwners ||
    prev.localUserId !== next.localUserId ||
    prev.hoveredBindingId !== next.hoveredBindingId ||
    prev.startPointBindingId !== next.startPointBindingId ||
    prev.onPointerDown !== next.onPointerDown ||
    prev.onPointerMove !== next.onPointerMove ||
    prev.onPointerUp !== next.onPointerUp ||
    prev.preservePointerSamples !== next.preservePointerSamples
  );
};

const InteractiveCanvas: React.FC<InteractiveCanvasProps> = ({
  containerRef,
  elements,
  selectedIds,
  draftElement,
  eraserPath,
  viewport,
  theme = 'dark',
  onPointerDown,
  onPointerMove,
  onPointerUp,
  marqueeSelection,
  collaborators = [],
  lockOwners = new Map<string, string>(),
  localUserId = null,
  hoveredBindingId,
  startPointBindingId,
  preservePointerSamples = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dprRef = useRef(1);
  const sizeRef = useRef({ width: 0, height: 0 });
  const propsRef = useRef({
    elements,
    selectedIds,
    draftElement,
    eraserPath,
    viewport,
    theme,
    marqueeSelection,
    collaborators,
    lockOwners,
    localUserId,
    hoveredBindingId,
    startPointBindingId,
  });

  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const props = propsRef.current;
    renderInteractiveScene({
      ctx,
      viewport: {
        ...props.viewport,
        width: sizeRef.current.width,
        height: sizeRef.current.height,
      },
      canvasWidth: sizeRef.current.width,
      canvasHeight: sizeRef.current.height,
      elements: props.elements,
      draftElement: props.draftElement,
      eraserPath: props.eraserPath,
      selectedIds: props.selectedIds,
      marqueeSelection: props.marqueeSelection,
      collaborators: props.collaborators,
      lockOwners: props.lockOwners,
      localUserId: props.localUserId,
      gridEnabled: false,
      theme: props.theme,
      renderCommittedElements: false,
      dpr: dprRef.current,
      hoveredBindingId: props.hoveredBindingId,
      startPointBindingId: props.startPointBindingId,
    });
  }, []);
  const markDirty = useCanvasRenderLoop(renderFrame, 'canvas:interactive');

  useEffect(() => {
    propsRef.current = {
      elements,
      selectedIds,
      draftElement,
      eraserPath,
      viewport,
      theme,
      marqueeSelection,
      collaborators,
      lockOwners,
      localUserId,
      hoveredBindingId,
      startPointBindingId,
    };
    markDirty();
  }, [
    elements,
    selectedIds,
    draftElement,
    eraserPath,
    viewport,
    theme,
    marqueeSelection,
    collaborators,
    lockOwners,
    localUserId,
    hoveredBindingId,
    startPointBindingId,
    markDirty,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const width = Math.max(1, container.offsetWidth);
      const height = Math.max(1, container.offsetHeight);
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
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(resize);
      observer.observe(container);
    }

    return () => {
      window.removeEventListener('resize', resize);
      observer?.disconnect();
    };
  }, [containerRef, markDirty]);

  const { flushPointerMove, handlePointerMove } = usePointerMoveQueue(
    onPointerMove,
    preservePointerSamples
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      // Keep keyboard navigation attached to the editor when a pointer starts
      // on either canvas layer. Pointer capture below still lets the gesture
      // continue outside the visible canvas bounds.
      event.currentTarget.focus();
      flushPointerMove();
      onPointerDown?.(event);
    },
    [flushPointerMove, onPointerDown]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      // Apply the final coalesced move before finalizing a drag/drawing so the
      // committed element includes the release position.
      flushPointerMove();
      onPointerUp?.(event);
    },
    [flushPointerMove, onPointerUp]
  );

  const handlePointerLeave = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      // Pointer capture is the normal path. Only use leave as a cleanup
      // fallback for browsers that do not implement it; otherwise leaving the
      // canvas would prematurely finish a drag or freehand stroke.
      if (
        typeof event.currentTarget.hasPointerCapture === 'function' &&
        event.currentTarget.hasPointerCapture(event.pointerId)
      ) {
        return;
      }
      handlePointerUp(event);
    },
    [handlePointerUp]
  );

  const style = useMemo<React.CSSProperties>(
    () => ({
      zIndex: 2,
      cursor: 'default',
      pointerEvents: 'auto',
      touchAction: 'none',
    }),
    []
  );

  return (
    <canvas
      ref={canvasRef}
      className="canvas-surface absolute inset-0"
      style={style}
      tabIndex={0}
      aria-label="Drawing canvas"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      Drawing canvas
    </canvas>
  );
};

export default React.memo(InteractiveCanvas, areEqual);
