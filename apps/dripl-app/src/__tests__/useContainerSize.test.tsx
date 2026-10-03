import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useContainerSize } from '@/hooks/canvas/useContainerSize';

type ObserverCallback = (
  entries: Array<{ contentRect: { width: number; height: number } }>
) => void;

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  callback: ObserverCallback;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: ObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  observe(el: Element) {
    this.observed.push(el);
  }

  unobserve = vi.fn();
  disconnect = vi.fn(() => {
    this.disconnected = true;
  });
}

function measured(width: number, height: number) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: height });
  return el;
}

beforeEach(() => {
  MockResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('useContainerSize', () => {
  it('reports not-ready until an element is attached', () => {
    const { result } = renderHook(() => useContainerSize());
    expect(result.current.containerReady).toBe(false);
    expect(result.current.containerRef.current).toBeNull();
    expect(result.current.containerSize).toEqual({ width: 0, height: 0 });
  });

  it('measures the element immediately on attach and observes it', () => {
    const el = measured(800, 600);
    const { result } = renderHook(() => useContainerSize());

    act(() => {
      result.current.setContainerRef(el);
    });

    expect(result.current.containerReady).toBe(true);
    expect(result.current.containerRef.current).toBe(el);
    expect(result.current.containerSize).toEqual({ width: 800, height: 600 });

    const observer = MockResizeObserver.instances.at(-1)!;
    expect(observer.observed).toEqual([el]);
  });

  it('follows the observer entries', () => {
    const el = measured(800, 600);
    const { result } = renderHook(() => useContainerSize());
    act(() => {
      result.current.setContainerRef(el);
    });

    act(() => {
      MockResizeObserver.instances.at(-1)!.callback([{ contentRect: { width: 400, height: 300 } }]);
    });

    expect(result.current.containerSize).toEqual({ width: 400, height: 300 });
  });

  it('ignores an empty observer batch', () => {
    const el = measured(800, 600);
    const { result } = renderHook(() => useContainerSize());
    act(() => {
      result.current.setContainerRef(el);
    });
    const before = result.current.containerSize;

    act(() => {
      MockResizeObserver.instances.at(-1)!.callback([]);
    });

    expect(result.current.containerSize).toBe(before);
  });

  it('falls back to the client box when the observer reports a zero-sized rect', () => {
    const el = measured(1024, 768);
    const { result } = renderHook(() => useContainerSize());
    act(() => {
      result.current.setContainerRef(el);
    });

    act(() => {
      MockResizeObserver.instances.at(-1)!.callback([{ contentRect: { width: 0, height: 0 } }]);
    });

    // A zero rect means "not laid out yet"; the client box is the better answer.
    expect(result.current.containerSize).toEqual({ width: 1024, height: 768 });
  });

  it('clears readiness and drops the element when detached', () => {
    const el = measured(800, 600);
    const { result } = renderHook(() => useContainerSize());
    act(() => {
      result.current.setContainerRef(el);
    });

    act(() => {
      result.current.setContainerRef(null);
    });

    expect(result.current.containerReady).toBe(false);
    expect(result.current.containerRef.current).toBeNull();
  });

  it('disconnects the observer on unmount so it cannot outlive the component', () => {
    const el = measured(800, 600);
    const { result, unmount } = renderHook(() => useContainerSize());
    act(() => {
      result.current.setContainerRef(el);
    });
    const observer = MockResizeObserver.instances.at(-1)!;

    unmount();

    expect(observer.disconnected).toBe(true);
  });

  it('re-measures after a detach-then-attach cycle, as React remounts produce', () => {
    const { result } = renderHook(() => useContainerSize());
    act(() => {
      result.current.setContainerRef(measured(800, 600));
    });
    const first = MockResizeObserver.instances.at(-1)!;

    act(() => {
      result.current.setContainerRef(null);
    });
    act(() => {
      result.current.setContainerRef(measured(400, 300));
    });

    expect(first.disconnected).toBe(true);
    expect(result.current.containerSize).toEqual({ width: 400, height: 300 });
  });

  it('does not create an observer before an element is attached', () => {
    renderHook(() => useContainerSize());
    expect(MockResizeObserver.instances).toHaveLength(0);
  });

  it('keeps the same ref identity across renders', () => {
    const el = measured(800, 600);
    const { result, rerender } = renderHook(() => useContainerSize());
    const refBefore = result.current.containerRef;

    act(() => {
      result.current.setContainerRef(el);
    });
    rerender();

    expect(result.current.containerRef).toBe(refBefore);
    expect(result.current.setContainerRef).toBeTypeOf('function');
  });
});
