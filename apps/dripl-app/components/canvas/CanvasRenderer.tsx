"use client";

import { useRef, useEffect, useCallback, useMemo } from "react";
import type { DriplElement } from "@dripl/common";
import { renderStaticScene, createRoughCanvas, renderRoughElements, RoughCanvas } from "@dripl/element";
import { getElementBounds } from "@dripl/math";
import { getVisibleElements } from "@/utils/viewport-culling";
import { Viewport } from "@/utils/canvas-coordinates";
import { AnimationController } from "@/utils/animationController";

let sceneNonceCounter = 0;
const generateSceneNonce = () => sceneNonceCounter++;

interface CanvasRendererProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  containerRef: React.RefObject<HTMLDivElement>;
  elements: DriplElement[];
  selectedIds: Set<string>;
  currentPreview: DriplElement | null;
  eraserPath: Array<{ x: number; y: number }>;
  viewport: Viewport;
  onFrameRequest?: () => void;
  theme?: "light" | "dark";
  sceneNonce?: number;
}

export function useCanvasRenderer({
  canvasRef,
  containerRef,
  elements,
  selectedIds,
  currentPreview,
  eraserPath,
  viewport,
  onFrameRequest,
  theme = "dark",
  sceneNonce = generateSceneNonce(),
}: CanvasRendererProps) {
  const roughCanvasRef = useRef<RoughCanvas | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const lastRenderedElementsRef = useRef<DriplElement[]>([]);
  const lastSelectedIdsRef = useRef<Set<string>>(new Set());
  const needsRenderRef = useRef(true);

  const visibleElements = useMemo(() => {
    return getVisibleElements(elements, viewport, sceneNonce);
  }, [elements, viewport, sceneNonce]);

  useEffect(() => {
    if (canvasRef.current && !roughCanvasRef.current) {
      roughCanvasRef.current = createRoughCanvas(canvasRef.current);
      needsRenderRef.current = true;
    }
  }, [canvasRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();

      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
      }

      needsRenderRef.current = true;
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [canvasRef, containerRef]);

  // Check if we need to re-render
  useEffect(() => {
    const elementsChanged =
      elements.length !== lastRenderedElementsRef.current.length ||
      elements.some(
        (el, i) =>
          el.id !== lastRenderedElementsRef.current[i]?.id ||
          el !== lastRenderedElementsRef.current[i],
      );

    const selectionChanged =
      selectedIds.size !== lastSelectedIdsRef.current.size ||
      Array.from(selectedIds).some((id) => !lastSelectedIdsRef.current.has(id));

    if (
      elementsChanged ||
      selectionChanged ||
      currentPreview ||
      eraserPath.length > 0
    ) {
      needsRenderRef.current = true;
      lastRenderedElementsRef.current = elements;
      lastSelectedIdsRef.current = new Set(selectedIds);
    }
  }, [elements, selectedIds, currentPreview, eraserPath]);

  // Main render loop using AnimationController
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");

    if (!canvas || !ctx) {
      console.log("Canvas or context not available");
      requestAnimationFrame(renderFrame);
      return;
    }

    // Only render if something changed or forced
    if (!needsRenderRef.current) {
      requestAnimationFrame(renderFrame);
      return;
    }

    needsRenderRef.current = false;

    // Render static scene
    const dpr = window.devicePixelRatio || 1;
    renderStaticScene(canvas, visibleElements, viewport, {
      gridEnabled: false,
      gridSize: 20,
      zoom: viewport.zoom,
      theme,
      dpr,
    });

    // Render current preview element (being drawn)
    if (currentPreview) {
      const previewCanvas = document.createElement("canvas");
      previewCanvas.width = canvas.width;
      previewCanvas.height = canvas.height;
      const previewCtx = previewCanvas.getContext("2d");
      if (previewCtx) {
        // Render preview element on temporary canvas
        const rc = createRoughCanvas(previewCanvas);
        if (rc) {
          renderRoughElements(rc, previewCtx, [currentPreview], theme);
        }
        // Draw temporary canvas to main canvas
        ctx.drawImage(previewCanvas, 0, 0);
      }
    }

    // Render eraser trail
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

    // Request next frame
    requestAnimationFrame(renderFrame);
    onFrameRequest?.();
  }, [
    canvasRef,
    visibleElements, // Use memoized visible elements instead of raw elements
    selectedIds,
    currentPreview,
    eraserPath,
    viewport,
    onFrameRequest,
  ]);

  // Start render loop
  useEffect(() => {
    needsRenderRef.current = true;
    renderFrame();

    return () => {
      if (animationFrameIdRef.current !== null) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [renderFrame]);

  // Force re-render when viewport changes
  useEffect(() => {
    needsRenderRef.current = true;
  }, [viewport.x, viewport.y, viewport.zoom]);

  return {
    forceRender: () => {
      needsRenderRef.current = true;
    },
  };
}
