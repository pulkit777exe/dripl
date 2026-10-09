'use client';

import { useCallback, useEffect, useRef } from 'react';
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

  // Freedraw samples accumulate in `activeRef` until the trailing-edge flush
  // syncs the draft in a single store commit (see updateDrawing). A freehand
  // stroke replays every coalesced sample in one frame; syncing each one
  // re-rendered the canvas subtree per sample for a single visible frame.
  // Other tools deliver at most one sample per frame (the pointer queue
  // collapses them), so they keep syncing inline — batching them would change
  // their synchronous contract for no gain.
  const draftFlushRef = useRef<number | null>(null);

  const cancelDraftFlush = useCallback(() => {
    if (draftFlushRef.current !== null) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(draftFlushRef.current);
      }
      draftFlushRef.current = null;
    }
  }, []);

  const flushDraftToStore = useCallback(() => {
    cancelDraftFlush();
    const { toolState, baseProps } = activeRef.current;
    // Finished or cancelled since scheduling: nothing to sync.
    if (!toolState || !baseProps) return;
    syncDraftToStore(toolState, baseProps);
  }, [syncDraftToStore, cancelDraftFlush]);

  const scheduleDraftFlush = useCallback(() => {
    if (draftFlushRef.current !== null) return;
    // No frame source: apply inline, which is the pre-batching behavior.
    if (typeof requestAnimationFrame === 'undefined') {
      flushDraftToStore();
      return;
    }
    draftFlushRef.current = requestAnimationFrame(() => {
      draftFlushRef.current = null;
      flushDraftToStore();
    });
  }, [flushDraftToStore]);

  const startDrawing = useCallback(
    (
      point: Point,
      tool: ToolType,
      options: ToolStartOptions,
      baseProps: BaseToolProps,
      _elements?: DriplElement[]
    ) => {
      // A previous stroke's scheduled sync must not land on the new stroke.
      cancelDraftFlush();
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
    [buildElement, setDraftElement, cancelDraftFlush]
  );

  const updateDrawing = useCallback(
    (point: Point, options: ToolUpdateOptions, elements?: DriplElement[]) => {
      const { toolState, baseProps } = activeRef.current;
      if (!toolState || !baseProps) return;

      const next = advanceToolState(toolState, point, options);
      activeRef.current = { toolState: next, baseProps };

      if (next.type === 'freedraw') {
        // State advances per sample for full fidelity; the store sync lands
        // once per frame (see scheduleDraftFlush).
        scheduleDraftFlush();
      } else {
        syncDraftToStore(next, baseProps);
      }
      if (next.type === 'arrow' && elements) {
        // Placeholder for future arrow binding support without affecting behavior.
        void elements;
      }
    },
    [syncDraftToStore, scheduleDraftFlush]
  );

  const finishDrawing = useCallback((): DriplElement | null => {
    const { toolState, baseProps } = activeRef.current;
    activeRef.current = { toolState: null, baseProps: null };
    // The preview below is built from the tool state, which already holds
    // every sample, so a pending sync is redundant rather than load-bearing.
    cancelDraftFlush();
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
  }, [buildElement, commitDraft, setDraftElement, updateDraftElement, cancelDraftFlush]);

  const cancelDrawing = useCallback(() => {
    activeRef.current = { toolState: null, baseProps: null };
    cancelDraftFlush();
    setDraftElement(null);
  }, [setDraftElement, cancelDraftFlush]);

  useEffect(() => () => cancelDraftFlush(), [cancelDraftFlush]);

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
