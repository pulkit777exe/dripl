"use client";

import { useState, useCallback } from "react";
import type { DriplElement, Point } from "@dripl/common";
import { v4 as uuidv4 } from "uuid";
import {
  createRectangleElement,
  RectangleToolState,
} from "@/utils/tools/rectangle";
import { createEllipseElement, EllipseToolState } from "@/utils/tools/ellipse";
import { createDiamondElement, DiamondToolState } from "@/utils/tools/diamond";
import {
  createArrowElement,
  ArrowToolState,
  snapArrowToElement,
} from "@/utils/tools/arrow";
import { createLineElement, LineToolState } from "@/utils/tools/line";
import {
  createFreedrawElement,
  FreedrawToolState,
} from "@/utils/tools/freedraw";
import { createTextElement, TextToolState } from "@/utils/tools/text";
import {
  createImageElement,
  ImageToolState,
  loadImage,
} from "@/utils/tools/image";
import { createFrameElement, FrameToolState } from "@/utils/tools/frame";
import { useShapeRegistry } from "./useShapeRegistry";

export type ToolType =
  | "select"
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "arrow"
  | "line"
  | "freedraw"
  | "text"
  | "image"
  | "frame"
  | "eraser";

interface BaseToolProps {
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  opacity: number;
  roughness: number;
  strokeStyle: "solid" | "dashed" | "dotted";
  fillStyle:
    | "hachure"
    | "solid"
    | "zigzag"
    | "cross-hatch"
    | "dots"
    | "dashed"
    | "zigzag-line";
}

export interface UseDrawingToolsReturn {
  currentPreview: DriplElement | null;
  startDrawing: (
    point: Point,
    tool: ToolType,
    shiftKey: boolean,
    baseProps: BaseToolProps,
    elements?: DriplElement[],
  ) => void;
  updateDrawing: (
    point: Point,
    shiftKey: boolean,
    elements?: DriplElement[],
  ) => void;
  finishDrawing: () => DriplElement | null;
  cancelDrawing: () => void;
  isDrawing: boolean;
}

export function useDrawingTools(): UseDrawingToolsReturn {
  const [currentPreview, setCurrentPreview] = useState<DriplElement | null>(
    null,
  );
  const [toolState, setToolState] = useState<
    | { type: "rectangle"; state: RectangleToolState }
    | { type: "ellipse"; state: EllipseToolState }
    | { type: "diamond"; state: DiamondToolState }
    | { type: "arrow"; state: ArrowToolState }
    | { type: "line"; state: LineToolState }
    | { type: "freedraw"; state: FreedrawToolState }
    | { type: "frame"; state: FrameToolState }
    | null
  >(null);
  const [baseProps, setBaseProps] = useState<BaseToolProps | null>(null);
  const { createElement } = useShapeRegistry();

  const startDrawing = useCallback(
    (
      point: Point,
      tool: ToolType,
      shiftKey: boolean,
      props: BaseToolProps,
      elements?: DriplElement[],
    ) => {
      setBaseProps(props);

      switch (tool) {
        case "rectangle":
          setToolState({
            type: "rectangle",
            state: { startPoint: point, currentPoint: point, shiftKey },
          });
          break;
        case "ellipse":
          setToolState({
            type: "ellipse",
            state: { startPoint: point, currentPoint: point, shiftKey },
          });
          break;
        case "diamond":
          setToolState({
            type: "diamond",
            state: { startPoint: point, currentPoint: point, shiftKey },
          });
          break;
        case "arrow":
          setToolState({
            type: "arrow",
            state: {
              points: [point],
              isComplete: false,
              isDragging: false,
              currentPoint: null,
            },
          });
          break;
        case "line":
          setToolState({
            type: "line",
            state: {
              points: [point],
              isComplete: false,
              shiftKey,
              isDragging: false,
              currentPoint: null,
            },
          });
          break;
        case "freedraw":
          setToolState({
            type: "freedraw",
            state: { points: [point], isComplete: false },
          });
          break;
        case "frame":
          setToolState({
            type: "frame",
            state: { startPoint: point, currentPoint: point, shiftKey },
          });
          break;
        default:
          break;
      }
    },
    [],
  );

  const updateDrawing = useCallback(
    (point: Point, shiftKey: boolean, elements?: DriplElement[]) => {
      if (!toolState || !baseProps) return;

      switch (toolState.type) {
        case "rectangle":
          setToolState({
            ...toolState,
            state: { ...toolState.state, currentPoint: point, shiftKey },
          });
          setCurrentPreview(
            createRectangleElement(toolState.state, {
              id: uuidv4(),
              ...baseProps,
              seed: Math.floor(Math.random() * 1000000),
            }),
          );
          break;
        case "ellipse":
          setToolState({
            ...toolState,
            state: { ...toolState.state, currentPoint: point, shiftKey },
          });
          setCurrentPreview(
            createEllipseElement(toolState.state, {
              id: uuidv4(),
              ...baseProps,
              seed: Math.floor(Math.random() * 1000000),
            }),
          );
          break;
        case "diamond":
          setToolState({
            ...toolState,
            state: { ...toolState.state, currentPoint: point, shiftKey },
          });
          setCurrentPreview(
            createDiamondElement(toolState.state, {
              id: uuidv4(),
              ...baseProps,
              seed: Math.floor(Math.random() * 1000000),
            }),
          );
          break;
        case "arrow": {
          const snappedPoint = elements
            ? snapArrowToElement(point, elements)
            : point;
          // Arrow should only have 2 points: start and end
          const startPoint = toolState.state.points[0] || point;
          const newPoints = [startPoint, snappedPoint];
          setToolState({
            ...toolState,
            state: {
              ...toolState.state,
              points: newPoints,
              currentPoint: snappedPoint,
            },
          });
          const { arrow } = createArrowElement(
            { ...toolState.state, points: newPoints },
            {
              id: uuidv4(),
              ...baseProps,
              seed: Math.floor(Math.random() * 1000000),
            },
          );
          setCurrentPreview(arrow);
          break;
        }
        case "line": {
          // Line should only have 2 points: start and end (for straight lines)
          const startPoint = toolState.state.points[0] || point;
          let endPoint = point;

          // Shift key constrains to horizontal/vertical/45 degree angles
          if (shiftKey) {
            const dx = point.x - startPoint.x;
            const dy = point.y - startPoint.y;
            const angle = Math.atan2(dy, dx);
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Snap to nearest 45 degree angle
            const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
            endPoint = {
              x: startPoint.x + Math.cos(snapAngle) * distance,
              y: startPoint.y + Math.sin(snapAngle) * distance,
            };
          }

          const newPoints = [startPoint, endPoint];
          setToolState({
            ...toolState,
            state: {
              ...toolState.state,
              points: newPoints,
              shiftKey,
              currentPoint: endPoint,
            },
          });
          setCurrentPreview(
            createLineElement(
              { ...toolState.state, points: newPoints, shiftKey },
              {
                id: uuidv4(),
                ...baseProps,
                seed: Math.floor(Math.random() * 1000000),
              },
            ),
          );
          break;
        }
        case "freedraw": {
          const newPoints = [...toolState.state.points, point];
          setToolState({
            ...toolState,
            state: { ...toolState.state, points: newPoints },
          });
          if (newPoints.length % 3 === 0 || newPoints.length < 10) {
            setCurrentPreview(
              createFreedrawElement(
                { ...toolState.state, points: newPoints },
                {
                  id: uuidv4(),
                  ...baseProps,
                  seed: Math.floor(Math.random() * 1000000),
                },
              ),
            );
          }
          break;
        }
        case "frame":
          setToolState({
            ...toolState,
            state: { ...toolState.state, currentPoint: point, shiftKey },
          });
          setCurrentPreview(
            createFrameElement(toolState.state, {
              id: uuidv4(),
              ...baseProps,
              seed: Math.floor(Math.random() * 1000000),
            }),
          );
          break;
      }
    },
    [toolState, baseProps],
  );

  const finishDrawing = useCallback((): DriplElement | null => {
    if (!toolState || !baseProps) {
      setToolState(null);
      setBaseProps(null);
      setCurrentPreview(null);
      return null;
    }

    const props = {
      id: uuidv4(),
      ...baseProps,
      seed: Math.floor(Math.random() * 1000000),
    };

    let element: DriplElement | null = currentPreview;

    if (!element) {
      switch (toolState.type) {
        case "rectangle":
          element = createRectangleElement(toolState.state, props);
          break;
        case "ellipse":
          element = createEllipseElement(toolState.state, props);
          break;
        case "diamond":
          element = createDiamondElement(toolState.state, props);
          break;
        case "arrow": {
          const { arrow } = createArrowElement(toolState.state, props);
          element = arrow;
          break;
        }
        case "line":
          element = createLineElement(
            { ...toolState.state, points: toolState.state.points },
            props,
          );
          break;
        case "freedraw":
          element = createFreedrawElement(toolState.state, props);
          break;
        case "frame":
          element = createFrameElement(toolState.state, props);
          break;
        default:
          break;
      }
    }

    setToolState(null);
    setBaseProps(null);
    setCurrentPreview(null);
    return element;
  }, [toolState, baseProps, currentPreview]);

  const cancelDrawing = useCallback(() => {
    setToolState(null);
    setBaseProps(null);
    setCurrentPreview(null);
  }, []);

  return {
    currentPreview,
    startDrawing,
    updateDrawing,
    finishDrawing,
    cancelDrawing,
    isDrawing: toolState !== null,
  };
}
