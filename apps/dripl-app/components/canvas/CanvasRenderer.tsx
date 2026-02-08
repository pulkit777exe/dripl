"use client";

import { useRef, useEffect, useCallback } from "react";
import type { DriplElement } from "@dripl/common";
import {
  createRoughCanvas,
  renderRoughElements,
  type RoughCanvas,
} from "@dripl/element";
import { getElementBounds } from "@dripl/math";
import { getVisibleElements } from "@/utils/viewport-culling";
import { Viewport } from "@/utils/canvas-coordinates";

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
}: CanvasRendererProps) {
  const roughCanvasRef = useRef<RoughCanvas | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const lastRenderedElementsRef = useRef<DriplElement[]>([]);
  const lastSelectedIdsRef = useRef<Set<string>>(new Set());
  const needsRenderRef = useRef(true);

  // Initialize Rough.js canvas
  useEffect(() => {
    if (canvasRef.current && !roughCanvasRef.current) {
      roughCanvasRef.current = createRoughCanvas(canvasRef.current);
      needsRenderRef.current = true;
    }
  }, [canvasRef]);

  // Resize canvas to match container
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();

      // Set display size
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      // Set actual size in memory (scaled for high DPI)
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;

      // Scale context to account for DPR
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

  // Main render loop using requestAnimationFrame
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const rc = roughCanvasRef.current;

    if (!canvas || !ctx || !rc) {
      console.log("Canvas or context or rough canvas not available");
      animationFrameIdRef.current = requestAnimationFrame(renderFrame);
      return;
    }

    console.log("Rendering frame - elements count:", elements.length);
    if (elements.length > 0) {
      console.log("First element details:", elements[0]);
    }
    const visibleElements = getVisibleElements(elements, viewport);
    console.log(
      "Rendering frame - visible elements count:",
      visibleElements.length,
    );
    if (visibleElements.length > 0) {
      console.log("First visible element details:", visibleElements[0]);
    }

    // Only render if something changed or forced
    if (!needsRenderRef.current) {
      animationFrameIdRef.current = requestAnimationFrame(renderFrame);
      return;
    }

    needsRenderRef.current = false;

    // Clear canvas
    ctx.clearRect(
      0,
      0,
      canvas.width / (window.devicePixelRatio || 1),
      canvas.height / (window.devicePixelRatio || 1),
    );

    // Get visible elements (viewport culling)
    // Already calculated above for logging

    // Apply viewport transformations
    ctx.save();
    ctx.translate(viewport.x, viewport.y);
    ctx.scale(viewport.zoom, viewport.zoom);

    // Render all visible elements
    renderRoughElements(rc, ctx, visibleElements, theme);

    // Render current preview element (being drawn)
    if (currentPreview) {
      renderRoughElements(rc, ctx, [currentPreview], theme);
    }

    // Render selection highlights
    if (selectedIds.size > 0) {
      ctx.save();
      ctx.strokeStyle = "#6965db";
      ctx.lineWidth = 1 / viewport.zoom;
      ctx.setLineDash([5 / viewport.zoom, 5 / viewport.zoom]);

      visibleElements.forEach((el) => {
        if (el.id && selectedIds.has(el.id)) {
          const bounds = getElementBounds(el);
          const padding = 4 / viewport.zoom;
          ctx.strokeRect(
            bounds.x - padding,
            bounds.y - padding,
            bounds.width + padding * 2,
            bounds.height + padding * 2,
          );
        }
      });

      ctx.restore();
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

    ctx.restore();

    // Request next frame
    animationFrameIdRef.current = requestAnimationFrame(renderFrame);
    onFrameRequest?.();
  }, [
    canvasRef,
    elements,
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
