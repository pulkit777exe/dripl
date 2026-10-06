import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

import { useCanvasWheel } from '@/hooks/canvas/useCanvasWheel';
import { useCanvasStore } from '@/lib/store';
import { wheelZoomFactor, zoomToCursor, DEFAULT_ZOOM_SETTINGS } from '@/utils/zoomUtils';

function Harness({ containerRef }: { containerRef: React.RefObject<HTMLDivElement> }) {
  useCanvasWheel({ containerRef, containerReady: true });
  return null;
}

/**
 * Frames are driven by hand rather than by fake timers.
 *
 * Wheel input is accumulated and applied once per animation frame, so a test has to
 * advance a frame to see the resulting viewport. Driving `requestAnimationFrame` from an
 * explicit queue keeps that deterministic and keeps the frame count *observable* — which
 * is the property the equivalence test below needs, and which a timer-based flush cannot
 * report. Fake timers remain in use for the gesture-end `setTimeout`.
 */
let pendingFrames: FrameRequestCallback[] = [];

function flushFrames(): void {
  const due = pendingFrames;
  pendingFrames = [];
  act(() => {
    for (const cb of due) cb(0);
  });
}

function wheel(
  element: HTMLElement,
  init: {
    deltaX?: number;
    deltaY?: number;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    clientX?: number;
    clientY?: number;
  }
) {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaX: init.deltaX ?? 0,
    deltaY: init.deltaY ?? 0,
    ctrlKey: init.ctrlKey ?? false,
    shiftKey: init.shiftKey ?? false,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  element.dispatchEvent(event);
  return event;
}

describe('useCanvasWheel', () => {
  let container: HTMLDivElement;
  let containerRef: React.RefObject<HTMLDivElement>;
  let mounted: ReturnType<typeof render>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    containerRef = { current: container };
    vi.useFakeTimers();
    pendingFrames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      pendingFrames.push(cb);
      return pendingFrames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      pendingFrames = [];
    });
    useCanvasStore.setState({ panX: 0, panY: 0, zoom: 1 });
    mounted = render(<Harness containerRef={containerRef} />);
  });

  afterEach(() => {
    mounted.unmount();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('zooms in on scroll up, anchored at the cursor', () => {
    // jsdom reports a zero rect, so client coords are screen coords.
    wheel(container, { deltaY: -100, clientX: 400, clientY: 300 });
    flushFrames();
    const { zoom, panX, panY } = useCanvasStore.getState();
    expect(zoom).toBeCloseTo(wheelZoomFactor(-100), 10);
    // The world point under the cursor must not move.
    expect((400 - panX) / zoom).toBeCloseTo(400, 9);
    expect((300 - panY) / zoom).toBeCloseTo(300, 9);
  });

  it('zooms out on scroll down', () => {
    wheel(container, { deltaY: 100, clientX: 400, clientY: 300 });
    flushFrames();
    const { zoom } = useCanvasStore.getState();
    expect(zoom).toBeLessThan(1);
    expect(zoom).toBeCloseTo(wheelZoomFactor(100), 10);
  });

  it('zooms with ctrl held exactly like a plain scroll (trackpad pinch path)', () => {
    wheel(container, { deltaY: -20, ctrlKey: true, clientX: 50, clientY: 60 });
    flushFrames();
    const { zoom, panX, panY } = useCanvasStore.getState();
    expect(zoom).toBeCloseTo(wheelZoomFactor(-20), 10);
    expect((50 - panX) / zoom).toBeCloseTo(50, 9);
    expect((60 - panY) / zoom).toBeCloseTo(60, 9);
  });

  it('clamps at the zoom limits without drifting the anchor', () => {
    useCanvasStore.setState({ zoom: 20, panX: 0, panY: 0 });
    wheel(container, { deltaY: -500, clientX: 400, clientY: 300 });
    flushFrames();
    const { zoom, panX, panY } = useCanvasStore.getState();
    expect(zoom).toBe(20);
    expect(panX).toBe(0);
    expect(panY).toBe(0);
  });

  it('pans horizontally when shift is held, without zooming', () => {
    wheel(container, { deltaY: 100, shiftKey: true });
    flushFrames();
    const { zoom, panX, panY } = useCanvasStore.getState();
    expect(zoom).toBe(1);
    expect(panX).toBe(-150);
    expect(panY).toBe(0);
  });

  it('ignores sub-pixel noise without touching state', () => {
    const event = wheel(container, { deltaY: 0.2 });
    expect(event.defaultPrevented).toBe(false);
    expect(useCanvasStore.getState().zoom).toBe(1);
  });

  it('ignores horizontal-only scrolls', () => {
    const event = wheel(container, { deltaX: 50 });
    expect(event.defaultPrevented).toBe(false);
    const { panX, zoom } = useCanvasStore.getState();
    expect(panX).toBe(0);
    expect(zoom).toBe(1);
  });

  // Regression: a trackpad emits `wheel` at roughly 100-200 events/second, so applying
  // one `setViewport` per event ran about twice the state updates there are frames to
  // draw them on a 120Hz display. Input is now accumulated and applied once per frame.
  //
  // This replaced a test asserting the opposite -- that zoom applied *synchronously*
  // with no frame scheduled -- which existed to lock in the removal of a buggy inertia
  // animation. Deferring is safe only because of the equivalence test below, which is
  // the real guarantee: the frame-batched result must equal the sequential one.
  it('applies the viewport once per frame, not once per event', () => {
    let viewportWrites = 0;
    const unsubscribe = useCanvasStore.subscribe((state, previous) => {
      if (
        state.zoom !== previous.zoom ||
        state.panX !== previous.panX ||
        state.panY !== previous.panY
      ) {
        viewportWrites += 1;
      }
    });

    for (let i = 0; i < 30; i++) {
      wheel(container, { deltaY: -20, clientX: 400, clientY: 300 });
    }

    // Nothing applied yet: the events are queued, not applied.
    expect(viewportWrites).toBe(0);

    flushFrames();

    // Thirty events, one write. This is the whole point of the change.
    expect(viewportWrites).toBe(1);
    unsubscribe();
  });

  // The equivalence guarantee. Derived from the same exported helpers the hook uses,
  // rather than a typed literal, so it stays correct if the zoom maths changes.
  //
  // Accumulating the *product* of the per-event factors is what makes this exact.
  // Summing the deltas instead would pass a two-event test and still under-zoom a fast
  // flick, because `wheelZoomFactor` clamps each event to 150px before exponentiating.
  it('lands on the same viewport as applying every event separately', () => {
    // Deltas including a large one among small ones, which is what a trackpad flick
    // actually looks like.
    const deltas = [-20, -35, -140, -12, -48, -7];

    for (const deltaY of deltas) {
      wheel(container, { deltaY, clientX: 400, clientY: 300 });
    }
    flushFrames();

    const { zoom, panX, panY } = useCanvasStore.getState();

    // Reference: the identical sequence applied one event at a time, synchronously.
    let reference = { zoom: 1, panX: 0, panY: 0 };
    for (const deltaY of deltas) {
      reference = zoomToCursor(
        reference,
        400,
        300,
        wheelZoomFactor(deltaY),
        DEFAULT_ZOOM_SETTINGS.minZoom,
        DEFAULT_ZOOM_SETTINGS.maxZoom
      );
    }

    expect(zoom).toBeCloseTo(reference.zoom, 12);
    expect(panX).toBeCloseTo(reference.panX, 9);
    expect(panY).toBeCloseTo(reference.panY, 9);
  });

  // The cumulative clamp matters here: 6 x -140 is -840, far past the 150px per-event
  // ceiling. Accumulating the factor product keeps each event's own contribution, where
  // summing the deltas would clamp the burst to a single event's worth and leave the
  // zoom visibly short of where the gesture went.
  it('does not lose a large fast flick to the per-event clamp', () => {
    for (let i = 0; i < 6; i++) {
      wheel(container, { deltaY: -140, clientX: 400, clientY: 300 });
    }
    flushFrames();

    const { zoom } = useCanvasStore.getState();

    // Six events' worth of factor, not one event's.
    expect(zoom).toBeCloseTo(Math.pow(wheelZoomFactor(-140), 6), 12);
    expect(zoom).toBeGreaterThan(wheelZoomFactor(-140));
  });

  // A dead-zone event must be discarded, not accumulated into the frame: a resting finger
  // on a trackpad emits sub-pixel deltas continuously, and summing them into a pending
  // zoom would creep the viewport while nobody is touching anything.
  it('discards sub-pixel events instead of accumulating them into the frame', () => {
    for (let i = 0; i < 40; i++) {
      wheel(container, { deltaY: 0.2, clientX: 400, clientY: 300 });
    }
    flushFrames();

    const { zoom, panX } = useCanvasStore.getState();
    expect(zoom).toBe(1);
    expect(panX).toBe(0);
  });

  // Regression: the shift-pan accumulator has to *sum*. Mutation `pending.px = next.px`
  // kept only the last event's delta and every pan test still passed, because each of
  // them fired a single wheel event -- so nothing ever put two panning events in one
  // frame. The visible symptom would be a trackpad horizontal flick that pans a fraction
  // of the distance the user actually moved.
  it('sums every panning event in the frame rather than keeping only the last', () => {
    const deltas = [-30, -45, -25, -60];

    for (const deltaY of deltas) {
      wheel(container, { deltaY, shiftKey: true });
    }
    flushFrames();

    const { panX, zoom } = useCanvasStore.getState();
    const total = deltas.reduce((sum, d) => sum + d, 0);

    // PAN_SPEED is 1.5 in the hook; the invariant is that the pan covers the whole
    // gesture, so compare against the summed delta rather than a hand-copied constant.
    expect(panX).toBeCloseTo(-total * 1.5, 9);
    // Strictly further than the last event alone would have carried it -- which is the
    // assertion that fails if the accumulator keeps only the final delta.
    expect(Math.abs(panX)).toBeGreaterThan(Math.abs(-deltas[deltas.length - 1]! * 1.5));
    // Panning must not have zoomed on the way.
    expect(zoom).toBe(1);
  });

  it('prevents the default scroll so the page does not move', () => {
    const event = wheel(container, { deltaY: 200 });
    expect(event.defaultPrevented).toBe(true);
  });

  it('removes its listener and gesture timer on unmount', () => {
    vi.useFakeTimers();
    wheel(container, { deltaY: -100 });
    flushFrames();
    mounted.unmount();
    vi.runAllTimers();
    const zoomAfter = useCanvasStore.getState().zoom;
    wheel(container, { deltaY: -100 });
    flushFrames();
    expect(useCanvasStore.getState().zoom).toBe(zoomAfter);
  });
});
