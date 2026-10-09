import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RBush from 'rbush';
import { useCanvasStore } from '@/lib/store';
import { getElementBounds } from '@dripl/math/intersection';
import { useCanvasPointerEvents } from '@/hooks/canvas/useCanvasPointerEvents';
import type { DriplElement } from '@dripl/common';

/**
 * One trail commit per eraser frame.
 *
 * Eraser input preserves every coalesced sample, so a frame can carry
 * several — and the old path committed each one, re-rendering the canvas
 * subtree per sample for a single visible frame. Samples now accumulate in a
 * ref and a trailing-edge flush appends the frame's batch in one
 * `setEraserPath` call; hit-testing rides along in the same flush. Pointer-up
 * drains synchronously, so the erase set is complete even when no frame ran
 * between the last move and the release. The wrapper below counts commits
 * while the real store stays behind it, so the end state is asserted against
 * the same commit the count observes.
 */
function rect(id: string, x: number): DriplElement {
  return {
    id,
    type: 'rectangle',
    x,
    y: 0,
    width: 100,
    height: 80,
    strokeColor: '#000000',
    backgroundColor: '#ffffff',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
  } as unknown as DriplElement;
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
    isPanning: false,
    isResizing: false,
    isRotating: false,
    isEditingElementId: null,
    marqueeSelection: null,
    textInput: null,
    eraserPath: [],
    cursorPosition: null,
    elementLocks: new Map(),
    userId: 'me',
    zoom: 1,
    panX: 0,
    panY: 0,
    gridEnabled: false,
    gridSize: 20,
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
    readOnly: false,
  });
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
}

function spatialIndexFor(elements: DriplElement[]) {
  const tree = new RBush<{ minX: number; minY: number; maxX: number; maxY: number; id: string }>();
  const byId = new Map<string, DriplElement>();
  const order = new Map<string, number>();
  elements.forEach((el, i) => {
    const b = getElementBounds(el);
    tree.insert({ minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height, id: el.id });
    byId.set(el.id, el);
    order.set(el.id, i);
  });
  return { tree, byId, order, elementIds: new Set(elements.map(e => e.id)) };
}

function pointerEvent(x: number, y: number): React.PointerEvent<HTMLCanvasElement> {
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
    pressure: 0.5,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.PointerEvent<HTMLCanvasElement>;
}

let frameQueue: Map<number, FrameRequestCallback>;
let nextFrameId: number;

function setup(elements: DriplElement[]) {
  seed(elements);
  const store = useCanvasStore.getState();
  // Installed before render so the hook's store subscription picks up the
  // spy; it calls through, so the state assertions below observe the real
  // commit the count observes.
  const pathSpy = vi.spyOn(store, 'setEraserPath');
  const props = {
    readOnly: false,
    getCanvasCoordinates: (e: { clientX: number; clientY: number }) => ({
      x: e.clientX,
      y: e.clientY,
    }),
    snapPointToGrid: (p: { x: number; y: number }) => p,
    broadcastCursor: vi.fn<(x: number, y: number) => void>(),
    addElement: store.addElement,
    getElementAtPosition: vi
      .fn<(x: number, y: number) => DriplElement | null>()
      .mockReturnValue(null),
    getElementsAtPosition: vi.fn<(x: number, y: number) => DriplElement[]>().mockReturnValue([]),
    updateElementTransient: store.updateElementTransient,
    updateElementsTransient: store.updateElementsTransient,
    updateElement: store.updateElement,
    pushHistory: store.pushHistory,
    lockElementsForGesture: vi.fn<(ids: Iterable<string>) => void>(),
    unlockElement: vi.fn<(id: string) => void>(),
    unlockGestureElements: vi.fn<() => void>(),
    setEditingElementId: store.setEditingElementId,
    startDrawing: vi.fn(),
    updateDrawing: vi.fn(),
    setDrawingState: vi.fn<(drawing: boolean) => void>(),
    maybeRevertToSelectTool: vi.fn(),
    finishDrawing: vi.fn<() => DriplElement | null>().mockReturnValue(null),
    applyFrameGrouping: vi.fn<(frame: DriplElement) => void>(),
    spatialIndex: spatialIndexFor(elements),
  };
  return { hook: renderHook(() => useCanvasPointerEvents(props)), pathSpy };
}

function selectEraser() {
  act(() => {
    useCanvasStore.setState({ activeTool: 'eraser' });
  });
}

function runFrames() {
  act(() => {
    const pending = Array.from(frameQueue.values());
    frameQueue.clear();
    for (const cb of pending) cb(performance.now());
  });
}

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

describe('eraser trail batching', () => {
  it('appends a frame of samples in one commit, in order', () => {
    const {
      hook: { result },
      pathSpy,
    } = setup([rect('a', 0), rect('b', 300)]);
    selectEraser();

    act(() => {
      result.current.handlePointerDown(pointerEvent(50, 40));
    });
    // The down point commits immediately; the moves below must not.
    expect(pathSpy.mock.calls).toHaveLength(1);

    act(() => {
      result.current.handlePointerMove(pointerEvent(55, 45));
    });
    act(() => {
      result.current.handlePointerMove(pointerEvent(60, 50));
    });
    act(() => {
      result.current.handlePointerMove(pointerEvent(65, 55));
    });
    expect(pathSpy.mock.calls).toHaveLength(1);

    runFrames();

    expect(pathSpy.mock.calls).toHaveLength(2);
    expect(useCanvasStore.getState().eraserPath).toEqual([
      { x: 50, y: 40 },
      { x: 55, y: 45 },
      { x: 60, y: 50 },
      { x: 65, y: 55 },
    ]);
  });

  it('erases what the deferred batch hit once the frame runs', () => {
    const {
      hook: { result },
    } = setup([rect('a', 0), rect('b', 300)]);
    selectEraser();

    act(() => {
      result.current.handlePointerDown(pointerEvent(50, 40));
    });
    act(() => {
      result.current.handlePointerMove(pointerEvent(55, 45));
    });
    runFrames();
    act(() => {
      result.current.handlePointerUp(pointerEvent(55, 45));
    });

    const after = useCanvasStore.getState();
    expect(after.elements.map(e => e.id)).toEqual(['b']);
    expect(after.eraserPath).toEqual([]);
  });

  it('erases on release even when no frame ran, without resurrecting the trail', () => {
    const {
      hook: { result },
      pathSpy,
    } = setup([rect('a', 0), rect('b', 300)]);
    selectEraser();

    act(() => {
      result.current.handlePointerDown(pointerEvent(50, 40));
    });
    act(() => {
      result.current.handlePointerMove(pointerEvent(55, 45));
    });
    // No frame: release drains synchronously so the erase set is complete.
    act(() => {
      result.current.handlePointerUp(pointerEvent(55, 45));
    });

    const after = useCanvasStore.getState();
    expect(after.elements.map(e => e.id)).toEqual(['b']);
    expect(after.eraserPath).toEqual([]);

    // A late frame must not append the drained batch back onto the cleared path.
    const callsAfterUp = pathSpy.mock.calls.length;
    runFrames();
    expect(pathSpy.mock.calls).toHaveLength(callsAfterUp);
    expect(useCanvasStore.getState().eraserPath).toEqual([]);
  });

  it('drops a stranded batch when a new stroke starts', () => {
    const {
      hook: { result },
    } = setup([rect('a', 0), rect('b', 300)]);
    selectEraser();

    act(() => {
      result.current.handlePointerDown(pointerEvent(50, 40));
    });
    act(() => {
      result.current.handlePointerMove(pointerEvent(55, 45));
    });
    // New stroke before any frame: the stranded sample must not leak into it.
    act(() => {
      result.current.handlePointerDown(pointerEvent(400, 400));
    });
    runFrames();

    expect(useCanvasStore.getState().eraserPath).toEqual([{ x: 400, y: 400 }]);
  });
});
