"use client";

import { useRef, useCallback } from "react";
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
import { createFrameElement, FrameToolState } from "@/utils/tools/frame";
import { useCanvasStore } from "@/lib/canvas-store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

/**
 * Per-stroke tool state held in a ref (not React state) so mutations during
 * pointermove don't trigger re-renders of the canvas host.
 */
type ActiveToolState =
  | { type: "rectangle"; state: RectangleToolState; id: string; seed: number }
  | { type: "ellipse"; state: EllipseToolState; id: string; seed: number }
  | { type: "diamond"; state: DiamondToolState; id: string; seed: number }
  | { type: "arrow"; state: ArrowToolState; id: string; seed: number }
  | { type: "line"; state: LineToolState; id: string; seed: number }
  | { type: "freedraw"; state: FreedrawToolState; id: string; seed: number }
  | { type: "frame"; state: FrameToolState; id: string; seed: number };

export interface UseDrawingToolsReturn {
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
  /** Commits the draft to the store and returns the committed element. */
  finishDrawing: () => DriplElement | null;
  cancelDrawing: () => void;
  isDrawing: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDrawingTools(): UseDrawingToolsReturn {
  /**
   * All mutable per-stroke state lives in a ref so pointermove handlers never
   * trigger an additional React render cycle during drawing.
   */
  const activeRef = useRef<{
    toolState: ActiveToolState | null;
    baseProps: BaseToolProps | null;
  }>({ toolState: null, baseProps: null });

  // Zustand draft actions — stable references, safe to destructure once.
  const setDraftElement = useCanvasStore((s) => s.setDraftElement);
  const updateDraftElement = useCanvasStore((s) => s.updateDraftElement);
  const commitDraft = useCanvasStore((s) => s.commitDraft);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Build base element props. ID and seed are created ONCE per stroke. */
  const makeProps = (id: string, seed: number, base: BaseToolProps) => ({
    id,
    ...base,
    seed,
  });

  /** Re-derive the current draft element from toolState and write it to Zustand. */
  const syncDraftToStore = useCallback(
    (toolState: ActiveToolState, base: BaseToolProps) => {
      const props = makeProps(toolState.id, toolState.seed, base);

      let element: DriplElement | null = null;

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
          element = createLineElement(toolState.state, props);
          break;
        case "freedraw":
          element = createFreedrawElement(toolState.state, props);
          break;
        case "frame":
          element = createFrameElement(toolState.state, props);
          break;
      }

      if (element) {
        // updateDraftElement does a shallow spread — stable ID guaranteed.
        updateDraftElement(element as Partial<DriplElement>);
      }
    },
    [updateDraftElement],
  );

  // ---------------------------------------------------------------------------
  // startDrawing — initialise the per-stroke ref AND seed the Zustand draft
  // ---------------------------------------------------------------------------
  const startDrawing = useCallback(
    (
      point: Point,
      tool: ToolType,
      shiftKey: boolean,
      props: BaseToolProps,
      elements?: DriplElement[],
    ) => {
      // Stable ID + seed for this entire stroke.
      const id = uuidv4();
      const seed = Math.floor(Math.random() * 1_000_000);

      let toolState: ActiveToolState | null = null;

      switch (tool) {
        case "rectangle":
          toolState = {
            type: "rectangle",
            id,
            seed,
            state: { startPoint: point, currentPoint: point, shiftKey },
          };
          break;
        case "ellipse":
          toolState = {
            type: "ellipse",
            id,
            seed,
            state: { startPoint: point, currentPoint: point, shiftKey },
          };
          break;
        case "diamond":
          toolState = {
            type: "diamond",
            id,
            seed,
            state: { startPoint: point, currentPoint: point, shiftKey },
          };
          break;
        case "arrow":
          toolState = {
            type: "arrow",
            id,
            seed,
            state: {
              points: [point],
              isComplete: false,
              isDragging: false,
              currentPoint: null,
            },
          };
          break;
        case "line":
          toolState = {
            type: "line",
            id,
            seed,
            state: {
              points: [point],
              isComplete: false,
              shiftKey,
              isDragging: false,
              currentPoint: null,
            },
          };
          break;
        case "freedraw":
          toolState = {
            type: "freedraw",
            id,
            seed,
            state: { points: [point], isComplete: false },
          };
          break;
        case "frame":
          toolState = {
            type: "frame",
            id,
            seed,
            state: { startPoint: point, currentPoint: point, shiftKey },
          };
          break;
        default:
          return;
      }

      activeRef.current = { toolState, baseProps: props };

      // Seed the Zustand draft with the initial (collapsed) element so the
      // store immediately knows a draw is in progress.
      const initialProps = makeProps(id, seed, props);
      let initialElement: DriplElement | null = null;

      switch (toolState.type) {
        case "rectangle":
          initialElement = createRectangleElement(
            toolState.state,
            initialProps,
          );
          break;
        case "ellipse":
          initialElement = createEllipseElement(toolState.state, initialProps);
          break;
        case "diamond":
          initialElement = createDiamondElement(toolState.state, initialProps);
          break;
        case "arrow": {
          const { arrow } = createArrowElement(toolState.state, initialProps);
          initialElement = arrow;
          break;
        }
        case "line":
          initialElement = createLineElement(toolState.state, initialProps);
          break;
        case "freedraw":
          initialElement = createFreedrawElement(toolState.state, initialProps);
          break;
        case "frame":
          initialElement = createFrameElement(toolState.state, initialProps);
          break;
      }

      if (initialElement) {
        // setDraftElement sets lifecycle → "drawing"
        setDraftElement(initialElement);
      }
    },
    [setDraftElement],
  );

  // ---------------------------------------------------------------------------
  // updateDrawing — mutates the ref, then syncs geometry to the Zustand draft
  // ---------------------------------------------------------------------------
  const updateDrawing = useCallback(
    (point: Point, shiftKey: boolean, elements?: DriplElement[]) => {
      const { toolState, baseProps } = activeRef.current;
      if (!toolState || !baseProps) return;

      switch (toolState.type) {
        case "rectangle":
          toolState.state = {
            ...toolState.state,
            currentPoint: point,
            shiftKey,
          };
          break;

        case "ellipse":
          toolState.state = {
            ...toolState.state,
            currentPoint: point,
            shiftKey,
          };
          break;

        case "diamond":
          toolState.state = {
            ...toolState.state,
            currentPoint: point,
            shiftKey,
          };
          break;

        case "arrow": {
          const snapped = elements
            ? snapArrowToElement(point, elements)
            : point;
          const start = toolState.state.points[0] ?? point;
          toolState.state = {
            ...toolState.state,
            points: [start, snapped],
            currentPoint: snapped,
          };
          break;
        }

        case "line": {
          const start = toolState.state.points[0] ?? point;
          let end = point;

          if (shiftKey) {
            const dx = point.x - start.x;
            const dy = point.y - start.y;
            const angle = Math.atan2(dy, dx);
            const dist = Math.sqrt(dx * dx + dy * dy);
            const snap = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
            end = {
              x: start.x + Math.cos(snap) * dist,
              y: start.y + Math.sin(snap) * dist,
            };
          }

          toolState.state = {
            ...toolState.state,
            points: [start, end],
            shiftKey,
            currentPoint: end,
          };
          break;
        }

        case "freedraw": {
          const newPoints = [...toolState.state.points, point];
          toolState.state = { ...toolState.state, points: newPoints };
          // Throttle — only re-derive shape every 3rd point to save CPU.
          if (newPoints.length % 3 !== 0 && newPoints.length > 10) return;
          break;
        }

        case "frame":
          toolState.state = {
            ...toolState.state,
            currentPoint: point,
            shiftKey,
          };
          break;
      }

      syncDraftToStore(toolState, baseProps);
    },
    [syncDraftToStore],
  );

  // ---------------------------------------------------------------------------
  // finishDrawing — atomically commits draft → elements[] + history
  // ---------------------------------------------------------------------------
  const finishDrawing = useCallback((): DriplElement | null => {
    const { toolState, baseProps } = activeRef.current;

    // Reset ref first so any stray pointerup events are no-ops.
    activeRef.current = { toolState: null, baseProps: null };

    if (!toolState || !baseProps) {
      // Clear any orphaned draft (e.g. cancelled mid-draw).
      setDraftElement(null);
      return null;
    }

    // Ensure the very latest geometry is reflected in the store draft before
    // committing (handles the edge case of mousedown → immediate mouseup).
    syncDraftToStore(toolState, baseProps);

    // commitDraft() atomically appends draftElement to elements[] and pushes
    // history — it is the ONLY place history is pushed for drawing operations.
    const committed = commitDraft();
    return committed;
  }, [commitDraft, setDraftElement, syncDraftToStore]);

  // ---------------------------------------------------------------------------
  // cancelDrawing
  // ---------------------------------------------------------------------------
  const cancelDrawing = useCallback(() => {
    activeRef.current = { toolState: null, baseProps: null };
    setDraftElement(null); // clears draft + resets lifecycle to "idle"
  }, [setDraftElement]);

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------
  const lifecycle = useCanvasStore((s) => s.drawingLifecycle);

  return {
    startDrawing,
    updateDrawing,
    finishDrawing,
    cancelDrawing,
    isDrawing: lifecycle === "drawing" || lifecycle === "committing",
  };
}
