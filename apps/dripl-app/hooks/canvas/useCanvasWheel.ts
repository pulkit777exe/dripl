'use client';

import { useEffect, useRef } from 'react';
import { useCanvasStore } from '@/lib/store';
import {
  normalizeWheelDelta,
  wheelZoomFactor,
  zoomToCursor,
  DEFAULT_ZOOM_SETTINGS,
} from '@/utils/zoomUtils';

interface UseCanvasWheelOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  containerReady: boolean;
}

/** Screen-space pan applied per unit of wheel delta. */
const PAN_SPEED = 1.5;

/** Sub-pixel deltas are resting-finger jitter, not intent. */
const WHEEL_DEAD_ZONE_PX = 0.5;

/**
 * Wheel handling: plain scroll zooms to the cursor, like Miro/FigJam.
 * Ctrl/Cmd + scroll (trackpad pinch) zooms through the same path — the
 * exponential factor scales with delta magnitude, so small pinch deltas
 * stay smooth while mouse notches step sensibly. Shift + scroll pans
 * horizontally. Space-drag and middle-drag (see useCanvasPointerEvents)
 * remain the pan affordances.
 *
 * There is deliberately no animation and no inertia here. A previous
 * implementation restarted a 150ms eased animation on every wheel event and
 * fed deltas into a 0.95-decay velocity loop: the animation churned through
 * continuous gestures, and one 200-unit notch glided ~6,000 px, carrying the
 * viewport off the scene. Each event applies exactly one synchronous
 * `setViewport`, like the pan path it replaces.
 */
export function useCanvasWheel({ containerRef, containerReady }: UseCanvasWheelOptions) {
  const gestureActiveRef = useRef(false);
  const gestureEndTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const endGesture = () => {
      gestureActiveRef.current = false;
      gestureEndTimerRef.current = null;
      useCanvasStore.getState().setShouldCacheIgnoreZoom(false);
    };

    const handleWheel = (e: WheelEvent) => {
      const isShift = e.shiftKey;
      const { dx, dy } = normalizeWheelDelta(e);

      // Shift + scroll = horizontal pan. Shift is usually reported as deltaY,
      // so fall back to it; upstream selects the same way
      // (`App.tsx:10987`: `scrollX: scrollX - (deltaY || deltaX) / zoom.value`).
      if (isShift && (Math.abs(dx) > 0 || Math.abs(dy) > 0)) {
        e.preventDefault();
        const state = useCanvasStore.getState();
        const shiftDelta = dy || dx;
        state.setPan(state.panX - shiftDelta * PAN_SPEED, state.panY);
        return;
      }

      // Horizontal-only scrolls and sub-pixel noise fall through (a tilt
      // wheel with no shift is not a zoom gesture).
      if (Math.abs(dy) < WHEEL_DEAD_ZONE_PX) return;
      e.preventDefault();

      const rect = container.getBoundingClientRect();
      const state = useCanvasStore.getState();
      const next = zoomToCursor(
        { zoom: state.zoom, panX: state.panX, panY: state.panY },
        e.clientX - rect.left,
        e.clientY - rect.top,
        wheelZoomFactor(dy),
        DEFAULT_ZOOM_SETTINGS.minZoom,
        DEFAULT_ZOOM_SETTINGS.maxZoom
      );

      if (!gestureActiveRef.current) {
        gestureActiveRef.current = true;
        state.setShouldCacheIgnoreZoom(true);
      }
      if (gestureEndTimerRef.current !== null) {
        window.clearTimeout(gestureEndTimerRef.current);
      }
      gestureEndTimerRef.current = window.setTimeout(endGesture, 150);

      state.setViewport(next.zoom, next.panX, next.panY);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
      if (gestureEndTimerRef.current !== null) {
        window.clearTimeout(gestureEndTimerRef.current);
        gestureEndTimerRef.current = null;
      }
      gestureActiveRef.current = false;
    };
  }, [containerRef, containerReady]);
}
