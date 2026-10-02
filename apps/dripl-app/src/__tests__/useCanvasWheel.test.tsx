import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import { useCanvasWheel } from '@/hooks/canvas/useCanvasWheel';
import { useCanvasStore } from '@/lib/store';
import { wheelZoomFactor } from '@/utils/zoomUtils';

function Harness({ containerRef }: { containerRef: React.RefObject<HTMLDivElement> }) {
  useCanvasWheel({ containerRef, containerReady: true });
  return null;
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
    const { zoom, panX, panY } = useCanvasStore.getState();
    expect(zoom).toBeCloseTo(wheelZoomFactor(-100), 10);
    // The world point under the cursor must not move.
    expect((400 - panX) / zoom).toBeCloseTo(400, 9);
    expect((300 - panY) / zoom).toBeCloseTo(300, 9);
  });

  it('zooms out on scroll down', () => {
    wheel(container, { deltaY: 100, clientX: 400, clientY: 300 });
    const { zoom } = useCanvasStore.getState();
    expect(zoom).toBeLessThan(1);
    expect(zoom).toBeCloseTo(wheelZoomFactor(100), 10);
  });

  it('zooms with ctrl held exactly like a plain scroll (trackpad pinch path)', () => {
    wheel(container, { deltaY: -20, ctrlKey: true, clientX: 50, clientY: 60 });
    const { zoom, panX, panY } = useCanvasStore.getState();
    expect(zoom).toBeCloseTo(wheelZoomFactor(-20), 10);
    expect((50 - panX) / zoom).toBeCloseTo(50, 9);
    expect((60 - panY) / zoom).toBeCloseTo(60, 9);
  });

  it('clamps at the zoom limits without drifting the anchor', () => {
    useCanvasStore.setState({ zoom: 20, panX: 0, panY: 0 });
    wheel(container, { deltaY: -500, clientX: 400, clientY: 300 });
    const { zoom, panX, panY } = useCanvasStore.getState();
    expect(zoom).toBe(20);
    expect(panX).toBe(0);
    expect(panY).toBe(0);
  });

  it('pans horizontally when shift is held, without zooming', () => {
    wheel(container, { deltaY: 100, shiftKey: true });
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

  it('applies zoom synchronously with no animation frames scheduled', () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    wheel(container, { deltaY: -100 });
    expect(useCanvasStore.getState().zoom).toBeGreaterThan(1);
    expect(raf).not.toHaveBeenCalled();
  });

  it('prevents the default scroll so the page does not move', () => {
    const event = wheel(container, { deltaY: 200 });
    expect(event.defaultPrevented).toBe(true);
  });

  it('removes its listener and gesture timer on unmount', () => {
    vi.useFakeTimers();
    wheel(container, { deltaY: -100 });
    mounted.unmount();
    vi.runAllTimers();
    const zoomAfter = useCanvasStore.getState().zoom;
    wheel(container, { deltaY: -100 });
    expect(useCanvasStore.getState().zoom).toBe(zoomAfter);
  });
});
