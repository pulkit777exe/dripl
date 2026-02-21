"use client";

import React, { useRef, useEffect, useCallback, useMemo } from "react";
import { useCanvasStore } from "@/lib/canvas-store";
import type { DriplElement, Point } from "@dripl/common";
import {
  createRoughCanvas,
  renderRoughElements,
  type RoughCanvas,
} from "@dripl/element";
import { getElementBounds } from "@dripl/math";
import { Viewport } from "@/utils/canvas-coordinates";
import { getVisibleElements } from "@/utils/viewport-culling";
import { AnimationController } from "./AnimationController";

interface InteractiveCanvasProps {
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

interface InteractiveCanvasAppState {
  zoom: number;
  x: number;
  y: number;
  selectedIds: Set<string>;
  currentPreview: DriplElement | null;
  eraserPath: Point[];
  cursorPosition: Point | null;
  isDragging: boolean;
  isResizing: boolean;
  isDrawing: boolean;
  marqueeSelection: {
    start: Point;
    end: Point;
    active: boolean;
  } | null;
}

const getRelevantAppStateProps = (
  props: InteractiveCanvasProps
): InteractiveCanvasAppState => {
  return {
    zoom: props.viewport.zoom,
    x: props.viewport.x,
    y: props.viewport.y,
    selectedIds: props.selectedIds,
    currentPreview: props.currentPreview || null,
    eraserPath: props.eraserPath,
    cursorPosition: props.cursorPosition || null,
    isDragging: !!props.isDragging,
    isResizing: !!props.isResizing,
    isDrawing: !!props.isDrawing,
    marqueeSelection: props.marqueeSelection || null,
  };
};

const areEqual = (
  prevProps: InteractiveCanvasProps,
  nextProps: InteractiveCanvasProps
): boolean => {
  const selectionChanged =
    prevProps.selectedIds.size !== nextProps.selectedIds.size ||
    Array.from(prevProps.selectedIds).some(
      (id) => !nextProps.selectedIds.has(id)
    );

  const previewChanged = prevProps.currentPreview !== nextProps.currentPreview;
  const eraserPathChanged = JSON.stringify(prevProps.eraserPath) !== JSON.stringify(nextProps.eraserPath);

  const interactiveChanged =
    prevProps.isDragging !== nextProps.isDragging ||
    prevProps.isResizing !== nextProps.isResizing ||
    prevProps.isDrawing !== nextProps.isDrawing ||
    JSON.stringify(prevProps.marqueeSelection) !== JSON.stringify(nextProps.marqueeSelection) ||
    JSON.stringify(prevProps.cursorPosition) !== JSON.stringify(nextProps.cursorPosition);

  const viewportChanged =
    prevProps.viewport.x !== nextProps.viewport.x ||
    prevProps.viewport.y !== nextProps.viewport.y ||
    prevProps.viewport.zoom !== nextProps.viewport.zoom;

  if (selectionChanged || previewChanged || eraserPathChanged || interactiveChanged || viewportChanged) {
    return false;
  }

  return true;
};

const INTERACTIVE_SCENE_ANIMATION_KEY = "animateInteractiveScene";

const InteractiveCanvas: React.FC<InteractiveCanvasProps> = ({
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
}) => {
  const interactiveCanvasRef = useRef<HTMLCanvasElement>(null);
  const interactiveRoughCanvasRef = useRef<RoughCanvas | null>(null);
  const isComponentMounted = useRef(false);

  const visibleElements = useMemo(
    () => getVisibleElements(elements, viewport),
    [elements, viewport],
  );

  const rendererParams = useRef<{
    canvas: HTMLCanvasElement;
    rc: RoughCanvas;
    elements: DriplElement[];
    selectedIds: Set<string>;
    currentPreview: DriplElement | null;
    eraserPath: Point[];
    cursorPosition: Point | null;
    isDragging: boolean;
    isResizing: boolean;
    isDrawing: boolean;
    marqueeSelection: {
      start: Point;
      end: Point;
      active: boolean;
    } | null;
    viewport: Viewport;
    theme: "light" | "dark";
  } | null>(null);

  useEffect(() => {
    if (interactiveCanvasRef.current && !interactiveRoughCanvasRef.current) {
      interactiveRoughCanvasRef.current = createRoughCanvas(
        interactiveCanvasRef.current
      );
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !interactiveCanvasRef.current) return;

    const canvas = interactiveCanvasRef.current;
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
  }, [containerRef]);

  const renderInteractiveScene = useCallback(
    ({ deltaTime, state }: { deltaTime: number; state: any }) => {
      if (!rendererParams.current || !interactiveRoughCanvasRef.current) {
        return undefined;
      }

      const {
        canvas,
        rc,
        elements,
        selectedIds,
        currentPreview,
        eraserPath,
        cursorPosition,
        isDragging,
        isResizing,
        isDrawing,
        marqueeSelection,
        viewport,
        theme,
      } = rendererParams.current;

      const ctx = canvas.getContext("2d");
      if (!ctx) return undefined;

      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

      ctx.save();
      ctx.translate(viewport.x, viewport.y);
      ctx.scale(viewport.zoom, viewport.zoom);

      if (currentPreview) {
        renderRoughElements(rc, ctx, [currentPreview], theme);
      }

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

      if (marqueeSelection?.active) {
        const minX = Math.min(marqueeSelection.start.x, marqueeSelection.end.x);
        const minY = Math.min(marqueeSelection.start.y, marqueeSelection.end.y);
        const maxX = Math.max(marqueeSelection.start.x, marqueeSelection.end.x);
        const maxY = Math.max(marqueeSelection.start.y, marqueeSelection.end.y);

        ctx.save();
        ctx.strokeStyle = theme === "dark" ? "#6c47ff" : "#6b46c1";
        ctx.fillStyle = theme === "dark" ? "rgba(168, 165, 255, 0.1)" : "rgba(99, 102, 241, 0.1)";
        ctx.lineWidth = 1 / viewport.zoom;
        ctx.setLineDash([4 / viewport.zoom, 4 / viewport.zoom]);

        ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
        ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
        ctx.restore();
      }

      if (selectedIds.size > 0 && (isDragging || isResizing)) {
        ctx.save();
        ctx.strokeStyle = theme === "dark" ? "#ffffff" : "#000000";
        ctx.fillStyle = theme === "dark" ? "#6c47ff" : "#6b46c1";
        ctx.lineWidth = 1 / viewport.zoom;

        elements.forEach((element) => {
          if (selectedIds.has(element.id)) {
            const bounds = getElementBounds(element);
            const handleSize = 8 / viewport.zoom;

            const handles = [
              { x: bounds.x, y: bounds.y },
              { x: bounds.x + bounds.width, y: bounds.y }, 
              { x: bounds.x, y: bounds.y + bounds.height },
              { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
              { x: bounds.x + bounds.width / 2, y: bounds.y },
              { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height },
              { x: bounds.x, y: bounds.y + bounds.height / 2 },
              { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 }, 
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

      if (cursorPosition && isDrawing) {
        ctx.save();
        ctx.strokeStyle = theme === "dark" ? "#6c47ff" : "#6b46c1";
        ctx.lineWidth = 2 / viewport.zoom;
        ctx.setLineDash([4 / viewport.zoom, 4 / viewport.zoom]);

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

      return state;
    },
    []
  );

  useEffect(() => {
    if (!interactiveCanvasRef.current || !interactiveRoughCanvasRef.current) {
      return;
    }

    rendererParams.current = {
      canvas: interactiveCanvasRef.current,
      rc: interactiveRoughCanvasRef.current,
      elements: visibleElements,
      selectedIds,
      currentPreview: currentPreview || null,
      eraserPath,
      cursorPosition: cursorPosition || null,
      isDragging: !!isDragging,
      isResizing: !!isResizing,
      isDrawing: !!isDrawing,
      marqueeSelection: marqueeSelection || null,
      viewport,
      theme,
    };

    if (!AnimationController.running(INTERACTIVE_SCENE_ANIMATION_KEY)) {
      AnimationController.start(
        INTERACTIVE_SCENE_ANIMATION_KEY,
        renderInteractiveScene,
        {}
      );
    }

    return () => {
      if (!isComponentMounted.current) {
        AnimationController.stop(INTERACTIVE_SCENE_ANIMATION_KEY);
      }
    };
  }, [
    visibleElements,
    selectedIds,
    currentPreview,
    eraserPath,
    cursorPosition,
    isDragging,
    isResizing,
    isDrawing,
    marqueeSelection,
    viewport,
    theme,
    renderInteractiveScene,
  ]);

  useEffect(() => {
    isComponentMounted.current = true;

    return () => {
      isComponentMounted.current = false;
      AnimationController.stop(INTERACTIVE_SCENE_ANIMATION_KEY);
    };
  }, []);

  const cursorStyle = useMemo(() => {
    if (isDragging) return "grabbing";
    if (isDrawing) return "crosshair";
    return "default";
  }, [isDragging, isDrawing]);

  return (
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
  );
};

export default React.memo(InteractiveCanvas, areEqual);
