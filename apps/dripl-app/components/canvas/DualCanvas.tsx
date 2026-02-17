"use client";

import React, { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { useCanvasStore } from "@/lib/canvas-store";
import type { DriplElement, Point } from "@dripl/common";
import {
  createRoughCanvas,
  renderRoughElements,
  type RoughCanvas,
} from "@dripl/element";
import { getElementBounds } from "@dripl/math";
import { Viewport, screenToCanvas } from "@/utils/canvas-coordinates";
import { throttle } from "@dripl/utils";

interface DualCanvasProps {
  containerRef: React.RefObject<HTMLDivElement>;
  elements: DriplElement[];
  selectedIds: Set<string>;
  currentPreview: DriplElement | null;
  eraserPath: Point[];
  viewport: Viewport;
  theme?: "light" | "dark";
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
}

/**
 * Dual Canvas Architecture (per TDD):
 * 
 * ┌──────────────────────────────┐
 * │ Interactive Canvas           │  ← Drag preview, resize preview, 
 * │ - Drag preview               │    selection box, remote cursors
 * │ - Resize preview             │    (re-renders frequently)
 * │ - Selection box              │
 * │ - Remote cursors             │
 * ├──────────────────────────────┤
 * │ Static Scene Canvas          │  ← Stable elements, arrows, shapes, text
 * │ - Arrows                     │    (only re-renders when elements change)
 * │ - Shapes                     │
 * │ - Text                       │
 * │ - Images                     │
 * └──────────────────────────────┘
 * 
 * Benefits:
 * - Performance: Static layer only renders when elements change
 * - Smooth interactions: Interactive layer runs at 60fps
 * - Better responsiveness during complex operations
 */
export function DualCanvas({
  containerRef,
  elements,
  selectedIds,
  currentPreview,
  eraserPath,
  viewport,
  theme = "dark",
  onPointerDown,
  onPointerMove,
  onPointerUp,
  cursorPosition,
  isDragging,
  isResizing,
  isDrawing,
  marqueeSelection,
}: DualCanvasProps) {
  // ==================== REFS ====================
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  const interactiveCanvasRef = useRef<HTMLCanvasElement>(null);
  const staticRoughCanvasRef = useRef<RoughCanvas | null>(null);
  const interactiveRoughCanvasRef = useRef<RoughCanvas | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  
  // Track previous elements to detect changes
  const prevElementsRef = useRef<DriplElement[]>([]);
  const prevSelectedIdsRef = useRef<Set<string>>(new Set());
  const lastRenderTimeRef = useRef<number>(0);
  
  // Dirty region tracking
  const dirtyRegionsRef = useRef<Array<{ x: number; y: number; width: number; height: number }>>([]);
  const needsStaticRenderRef = useRef(true);

  // ==================== STATIC CANVAS SETUP ====================
  useEffect(() => {
    if (staticCanvasRef.current && !staticRoughCanvasRef.current) {
      staticRoughCanvasRef.current = createRoughCanvas(staticCanvasRef.current);
      needsStaticRenderRef.current = true;
    }
    if (interactiveCanvasRef.current && !interactiveRoughCanvasRef.current) {
      interactiveRoughCanvasRef.current = createRoughCanvas(interactiveCanvasRef.current);
    }
  }, []);

  // ==================== RESIZE HANDLER ====================
  const resizeCanvases = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();

    [staticCanvasRef, interactiveCanvasRef].forEach((canvasRef) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
      }
    });

    needsStaticRenderRef.current = true;
  }, [containerRef]);

  useEffect(() => {
    resizeCanvases();
    window.addEventListener("resize", resizeCanvases);
    return () => window.removeEventListener("resize", resizeCanvases);
  }, [resizeCanvases]);

  // ==================== DETECT ELEMENT CHANGES ====================
  const detectElementChanges = useCallback((): boolean => {
    const prevElements = prevElementsRef.current;
    
    // Check if elements array changed
    const elementsChanged =
      elements.length !== prevElements.length ||
      elements.some((el, i) => {
        const prev = prevElements[i];
        if (!prev) return true;
        // Check key properties that affect rendering
        return (
          el.id !== prev.id ||
          el.x !== prev.x ||
          el.y !== prev.y ||
          el.width !== prev.width ||
          el.height !== prev.height ||
          el.type !== prev.type ||
          el.strokeColor !== prev.strokeColor ||
          el.backgroundColor !== prev.backgroundColor ||
          el.strokeWidth !== prev.strokeWidth ||
          el.opacity !== prev.opacity ||
          el.roughness !== prev.roughness ||
          el.strokeStyle !== prev.strokeStyle ||
          el.fillStyle !== prev.fillStyle ||
          JSON.stringify(el.points) !== JSON.stringify(prev.points)
        );
      });

    // Check if selection changed
    const selectionChanged =
      selectedIds.size !== prevSelectedIdsRef.current.size ||
      Array.from(selectedIds).some((id) => !prevSelectedIdsRef.current.has(id));

    if (elementsChanged || selectionChanged) {
      prevElementsRef.current = [...elements];
      prevSelectedIdsRef.current = new Set(selectedIds);
      needsStaticRenderRef.current = true;
      return true;
    }

    return false;
  }, [elements, selectedIds]);

  // ==================== STATIC CANVAS RENDER ====================
  const renderStaticCanvas = useCallback(() => {
    const canvas = staticCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    const rc = staticRoughCanvasRef.current;

    if (!canvas || !ctx || !rc) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    // Apply viewport transformations
    ctx.save();
    ctx.translate(viewport.x, viewport.y);
    ctx.scale(viewport.zoom, viewport.zoom);

    // Render all elements
    renderRoughElements(rc, ctx, elements, theme);

    // Render selection highlights on static canvas (for performance)
    if (selectedIds.size > 0) {
      ctx.save();
      ctx.strokeStyle = theme === "dark" ? "#a8a5ff" : "#6366f1";
      ctx.lineWidth = 2 / viewport.zoom;
      ctx.setLineDash([5 / viewport.zoom, 5 / viewport.zoom]);

      elements.forEach((element) => {
        if (selectedIds.has(element.id)) {
          const bounds = getElementBounds(element);
          ctx.strokeRect(
            bounds.x - 5,
            bounds.y - 5,
            bounds.width + 10,
            bounds.height + 10
          );
        }
      });

      ctx.restore();
    }

    ctx.restore();

    needsStaticRenderRef.current = false;
    lastRenderTimeRef.current = performance.now();
  }, [elements, selectedIds, viewport, theme]);

  // ==================== INTERACTIVE CANVAS RENDER ====================
  const renderInteractiveCanvas = useCallback(() => {
    const canvas = interactiveCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    const rc = interactiveRoughCanvasRef.current; // Use separate instance for interactive layer

    if (!canvas || !ctx || !rc) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    // Apply viewport transformations
    ctx.save();
    ctx.translate(viewport.x, viewport.y);
    ctx.scale(viewport.zoom, viewport.zoom);

    // 1. Render current preview (being drawn/dragged)
    if (currentPreview) {
      renderRoughElements(rc, ctx, [currentPreview], theme);
    }

    // 2. Render eraser path
    if (eraserPath.length > 0) {
      ctx.save();
      ctx.strokeStyle = "#ff0000";
      ctx.lineWidth = 10 / viewport.zoom;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = 0.3;

      ctx.beginPath();
      ctx.moveTo(eraserPath[0]!.x, eraserPath[0]!.y);
      for (let i = 1; i < eraserPath.length; i++) {
        ctx.lineTo(eraserPath[i]!.x, eraserPath[i]!.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 3. Render marquee selection box
    if (marqueeSelection?.active) {
      const minX = Math.min(marqueeSelection.start.x, marqueeSelection.end.x);
      const minY = Math.min(marqueeSelection.start.y, marqueeSelection.end.y);
      const maxX = Math.max(marqueeSelection.start.x, marqueeSelection.end.x);
      const maxY = Math.max(marqueeSelection.start.y, marqueeSelection.end.y);

      ctx.save();
      ctx.strokeStyle = theme === "dark" ? "#a8a5ff" : "#6366f1";
      ctx.fillStyle = theme === "dark" ? "rgba(168, 165, 255, 0.1)" : "rgba(99, 102, 241, 0.1)";
      ctx.lineWidth = 1 / viewport.zoom;
      ctx.setLineDash([4 / viewport.zoom, 4 / viewport.zoom]);

      ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
      ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
      ctx.restore();
    }

    // 4. Render resize handles (when dragging/resizing)
    if (selectedIds.size > 0 && (isDragging || isResizing)) {
      ctx.save();
      ctx.strokeStyle = theme === "dark" ? "#ffffff" : "#000000";
      ctx.fillStyle = theme === "dark" ? "#a8a5ff" : "#6366f1";
      ctx.lineWidth = 1 / viewport.zoom;

      elements.forEach((element) => {
        if (selectedIds.has(element.id)) {
          const bounds = getElementBounds(element);
          const handleSize = 8 / viewport.zoom;

          // Corner handles
          const handles = [
            { x: bounds.x, y: bounds.y }, // nw
            { x: bounds.x + bounds.width, y: bounds.y }, // ne
            { x: bounds.x, y: bounds.y + bounds.height }, // sw
            { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, // se
            // Edge handles
            { x: bounds.x + bounds.width / 2, y: bounds.y }, // n
            { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height }, // s
            { x: bounds.x, y: bounds.y + bounds.height / 2 }, // w
            { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 }, // e
          ];

          handles.forEach((handle) => {
            ctx.fillRect(
              handle.x - handleSize / 2,
              handle.y - handleSize / 2,
              handleSize,
              handleSize
            );
          });
        }
      });

      ctx.restore();
    }

    // 5. Render cursor indicator (when drawing)
    if (cursorPosition && isDrawing) {
      ctx.save();
      ctx.strokeStyle = theme === "dark" ? "#a8a5ff" : "#6366f1";
      ctx.lineWidth = 2 / viewport.zoom;
      ctx.setLineDash([4 / viewport.zoom, 4 / viewport.zoom]);

      // Draw crosshair at cursor
      const { x, y } = cursorPosition;
      const size = 20 / viewport.zoom;
      
      ctx.beginPath();
      ctx.moveTo(x - size, y);
      ctx.lineTo(x + size, y);
      ctx.moveTo(x, y - size);
      ctx.lineTo(x, y + size);
      ctx.stroke();

      ctx.restore();
    }

    ctx.restore();
  }, [
    currentPreview,
    eraserPath,
    marqueeSelection,
    selectedIds,
    elements,
    isDragging,
    isResizing,
    isDrawing,
    cursorPosition,
    viewport,
    theme,
  ]);

  // ==================== MAIN RENDER LOOP ====================
  const renderLoop = useCallback(() => {
    // Always render interactive layer (60fps)
    renderInteractiveCanvas();

    // Only render static layer when elements change
    const elementsChanged = detectElementChanges();
    if (elementsChanged || needsStaticRenderRef.current) {
      renderStaticCanvas();
    }

    // Continue loop
    animationFrameIdRef.current = requestAnimationFrame(renderLoop);
  }, [renderInteractiveCanvas, renderStaticCanvas, detectElementChanges]);

  // Start render loop
  useEffect(() => {
    animationFrameIdRef.current = requestAnimationFrame(renderLoop);

    return () => {
      if (animationFrameIdRef.current !== null) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [renderLoop]);

  // Force static render when viewport changes (pan/zoom)
  useEffect(() => {
    needsStaticRenderRef.current = true;
  }, [viewport.x, viewport.y, viewport.zoom]);

  // ==================== CURSOR STYLE ====================
  const cursorStyle = useMemo(() => {
    if (isDragging) return "grabbing";
    if (isDrawing) return "crosshair";
    return "default";
  }, [isDragging, isDrawing]);

  // ==================== RENDER ====================
  return (
    <>
      {/* Static Scene Canvas - renders stable elements */}
      <canvas
        ref={staticCanvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 1 }}
      />

      {/* Interactive Canvas - renders previews, selection, cursors */}
      <canvas
        ref={interactiveCanvasRef}
        className="absolute inset-0"
        style={{ 
          zIndex: 2,
          cursor: cursorStyle,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
    </>
  );
}

/**
 * Hook for dual canvas rendering
 * Provides the render logic without the JSX
 */
export function useDualCanvasRenderer({
  containerRef,
  elements,
  selectedIds,
  currentPreview,
  eraserPath,
  viewport,
  theme = "dark",
}: Omit<DualCanvasProps, "onPointerDown" | "onPointerMove" | "onPointerUp" | "cursorPosition" | "isDragging" | "isResizing" | "isDrawing" | "marqueeSelection">) {
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const interactiveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const staticRoughCanvasRef = useRef<RoughCanvas | null>(null);
  
  const prevElementsRef = useRef<DriplElement[]>([]);
  const needsStaticRenderRef = useRef(true);
  
  // Initialize
  useEffect(() => {
    if (containerRef.current && !staticRoughCanvasRef.current) {
      const canvases = containerRef.current.querySelectorAll("canvas");
      if (canvases.length >= 2) {
        staticCanvasRef.current = canvases[0] as HTMLCanvasElement;
        interactiveCanvasRef.current = canvases[1] as HTMLCanvasElement;
        
        if (staticCanvasRef.current) {
          staticRoughCanvasRef.current = createRoughCanvas(staticCanvasRef.current);
          needsStaticRenderRef.current = true;
        }
      }
    }
  }, [containerRef]);

  const forceStaticRender = useCallback(() => {
    needsStaticRenderRef.current = true;
  }, []);

  return {
    staticCanvasRef,
    interactiveCanvasRef,
    staticRoughCanvasRef,
    forceStaticRender,
  };
}

export default DualCanvas;
