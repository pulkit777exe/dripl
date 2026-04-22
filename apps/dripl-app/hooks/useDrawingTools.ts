'use client';

import { useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { DriplElement, Point } from '@dripl/common';
import { useCanvasStore } from '@/lib/canvas-store';
import { createRectangleElement, type RectangleToolState } from '@/utils/tools/rectangle';
import { createEllipseElement, type EllipseToolState } from '@/utils/tools/ellipse';
import { createDiamondElement, type DiamondToolState } from '@/utils/tools/diamond';
import { createArrowElement, type ArrowToolState } from '@/utils/tools/arrow';
import { createLineElement, type LineToolState } from '@/utils/tools/line';
import { createFreedrawElement, type FreedrawToolState } from '@/utils/tools/freedraw';
import { createFrameElement, type FrameToolState } from '@/utils/tools/frame';

export type ToolType =
  | 'select'
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'arrow'
  | 'line'
  | 'freedraw'
  | 'text'
  | 'image'
  | 'frame'
  | 'eraser';

interface BaseToolProps {
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  opacity: number;
  roughness: number;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  fillStyle: 'hachure' | 'solid' | 'zigzag' | 'cross-hatch' | 'dots' | 'dashed' | 'zigzag-line';
}

type ActiveToolState =
  | { type: 'rectangle'; state: RectangleToolState; id: string; seed: number }
  | { type: 'ellipse'; state: EllipseToolState; id: string; seed: number }
  | { type: 'diamond'; state: DiamondToolState; id: string; seed: number }
  | { type: 'arrow'; state: ArrowToolState; id: string; seed: number }
  | { type: 'line'; state: LineToolState; id: string; seed: number }
  | { type: 'freedraw'; state: FreedrawToolState; id: string; seed: number }
  | { type: 'frame'; state: FrameToolState; id: string; seed: number };

interface StartOptions {
  shiftKey: boolean;
  altKey?: boolean;
}

interface UpdateOptions {
  shiftKey: boolean;
  altKey?: boolean;
  pressure?: number;
}

export interface UseDrawingToolsReturn {
  startDrawing: (
    point: Point,
    tool: ToolType,
    options: StartOptions,
    baseProps: BaseToolProps,
    elements?: DriplElement[]
  ) => void;
  updateDrawing: (point: Point, options: UpdateOptions, elements?: DriplElement[]) => void;
  finishDrawing: () => DriplElement | null;
  cancelDrawing: () => void;
  isDrawing: boolean;
}

function getDistance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function snapAngle(start: Point, end: Point, stepDegrees = 15): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance === 0) return end;
  const step = (stepDegrees * Math.PI) / 180;
  const snappedAngle = Math.round(Math.atan2(dy, dx) / step) * step;
  return {
    x: start.x + Math.cos(snappedAngle) * distance,
    y: start.y + Math.sin(snappedAngle) * distance,
  };
}

function perpendicularDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return getDistance(point, start);
  }
  const numerator = Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x);
  const denominator = Math.sqrt(dx * dx + dy * dy);
  return numerator / denominator;
}

function simplifyRdp(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points;

  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return points;

  let maxDistance = -1;
  let maxIndex = 0;

  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i];
    if (!point) continue;
    const distance = perpendicularDistance(point, first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  if (maxDistance <= epsilon) {
    return [first, last];
  }

  const left = simplifyRdp(points.slice(0, maxIndex + 1), epsilon);
  const right = simplifyRdp(points.slice(maxIndex), epsilon);
  return [...left.slice(0, -1), ...right];
}

export function useDrawingTools(): UseDrawingToolsReturn {
  const activeRef = useRef<{
    toolState: ActiveToolState | null;
    baseProps: BaseToolProps | null;
  }>({ toolState: null, baseProps: null });

  const setDraftElement = useCanvasStore(state => state.setDraftElement);
  const updateDraftElement = useCanvasStore(state => state.updateDraftElement);
  const commitDraft = useCanvasStore(state => state.commitDraft);

  const makeProps = useCallback(
    (id: string, seed: number, base: BaseToolProps) => ({
      id,
      ...base,
      seed,
    }),
    []
  );

  const buildElement = useCallback(
    (toolState: ActiveToolState, base: BaseToolProps): DriplElement | null => {
      const props = makeProps(toolState.id, toolState.seed, base);

      switch (toolState.type) {
        case 'rectangle':
          return createRectangleElement(toolState.state, props);
        case 'ellipse':
          return createEllipseElement(toolState.state, props);
        case 'diamond':
          return createDiamondElement(toolState.state, props);
        case 'arrow':
          return createArrowElement(toolState.state, props).arrow;
        case 'line':
          return createLineElement(toolState.state, props);
        case 'freedraw':
          return createFreedrawElement(toolState.state, props);
        case 'frame':
          return createFrameElement(toolState.state, props);
        default:
          return null;
      }
    },
    [makeProps]
  );

  const syncDraftToStore = useCallback(
    (toolState: ActiveToolState, base: BaseToolProps) => {
      const element = buildElement(toolState, base);
      if (element) {
        updateDraftElement(element as Partial<DriplElement>);
      }
    },
    [buildElement, updateDraftElement]
  );

  const startDrawing = useCallback(
    (
      point: Point,
      tool: ToolType,
      options: StartOptions,
      baseProps: BaseToolProps,
      _elements?: DriplElement[]
    ) => {
      const id = uuidv4();
      const seed = Math.floor(Math.random() * 1_000_000);
      let toolState: ActiveToolState | null = null;

      switch (tool) {
        case 'rectangle':
          toolState = {
            type: 'rectangle',
            id,
            seed,
            state: {
              startPoint: point,
              currentPoint: point,
              shiftKey: options.shiftKey,
              altKey: options.altKey,
            },
          };
          break;
        case 'ellipse':
          toolState = {
            type: 'ellipse',
            id,
            seed,
            state: {
              startPoint: point,
              currentPoint: point,
              shiftKey: options.shiftKey,
              altKey: options.altKey,
            },
          };
          break;
        case 'diamond':
          toolState = {
            type: 'diamond',
            id,
            seed,
            state: { startPoint: point, currentPoint: point, shiftKey: options.shiftKey },
          };
          break;
        case 'arrow':
          toolState = {
            type: 'arrow',
            id,
            seed,
            state: {
              points: [point, point],
              isComplete: false,
              isDragging: true,
              currentPoint: point,
            },
          };
          break;
        case 'line':
          toolState = {
            type: 'line',
            id,
            seed,
            state: {
              points: [point, point],
              isComplete: false,
              shiftKey: options.shiftKey,
              isDragging: true,
              currentPoint: point,
            },
          };
          break;
        case 'freedraw':
          toolState = {
            type: 'freedraw',
            id,
            seed,
            state: { points: [point], pressureValues: [0.5], isComplete: false },
          };
          break;
        case 'frame':
          toolState = {
            type: 'frame',
            id,
            seed,
            state: { startPoint: point, currentPoint: point, shiftKey: options.shiftKey },
          };
          break;
        default:
          return;
      }

      activeRef.current = { toolState, baseProps };
      const initial = buildElement(toolState, baseProps);
      if (initial) {
        setDraftElement(initial);
      }
    },
    [buildElement, setDraftElement]
  );

  const updateDrawing = useCallback(
    (point: Point, options: UpdateOptions, elements?: DriplElement[]) => {
      const { toolState, baseProps } = activeRef.current;
      if (!toolState || !baseProps) return;

      switch (toolState.type) {
        case 'rectangle':
          toolState.state = {
            ...toolState.state,
            currentPoint: point,
            shiftKey: options.shiftKey,
            altKey: options.altKey,
          };
          break;
        case 'ellipse':
          toolState.state = {
            ...toolState.state,
            currentPoint: point,
            shiftKey: options.shiftKey,
            altKey: options.altKey,
          };
          break;
        case 'diamond':
          toolState.state = { ...toolState.state, currentPoint: point, shiftKey: options.shiftKey };
          break;
        case 'frame':
          toolState.state = { ...toolState.state, currentPoint: point, shiftKey: options.shiftKey };
          break;
        case 'arrow': {
          const start = toolState.state.points[0] ?? point;
          const end = options.shiftKey ? snapAngle(start, point, 15) : point;
          toolState.state = {
            ...toolState.state,
            points: [start, end],
            currentPoint: end,
          };
          break;
        }
        case 'line': {
          const start = toolState.state.points[0] ?? point;
          const end = options.shiftKey ? snapAngle(start, point, 15) : point;
          toolState.state = {
            ...toolState.state,
            points: [start, end],
            currentPoint: end,
            shiftKey: options.shiftKey,
          };
          break;
        }
        case 'freedraw': {
          const pressure = options.pressure ?? 0.5;
          toolState.state = {
            ...toolState.state,
            pressure,
            pressureValues: [...(toolState.state.pressureValues ?? []), pressure],
            points: [...toolState.state.points, point],
          };
          break;
        }
      }

      syncDraftToStore(toolState, baseProps);
      if (toolState.type === 'arrow' && elements) {
        // Placeholder for future arrow binding support without affecting behavior.
        void elements;
      }
    },
    [syncDraftToStore]
  );

  const finishDrawing = useCallback((): DriplElement | null => {
    const { toolState, baseProps } = activeRef.current;
    activeRef.current = { toolState: null, baseProps: null };
    if (!toolState || !baseProps) {
      setDraftElement(null);
      return null;
    }

    if (toolState.type === 'freedraw') {
      toolState.state = {
        ...toolState.state,
        points: simplifyRdp(toolState.state.points, 0.8),
      };
    }

    const preview = buildElement(toolState, baseProps);
    if (!preview) {
      setDraftElement(null);
      return null;
    }

    const isTinyShape =
      (preview.type === 'rectangle' ||
        preview.type === 'ellipse' ||
        preview.type === 'diamond' ||
        preview.type === 'frame') &&
      (Math.abs(preview.width) < 5 || Math.abs(preview.height) < 5);

    const isTinyLinear =
      (preview.type === 'line' || preview.type === 'arrow') &&
      'points' in preview &&
      Array.isArray(preview.points) &&
      preview.points.length >= 2 &&
      getDistance(preview.points[0] as Point, preview.points[1] as Point) < 5;

    if (isTinyShape || isTinyLinear) {
      setDraftElement(null);
      return null;
    }

    updateDraftElement(preview);
    return commitDraft();
  }, [buildElement, commitDraft, setDraftElement, updateDraftElement]);

  const cancelDrawing = useCallback(() => {
    activeRef.current = { toolState: null, baseProps: null };
    setDraftElement(null);
  }, [setDraftElement]);

  const lifecycle = useCanvasStore(state => state.drawingLifecycle);

  return {
    startDrawing,
    updateDrawing,
    finishDrawing,
    cancelDrawing,
    isDrawing: lifecycle === 'drawing' || lifecycle === 'committing',
  };
}
