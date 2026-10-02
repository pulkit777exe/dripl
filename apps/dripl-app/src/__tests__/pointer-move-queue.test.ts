import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePointerMoveQueue } from '@/hooks/canvas/usePointerMoveQueue';

function nativePointerEvent(clientX: number, clientY: number): PointerEvent {
  return {
    clientX,
    clientY,
    screenX: clientX,
    screenY: clientY,
    pageX: clientX,
    pageY: clientY,
    movementX: 0,
    movementY: 0,
    button: 0,
    buttons: 1,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    pressure: 0.5,
    tangentialPressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    width: 1,
    height: 1,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    timeStamp: 0,
    preventDefault: () => {},
    stopPropagation: () => {},
  } as unknown as PointerEvent;
}

function pointerEvent(
  clientX: number,
  clientY: number,
  coalesced: Array<{ x: number; y: number }> = []
): React.PointerEvent<HTMLCanvasElement> {
  const native = nativePointerEvent(clientX, clientY);
  return {
    ...nativePointerEvent(clientX, clientY),
    detail: 0,
    target: document.createElement('canvas'),
    currentTarget: document.createElement('canvas'),
    nativeEvent: {
      ...native,
      getCoalescedEvents: () => coalesced.map(p => nativePointerEvent(p.x, p.y)),
    },
    preventDefault: () => {},
    stopPropagation: () => {},
    persist: () => {},
  } as unknown as React.PointerEvent<HTMLCanvasElement>;
}

describe('usePointerMoveQueue', () => {
  let frameQueue: Map<number, FrameRequestCallback>;
  let nextFrameId: number;

  beforeEach(() => {
    frameQueue = new Map();
    nextFrameId = 1;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      const id = nextFrameId++;
      frameQueue.set(id, cb);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      frameQueue.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const runFrames = () => {
    act(() => {
      const pending = [...frameQueue.values()];
      frameQueue.clear();
      pending.forEach(cb => cb(0));
    });
  };

  it('delivers only the latest move per frame without sample preservation', () => {
    const onPointerMove = vi.fn();
    const { result } = renderHook(() => usePointerMoveQueue(onPointerMove, false));

    act(() => {
      result.current.handlePointerMove(pointerEvent(1, 1));
      result.current.handlePointerMove(pointerEvent(2, 2));
    });
    expect(onPointerMove).not.toHaveBeenCalled();

    runFrames();
    expect(onPointerMove).toHaveBeenCalledTimes(1);
    expect(onPointerMove.mock.calls[0]![0]).toMatchObject({ clientX: 2, clientY: 2 });
  });

  it('preserves coalesced native samples for freehand gestures', () => {
    const onPointerMove = vi.fn();
    const { result } = renderHook(() => usePointerMoveQueue(onPointerMove, true));

    act(() => {
      result.current.handlePointerMove(
        pointerEvent(3, 3, [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ])
      );
    });
    runFrames();

    const delivered = onPointerMove.mock.calls.map(call => {
      const evt = call[0] as { clientX: number; clientY: number };
      return [evt.clientX, evt.clientY];
    });
    expect(delivered).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it('flushes synchronously on demand without waiting for a frame', () => {
    const onPointerMove = vi.fn();
    const { result } = renderHook(() => usePointerMoveQueue(onPointerMove, false));

    act(() => {
      result.current.handlePointerMove(pointerEvent(5, 5));
      result.current.flushPointerMove();
    });
    expect(onPointerMove).toHaveBeenCalledTimes(1);

    // The cancelled frame delivers nothing more.
    runFrames();
    expect(onPointerMove).toHaveBeenCalledTimes(1);
  });

  it('drops pending moves on unmount', () => {
    const onPointerMove = vi.fn();
    const { result, unmount } = renderHook(() => usePointerMoveQueue(onPointerMove, false));

    act(() => {
      result.current.handlePointerMove(pointerEvent(7, 7));
    });
    unmount();
    runFrames();
    expect(onPointerMove).not.toHaveBeenCalled();
  });
});
