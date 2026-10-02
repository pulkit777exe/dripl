'use client';

import { useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { DriplElement, Point, ArrowStyle } from '@dripl/common';
import { useCanvasStore } from '@/lib/store';
import { createRectangleElement } from '@/utils/tools/rectangle';
import { createEllipseElement } from '@/utils/tools/ellipse';
import { createDiamondElement } from '@/utils/tools/diamond';
import { createArrowElement } from '@/utils/tools/arrow';
import { createLineElement } from '@/utils/tools/line';
import { createFreedrawElement } from '@/utils/tools/freedraw';
import { createFrameElement } from '@/utils/tools/frame';
import { createEmbedElement } from '@/utils/tools/webEmbed';
import {
  advanceToolState,
  bindCommittedArrow,
  createToolState,
  detectArrowBindings,
  isTinyPreview,
  smoothFinishedPoints,
  type ActiveToolState,
  type ToolStartOptions,
  type ToolTypeName,
  type ToolUpdateOptions,
} from '@/lib/draw/tool-state';

/** Tool names accepted by startDrawing; pointer events imports this type. */
export type ToolType = ToolTypeName;

interface BaseToolProps {
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  opacity: number;
  roughness: number;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  fillStyle: 'hachure' | 'solid' | 'zigzag' | 'cross-hatch' | 'dots' | 'dashed' | 'zigzag-line';
  arrowStyle?: ArrowStyle;
}

export interface UseDrawingToolsReturn {
  startDrawing: (
    point: Point,
    tool: ToolType,
    options: ToolStartOptions,
    baseProps: BaseToolProps,
    elements?: DriplElement[]
  ) => void;
  updateDrawing: (point: Point, options: ToolUpdateOptions, elements?: DriplElement[]) => void;
  finishDrawing: () => DriplElement | null;
  cancelDrawing: () => void;
  bindModeRef: React.MutableRefObject<'orbit' | 'inside'>;
  isDrawing: boolean;
}

export function useDrawingTools(): UseDrawingToolsReturn {
  const activeRef = useRef<{
    toolState: ActiveToolState | null;
    baseProps: BaseToolProps | null;
  }>({ toolState: null, baseProps: null });

  const bindModeRef = useRef<'orbit' | 'inside'>('orbit');

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
          return createArrowElement(toolState.state, props, undefined, base.arrowStyle).arrow;
        case 'line':
          return createLineElement(toolState.state, props);
        case 'freedraw':
          return createFreedrawElement(toolState.state, props);
        case 'frame':
          return createFrameElement(toolState.state, props);
        case 'embed': {
          // Use the URL from the tool state, or from the pending embed in the store
          const pendingEmbed = useCanvasStore.getState().pendingEmbed;
          const url = toolState.url || pendingEmbed?.url || '';
          const title = toolState.title || pendingEmbed?.title;
          return createEmbedElement(toolState.state, props, url, title);
        }
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
      options: ToolStartOptions,
      baseProps: BaseToolProps,
      _elements?: DriplElement[]
    ) => {
      const id = uuidv4();
      const seed = Math.floor(Math.random() * 1_000_000);
      const { toolState, bindMode } = createToolState(tool, point, options, id, seed);
      if (!toolState) return;
      if (bindMode) bindModeRef.current = bindMode;

      activeRef.current = { toolState, baseProps };
      const initial = buildElement(toolState, baseProps);
      if (initial) {
        setDraftElement(initial);
      }
    },
    [buildElement, setDraftElement]
  );

  const updateDrawing = useCallback(
    (point: Point, options: ToolUpdateOptions, elements?: DriplElement[]) => {
      const { toolState, baseProps } = activeRef.current;
      if (!toolState || !baseProps) return;

      const next = advanceToolState(toolState, point, options);
      activeRef.current = { toolState: next, baseProps };

      syncDraftToStore(next, baseProps);
      if (next.type === 'arrow' && elements) {
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
        points: smoothFinishedPoints(toolState.state.points),
      };
    }

    let preview = buildElement(toolState, baseProps);
    if (!preview) {
      setDraftElement(null);
      return null;
    }

    if (isTinyPreview(preview)) {
      setDraftElement(null);
      return null;
    }

    // Detect bindings for arrows
    const detected = detectArrowBindings(
      preview,
      useCanvasStore.getState().elements,
      bindModeRef.current
    );
    preview = detected.preview;
    const { startMatch, endMatch } = detected;

    updateDraftElement(preview);
    const committed = commitDraft();

    // Update the target shapes' boundElements (reverse index) so arrows follow shapes when dragged
    if (committed && (startMatch || endMatch)) {
      const state = useCanvasStore.getState();
      state.setElements(bindCommittedArrow(committed, startMatch, endMatch, state.elements));
    }

    return committed;
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
    bindModeRef,
    isDrawing: lifecycle === 'drawing' || lifecycle === 'committing',
  };
}
