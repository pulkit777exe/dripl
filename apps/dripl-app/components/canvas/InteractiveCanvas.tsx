'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import type { DriplElement, Point } from '@dripl/common';
import type { Viewport } from '@/utils/canvas-coordinates';
import { renderInteractiveScene, type CollaboratorCursor } from '@/renderer/interactiveScene';

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
}

const areEqual = (prev: InteractiveCanvasProps, next: InteractiveCanvasProps): boolean => {
  const selectionChanged =
    prev.selectedIds.size !== next.selectedIds.size ||
    Array.from(prev.selectedIds).some(id => !next.selectedIds.has(id));
  const viewportChanged =
    prev.viewport.x !== next.viewport.x ||
    prev.viewport.y !== next.viewport.y ||
    prev.viewport.zoom !== next.viewport.zoom;

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
    prev.localUserId !== next.localUserId
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
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const isDirtyRef = useRef(true);
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
  });

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
    };
    isDirtyRef.current = true;
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
      isDirtyRef.current = true;
    };

    resize();
    window.addEventListener('resize', resize);
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      window.removeEventListener('resize', resize);
      observer.disconnect();
    };
  }, [containerRef]);

  useEffect(() => {
    const loop = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx && isDirtyRef.current) {
        isDirtyRef.current = false;
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
        });
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

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
      className="absolute inset-0"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
    />
  );
};

export default React.memo(InteractiveCanvas, areEqual);
