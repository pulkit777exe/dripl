import type { DriplElement, LinearElement, NormalizedBinding, Point } from '@dripl/common';
import { bindArrowToElement } from '@/utils/arrow-binding';
import { findNearestShape } from './find-shape';
import { getDistance, simplifyRdp, snapAngle } from './simplify';
import type { RectangleToolState } from '@/utils/tools/rectangle';
import type { EllipseToolState } from '@/utils/tools/ellipse';
import type { DiamondToolState } from '@/utils/tools/diamond';
import type { ArrowToolState } from '@/utils/tools/arrow';
import type { LineToolState } from '@/utils/tools/line';
import type { FreedrawToolState } from '@/utils/tools/freedraw';
import type { FrameToolState } from '@/utils/tools/frame';
import type { WebEmbedToolState } from '@/utils/tools/webEmbed';

/**
 * Drawing tool state machine — pure logic extracted from `useDrawingTools`.
 *
 * The hook owns the active ref, the draft store sync, and the commit; every
 * state transition (start/update/finish guards/binding detection) is a
 * closed-form function here, unit-tested without stores or gestures.
 */

export type ActiveToolState =
  | { type: 'rectangle'; state: RectangleToolState; id: string; seed: number }
  | { type: 'ellipse'; state: EllipseToolState; id: string; seed: number }
  | { type: 'diamond'; state: DiamondToolState; id: string; seed: number }
  | { type: 'arrow'; state: ArrowToolState; id: string; seed: number }
  | { type: 'line'; state: LineToolState; id: string; seed: number }
  | { type: 'freedraw'; state: FreedrawToolState; id: string; seed: number }
  | { type: 'frame'; state: FrameToolState; id: string; seed: number }
  | {
      type: 'embed';
      state: WebEmbedToolState;
      id: string;
      seed: number;
      url: string;
      title?: string;
    };

export type ToolTypeName =
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
  | 'embed'
  | 'eraser';

export interface ToolStartOptions {
  shiftKey: boolean;
  altKey?: boolean;
}

export interface ToolUpdateOptions {
  shiftKey: boolean;
  altKey?: boolean;
  pressure?: number;
}

export interface ToolStart {
  toolState: ActiveToolState | null;
  /**
   * Arrow bind mode derived from Alt (orbit by default, inside with Alt).
   * Null for other tools — the hook leaves the ref untouched for those,
   * matching the historical behavior.
   */
  bindMode: 'orbit' | 'inside' | null;
}

/** Initial tool state for a pointer-down; null for non-shape tools. */
export function createToolState(
  tool: ToolTypeName,
  point: Point,
  options: ToolStartOptions,
  id: string,
  seed: number
): ToolStart {
  const bindMode = tool === 'arrow' ? (options.altKey ? 'inside' : 'orbit') : null;
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
    case 'embed':
      toolState = {
        type: 'embed',
        id,
        seed,
        state: { startPoint: point, currentPoint: point, shiftKey: options.shiftKey },
        url: '',
        title: undefined,
      };
      break;
    default:
      toolState = null;
  }

  return { toolState, bindMode };
}

/** Advance tool state for a pointer-move; returns a new wrapper. */
export function advanceToolState(
  toolState: ActiveToolState,
  point: Point,
  options: ToolUpdateOptions
): ActiveToolState {
  switch (toolState.type) {
    case 'rectangle':
      return {
        ...toolState,
        state: {
          ...toolState.state,
          currentPoint: point,
          shiftKey: options.shiftKey,
          altKey: options.altKey,
        },
      };
    case 'ellipse':
      return {
        ...toolState,
        state: {
          ...toolState.state,
          currentPoint: point,
          shiftKey: options.shiftKey,
          altKey: options.altKey,
        },
      };
    case 'diamond':
    case 'frame':
    case 'embed':
      return {
        ...toolState,
        state: { ...toolState.state, currentPoint: point, shiftKey: options.shiftKey },
      };
    case 'arrow': {
      const start = toolState.state.points[0] ?? point;
      const end = options.shiftKey ? snapAngle(start, point, 15) : point;
      return {
        ...toolState,
        state: {
          ...toolState.state,
          points: [start, end],
          currentPoint: end,
        },
      };
    }
    case 'line': {
      const start = toolState.state.points[0] ?? point;
      const end = options.shiftKey ? snapAngle(start, point, 15) : point;
      return {
        ...toolState,
        state: {
          ...toolState.state,
          points: [start, end],
          currentPoint: end,
          shiftKey: options.shiftKey,
        },
      };
    }
    case 'freedraw': {
      const pressure = options.pressure ?? 0.5;
      return {
        ...toolState,
        state: {
          ...toolState.state,
          pressure,
          pressureValues: [...(toolState.state.pressureValues ?? []), pressure],
          points: [...toolState.state.points, point],
        },
      };
    }
  }
}

const TINY_SHAPE_PX = 5;

/**
 * Discard guard for accidental clicks: tiny boxes and sub-5px strokes
 * never commit. Mirrors the inline finish checks exactly.
 */
export function isTinyPreview(preview: DriplElement): boolean {
  const isTinyShape =
    (preview.type === 'rectangle' ||
      preview.type === 'ellipse' ||
      preview.type === 'diamond' ||
      preview.type === 'frame') &&
    (Math.abs(preview.width) < TINY_SHAPE_PX || Math.abs(preview.height) < TINY_SHAPE_PX);

  const points = 'points' in preview && Array.isArray(preview.points) ? preview.points : null;
  const isTinyLinear =
    (preview.type === 'line' || preview.type === 'arrow') &&
    points !== null &&
    points.length >= 2 &&
    getDistance(points[0] as Point, points[1] as Point) < TINY_SHAPE_PX;

  return isTinyShape || isTinyLinear;
}

export interface ArrowBindingMatch {
  element: DriplElement;
  binding: NormalizedBinding;
}

export interface DetectedArrowBindings {
  preview: DriplElement;
  startMatch: ArrowBindingMatch | null;
  endMatch: ArrowBindingMatch | null;
}

/** Detect shape bindings for a finished arrow's endpoints. */
export function detectArrowBindings(
  preview: DriplElement,
  elements: DriplElement[],
  bindMode: 'orbit' | 'inside'
): DetectedArrowBindings {
  let startMatch: ArrowBindingMatch | null = null;
  let endMatch: ArrowBindingMatch | null = null;
  let next = preview;

  if (preview.type === 'arrow' && 'points' in preview) {
    const points = preview.points as Point[];
    const arrowId = preview.id;

    if (points.length >= 2) {
      const firstPoint = points[0]!;
      const lastPoint = points[points.length - 1]!;
      const startPoint = { x: preview.x + firstPoint.x, y: preview.y + firstPoint.y };
      const endPoint = { x: preview.x + lastPoint.x, y: preview.y + lastPoint.y };

      startMatch = findNearestShape(startPoint, elements, arrowId, bindMode);
      endMatch = findNearestShape(endPoint, elements, arrowId, bindMode);

      if (startMatch || endMatch) {
        next = {
          ...preview,
          startBinding: startMatch?.binding,
          endBinding: endMatch?.binding,
        };
      }
    }
  }

  return { preview: next, startMatch, endMatch };
}

/**
 * Update bound shapes' reverse index so a committed arrow follows its
 * targets when dragged. Pure list transform; the caller commits to state.
 */
export function bindCommittedArrow(
  committed: DriplElement,
  startMatch: ArrowBindingMatch | null,
  endMatch: ArrowBindingMatch | null,
  elements: DriplElement[]
): DriplElement[] {
  let next = elements;
  if (startMatch) {
    next = bindArrowToElement(
      committed as LinearElement,
      startMatch.element.id,
      'start',
      startMatch.binding.fixedPoint,
      startMatch.binding.mode,
      next
    );
  }
  if (endMatch) {
    next = bindArrowToElement(
      committed as LinearElement,
      endMatch.element.id,
      'end',
      endMatch.binding.fixedPoint,
      endMatch.binding.mode,
      next
    );
  }
  return next;
}

/** Smooth a finished freedraw stroke before preview (RDP, 0.8px). */
export function smoothFinishedPoints(points: Point[]): Point[] {
  return simplifyRdp(points, 0.8);
}
