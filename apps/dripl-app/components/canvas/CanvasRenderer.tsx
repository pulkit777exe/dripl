"use client";

import { useRef, useEffect, useCallback, useMemo } from "react";
import type { DriplElement } from "@dripl/common";
import {
  renderStaticScene,
  createRoughCanvas,
  renderRoughElements,
  RoughCanvas,
} from "@dripl/element";
import { getVisibleElements } from "@/utils/viewport-culling";
import { Viewport } from "@/utils/canvas-coordinates";

let sceneNonceCounter = 0;
const generateSceneNonce = () => sceneNonceCounter++;

interface CanvasRendererProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  containerRef: React.RefObject<HTMLDivElement>;
  /**
   * Committed elements only — draftElement is passed separately so the
   * renderer can compose them without mutating committed state.
   */
  elements: DriplElement[];
  /**
   * The element currently being drawn. It is rendered on top of committed
   * elements but is NOT part of the `elements` array until finishDrawing().
   */
  draftElement: DriplElement | null;
  selectedIds: Set<string>;
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
  draftElement,
  selectedIds,
  eraserPath,
  viewport,
  onFrameRequest,
  theme = "dark",
  sceneNonce = generateSceneNonce(),
}: CanvasRendererProps) {
  const roughCanvasRef = useRef<RoughCanvas | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const lastRenderedElementsRef = useRef<DriplElement[]>([]);
  const lastDraftRef = useRef<DriplElement | null>(null);
  const lastSelectedIdsRef = useRef<Set<string>>(new Set());
  const needsRenderRef = useRef(true);

  /**
   * The render list is `[...elements, draftElement]` when a draft exists so
   * the draft is always composited on top without ever touching elements[].
   *
   * We memoise on the committed elements array identity, draftElement identity,
   * viewport, and sceneNonce so viewport-culling only re-runs when something
   * actually changed.
   */
  const visibleElements = useMemo(() => {
    const renderList: DriplElement[] =
      draftElement !== null ? [...elements, draftElement] : elements;
    return getVisibleElements(renderList, viewport, sceneNonce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, draftElement, viewport, sceneNonce]);

  // ── Initialise RoughCanvas once ──────────────────────────────────────────
  useEffect(() => {
    if (canvasRef.current && !roughCanvasRef.current) {
      roughCanvasRef.current = createRoughCanvas(canvasRef.current);
      needsRenderRef.current = true;
    }
  }, [canvasRef]);

  // ── Resize handler ───────────────────────────────────────────────────────
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
      if (ctx) ctx.scale(dpr, dpr);

      needsRenderRef.current = true;
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [canvasRef, containerRef]);

  // ── Dirty-checking — mark needsRender when inputs change ─────────────────
  useEffect(() => {
    const elementsChanged =
      elements.length !== lastRenderedElementsRef.current.length ||
      elements.some(
        (el, i) =>
          el.id !== lastRenderedElementsRef.current[i]?.id ||
          el !== lastRenderedElementsRef.current[i],
      );

    const draftChanged = draftElement !== lastDraftRef.current;

    const selectionChanged =
      selectedIds.size !== lastSelectedIdsRef.current.size ||
      Array.from(selectedIds).some((id) => !lastSelectedIdsRef.current.has(id));

    if (
      elementsChanged ||
      draftChanged ||
      selectionChanged ||
      eraserPath.length > 0
    ) {
      needsRenderRef.current = true;
      lastRenderedElementsRef.current = elements;
      lastDraftRef.current = draftElement;
      lastSelectedIdsRef.current = new Set(selectedIds);
    }
  }, [elements, draftElement, selectedIds, eraserPath]);

  // ── Main render loop ─────────────────────────────────────────────────────
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");

    if (!canvas || !ctx) {
      requestAnimationFrame(renderFrame);
      return;
    }

    if (!needsRenderRef.current) {
      requestAnimationFrame(renderFrame);
      return;
    }

    needsRenderRef.current = false;

    const dpr = window.devicePixelRatio || 1;

    // Render all committed elements (+ draft if present via visibleElements).
    renderStaticScene(canvas, visibleElements, viewport, {
      gridEnabled: false,
      gridSize: 20,
      zoom: viewport.zoom,
      theme,
      dpr,
    });

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

    requestAnimationFrame(renderFrame);
    onFrameRequest?.();
  }, [
    canvasRef,
    visibleElements,
    selectedIds,
    eraserPath,
    viewport,
    theme,
    onFrameRequest,
  ]);

  // ── Start render loop ────────────────────────────────────────────────────
  useEffect(() => {
    needsRenderRef.current = true;
    renderFrame();

    return () => {
      if (animationFrameIdRef.current !== null) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [renderFrame]);

  // ── Force re-render on viewport change ──────────────────────────────────
  useEffect(() => {
    needsRenderRef.current = true;
  }, [viewport.x, viewport.y, viewport.zoom]);

  return {
    forceRender: () => {
      needsRenderRef.current = true;
    },
  };
}
