import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import { useTransformStart } from '@/hooks/canvas/useTransformStart';
import type { InteractionState } from '@/hooks/canvas/useCanvasPointerEvents';
import type { ResizeHandle } from '@/components/canvas/SelectionOverlay';
import type { DriplElement } from '@dripl/common';

function rect(id: string, x = 0, y = 0): DriplElement {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    width: 100,
    height: 80,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
  } as DriplElement;
}

function seed(elements: DriplElement[], selectedIds: string[]) {
  useCanvasStore.setState({
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    elementLocks: new Map(),
    userId: 'me',
    isResizing: false,
    isRotating: false,
    isEditingElementId: null,
    past: [],
    future: [],
  });
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
  useCanvasStore.getState().setSelectedIds(new Set(selectedIds));
}

/**
 * The hook captures the pointer on `canvas:last-child` inside the container,
 * so the harness needs a real container with two canvases: the first must be
 * skipped.
 */
function setup(options: { readOnly?: boolean; captured?: number[] } = {}) {
  const container = document.createElement('div');
  const overlay = document.createElement('canvas');
  const interactive = document.createElement('canvas');
  const captured: number[] = options.captured ?? [];
  interactive.setPointerCapture = ((pointerId: number) => {
    captured.push(pointerId);
  }) as HTMLCanvasElement['setPointerCapture'];

  container.appendChild(overlay);
  container.appendChild(interactive);

  const interactionRef = { current: freshInteraction() } as { current: InteractionState };
  const lockElementsForGesture = vi.fn();
  const unlockGestureElements = vi.fn();
  const setEditingElementId = vi.fn();

  const hook = renderHook(() =>
    useTransformStart({
      interactionRef,
      containerRef: { current: container } as React.RefObject<HTMLDivElement>,
      readOnly: options.readOnly ?? false,
      getCanvasCoordinates: e => ({ x: e.clientX, y: e.clientY }),
      lockElementsForGesture,
      unlockGestureElements,
      setEditingElementId,
    })
  );

  return {
    ...hook,
    interactionRef,
    captured,
    lockElementsForGesture,
    unlockGestureElements,
    setEditingElementId,
  };
}

function freshInteraction(): InteractionState {
  return {
    panning: false,
    panStartClient: null,
    isSpacePressed: false,
    dragStartCanvasPos: null,
    dragInitialElements: null,
    dragging: false,
    historyPushed: false,
    resizing: false,
    resizeHandle: null,
    resizeStartCanvasPos: null,
    resizeInitialEl: null,
    rotating: false,
    rotateInitialEl: null,
    touchPointers: new Map(),
    pinchStartDistance: 0,
    pinchStartMid: null,
    pinchStartZoom: 1,
    pinchStartPan: { x: 0, y: 0 },
    boundArrowsByShape: new Map(),
    bindingIndexReady: false,
  };
}

function pointerEvent(pointerId = 7, clientX = 10, clientY = 20) {
  return {
    pointerId,
    clientX,
    clientY,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
  } as unknown as React.PointerEvent;
}

describe('useTransformStart.handleResizeStart', () => {
  beforeEach(() => {
    seed([], []);
  });

  it('arms the resize gesture from a frozen snapshot of the selection', () => {
    seed([rect('a', 100, 50)], ['a']);
    const captured: number[] = [];
    const {
      result,
      interactionRef,
      lockElementsForGesture,
      setEditingElementId,
      captured: cap,
    } = setup({ captured });

    act(() => {
      result.current.handleResizeStart('se', pointerEvent(3, 140, 90));
    });

    const interaction = interactionRef.current;
    expect(interaction.resizing).toBe(true);
    expect(interaction.historyPushed).toBe(false);
    expect(interaction.resizeHandle).toBe('se');
    expect(interaction.resizeStartCanvasPos).toEqual({ x: 140, y: 90 });
    expect(interaction.resizeInitialEl).toMatchObject({ id: 'a', x: 100, y: 50 });
    expect(useCanvasStore.getState().isResizing).toBe(true);
    expect(lockElementsForGesture).toHaveBeenCalledTimes(1);
    expect([...lockElementsForGesture.mock.calls[0]![0]]).toEqual(['a']);
    expect(setEditingElementId).toHaveBeenCalledWith('a');
    expect(cap).toEqual([3]);
  });

  it('freezes the baseline so later store writes cannot move the gesture origin', () => {
    seed([rect('a', 100, 50)], ['a']);
    const { result, interactionRef } = setup();

    act(() => {
      result.current.handleResizeStart('nw', pointerEvent());
    });
    const frozen = interactionRef.current.resizeInitialEl!;

    act(() => {
      useCanvasStore.getState().updateElement('a', { x: 999 });
    });

    expect(interactionRef.current.resizeInitialEl).toBe(frozen);
    expect(frozen.x).toBe(100);
  });

  it('accepts a deep clone rather than the live store object', () => {
    seed([rect('a', 100, 50)], ['a']);
    const { result, interactionRef } = setup();

    act(() => {
      result.current.handleResizeStart('se', pointerEvent());
    });

    const live = useCanvasStore.getState().elementsById.get('a');
    expect(interactionRef.current.resizeInitialEl).not.toBe(live);
  });

  it.each([
    ['read-only', () => setup({ readOnly: true })],
    [
      'a multi-selection',
      () => {
        seed([rect('a'), rect('b', 300)], ['a', 'b']);
        return setup();
      },
    ],
    [
      'no selection',
      () => {
        seed([rect('a')], []);
        return setup();
      },
    ],
    [
      'a selected id with no element',
      () => {
        seed([], ['ghost']);
        return setup();
      },
    ],
    [
      'a lock held by another collaborator',
      () => {
        seed([rect('a')], ['a']);
        useCanvasStore.setState({ elementLocks: new Map([['a', 'someone-else']]) });
        return setup();
      },
    ],
  ])('refuses to start under %s', (_label, make) => {
    const { result, interactionRef, lockElementsForGesture, setEditingElementId } = make();
    const stopPropagation = vi.fn();

    act(() => {
      result.current.handleResizeStart('se', { ...pointerEvent(), stopPropagation } as never);
    });

    expect(interactionRef.current.resizing).toBe(false);
    expect(interactionRef.current.resizeInitialEl).toBeNull();
    expect(useCanvasStore.getState().isResizing).toBe(false);
    expect(lockElementsForGesture).not.toHaveBeenCalled();
    expect(setEditingElementId).not.toHaveBeenCalled();
    // The overlay handle must not fall through to the canvas beneath it.
    expect(stopPropagation).toHaveBeenCalled();
  });

  it('proceeds when the lock is held by this user', () => {
    seed([rect('a')], ['a']);
    useCanvasStore.setState({ elementLocks: new Map([['a', 'me']]) });
    const { result, interactionRef } = setup();

    act(() => {
      result.current.handleResizeStart('se', pointerEvent());
    });

    expect(interactionRef.current.resizing).toBe(true);
  });

  it('carries an arrow resize handle through unchanged', () => {
    seed([rect('a')], ['a']);
    const { result, interactionRef } = setup();

    act(() => {
      result.current.handleResizeStart('arrow-point-1' as ResizeHandle, pointerEvent());
    });

    expect(interactionRef.current.resizeHandle).toBe('arrow-point-1');
  });
});

describe('useTransformStart.handleRotateStart', () => {
  beforeEach(() => {
    seed([], []);
  });

  it('arms rotation without touching the resize baseline', () => {
    seed([rect('a', 10, 20)], ['a']);
    const { result, interactionRef, lockElementsForGesture } = setup();

    act(() => {
      result.current.handleRotateStart(pointerEvent(11));
    });

    expect(interactionRef.current.rotating).toBe(true);
    expect(interactionRef.current.historyPushed).toBe(false);
    expect(interactionRef.current.rotateInitialEl).toMatchObject({ id: 'a' });
    expect(interactionRef.current.resizing).toBe(false);
    expect(useCanvasStore.getState().isRotating).toBe(true);
    expect([...lockElementsForGesture.mock.calls[0]![0]]).toEqual(['a']);
  });

  it('refuses under the same guards as resize', () => {
    seed([rect('a'), rect('b', 300)], ['a', 'b']);
    const { result, interactionRef, lockElementsForGesture } = setup();

    act(() => {
      result.current.handleRotateStart(pointerEvent());
    });

    expect(interactionRef.current.rotating).toBe(false);
    expect(useCanvasStore.getState().isRotating).toBe(false);
    expect(lockElementsForGesture).not.toHaveBeenCalled();
  });
});

describe('useTransformStart cleanup', () => {
  beforeEach(() => {
    seed([], []);
  });

  it('releases gesture locks on unmount so a remote element is not locked forever', () => {
    seed([rect('a')], ['a']);
    const { result, unmount, unlockGestureElements, interactionRef } = setup();

    act(() => {
      result.current.handleResizeStart('se', pointerEvent());
    });
    expect(interactionRef.current.resizing).toBe(true);

    unmount();
    expect(unlockGestureElements).toHaveBeenCalledTimes(1);
  });
});
