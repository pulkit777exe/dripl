import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RBush from 'rbush';
import { useCanvasStore } from '@/lib/store';
import { getElementBounds } from '@dripl/math/intersection';
import {
  CLICK_DRAG_THRESHOLD_PX,
  clickDragThresholdWorld,
  useCanvasPointerEvents,
} from '@/hooks/canvas/useCanvasPointerEvents';
import { useTransformStart } from '@/hooks/canvas/useTransformStart';
import type { InteractionState } from '@/hooks/canvas/useCanvasPointerEvents';
import type { DriplElement, LinearElement } from '@dripl/common';

/**
 * Phase 1 characterization tests (Candidate 1 PR1).
 *
 * These pin current public behavior of the pointer/transform interaction hooks
 * as a safety net before refactor. They intentionally describe behavior as it
 * exists today, including legacy quirks called out in comments.
 */

interface Fixture {
  [key: string]: unknown;
}

function element(id: string, fixture: Fixture): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    ...fixture,
  } as unknown as DriplElement;
}

function rect(id: string, x: number, y: number, extra: Fixture = {}): DriplElement {
  return element(id, { type: 'rectangle', x, y, ...extra });
}

function arrow(
  id: string,
  x: number,
  y: number,
  length: number,
  extra: Fixture = {}
): DriplElement {
  return element(id, {
    type: 'arrow',
    x,
    y,
    width: length,
    height: 0,
    points: [
      { x: 0, y: 0 },
      { x: length, y: 0 },
    ],
    ...extra,
  });
}

function seed(elements: DriplElement[], extra: Record<string, unknown> = {}) {
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
    marqueeSelectionMode: 'intersecting',
    textInput: null,
    eraserPath: [],
    cursorPosition: null,
    elementLocks: new Map<string, string>(),
    userId: 'me',
    zoom: 1,
    panX: 0,
    panY: 0,
    gridEnabled: false,
    gridSize: 20,
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
    draftElement: null,
    drawingLifecycle: 'idle',
    readOnly: false,
    ...extra,
  });
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
}

function spatialIndexFor(elements: DriplElement[]) {
  const tree = new RBush<{ minX: number; minY: number; maxX: number; maxY: number; id: string }>();
  const byId = new Map<string, DriplElement>();
  elements.forEach(el => {
    const b = getElementBounds(el);
    tree.insert({ minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height, id: el.id });
    byId.set(el.id, el);
  });
  return { tree, byId };
}

function pointerEvent(
  x: number,
  y: number,
  extra: Record<string, unknown> = {}
): React.PointerEvent<HTMLCanvasElement> {
  const target = (extra.target as HTMLElement | undefined) ?? document.createElement('canvas');
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
    ...extra,
  } as unknown as React.PointerEvent<HTMLCanvasElement>;
}

interface Overrides {
  elements?: DriplElement[];
  readOnly?: boolean;
  getElementAtPosition?: (x: number, y: number) => DriplElement | null;
  getElementsAtPosition?: (x: number, y: number) => DriplElement[];
  lockElementsForGesture?: ReturnType<typeof vi.fn<(ids: Iterable<string>) => void>>;
  unlockElement?: ReturnType<typeof vi.fn<(id: string) => void>>;
  unlockGestureElements?: ReturnType<typeof vi.fn<() => void>>;
  updateElementsTransient?: ReturnType<typeof vi.fn>;
  updateElementTransient?: ReturnType<typeof vi.fn>;
  updateElement?: ReturnType<typeof vi.fn>;
  pushHistory?: ReturnType<typeof vi.fn>;
  finishDrawing?: ReturnType<typeof vi.fn<() => DriplElement | null>>;
  startDrawing?: ReturnType<typeof vi.fn>;
  updateDrawing?: ReturnType<typeof vi.fn>;
  cancelDrawing?: ReturnType<typeof vi.fn>;
  maybeRevertToSelectTool?: ReturnType<typeof vi.fn>;
}

function setup(overrides: Overrides = {}) {
  const elements = overrides.elements ?? [];
  seed(elements);
  const store = useCanvasStore.getState();
  const props = {
    readOnly: overrides.readOnly ?? false,
    getCanvasCoordinates: (e: { clientX: number; clientY: number }) => ({
      x: e.clientX,
      y: e.clientY,
    }),
    snapPointToGrid: (p: { x: number; y: number }) => p,
    broadcastCursor: vi.fn(),
    addElement: store.addElement,
    getElementAtPosition: vi.fn(overrides.getElementAtPosition ?? (() => null)),
    getElementsAtPosition: vi.fn(overrides.getElementsAtPosition ?? (() => [])),
    updateElementTransient: overrides.updateElementTransient ?? vi.fn(store.updateElementTransient),
    updateElementsTransient:
      overrides.updateElementsTransient ?? vi.fn(store.updateElementsTransient),
    updateElement: overrides.updateElement ?? vi.fn(store.updateElement),
    pushHistory: overrides.pushHistory ?? vi.fn(store.pushHistory),
    lockElementsForGesture:
      overrides.lockElementsForGesture ?? vi.fn<(ids: Iterable<string>) => void>(),
    unlockElement: overrides.unlockElement ?? vi.fn<(id: string) => void>(),
    unlockGestureElements: overrides.unlockGestureElements ?? vi.fn<() => void>(),
    setEditingElementId: store.setEditingElementId,
    startDrawing: overrides.startDrawing ?? vi.fn(),
    updateDrawing: overrides.updateDrawing ?? vi.fn(),
    setDrawingState: vi.fn(),
    maybeRevertToSelectTool: overrides.maybeRevertToSelectTool ?? vi.fn(),
    finishDrawing: overrides.finishDrawing ?? vi.fn(() => null),
    cancelDrawing: overrides.cancelDrawing ?? vi.fn(),
    applyFrameGrouping: vi.fn(),
    spatialIndex: spatialIndexFor(elements),
  };
  return { ...renderHook(() => useCanvasPointerEvents(props)), props };
}

function armResize(
  result: { current: ReturnType<typeof useCanvasPointerEvents> },
  handle: string,
  elementId = 'a'
) {
  act(() => {
    const interaction = result.current.interactionRef.current;
    interaction.resizing = true;
    interaction.historyPushed = false;
    interaction.resizeHandle = handle;
    interaction.resizeStartCanvasPos = { x: 0, y: 0 };
    interaction.resizeInitialEl = structuredClone(
      useCanvasStore.getState().elementsById.get(elementId)!
    );
    useCanvasStore.getState().setIsResizing(true);
    useCanvasStore.getState().setEditingElementId(elementId);
  });
}

function armRotate(result: { current: ReturnType<typeof useCanvasPointerEvents> }, elementId = 'a') {
  act(() => {
    const interaction = result.current.interactionRef.current;
    interaction.rotating = true;
    interaction.historyPushed = false;
    interaction.rotateInitialEl = structuredClone(
      useCanvasStore.getState().elementsById.get(elementId)!
    );
    useCanvasStore.getState().setIsRotating(true);
    useCanvasStore.getState().setEditingElementId(elementId);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pointer-cancel / cancelActiveGesture rollback (characterization)', () => {
  beforeEach(() => seed([]));

  it('rolls back an armed drag without history commit and releases locks', () => {
    const elements = [rect('a', 100, 100)];
    const unlockElement = vi.fn();
    const unlockGestureElements = vi.fn();
    const pushHistory = vi.fn(useCanvasStore.getState().pushHistory);
    const { result } = setup({
      elements,
      unlockElement,
      unlockGestureElements,
      pushHistory,
      getElementAtPosition: () => elements[0]!,
      getElementsAtPosition: () => elements,
    });

    act(() => {
      result.current.handlePointerDown(pointerEvent(150, 140));
    });
    act(() => {
      result.current.handlePointerMove(pointerEvent(200, 170));
    });
    expect(useCanvasStore.getState().elementsById.get('a')).toMatchObject({ x: 150, y: 130 });
    const pastBeforeCancel = useCanvasStore.getState().past.length;

    let cancelled = false;
    act(() => {
      cancelled = result.current.cancelActiveGesture();
    });

    expect(cancelled).toBe(true);
    const state = useCanvasStore.getState();
    expect(state.elementsById.get('a')).toMatchObject({ x: 100, y: 100 });
    expect(state.isDragging).toBe(false);
    expect(state.isEditingElementId).toBeNull();
    expect(state.past.length).toBe(pastBeforeCancel);
    expect(pushHistory).toHaveBeenCalledTimes(1); // from the gesture move, not from cancel
    expect(unlockElement).toHaveBeenCalledWith('a');
    expect(unlockGestureElements).toHaveBeenCalled();
    expect(result.current.interactionRef.current.dragging).toBe(false);
    expect(result.current.interactionRef.current.dragInitialElements).toBeNull();
    expect(result.current.interactionRef.current.pendingDrag).toBeNull();
  });

  it('rolls back an armed resize, restores transient state, clears hover binding, and releases locks', () => {
    const elements = [rect('a', 100, 100)];
    const unlockElement = vi.fn();
    const unlockGestureElements = vi.fn();
    const pushHistory = vi.fn(useCanvasStore.getState().pushHistory);
    const { result } = setup({
      elements,
      unlockElement,
      unlockGestureElements,
      pushHistory,
    });
    useCanvasStore.setState({ selectedIds: new Set(['a']) });
    armResize(result, 'se');

    act(() => {
      result.current.handlePointerMove(pointerEvent(50, 30));
    });
    expect(useCanvasStore.getState().elementsById.get('a')).toMatchObject({ width: 150, height: 110 });
    const pastBeforeCancel = useCanvasStore.getState().past.length;

    let cancelled = false;
    act(() => {
      cancelled = result.current.cancelActiveGesture();
    });

    expect(cancelled).toBe(true);
    const state = useCanvasStore.getState();
    expect(state.elementsById.get('a')).toMatchObject({ x: 100, y: 100, width: 100, height: 80 });
    expect(state.isResizing).toBe(false);
    expect(state.isEditingElementId).toBeNull();
    expect(state.past.length).toBe(pastBeforeCancel);
    expect(pushHistory).toHaveBeenCalledTimes(1); // from the resize move, not from cancel
    expect(unlockElement).toHaveBeenCalledWith('a');
    expect(unlockGestureElements).toHaveBeenCalled();
    expect(result.current.interactionRef.current.resizing).toBe(false);
    expect(result.current.interactionRef.current.resizeInitialEl).toBeNull();
    expect(result.current.interactionRef.current.resizeHandle).toBeNull();
    expect(result.current.hoveredBindingId).toBeNull();
  });

  it('rolls back an armed rotate without committing and releases locks', () => {
    const elements = [rect('a', 100, 100)];
    const unlockElement = vi.fn();
    const unlockGestureElements = vi.fn();
    const { result } = setup({ elements, unlockElement, unlockGestureElements });
    useCanvasStore.setState({ selectedIds: new Set(['a']) });
    armRotate(result);

    act(() => {
      result.current.handlePointerMove(pointerEvent(250, 140)); // quarter turn
    });
    expect(useCanvasStore.getState().elementsById.get('a')!.angle).toBeCloseTo(Math.PI / 2, 6);
    const pastBeforeCancel = useCanvasStore.getState().past.length;

    let cancelled = false;
    act(() => {
      cancelled = result.current.cancelActiveGesture();
    });

    expect(cancelled).toBe(true);
    expect(useCanvasStore.getState().elementsById.get('a')!.angle ?? 0).toBeCloseTo(0, 6);
    expect(useCanvasStore.getState().isRotating).toBe(false);
    expect(useCanvasStore.getState().past.length).toBe(pastBeforeCancel);
    expect(unlockElement).toHaveBeenCalledWith('a');
    expect(unlockGestureElements).toHaveBeenCalled();
    expect(result.current.interactionRef.current.rotating).toBe(false);
    expect(result.current.interactionRef.current.rotateInitialEl).toBeNull();
  });

  it('cancels an active marquee without selecting and reports armed', () => {
    const elements = [rect('a', 100, 100)];
    const { result } = setup({
      elements,
      getElementAtPosition: () => null,
      getElementsAtPosition: () => [],
    });

    act(() => {
      result.current.handlePointerDown(pointerEvent(0, 0));
    });
    act(() => {
      result.current.handlePointerMove(pointerEvent(300, 300));
    });
    expect(useCanvasStore.getState().marqueeSelection?.active).toBe(true);

    let cancelled = false;
    act(() => {
      cancelled = result.current.cancelActiveGesture();
    });

    expect(cancelled).toBe(true);
    expect(useCanvasStore.getState().marqueeSelection).toBeNull();
    expect(useCanvasStore.getState().selectedIds.size).toBe(0);
  });

  it('treats pending drag/marquee (below threshold) as not armed cancel', () => {
    const elements = [rect('a', 100, 100)];
    const lockElementsForGesture = vi.fn();
    const { result } = setup({
      elements,
      lockElementsForGesture,
      getElementAtPosition: () => elements[0]!,
      getElementsAtPosition: () => elements,
    });

    act(() => {
      result.current.handlePointerDown(pointerEvent(150, 140));
    });
    expect(result.current.interactionRef.current.pendingDrag).not.toBeNull();
    expect(lockElementsForGesture).not.toHaveBeenCalled();

    let cancelled = true;
    act(() => {
      cancelled = result.current.cancelActiveGesture();
    });

    // Current behavior: pending press evaporates but does not count as armed.
    expect(cancelled).toBe(false);
    expect(result.current.interactionRef.current.pendingDrag).toBeNull();
    expect(useCanvasStore.getState().isDragging).toBe(false);
    expect(lockElementsForGesture).not.toHaveBeenCalled();
  });

  it('cancels active panning and clears pan state', () => {
    const { result } = setup();
    act(() => {
      useCanvasStore.setState({ activeTool: 'hand' });
    });
    act(() => {
      result.current.handlePointerDown(pointerEvent(10, 10));
    });
    expect(useCanvasStore.getState().isPanning).toBe(true);

    let cancelled = false;
    act(() => {
      cancelled = result.current.cancelActiveGesture();
    });

    expect(cancelled).toBe(true);
    expect(useCanvasStore.getState().isPanning).toBe(false);
    expect(result.current.interactionRef.current.panning).toBe(false);
    expect(result.current.interactionRef.current.panStartClient).toBeNull();
  });
});
  it('cancels an active eraser stroke without deleting hit elements (Escape semantics)', () => {
    // Eraser deletes on contact during the stroke; cancelActiveGesture is the
    // Escape/pointer-cancel rollback path and must drop the stroke, not erase.
    const frameQueue = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      const id = nextFrameId++;
      frameQueue.set(id, cb);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      frameQueue.delete(id);
    });
    const runFrames = () => {
      const pending = Array.from(frameQueue.values());
      frameQueue.clear();
      for (const cb of pending) cb(performance.now());
    };

    const elements = [rect('a', 100, 100), rect('keep', 900, 100)];
    const { result } = setup({ elements });
    act(() => {
      useCanvasStore.setState({ activeTool: 'eraser' });
    });

    act(() => {
      result.current.handlePointerDown(pointerEvent(150, 140));
    });
    act(() => {
      result.current.handlePointerMove(pointerEvent(155, 145));
    });
    // Do not flush frames: samples are pending. Cancel should drop them.
    let cancelled = false;
    act(() => {
      cancelled = result.current.cancelActiveGesture();
    });

    expect(cancelled).toBe(true);
    const state = useCanvasStore.getState();
    expect(state.elementsById.has('a')).toBe(true);
    expect(state.elementsById.has('keep')).toBe(true);
    expect(state.eraserPath).toEqual([]);
    expect(state.isDrawing).toBe(false);
    expect(state.past).toHaveLength(0);
    expect(result.current.eraserHitIdsRef.current.size).toBe(0);

    // A late frame must not resurrect or delete anything.
    runFrames();
    expect(useCanvasStore.getState().elementsById.has('a')).toBe(true);
  });

  it('cancels an active drawing (non-eraser/laser) via cancelDrawing and clears drawing state', () => {
    const cancelDrawing = vi.fn();
    const { result } = setup({ cancelDrawing });
    act(() => {
      useCanvasStore.setState({ activeTool: 'rectangle', isDrawing: true });
    });

    let cancelled = false;
    act(() => {
      cancelled = result.current.cancelActiveGesture();
    });

    expect(cancelled).toBe(true);
    expect(cancelDrawing).toHaveBeenCalledTimes(1);
    expect(useCanvasStore.getState().isDrawing).toBe(false);
  });
});

describe('space pan backstop / isSpacePressed (characterization)', () => {
  beforeEach(() => seed([]));

  it('exposes isSpacePressed on interactionRef and uses it for temporary pan entry', () => {
    const { result } = setup();
    expect(result.current.interactionRef.current.isSpacePressed).toBe(false);

    act(() => {
      result.current.interactionRef.current.isSpacePressed = true;
    });
    act(() => {
      result.current.handlePointerDown(pointerEvent(10, 10));
    });

    expect(useCanvasStore.getState().isPanning).toBe(true);
    expect(useCanvasStore.getState().activeTool).toBe('select');
    // Temporary pan does not record a restore target (current behavior).
    expect(result.current.lastToolBeforeSpaceRef.current).toBeNull();
  });

  it('pointer-up backstop: restores last tool when hand tool active, space released, and legacy restore target set', () => {
    // This pins the legacy backstop path in handlePointerUp. Current normal
    // space-pan flow does not set lastToolBeforeSpaceRef, but the backstop
    // remains for pans armed before that change / defensive consistency.
    const { result } = setup();
    act(() => {
      useCanvasStore.setState({ activeTool: 'hand' });
    });
    act(() => {
      result.current.handlePointerDown(pointerEvent(10, 10));
    });
    expect(useCanvasStore.getState().isPanning).toBe(true);

    act(() => {
      result.current.lastToolBeforeSpaceRef.current = 'rectangle';
      result.current.interactionRef.current.isSpacePressed = false;
    });
    act(() => {
      result.current.handlePointerUp(pointerEvent(20, 20));
    });

    expect(useCanvasStore.getState().isPanning).toBe(false);
    expect(useCanvasStore.getState().activeTool).toBe('rectangle');
  });

  it('pointer-up does not restore when space is still pressed (current behavior)', () => {
    const { result } = setup();
    act(() => {
      useCanvasStore.setState({ activeTool: 'hand' });
      result.current.interactionRef.current.isSpacePressed = true;
    });
    act(() => {
      result.current.handlePointerDown(pointerEvent(10, 10));
    });
    // Even if a legacy restore target exists, space-still-pressed blocks restore.
    act(() => {
      result.current.lastToolBeforeSpaceRef.current = 'rectangle';
      result.current.interactionRef.current.isSpacePressed = true;
    });
    act(() => {
      result.current.handlePointerUp(pointerEvent(20, 20));
    });

    expect(useCanvasStore.getState().activeTool).toBe('hand');
  });
});

describe('binding hover state (characterization)', () => {
  beforeEach(() => seed([]));

  it('exposes hoveredBindingId/startPointBindingId and updates them during arrow endpoint drag', () => {
    const elements = [arrow('ar', 0, 0, 100), rect('box', 200, -50)];
    const { result } = setup({ elements });

    expect(result.current.hoveredBindingId).toBeNull();
    expect(result.current.startPointBindingId).toBeNull();

    act(() => {
      const interaction = result.current.interactionRef.current;
      interaction.resizing = true;
      interaction.historyPushed = false;
      interaction.resizeHandle = 'arrow-end';
      interaction.resizeStartCanvasPos = { x: 0, y: 0 };
      interaction.resizeInitialEl = structuredClone(elements[0]!);
      useCanvasStore.getState().setIsResizing(true);
    });

    act(() => {
      result.current.handlePointerMove(pointerEvent(110, 0)); // endpoint into box
    });
    expect(result.current.hoveredBindingId).toBe('box');

    act(() => {
      result.current.handlePointerMove(pointerEvent(-90, 0)); // endpoint away
    });
    expect(result.current.hoveredBindingId).toBeNull();
  });

  it('clears hoveredBindingId on resize finalize (pointer up)', () => {
    const elements = [arrow('ar', 0, 0, 100), rect('box', 200, -50)];
    const { result } = setup({ elements });
    act(() => {
      const interaction = result.current.interactionRef.current;
      interaction.resizing = true;
      interaction.historyPushed = false;
      interaction.resizeHandle = 'arrow-end';
      interaction.resizeStartCanvasPos = { x: 0, y: 0 };
      interaction.resizeInitialEl = structuredClone(elements[0]!);
      useCanvasStore.getState().setIsResizing(true);
      useCanvasStore.getState().setEditingElementId('ar');
    });

    act(() => {
      result.current.handlePointerMove(pointerEvent(110, 0));
    });
    expect(result.current.hoveredBindingId).toBe('box');

    act(() => {
      result.current.handlePointerUp(pointerEvent(110, 0));
    });
    expect(result.current.hoveredBindingId).toBeNull();
  });

  it('exposes startPointBindingId during arrow drawing hover detection (characterization)', () => {
    const origin = rect('origin', -60, -40, { width: 80, height: 80 });
    const draft = arrow('draft', 0, 0, 300, { id: 'draft' });
    const { result } = setup({ elements: [origin] });
    act(() => {
      useCanvasStore.setState({ activeTool: 'arrow', isDrawing: true, draftElement: draft });
    });

    act(() => {
      result.current.handlePointerMove(pointerEvent(320, 140));
    });

    expect(result.current.startPointBindingId).toBe('origin');
    // Endpoint is far from origin box; hoveredBindingId should be null.
    expect(result.current.hoveredBindingId).toBeNull();
  });
});

describe('begin resize/rotate parity via useTransformStart + useCanvasPointerEvents (characterization)', () => {
  beforeEach(() => seed([]));

  function setupContract(elements: DriplElement[], selectedIds: string[]) {
    seed(elements, { selectedIds: new Set(selectedIds) });
    const container = document.createElement('div');
    const staticCanvas = document.createElement('canvas');
    staticCanvas.setAttribute('data-layer', 'static');
    const interactiveCanvas = document.createElement('canvas');
    interactiveCanvas.setAttribute('data-layer', 'interactive');
    interactiveCanvas.setPointerCapture = vi.fn() as unknown as HTMLCanvasElement['setPointerCapture'];
    container.appendChild(staticCanvas);
    container.appendChild(interactiveCanvas);

    const interactionRef = { current: null as unknown as InteractionState };
    const lockElementsForGesture = vi.fn<(ids: Iterable<string>) => void>();
    const unlockElement = vi.fn<(id: string) => void>();
    const unlockGestureElements = vi.fn<() => void>();

    const pointer = renderHook(() => {
      const store = useCanvasStore.getState();
      return useCanvasPointerEvents({
        readOnly: false,
        getCanvasCoordinates: (e: { clientX: number; clientY: number }) => ({ x: e.clientX, y: e.clientY }),
        snapPointToGrid: (p: { x: number; y: number }) => p,
        broadcastCursor: vi.fn(),
        addElement: store.addElement,
        getElementAtPosition: () => null,
        getElementsAtPosition: () => [],
        updateElementTransient: store.updateElementTransient,
        updateElementsTransient: store.updateElementsTransient,
        updateElement: store.updateElement,
        pushHistory: store.pushHistory,
        lockElementsForGesture,
        unlockElement,
        unlockGestureElements,
        setEditingElementId: store.setEditingElementId,
        startDrawing: vi.fn(),
        updateDrawing: vi.fn(),
        setDrawingState: vi.fn(),
        maybeRevertToSelectTool: vi.fn(),
        finishDrawing: vi.fn(() => null),
        cancelDrawing: vi.fn(),
        applyFrameGrouping: vi.fn(),
        spatialIndex: spatialIndexFor(elements),
      });
    });

    // Share the same interaction ref instance that pointer hook owns.
    interactionRef.current = pointer.result.current.interactionRef.current;

    const transform = renderHook(() =>
      useTransformStart({
        interactionRef: pointer.result.current.interactionRef as React.RefObject<InteractionState>,
        containerRef: { current: container } as React.RefObject<HTMLDivElement>,
        readOnly: false,
        getCanvasCoordinates: (e: { clientX: number; clientY: number }) => ({ x: e.clientX, y: e.clientY }),
        lockElementsForGesture,
        unlockGestureElements,
        setEditingElementId: useCanvasStore.getState().setEditingElementId,
        controller: pointer.result.current.controller,
      })
    );

    return {
      pointer,
      transform,
      interactiveCanvas,
      lockElementsForGesture,
      unlockElement,
      unlockGestureElements,
    };
  }

  it('resize start arms interaction state that pointer move/up consume with same lock lifecycle', () => {
    const elements = [rect('a', 100, 100)];
    const { pointer, transform, interactiveCanvas, lockElementsForGesture, unlockElement, unlockGestureElements } =
      setupContract(elements, ['a']);

    act(() => {
      transform.result.current.handleResizeStart(
        'se',
        {
          pointerId: 7,
          clientX: 0,
          clientY: 0,
          stopPropagation: vi.fn(),
          preventDefault: vi.fn(),
        } as unknown as React.PointerEvent
      );
    });

    expect(pointer.result.current.interactionRef.current.resizing).toBe(true);
    expect(pointer.result.current.interactionRef.current.resizeHandle).toBe('se');
    expect(lockElementsForGesture).toHaveBeenCalledWith(['a']);
    expect(useCanvasStore.getState().isEditingElementId).toBe('a');
    expect(interactiveCanvas.setPointerCapture).toHaveBeenCalledWith(7);

    act(() => {
      pointer.result.current.handlePointerMove(pointerEvent(40, 20));
    });
    expect(useCanvasStore.getState().elementsById.get('a')).toMatchObject({ width: 140, height: 100 });
    expect(useCanvasStore.getState().past).toHaveLength(1);

    act(() => {
      pointer.result.current.handlePointerUp(pointerEvent(40, 20));
    });
    expect(useCanvasStore.getState().isResizing).toBe(false);
    expect(useCanvasStore.getState().isEditingElementId).toBeNull();
    expect(unlockElement).toHaveBeenCalledWith('a');
    expect(unlockGestureElements).toHaveBeenCalled();
    expect(pointer.result.current.interactionRef.current.resizing).toBe(false);
  });

  it('rotate start arms interaction state that pointer move/up consume with same lock lifecycle', () => {
    const elements = [rect('a', 100, 100)];
    const { pointer, transform, interactiveCanvas, lockElementsForGesture, unlockElement, unlockGestureElements } =
      setupContract(elements, ['a']);

    act(() => {
      transform.result.current.handleRotateStart(
        {
          pointerId: 9,
          clientX: 150,
          clientY: 40,
          stopPropagation: vi.fn(),
          preventDefault: vi.fn(),
        } as unknown as React.PointerEvent
      );
    });

    expect(pointer.result.current.interactionRef.current.rotating).toBe(true);
    expect(lockElementsForGesture).toHaveBeenCalledWith(['a']);
    expect(useCanvasStore.getState().isEditingElementId).toBe('a');
    expect(interactiveCanvas.setPointerCapture).toHaveBeenCalledWith(9);

    act(() => {
      pointer.result.current.handlePointerMove(pointerEvent(250, 140));
    });
    expect(useCanvasStore.getState().elementsById.get('a')!.angle).toBeCloseTo(Math.PI / 2, 6);

    act(() => {
      pointer.result.current.handlePointerUp(pointerEvent(250, 140));
    });
    expect(useCanvasStore.getState().isRotating).toBe(false);
    expect(useCanvasStore.getState().isEditingElementId).toBeNull();
    expect(unlockElement).toHaveBeenCalledWith('a');
    expect(unlockGestureElements).toHaveBeenCalled();
    expect(pointer.result.current.interactionRef.current.rotating).toBe(false);
  });
});

describe('click-drag threshold / no lock+history before threshold (characterization)', () => {
  beforeEach(() => seed([]));

  it('exports the screen-space threshold and zoom-scaled world threshold', () => {
    expect(CLICK_DRAG_THRESHOLD_PX).toBe(4);
    expect(clickDragThresholdWorld(1)).toBe(4);
    expect(clickDragThresholdWorld(2)).toBe(2);
    expect(clickDragThresholdWorld(0.5)).toBe(8);
    // Current behavior: zoom is clamped to 0.1 minimum in denominator.
    expect(clickDragThresholdWorld(0)).toBe(40);
  });

  it('does not arm drag (no locks/history/isDragging) until movement exceeds zoom-scaled threshold', () => {
    const elements = [rect('a', 100, 100)];
    const lockElementsForGesture = vi.fn();
    const pushHistory = vi.fn(useCanvasStore.getState().pushHistory);
    const { result } = setup({
      elements,
      lockElementsForGesture,
      pushHistory,
      getElementAtPosition: () => elements[0]!,
      getElementsAtPosition: () => elements,
    });
    act(() => {
      useCanvasStore.setState({ zoom: 2 }); // world threshold = 2px
    });

    act(() => {
      result.current.handlePointerDown(pointerEvent(150, 140));
    });
    act(() => {
      result.current.handlePointerMove(pointerEvent(151.5, 140)); // below 2
    });

    expect(result.current.interactionRef.current.dragging).toBe(false);
    expect(lockElementsForGesture).not.toHaveBeenCalled();
    expect(pushHistory).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().isDragging).toBe(false);
    expect(useCanvasStore.getState().elementsById.get('a')).toMatchObject({ x: 100, y: 100 });

    act(() => {
      result.current.handlePointerMove(pointerEvent(153, 140)); // >= 2
    });

    expect(result.current.interactionRef.current.dragging).toBe(true);
    expect(lockElementsForGesture).toHaveBeenCalledTimes(1);
    expect(useCanvasStore.getState().isDragging).toBe(true);
  });
});

describe('arrow endpoint live-binding regression (L893-962 characterization)', () => {
  beforeEach(() => seed([]));

  it('reads current binding from live store (not gesture snapshot) so a same-gesture bind can be dropped', () => {
    // Regression characterization: geometry is derived from resizeInitialEl
    // snapshot, but binding state must be read from live elements so unbind can
    // fire after a bind created in the same gesture.
    const elements = [arrow('ar', 0, 0, 100), rect('box', 200, -50)];
    const { result } = setup({ elements });

    act(() => {
      const interaction = result.current.interactionRef.current;
      interaction.resizing = true;
      interaction.historyPushed = false;
      interaction.resizeHandle = 'arrow-end';
      interaction.resizeStartCanvasPos = { x: 0, y: 0 };
      interaction.resizeInitialEl = structuredClone(elements[0]!);
      useCanvasStore.getState().setIsResizing(true);
    });

    // Move 1: binds endpoint to box.
    act(() => {
      result.current.handlePointerMove(pointerEvent(110, 0));
    });
    expect((useCanvasStore.getState().elementsById.get('ar') as LinearElement).endBinding).toMatchObject({
      elementId: 'box',
    });
    // Snapshot still has no binding - this is the precondition for the bug.
    expect((result.current.interactionRef.current.resizeInitialEl as LinearElement).endBinding).toBeFalsy();

    // Move 2: drags away in same gesture; must unbind.
    act(() => {
      result.current.handlePointerMove(pointerEvent(-90, 0));
    });
    expect((useCanvasStore.getState().elementsById.get('ar') as LinearElement).endBinding).toBeFalsy();
    expect(result.current.hoveredBindingId).toBeNull();
  });
});
