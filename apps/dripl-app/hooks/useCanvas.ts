import { useRef, useEffect, useState, useCallback } from "react";
import { CanvasElement, Point } from "@/types/canvas";
import { drawShape, getElementBounds } from "@/utils/canvasUtils";
import { EraserTrail } from "@/eraser";

interface UseCanvasProps {
  elements: CanvasElement[];
  selectedIds: string[];
  zoom: number;
  pan: Point;
  activeTool: string;
  isDrawing: boolean;
  currentElement: CanvasElement | null;
  isMoving: boolean;
  moveOffset: Point;
  isRotating: boolean;
  rotateOffset: number;
  rotateStart: { angle: number; elementId: string } | null;
}

export const useCanvas = ({
  elements,
  selectedIds,
  zoom,
  pan,
  activeTool,
  isDrawing,
  currentElement,
  isMoving,
  moveOffset,
  isRotating,
  rotateOffset,
  rotateStart,
}: UseCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const eraserTrailRef = useRef<EraserTrail | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (activeTool === "eraser" && isDrawing) {
      let animationFrameId: number;

      const loop = () => {
        setTick((t) => t + 1);
        animationFrameId = requestAnimationFrame(loop);
      };

      loop();

      return () => {
        cancelAnimationFrame(animationFrameId);
      };
    }
  }, [activeTool, isDrawing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const container = containerRef.current;
    if (container) {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom / 100, zoom / 100);

    elements.forEach((element) => {
      const isSelected = selectedIds.includes(element.id);

      let renderElement = element;
      if (isMoving && isSelected) {
        renderElement = {
          ...element,
          x: element.x + moveOffset.x,
          y: element.y + moveOffset.y,
          points: element.points?.map((p) => ({
            x: p.x + moveOffset.x,
            y: p.y + moveOffset.y,
          })),
        };
      } else if (
        isRotating &&
        rotateStart &&
        element.id === rotateStart.elementId
      ) {
        renderElement = {
          ...element,
          rotation: (element.rotation || 0) + rotateOffset,
        };
      }

      drawShape(ctx, renderElement, isSelected);
    });

    if (currentElement) {
      drawShape(ctx, currentElement, false);
    }

    if (!eraserTrailRef.current) {
      eraserTrailRef.current = new EraserTrail(ctx);
    }

    eraserTrailRef.current?.render(pan, zoom / 100);

    ctx.restore();
  }, [
    elements,
    selectedIds,
    currentElement,
    zoom,
    pan,
    isMoving,
    moveOffset,
    isRotating,
    rotateOffset,
    rotateStart,
    tick,
  ]);

  // Helper to get canvas coordinates from mouse event
  const getCanvasPoint = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left - pan.x) * 100) / zoom;
      const y = ((e.clientY - rect.top - pan.y) * 100) / zoom;

      return { x, y };
    },
    [zoom, pan],
  );

  return {
    canvasRef,
    containerRef,
    eraserTrailRef,
    getCanvasPoint,
  };
};
