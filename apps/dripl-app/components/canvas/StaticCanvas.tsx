'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import type { DriplElement } from '@dripl/common';
import type { Viewport } from '@/utils/canvas-coordinates';
import { renderStaticScene } from '@dripl/element';

interface StaticCanvasProps {
  containerRef?: React.RefObject<HTMLDivElement>;
  elements: DriplElement[];
  selectedIds: Set<string>;
  viewport: Viewport;
  gridEnabled?: boolean;
  gridSize?: number;
  theme: 'light' | 'dark';
}

const areEqual = (prev: StaticCanvasProps, next: StaticCanvasProps): boolean => {
  const elementsEqual =
    prev.elements.length === next.elements.length &&
    prev.elements.every((element, index) => {
      const candidate = next.elements[index];
      return (
        candidate?.id === element.id &&
        candidate?.version === element.version &&
        candidate === element
      );
    });

  return (
    elementsEqual &&
    prev.viewport.x === next.viewport.x &&
    prev.viewport.y === next.viewport.y &&
    prev.viewport.zoom === next.viewport.zoom &&
    prev.gridEnabled === next.gridEnabled &&
    prev.gridSize === next.gridSize &&
    prev.theme === next.theme &&
    prev.selectedIds.size === next.selectedIds.size
  );
};

const StaticCanvas: React.FC<StaticCanvasProps> = ({
  containerRef,
  elements,
  selectedIds,
  viewport,
  gridEnabled = false,
  gridSize = 20,
  theme,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const isDirtyRef = useRef(true);
  const dprRef = useRef(1);
  const sizeRef = useRef({ width: 0, height: 0 });
  const propsRef = useRef({
    elements,
    selectedIds,
    viewport,
    gridEnabled,
    gridSize,
    theme,
  });

  useEffect(() => {
    propsRef.current = {
      elements,
      selectedIds,
      viewport,
      gridEnabled,
      gridSize,
      theme,
    };
    isDirtyRef.current = true;
  }, [elements, selectedIds, viewport, gridEnabled, gridSize, theme]);

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
      isDirtyRef.current = true;
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
  }, [containerRef, viewport.width, viewport.height]);

  useEffect(() => {
    const loop = () => {
      const canvas = canvasRef.current;
      if (canvas && isDirtyRef.current) {
        isDirtyRef.current = false;
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
          }
        );
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

  return <canvas ref={canvasRef} style={canvasStyle} />;
};

export default React.memo(StaticCanvas, areEqual);
