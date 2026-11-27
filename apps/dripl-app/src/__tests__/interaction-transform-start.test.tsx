import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import { CanvasInteractionControllerImpl } from '@/lib/canvas/interaction-controller';
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
 * Exercises the controller's public beginResize/beginRotate contract directly
 * (PR4: the former useTransformStart wrapper was removed). The controller
 * captures the pointer on the interactive canvas selected by its `data-layer`
 * role, so the harness needs a real container with two labelled canvases: the
 * static one must be skipped.
 */
function setup(options: { readOnly?: boolean; captured?: number[] } = {}) {
  const container = document.createElement('div');
  const overlay = document.createElement('canvas');
  overlay.setAttribute('data-layer', 'static');
  const interactive = document.createElement('canvas');
  interactive.setAttribute('data-layer', 'interactive');
  const captured: number[] = options.captured ?? [];
  interactive.setPointerCapture = ((pointerId: number) => {
    captured.push(pointerId);
  }) as HTMLCanvasElement['setPointerCapture'];

  container.appendChild(overlay);
  container.appendChild(interactive);

  const lockElementsForGesture = vi.fn();
  const unlockGestureElements = vi.fn();
  const setEditingElementId = vi.fn((id: string | null) => {
    useCanvasStore.getState().setEditingElementId(id);
  });

  const controller = new CanvasInteractionControllerImpl({
    readOnly: options.readOnly ?? false,
    containerRef: { current: container } as React.RefObject<HTMLDivElement>,
    getCanvasCoordinates: (e: { clientX: number; clientY: number }) => ({ x: e.clientX, y: e.clientY }),
    snapPointToGrid: (p: { x: number; y: number }) => p,
    store: {
      getSnapshot: () => {
        const s = useCanvasStore.getState();
        return {
          elements: s.elements,
          elementsById: s.elementsById,
          selectedIds: s.selectedIds,
          activeTool: s.activeTool,
          isDrawing: s.isDrawing,
          zoom: s.zoom,
          panX: s.panX,
          panY: s.panY,
          marqueeSelection: s.marqueeSelection,
          marqueeSelectionMode: s.marqueeSelectionMode,
          elementLocks: s.elementLocks,
          userId: s.userId,
          gridEnabled: s.gridEnabled,
          gridSize: s.gridSize,
          isEditingElementId: s.isEditingElementId,
          draftElement: s.draftElement,
          currentStrokeColor: s.currentStrokeColor,
          currentBackgroundColor: s.currentBackgroundColor,
          currentStrokeWidth: s.currentStrokeWidth,
          currentRoughness: s.currentRoughness,
          currentStrokeStyle: s.currentStrokeStyle,
          currentFillStyle: s.currentFillStyle,
          currentArrowStyle: s.currentArrowStyle,
        };
      },
      setSelectedIds: (ids: Set<string>) => useCanvasStore.getState().setSelectedIds(ids),
      clearSelection: () => useCanvasStore.getState().clearSelection(),
      setIsDragging: (v: boolean) => useCanvasStore.getState().setIsDragging(v),
      setIsPanning: (v: boolean) => useCanvasStore.getState().setIsPanning(v),
      setIsResizing: (v: boolean) => useCanvasStore.getState().setIsResizing(v),
      setIsRotating: (v: boolean) => useCanvasStore.getState().setIsRotating(v),
      setIsDrawing: (v: boolean) => useCanvasStore.getState().setIsDrawing(v),
      setTextInput: (v: unknown) => useCanvasStore.getState().setTextInput(v as never),
      setCursorPosition: (v: unknown) => useCanvasStore.getState().setCursorPosition(v as never),
      setMarqueeSelection: (v: unknown) => useCanvasStore.getState().setMarqueeSelection(v as never),
      setEraserPath: (v: unknown) => useCanvasStore.getState().setEraserPath(v as never),
      setPan: (x: number, y: number) => useCanvasStore.getState().setPan(x, y),
      setViewport: (z: number, x: number, y: number) => useCanvasStore.getState().setViewport(z, x, y),
      setActiveTool: (t: unknown) => useCanvasStore.getState().setActiveTool(t as never),
      setEditingElementId,
      expandSelectionWithGroups: (ids: Set<string>, els: readonly DriplElement[]) =>
        useCanvasStore.getState().expandSelectionWithGroups(ids, els as DriplElement[]),
      getSelectionBounds: (ids: ReadonlySet<string>, els: readonly DriplElement[]) =>
        useCanvasStore.getState().getSelectionBounds(ids as Set<string>, els as DriplElement[]),
      collectCascadeDeleteIds: (ids: Iterable<string>) =>
        useCanvasStore.getState().collectCascadeDeleteIds(ids),
      deleteElements: (ids: string[], opts?: { skipHistory?: boolean }) =>
        useCanvasStore.getState().deleteElements(ids, opts),
      pushHistory: () => useCanvasStore.getState().pushHistory(),
      clearPendingEmbed: () => useCanvasStore.getState().clearPendingEmbed(),
    },
    drawing: {
      startDrawing: vi.fn(),
      updateDrawing: vi.fn(),
      finishDrawing: vi.fn(() => null),
      cancelDrawing: vi.fn(),
    },
    collab: {
      broadcastCursor: vi.fn(),
      lockElementsForGesture,
      unlockElement: vi.fn(),
      unlockGestureElements,
    },
    assets: {
      uploadImage: vi.fn(async () => ''),
      loadImageDims: vi.fn(async () => ({ displayWidth: 0, displayHeight: 0 })),
      makeId: vi.fn(() => 'id'),
    },
    env: {
      now: () => Date.now(),
      requestFrame: (cb: FrameRequestCallback) => requestAnimationFrame(cb),
      cancelFrame: (id: number) => cancelAnimationFrame(id),
      hasAnimationFrame: () => typeof requestAnimationFrame !== 'undefined',
      dispatchEvent: vi.fn(),
    },
    hitTest: {
      getElementAtPosition: vi.fn(() => null),
      getElementsAtPosition: vi.fn(() => []),
      spatialIndex: { tree: { search: () => [] }, byId: new Map() },
    },
    addElement: vi.fn(),
    updateElementTransient: vi.fn(),
    updateElementsTransient: vi.fn(),
    updateElement: vi.fn(),
    maybeRevertToSelectTool: vi.fn(),
    applyFrameGrouping: vi.fn(),
  } as unknown as ConstructorParameters<typeof CanvasInteractionControllerImpl>[0]);

  const result = {
    current: {
      handleResizeStart: (handle: ResizeHandle, e: React.PointerEvent) =>
        controller.beginResize(handle, e),
      handleRotateStart: (e: React.PointerEvent) => controller.beginRotate(e),
    },
  };

  return {
    result,
    interactionRef: controller.interactionRef,
    captured,
    lockElementsForGesture,
    unlockGestureElements,
    setEditingElementId,
    controller,
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

describe('CanvasInteractionController.beginResize', () => {
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

  it('arms a group resize for a multi-selection, snapshotting every member', () => {
    seed([rect('a', 100, 50), rect('b', 300, 50)], ['a', 'b']);
    const {
      result,
      interactionRef,
      lockElementsForGesture,
      setEditingElementId,
      captured: cap,
    } = setup({ captured: [] });

    act(() => {
      result.current.handleResizeStart('se', pointerEvent(3, 140, 90));
    });

    const interaction = interactionRef.current;
    expect(interaction.resizing).toBe(true);
    expect(interaction.resizeHandle).toBe('se');
    expect(interaction.resizeInitialEl).toBeNull();
    expect(Array.from(interaction.resizeInitialEls?.keys() ?? [])).toEqual(['a', 'b']);
    // Union frame of the two 100x80 boxes at x 100 and x 300, padded by
    // half the 2px stroke on every side (the same box the overlay draws).
    expect(interaction.resizeGroupFrame).toEqual({ x: 99, y: 49, width: 302, height: 82 });
    expect(useCanvasStore.getState().isResizing).toBe(true);
    expect([...lockElementsForGesture.mock.calls[0]![0]].sort()).toEqual(['a', 'b']);
    expect(setEditingElementId).toHaveBeenCalledWith(null);
    expect(cap).toEqual([3]);
  });

  it('skips remotely locked members when arming a group resize', () => {
    seed([rect('a', 100, 50), rect('b', 300, 50)], ['a', 'b']);
    useCanvasStore.setState({ elementLocks: new Map([['b', 'someone-else']]) });
    const { result, interactionRef, lockElementsForGesture } = setup();

    act(() => {
      result.current.handleResizeStart('se', pointerEvent());
    });

    expect(interactionRef.current.resizing).toBe(true);
    expect(Array.from(interactionRef.current.resizeInitialEls?.keys() ?? [])).toEqual(['a']);
    expect([...lockElementsForGesture.mock.calls[0]![0]]).toEqual(['a']);
  });

  it('refuses a group resize when every member is locked elsewhere', () => {
    seed([rect('a'), rect('b', 300)], ['a', 'b']);
    useCanvasStore.setState({
      elementLocks: new Map([
        ['a', 'someone-else'],
        ['b', 'someone-else'],
      ]),
    });
    const { result, interactionRef, lockElementsForGesture } = setup();

    act(() => {
      result.current.handleResizeStart('se', pointerEvent());
    });

    expect(interactionRef.current.resizing).toBe(false);
    expect(lockElementsForGesture).not.toHaveBeenCalled();
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

describe('CanvasInteractionController.beginRotate', () => {
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

  it('arms a group rotation for a multi-selection, centred on the union frame', () => {
    seed([rect('a', 10, 20), rect('b', 110, 20)], ['a', 'b']);
    const { result, interactionRef, lockElementsForGesture } = setup();

    act(() => {
      result.current.handleRotateStart(pointerEvent(11, 60, 60));
    });

    const interaction = interactionRef.current;
    expect(interaction.rotating).toBe(true);
    expect(interaction.rotateInitialEl).toBeNull();
    expect(Array.from(interaction.rotateInitialEls?.keys() ?? [])).toEqual(['a', 'b']);
    // Union of two 100x80 boxes at x 10 and x 110 -> center (110, 60).
    expect(interaction.rotateCenter).toEqual({ x: 110, y: 60 });
    expect(useCanvasStore.getState().isRotating).toBe(true);
    expect([...lockElementsForGesture.mock.calls[0]![0]].sort()).toEqual(['a', 'b']);
  });

  it('refuses group rotation when every member is locked elsewhere', () => {
    seed([rect('a'), rect('b', 300)], ['a', 'b']);
    useCanvasStore.setState({
      elementLocks: new Map([
        ['a', 'someone-else'],
        ['b', 'someone-else'],
      ]),
    });
    const { result, interactionRef, lockElementsForGesture } = setup();

    act(() => {
      result.current.handleRotateStart(pointerEvent());
    });

    expect(interactionRef.current.rotating).toBe(false);
    expect(lockElementsForGesture).not.toHaveBeenCalled();
  });

  it('refuses when the single selection is locked by another collaborator', () => {
    seed([rect('a')], ['a']);
    useCanvasStore.setState({ elementLocks: new Map([['a', 'someone-else']]) });
    const { result, interactionRef, lockElementsForGesture } = setup();

    act(() => {
      result.current.handleRotateStart(pointerEvent());
    });

    expect(interactionRef.current.rotating).toBe(false);
    expect(useCanvasStore.getState().isRotating).toBe(false);
    expect(lockElementsForGesture).not.toHaveBeenCalled();
  });
});

describe('CanvasInteractionController.dispose', () => {
  beforeEach(() => {
    seed([], []);
  });

  it('releases gesture locks on dispose so a remote element is not locked forever', () => {
    seed([rect('a')], ['a']);
    const { result, controller, unlockGestureElements, interactionRef } = setup();

    act(() => {
      result.current.handleResizeStart('se', pointerEvent());
    });
    expect(interactionRef.current.resizing).toBe(true);

    act(() => {
      controller.dispose();
    });
    expect(unlockGestureElements).toHaveBeenCalledTimes(1);
  });
});
