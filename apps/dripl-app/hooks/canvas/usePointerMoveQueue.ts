'use client';

import { useCallback, useEffect, useRef } from 'react';
import { perfMark, perfMeasure } from '@/utils/performance';
import { capPointerSamples, MAX_PENDING_POINTER_SAMPLES } from '@/lib/canvas/pointer-samples';

export type QueuedPointerMove = React.PointerEvent<HTMLCanvasElement>;

/**
 * React releases synthetic-event fields after the DOM handler returns. Pointer
 * moves are intentionally deferred to the next animation frame, so retain the
 * small set of values the interaction layer consumes before queueing them.
 */
function snapshotNativePointerMove(
  event: PointerEvent,
  target: EventTarget | null,
  currentTarget: HTMLCanvasElement
): QueuedPointerMove {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    pageX: event.pageX,
    pageY: event.pageY,
    movementX: event.movementX,
    movementY: event.movementY,
    button: event.button,
    buttons: event.buttons,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary,
    pressure: event.pressure,
    tangentialPressure: event.tangentialPressure,
    tiltX: event.tiltX,
    tiltY: event.tiltY,
    twist: event.twist,
    width: event.width,
    height: event.height,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    timeStamp: event.timeStamp,
    target,
    currentTarget,
    nativeEvent: event,
    preventDefault: event.preventDefault.bind(event),
    stopPropagation: event.stopPropagation.bind(event),
  } as QueuedPointerMove;
}

function snapshotPointerMove(event: React.PointerEvent<HTMLCanvasElement>): QueuedPointerMove {
  const nativeEvent = event.nativeEvent as PointerEvent;
  const clientX = event.clientX ?? nativeEvent.clientX;
  const clientY = event.clientY ?? nativeEvent.clientY;
  return {
    clientX,
    clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    pageX: event.pageX,
    pageY: event.pageY,
    movementX: event.movementX,
    movementY: event.movementY,
    button: event.button,
    buttons: event.buttons,
    detail: event.detail,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary,
    pressure: event.pressure,
    tangentialPressure: event.tangentialPressure,
    tiltX: event.tiltX,
    tiltY: event.tiltY,
    twist: event.twist,
    width: event.width,
    height: event.height,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    timeStamp: event.timeStamp,
    target: event.target,
    currentTarget: event.currentTarget,
    nativeEvent: event.nativeEvent,
    preventDefault: event.preventDefault.bind(event),
    stopPropagation: event.stopPropagation.bind(event),
  } as QueuedPointerMove;
}

/**
 * Pointer-move coalescing queue — extracted from `InteractiveCanvas`.
 *
 * Moves are deferred to the next animation frame (React releases
 * synthetic-event fields after the handler returns, so values are snapshotted
 * before queueing). Freehand/eraser gestures preserve coalesced native samples,
 * capped per frame; other gestures keep only the latest. `flushPointerMove`
 * drains synchronously for pointer-down/up paths that must not wait a frame.
 */
export function usePointerMoveQueue(
  onPointerMove: ((event: QueuedPointerMove) => void) | undefined,
  preservePointerSamples: boolean
) {
  const pendingPointerMovesRef = useRef<QueuedPointerMove[]>([]);
  const pointerMoveFrameRef = useRef<number | null>(null);
  const onPointerMoveRef = useRef(onPointerMove);
  onPointerMoveRef.current = onPointerMove;
  const preservePointerSamplesRef = useRef(preservePointerSamples);
  preservePointerSamplesRef.current = preservePointerSamples;

  const flushPointerMove = useCallback(() => {
    if (pointerMoveFrameRef.current !== null) {
      cancelAnimationFrame(pointerMoveFrameRef.current);
      pointerMoveFrameRef.current = null;
    }

    const pending = pendingPointerMovesRef.current.splice(0);
    if (pending.length === 0) return;

    const startMark = 'canvas:pointer-move:start';
    const endMark = 'canvas:pointer-move:end';
    perfMark(startMark);
    try {
      for (const event of pending) {
        onPointerMoveRef.current?.(event);
      }
    } finally {
      perfMark(endMark);
      perfMeasure('canvas:pointer-move', startMark, endMark);
    }
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const latest = snapshotPointerMove(event);
    if (preservePointerSamplesRef.current) {
      const native = event.nativeEvent as PointerEvent & {
        getCoalescedEvents?: () => PointerEvent[];
      };
      const coalesced = native.getCoalescedEvents?.() ?? [];
      const rawSamples =
        coalesced.length > 0
          ? coalesced.map(sample =>
              snapshotNativePointerMove(sample, event.target, event.currentTarget)
            )
          : [latest];
      const last = rawSamples[rawSamples.length - 1];
      if (!last || last.clientX !== latest.clientX || last.clientY !== latest.clientY) {
        rawSamples.push(latest);
      }
      const samples = capPointerSamples(rawSamples, latest);
      pendingPointerMovesRef.current.push(...samples);
      if (pendingPointerMovesRef.current.length > MAX_PENDING_POINTER_SAMPLES) {
        pendingPointerMovesRef.current.splice(
          0,
          pendingPointerMovesRef.current.length - MAX_PENDING_POINTER_SAMPLES
        );
      }
    } else {
      pendingPointerMovesRef.current = [latest];
    }
    if (pointerMoveFrameRef.current !== null) return;

    pointerMoveFrameRef.current = requestAnimationFrame(() => {
      pointerMoveFrameRef.current = null;
      const pending = pendingPointerMovesRef.current.splice(0);
      if (pending.length === 0) return;

      const startMark = 'canvas:pointer-move:start';
      const endMark = 'canvas:pointer-move:end';
      perfMark(startMark);
      try {
        for (const pendingEvent of pending) {
          onPointerMoveRef.current?.(pendingEvent);
        }
      } finally {
        perfMark(endMark);
        perfMeasure('canvas:pointer-move', startMark, endMark);
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      if (pointerMoveFrameRef.current !== null) {
        cancelAnimationFrame(pointerMoveFrameRef.current);
      }
    };
  }, []);

  return { flushPointerMove, handlePointerMove };
}
