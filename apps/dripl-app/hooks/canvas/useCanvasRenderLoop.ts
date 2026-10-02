'use client';

import { useCallback, useEffect, useRef } from 'react';
import { perfMark, perfMeasure } from '@/utils/performance';

/**
 * Render a canvas only when something has changed.
 *
 * The canvas layers are imperative surfaces, so a permanent requestAnimationFrame
 * loop keeps the main thread awake even when the scene is idle. This hook keeps
 * the render callback in a ref and schedules at most one frame for a dirty
 * update. The callback may mark the surface dirty again while rendering, in
 * which case the next frame is scheduled immediately.
 */
export function useCanvasRenderLoop(render: () => void, label = 'canvas'): () => void {
  const renderRef = useRef(render);
  const frameRef = useRef<number | null>(null);
  const dirtyRef = useRef(true);
  const scheduleRef = useRef<() => void>(() => undefined);

  renderRef.current = render;

  const schedule = useCallback(() => {
    dirtyRef.current = true;

    if (frameRef.current !== null) {
      return;
    }

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;

      if (!dirtyRef.current) {
        return;
      }

      dirtyRef.current = false;
      const startMark = `${label}:frame:start`;
      const endMark = `${label}:frame:end`;
      perfMark(startMark);
      try {
        renderRef.current();
      } finally {
        perfMark(endMark);
        perfMeasure(`${label}:frame`, startMark, endMark);
      }

      // A render can synchronously update props (for example, a draft element
      // can be committed while the pointer-up handler is running). Preserve
      // that update without leaving a permanent idle loop behind.
      if (dirtyRef.current) {
        scheduleRef.current();
      }
    });
  }, [label]);

  scheduleRef.current = schedule;

  useEffect(() => {
    schedule();

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [schedule]);

  return schedule;
}
