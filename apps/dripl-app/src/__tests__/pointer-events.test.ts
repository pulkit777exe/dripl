import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RBush from 'rbush';
import { useCanvasStore } from '@/lib/store';
import type { DriplElement } from '@dripl/common';
import { getElementBounds } from '@dripl/math/intersection';
import { useCanvasPointerEvents } from '@/hooks/canvas/useCanvasPointerEvents';

function rect(id: string, x: number, y = 0): DriplElement {
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

function seed(elements: DriplElement[]) {
  useCanvasStore.setState({
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    past: [],
    future: [],
    activeTool: 'select',
    isDrawing: false,
    isDragging: false,
    marqueeSelection: null,
    eraserPath: [],
    elementLocks: new Map(),
    userId: 'local-user',
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
    readOnly: false,
  });
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
}

function spatialIndexFor(elements: DriplElement[]) {
  const tree = new RBush<{ minX: number; minY: number; maxX: number; maxY: number; id: string }>();
  tree.load(
    elements.map((el, i) => {
      const bounds = getElementBounds(el);
      return {
        minX: bounds.x,
        minY: bounds.y,
        maxX: bounds.x + bounds.width,
        maxY: bounds.y + bounds.height,
        id: el.id,
        order: i,
      };
    })
  );
  return {
    tree,
    byId: new Map(elements.map(el => [el.id, el] as const)),
  };
}

function pointerEvent(x: number, y: number, extra: Record<string, unknown> = {}) {
  const target = document.createElement('canvas');
  return {
    target,
    currentTarget: { setPointerCapture: vi.fn() },
    clientX: x,
    clientY: y,
    button: 0,
    buttons: 1,
    detail: 1,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    pointerId: 1,
    pointerType: 'mouse',
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...extra,
  } as unknown as React.PointerEvent<HTMLCanvasElement>;
}

interface Harness {
  getElementAtPosition: (x: number, y: number) => DriplElement | null;
  getElementsAtPosition: (x: number, y: number) => DriplElement[];
}

function setup(elements: DriplElement[], harness: Harness) {
  seed(elements);
  const store = useCanvasStore.getState();
  const props = {
    readOnly: false,
    getCanvasCoordinates: (e: { clientX: number; clientY: number }) => ({
      x: e.clientX,
      y: e.clientY,
    }),
    snapPointToGrid: (p: { x: number; y: number }) => p,
    broadcastCursor: vi.fn(),
    addElement: store.addElement,
    getElementAtPosition: vi.fn(harness.getElementAtPosition),
    getElementsAtPosition: vi.fn(harness.getElementsAtPosition),
    updateElementTransient: store.updateElementTransient,
    updateElementsTransient: store.updateElementsTransient,
    updateElement: store.updateElement,
    pushHistory: store.pushHistory,
    lockElementsForGesture: vi.fn(),
    unlockElement: vi.fn(),
    unlockGestureElements: vi.fn(),
    setEditingElementId: store.setEditingElementId,
    startDrawing: vi.fn(),
    updateDrawing: vi.fn(),
    setDrawingState: vi.fn(),
    maybeRevertToSelectTool: vi.fn(),
    finishDrawing: vi.fn(),
    applyFrameGrouping: vi.fn(),
    spatialIndex: spatialIndexFor(elements),
  };
  return renderHook(() => useCanvasPointerEvents(props));
}

describe('useCanvasPointerEvents select flow', () => {
  beforeEach(() => {
    seed([]);
  });

  it('clicks an element to select it, drags to move with one history entry', () => {
    const elements = [rect('a', 0), rect('b', 300)];
    const { result } = setup(elements, {
      getElementAtPosition: (x, _y) => (x < 200 ? elements[0]! : null),
      getElementsAtPosition: (x, _y) => (x < 200 ? [elements[0]!] : []),
    });

    act(() => {
      result.current.handlePointerDown(pointerEvent(50, 40));
    });
    expect(Array.from(useCanvasStore.getState().selectedIds)).toEqual(['a']);

    act(() => {
      result.current.handlePointerMove(pointerEvent(80, 40));
    });
    expect(useCanvasStore.getState().elementsById.get('a')?.x).toBe(30);

    act(() => {
      result.current.handlePointerUp(pointerEvent(80, 40));
    });
    const after = useCanvasStore.getState();
    expect(after.elementsById.get('a')?.x).toBe(30);
    expect(after.elementsById.get('b')?.x).toBe(300);
    expect(after.past).toHaveLength(1);
    expect(after.isDragging).toBe(false);
  });

  it('marquee-drags empty space to select covered elements', () => {
    const elements = [rect('a', 0), rect('b', 300)];
    const { result } = setup(elements, {
      getElementAtPosition: () => null,
      getElementsAtPosition: () => [],
    });

    act(() => {
      result.current.handlePointerDown(pointerEvent(250, 200));
    });
    // Clicking empty space clears the selection and arms the marquee.
    expect(useCanvasStore.getState().selectedIds.size).toBe(0);
    expect(useCanvasStore.getState().marqueeSelection?.active).toBe(true);

    act(() => {
      result.current.handlePointerMove(pointerEvent(450, 200));
    });
    act(() => {
      result.current.handlePointerUp(pointerEvent(450, 200));
    });
    // Marquee (250,200)-(450,200)... zero-height span covers nothing vertically
    // at y=200 (elements live at y 0..80): selection stays empty.
    expect(useCanvasStore.getState().selectedIds.size).toBe(0);

    // A marquee covering element b selects exactly b.
    act(() => {
      result.current.handlePointerDown(pointerEvent(250, -10));
    });
    act(() => {
      result.current.handlePointerMove(pointerEvent(450, 100));
    });
    act(() => {
      result.current.handlePointerUp(pointerEvent(450, 100));
    });
    expect(Array.from(useCanvasStore.getState().selectedIds)).toEqual(['b']);
  });

  it('shift-click adds to the selection instead of replacing it', () => {
    const elements = [rect('a', 0), rect('b', 300)];
    const { result } = setup(elements, {
      getElementAtPosition: (x, _y) => (x < 200 ? elements[0]! : elements[1]!),
      getElementsAtPosition: (x, _y) => (x < 200 ? [elements[0]!] : [elements[1]!]),
    });

    act(() => {
      result.current.handlePointerDown(pointerEvent(50, 40));
    });
    act(() => {
      result.current.handlePointerUp(pointerEvent(50, 40));
    });
    act(() => {
      result.current.handlePointerDown(pointerEvent(350, 40, { shiftKey: true }));
    });
    expect(Array.from(useCanvasStore.getState().selectedIds).sort()).toEqual(['a', 'b']);
  });
});

describe('useCanvasPointerEvents draw flow', () => {
  beforeEach(() => {
    seed([]);
  });

  it('delegates rectangle gestures to the drawing tools and reverts the tool', () => {
    const { result } = setup([], {
      getElementAtPosition: () => null,
      getElementsAtPosition: () => [],
    });
    act(() => {
      useCanvasStore.setState({ activeTool: 'rectangle' });
    });

    const store = useCanvasStore.getState();
    const startDrawing = vi.fn();
    const updateDrawing = vi.fn();
    const finishDrawing = vi.fn(() => null);
    const maybeRevert = vi.fn();
    const { result: drawing } = renderHook(() =>
      useCanvasPointerEvents({
        readOnly: false,
        getCanvasCoordinates: (e: { clientX: number; clientY: number }) => ({
          x: e.clientX,
          y: e.clientY,
        }),
        snapPointToGrid: (p: { x: number; y: number }) => p,
        broadcastCursor: vi.fn(),
        addElement: store.addElement,
        getElementAtPosition: () => null,
        getElementsAtPosition: () => [],
        updateElementTransient: store.updateElementTransient,
        updateElementsTransient: store.updateElementsTransient,
        updateElement: store.updateElement,
        pushHistory: store.pushHistory,
        lockElementsForGesture: vi.fn(),
        unlockElement: vi.fn(),
        unlockGestureElements: vi.fn(),
        setEditingElementId: store.setEditingElementId,
        startDrawing,
        updateDrawing,
        setDrawingState: vi.fn(),
        maybeRevertToSelectTool: maybeRevert,
        finishDrawing,
        applyFrameGrouping: vi.fn(),
        spatialIndex: spatialIndexFor([]),
      })
    );

    act(() => {
      drawing.current.handlePointerDown(pointerEvent(10, 20));
    });
    expect(startDrawing).toHaveBeenCalledWith(
      { x: 10, y: 20 },
      'rectangle',
      expect.objectContaining({ shiftKey: false }),
      expect.objectContaining({ strokeWidth: expect.any(Number) }),
      []
    );
    expect(useCanvasStore.getState().isDrawing).toBe(true);

    act(() => {
      drawing.current.handlePointerMove(pointerEvent(60, 70));
    });
    expect(updateDrawing).toHaveBeenCalledWith(
      { x: 60, y: 70 },
      expect.objectContaining({ shiftKey: false }),
      []
    );

    act(() => {
      drawing.current.handlePointerUp(pointerEvent(60, 70));
    });
    expect(finishDrawing).toHaveBeenCalled();
    expect(useCanvasStore.getState().isDrawing).toBe(false);
    expect(maybeRevert).toHaveBeenCalledWith('rectangle');
    expect(result.current).toBeDefined();
  });
});

describe('useCanvasPointerEvents eraser flow', () => {
  beforeEach(() => {
    seed([]);
  });

  it('erases elements hit by the eraser path on release', () => {
    const elements = [rect('a', 0), rect('b', 300)];
    const { result } = setup(elements, {
      getElementAtPosition: () => null,
      getElementsAtPosition: () => [],
    });
    act(() => {
      useCanvasStore.setState({ activeTool: 'eraser' });
    });

    act(() => {
      result.current.handlePointerDown(pointerEvent(50, 40));
    });
    expect(useCanvasStore.getState().isDrawing).toBe(true);
    expect(useCanvasStore.getState().eraserPath).toEqual([{ x: 50, y: 40 }]);

    act(() => {
      result.current.handlePointerMove(pointerEvent(55, 45));
    });
    act(() => {
      result.current.handlePointerUp(pointerEvent(55, 45));
    });

    const after = useCanvasStore.getState();
    expect(after.elements.map(e => e.id)).toEqual(['b']);
    expect(after.eraserPath).toEqual([]);
    expect(after.isDrawing).toBe(false);
  });
});
