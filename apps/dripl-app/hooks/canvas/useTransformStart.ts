'use client';

import { useCallback, useEffect, type RefObject } from 'react';
import type { ResizeHandle } from '@/components/canvas/SelectionOverlay';
import type { InteractionState } from './useCanvasPointerEvents';
import type { CanvasPoint } from './useCanvasCoordinates';

interface TransformControllerLike {
  beginResize: (handle: ResizeHandle, e: React.PointerEvent) => void;
  beginRotate: (e: React.PointerEvent) => void;
}

interface UseTransformStartOptions {
  interactionRef: RefObject<InteractionState>;
  containerRef: RefObject<HTMLDivElement | null>;
  readOnly: boolean;
  getCanvasCoordinates: (e: React.MouseEvent | React.DragEvent | React.PointerEvent) => CanvasPoint;
  lockElementsForGesture: (ids: Iterable<string>) => void;
  unlockGestureElements: () => void;
  setEditingElementId: (id: string | null) => void;
  /** Controller that owns resize/rotate gesture arming (PR2 deep module). */
  controller?: TransformControllerLike | null;
}

/**
 * Thin compat wrapper around the interaction controller's resize/rotate entry
 * points (PR3). The canonical implementation lives in
 * `lib/canvas/interaction-controller.ts` as `beginResize`/`beginRotate`.
 *
 * The unmount cleanup releases gesture locks so a remote element never stays
 * locked by a dead component — the same invariant the controller's gesture
 * teardown and cancel paths enforce during a live gesture.
 */
export function useTransformStart({
  unlockGestureElements,
  controller,
}: UseTransformStartOptions) {
  const handleResizeStart = useCallback(
    (handle: ResizeHandle, e: React.PointerEvent) => {
      if (!controller) {
        throw new Error('useTransformStart requires a controller (PR3)');
      }
      controller.beginResize(handle, e);
    },
    [controller]
  );

  const handleRotateStart = useCallback(
    (e: React.PointerEvent) => {
      if (!controller) {
        throw new Error('useTransformStart requires a controller (PR3)');
      }
      controller.beginRotate(e);
    },
    [controller]
  );

  useEffect(() => {
    return () => {
      unlockGestureElements();
    };
  }, [unlockGestureElements]);

  return { handleResizeStart, handleRotateStart };
}
