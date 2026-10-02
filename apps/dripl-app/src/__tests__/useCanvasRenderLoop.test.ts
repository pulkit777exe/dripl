import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasRenderLoop } from '@/hooks/canvas/useCanvasRenderLoop';

describe('useCanvasRenderLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders once on mount and does not keep an idle frame scheduled', () => {
    const render = vi.fn();
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame');
    const { result } = renderHook(() => useCanvasRenderLoop(render));

    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(render).toHaveBeenCalledTimes(1);

    const framesAfterPaint = requestFrame.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(requestFrame).toHaveBeenCalledTimes(framesAfterPaint);

    act(() => {
      result.current();
      vi.advanceTimersToNextFrame();
    });
    expect(render).toHaveBeenCalledTimes(2);
  });
});
