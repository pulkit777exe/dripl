import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/interactiveScene', () => ({
  renderInteractiveScene: vi.fn(),
}));

import InteractiveCanvas from '@/components/canvas/InteractiveCanvas';

class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

function renderInteractiveCanvas(
  overrides: Partial<React.ComponentProps<typeof InteractiveCanvas>> = {}
) {
  const container = document.createElement('div');
  Object.defineProperty(container, 'offsetWidth', { configurable: true, value: 800 });
  Object.defineProperty(container, 'offsetHeight', { configurable: true, value: 600 });
  document.body.appendChild(container);

  return render(
    <InteractiveCanvas
      containerRef={{ current: container }}
      elements={[]}
      selectedIds={new Set()}
      draftElement={null}
      eraserPath={[]}
      viewport={{ x: 0, y: 0, width: 800, height: 600, zoom: 1 }}
      {...overrides}
    />
  );
}

function dispatchPointerMove(canvas: HTMLElement, clientX: number, clientY: number): void {
  const event = new MouseEvent('pointermove', {
    bubbles: true,
    clientX,
    clientY,
  });
  Object.defineProperty(event, 'pointerId', { configurable: true, value: 1 });
  fireEvent(canvas, event);
}

describe('InteractiveCanvas', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('exposes a focusable named canvas and hides the decorative layer', () => {
    renderInteractiveCanvas();

    const canvas = screen.getByLabelText('Drawing canvas');
    expect(canvas).toHaveAttribute('tabindex', '0');
    expect(canvas).toHaveTextContent('Drawing canvas');
  });

  it('coalesces pointer moves to the latest event in one animation frame', () => {
    const onPointerMove = vi.fn();
    renderInteractiveCanvas({ onPointerMove });
    const canvas = screen.getByLabelText('Drawing canvas');

    dispatchPointerMove(canvas, 10, 10);
    dispatchPointerMove(canvas, 20, 30);
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    expect(onPointerMove).toHaveBeenCalledTimes(1);
    expect(onPointerMove.mock.calls[0]?.[0]).toMatchObject({
      clientX: 20,
      clientY: 30,
    });
  });

  it('bounds coalesced samples per frame while retaining the latest point', () => {
    const onPointerMove = vi.fn();
    renderInteractiveCanvas({ onPointerMove, preservePointerSamples: true });
    const canvas = screen.getByLabelText('Drawing canvas');

    const event = new MouseEvent('pointermove', {
      bubbles: true,
      clientX: 199,
      clientY: 199,
    });
    Object.defineProperty(event, 'pointerId', { configurable: true, value: 1 });
    Object.defineProperty(event, 'getCoalescedEvents', {
      configurable: true,
      value: () =>
        Array.from(
          { length: 200 },
          (_, index) => new MouseEvent('pointermove', { clientX: index, clientY: index })
        ),
    });
    fireEvent(canvas, event);

    act(() => {
      vi.advanceTimersToNextFrame();
    });

    expect(onPointerMove).toHaveBeenCalledTimes(64);
    expect(onPointerMove.mock.calls.at(-1)?.[0]).toMatchObject({
      clientX: 199,
      clientY: 199,
    });
  });

  it('does not finish a captured gesture when the pointer leaves the canvas', () => {
    const onPointerUp = vi.fn();
    renderInteractiveCanvas({ onPointerUp });
    const canvas = screen.getByLabelText('Drawing canvas') as HTMLCanvasElement;
    Object.defineProperty(canvas, 'hasPointerCapture', {
      configurable: true,
      value: vi.fn().mockReturnValue(true),
    });

    fireEvent.pointerLeave(canvas, { pointerId: 1 });

    expect(onPointerUp).not.toHaveBeenCalled();
  });

  it('flushes the final pointer move before pointer up', () => {
    const onPointerMove = vi.fn();
    const onPointerUp = vi.fn();
    renderInteractiveCanvas({ onPointerMove, onPointerUp });
    const canvas = screen.getByLabelText('Drawing canvas');

    fireEvent.pointerMove(canvas, { clientX: 12, clientY: 14, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 12, clientY: 14, pointerId: 1 });

    expect(onPointerMove).toHaveBeenCalledTimes(1);
    expect(onPointerUp).toHaveBeenCalledTimes(1);
  });
});
