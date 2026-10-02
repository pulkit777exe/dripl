'use client';

import { useCallback, useEffect, type RefObject } from 'react';
import { useCanvasStore } from '@/lib/store';
import type { DriplElement } from '@dripl/common';
import type { ResizeHandle } from '@/components/canvas/SelectionOverlay';
import type { InteractionState } from './useCanvasPointerEvents';
import type { CanvasPoint } from './useCanvasCoordinates';

interface UseTransformStartOptions {
  interactionRef: RefObject<InteractionState>;
  containerRef: RefObject<HTMLDivElement | null>;
  readOnly: boolean;
  getCanvasCoordinates: (e: React.MouseEvent | React.DragEvent | React.PointerEvent) => CanvasPoint;
  lockElementsForGesture: (ids: Iterable<string>) => void;
  unlockGestureElements: () => void;
  setEditingElementId: (id: string | null) => void;
}

/**
 * Resize / rotate gesture entry points.
 *
 * Extracted verbatim from RoughCanvas: single-selection guard, collab-lock
 * guard, frozen-clone baseline, interaction-ref arming, editing lock, and
 * pointer capture. The unmount effect releases gesture locks so a remote
 * element never stays locked by a dead component.
 */
export function useTransformStart({
  interactionRef,
  containerRef,
  readOnly,
  getCanvasCoordinates,
  lockElementsForGesture,
  unlockGestureElements,
  setEditingElementId,
}: UseTransformStartOptions) {
  const handleResizeStart = useCallback(
    (handle: ResizeHandle, e: React.PointerEvent) => {
      e.stopPropagation();
      if (readOnly) return;
      const state = useCanvasStore.getState();
      const selectedIdsArray = Array.from(state.selectedIds);
      if (selectedIdsArray.length !== 1) return;

      const element = state.elements.find(el => el.id === selectedIdsArray[0]);
      if (!element) return;
      const lockOwner = state.elementLocks.get(element.id);
      if (lockOwner && lockOwner !== state.userId) return;

      const startPos = getCanvasCoordinates(e);

      // Deep clone element to freeze it as the baseline
      const frozenEl: DriplElement = JSON.parse(JSON.stringify(element));

      interactionRef.current.resizing = true;
      interactionRef.current.historyPushed = false;
      interactionRef.current.resizeHandle = handle;
      interactionRef.current.resizeStartCanvasPos = startPos;
      interactionRef.current.resizeInitialEl = frozenEl;

      useCanvasStore.getState().setIsResizing(true);
      // Lock: prevent remote reconciliation from overwriting this element.
      setEditingElementId(element.id);
      lockElementsForGesture([element.id]);

      // Capture pointer on the canvas so we still get events outside
      const canvas = containerRef.current?.querySelector(
        'canvas:last-child'
      ) as HTMLCanvasElement | null;
      if (canvas) canvas.setPointerCapture(e.pointerId);
    },
    [
      containerRef,
      getCanvasCoordinates,
      interactionRef,
      lockElementsForGesture,
      readOnly,
      setEditingElementId,
    ]
  );

  const handleRotateStart = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      if (readOnly) return;
      const state = useCanvasStore.getState();
      const selectedIdsArray = Array.from(state.selectedIds);
      if (selectedIdsArray.length !== 1) return;

      const element = state.elements.find(el => el.id === selectedIdsArray[0]);
      if (!element) return;
      const lockOwner = state.elementLocks.get(element.id);
      if (lockOwner && lockOwner !== state.userId) return;

      const frozenEl: DriplElement = JSON.parse(JSON.stringify(element));

      interactionRef.current.rotating = true;
      interactionRef.current.historyPushed = false;
      interactionRef.current.rotateInitialEl = frozenEl;

      useCanvasStore.getState().setIsRotating(true);
      // Lock: prevent remote reconciliation from overwriting this element.
      setEditingElementId(element.id);
      lockElementsForGesture([element.id]);

      const canvas = containerRef.current?.querySelector(
        'canvas:last-child'
      ) as HTMLCanvasElement | null;
      if (canvas) canvas.setPointerCapture(e.pointerId);
    },
    [containerRef, interactionRef, lockElementsForGesture, readOnly, setEditingElementId]
  );

  useEffect(() => {
    return () => {
      unlockGestureElements();
    };
  }, [unlockGestureElements]);

  return { handleResizeStart, handleRotateStart };
}
