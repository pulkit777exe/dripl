'use client';

import { useEffect, useRef } from 'react';
import { useCanvasStore } from '@/lib/store';
import {
  normalizeWheelDelta,
  wheelZoomFactor,
  zoomToCursor,
  DEFAULT_ZOOM_SETTINGS,
} from '@/utils/zoomUtils';
import { throttleToFrame } from '@/utils/throttleToFrame';

interface UseCanvasWheelOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  containerReady: boolean;
}

/** Screen-space pan applied per unit of wheel delta. */
const PAN_SPEED = 1.5;

/** Sub-pixel deltas are resting-finger jitter, not intent. */
const WHEEL_DEAD_ZONE_PX = 0.5;

/** One frame's worth of wheel input, accumulated. */
type PendingWheel =
  { kind: 'zoom'; factor: number; clientX: number; clientY: number } | { kind: 'pan'; px: number };

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
 * viewport off the scene. What replaced it kept one `setViewport` per event,
 * which is correct but does more work than the display can show: a trackpad
 * emits `wheel` at roughly 100-200 events/second, so a gesture on a 120Hz display
 * runs about twice the state updates there are frames to draw them. Input is now
 * accumulated per frame and applied once — same arithmetic, a third of the commits.
 *
 * **Accumulating the product, not the sum.** `wheelZoomFactor` is
 * `exp(-clamp(dy) * I)` and `zoomToCursor` multiplies, so applying k events in
 * sequence is `zoom * Π exp(-clamp(dyᵢ) * I)`. That product is what gets
 * accumulated, which makes the per-frame result *identical* to applying each
 * event. Summing the raw deltas instead would not be: the per-event clamp caps a
 * single event at 150px, so a fast trackpad flick totalling 200px inside one
 * frame would be clamped back to 150 and visibly under-zoom — while the product
 * keeps every event's own contribution.
 *
 * Cursor anchoring composes the same way. Each `zoomToCursor` leaves the scene
 * point under the cursor exactly where it was, so the second step is anchoring
 * the point the first one preserved, and the composition is one step by the
 * product.
 *
 * Zoom and pan are accumulated separately because they are not composable into
 * a single step, and a gesture that switches between them mid-frame (shift held
 * partway through a flick) flushes the pending half rather than merging them.
 */
export function useCanvasWheel({ containerRef, containerReady }: UseCanvasWheelOptions) {
  const gestureActiveRef = useRef(false);
  const gestureEndTimerRef = useRef<number | null>(null);
  const pendingRef = useRef<PendingWheel | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const endGesture = () => {
      gestureActiveRef.current = false;
      gestureEndTimerRef.current = null;
      useCanvasStore.getState().setShouldCacheIgnoreZoom(false);
    };

    const applyPending = () => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (!pending) return;

      const state = useCanvasStore.getState();

      if (pending.kind === 'pan') {
        state.setPan(state.panX - pending.px * PAN_SPEED, state.panY);
        return;
      }

      // Read once per frame rather than once per event: this forces layout, and
      // during a gesture the container is not moving, so the extra reads were pure cost.
      const rect = container.getBoundingClientRect();
      const next = zoomToCursor(
        { zoom: state.zoom, panX: state.panX, panY: state.panY },
        pending.clientX - rect.left,
        pending.clientY - rect.top,
        pending.factor,
        DEFAULT_ZOOM_SETTINGS.minZoom,
        DEFAULT_ZOOM_SETTINGS.maxZoom
      );
      state.setViewport(next.zoom, next.panX, next.panY);
    };

    const throttledApply = throttleToFrame(applyPending);

    const accumulate = (next: PendingWheel) => {
      const pending = pendingRef.current;
      if (!pending || pending.kind !== next.kind) {
        // Switching gesture mid-frame: settle what is already owed before changing shape,
        // or the earlier half is silently discarded.
        //
        // `applyPending` reads the ref and clears it, so it must be called *before* the
        // ref is overwritten. Clearing the ref here first looks equivalent and is not: the
        // pending value is destroyed before anything applies it, and the earlier half of
        // the gesture vanishes.
        if (pending) applyPending();
        pendingRef.current = next;
        throttledApply();
        return;
      }

      if (pending.kind === 'pan' && next.kind === 'pan') {
        pending.px += next.px;
      } else if (pending.kind === 'zoom' && next.kind === 'zoom') {
        pending.factor *= next.factor;
        pending.clientX = next.clientX;
        pending.clientY = next.clientY;
      }
    };

    const handleWheel = (e: WheelEvent) => {
      const isShift = e.shiftKey;
      const { dx, dy } = normalizeWheelDelta(e);

      // Shift + scroll = horizontal pan. Shift is usually reported as deltaY,
      // so fall back to it; upstream selects the same way
      // (`App.tsx:10987`: `scrollX: scrollX - (deltaY || deltaX) / zoom.value`).
      if (isShift && (Math.abs(dx) > 0 || Math.abs(dy) > 0)) {
        e.preventDefault();
        accumulate({ kind: 'pan', px: dy || dx });
        return;
      }

      // Horizontal-only scrolls and sub-pixel noise fall through (a tilt
      // wheel with no shift is not a zoom gesture). Checked per event, so resting-finger
      // jitter is discarded rather than accumulated into the frame.
      if (Math.abs(dy) < WHEEL_DEAD_ZONE_PX) return;
      e.preventDefault();

      const state = useCanvasStore.getState();
      accumulate({
        kind: 'zoom',
        factor: wheelZoomFactor(dy),
        clientX: e.clientX,
        clientY: e.clientY,
      });

      if (!gestureActiveRef.current) {
        gestureActiveRef.current = true;
        state.setShouldCacheIgnoreZoom(true);
      }
      if (gestureEndTimerRef.current !== null) {
        window.clearTimeout(gestureEndTimerRef.current);
      }
      gestureEndTimerRef.current = window.setTimeout(endGesture, 150);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
      // A frame scheduled against a container that is going away must not run: it would
      // call `getBoundingClientRect` on a detached node and write a viewport no one sees.
      throttledApply.cancel();
      pendingRef.current = null;
      if (gestureEndTimerRef.current !== null) {
        window.clearTimeout(gestureEndTimerRef.current);
        gestureEndTimerRef.current = null;
      }
      gestureActiveRef.current = false;
    };
  }, [containerRef, containerReady]);
}
