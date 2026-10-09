import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RBush from 'rbush';
import { useCanvasStore } from '@/lib/store';
import { getElementBounds } from '@dripl/math/intersection';
import { useCanvasPointerEvents } from '@/hooks/canvas/useCanvasPointerEvents';
import type { DriplElement } from '@dripl/common';

/**
 * One commit per gesture frame.
 *
 * A drag that also moves binding follow-ups (bound arrows, labels) used to
 * commit twice per pointer move — primary geometry, then follow-ups — which
 * re-rendered the canvas subtree twice for a single visible frame. The hook
 * now resolves both halves into one `updateElementsTransient` call. These
 * tests count the calls through a pass-through wrapper with the real store
 * behind it, so the end state is asserted against the same commit the count
 * observes: a stubbed store would make "one call" vacuous.
 */
function rect(id: string, x: number, y: number, extra: Partial<DriplElement> = {}): DriplElement {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    width: 100,
    height: 80,
    strokeColor: '#000000',
    backgroundColor: '#ffffff',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    ...extra,
  } as unknown as DriplElement;
}

function boundArrow(id: string, targetId: string): DriplElement {
  return {
    id,
    type: 'arrow',
    x: 100,
    y: 0,
    width: 60,
    height: 10,
    points: [
      { x: 0, y: 5 },
      { x: 60, y: 5 },
    ],
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    startBinding: { elementId: targetId, fixedPoint: { x: 0.5, y: 0 }, mode: 'inside' },
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

let transientCalls = 0;

function setup(elements: DriplElement[], hits: DriplElement[]) {
  seed(elements);
  const store = useCanvasStore.getState();
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
    getElementsAtPosition: vi.fn<(x: number, y: number) => DriplElement[]>().mockReturnValue(hits),
    updateElementTransient: store.updateElementTransient,
    updateElementsTransient: (updates: ReadonlyMap<string, Partial<DriplElement>>): void => {
      transientCalls += 1;
      store.updateElementsTransient(updates);
    },
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
  return renderHook(() => useCanvasPointerEvents(props));
}

beforeEach(() => {
  transientCalls = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('gesture commit batching', () => {
  it('commits a bound drag once and still moves the follow-ups', () => {
    const shape = rect('r', 0, 0, { boundElements: [{ id: 'a', type: 'arrow' }] });
    const arrowEl = boundArrow('a', 'r');
    const originalPoints = arrowEl.points;
    const { result } = setup([shape, arrowEl], [shape]);

    act(() => {
      result.current.handlePointerDown(pointerEvent(10, 10));
    });
    expect(useCanvasStore.getState().isDragging).toBe(true);

    act(() => {
      result.current.handlePointerMove(pointerEvent(30, 40));
    });

    // One commit for primary geometry plus the arrow follow-up; the old path
    // committed twice here.
    expect(transientCalls).toBe(1);

    const state = useCanvasStore.getState();
    expect(state.elementsById.get('r')).toMatchObject({ x: 20, y: 30 });
    const movedArrow = state.elementsById.get('a') as unknown as {
      points: Array<{ x: number; y: number }>;
    };
    expect(movedArrow.points).not.toEqual(originalPoints);
  });

  it('commits an unbound drag once', () => {
    const shape = rect('r', 0, 0);
    const { result } = setup([shape], [shape]);

    act(() => {
      result.current.handlePointerDown(pointerEvent(10, 10));
    });

    act(() => {
      result.current.handlePointerMove(pointerEvent(30, 40));
    });

    // Even with no follow-ups the old path called twice (primary, then an
    // empty no-op); now there is nothing else to commit.
    expect(transientCalls).toBe(1);
    expect(useCanvasStore.getState().elementsById.get('r')).toMatchObject({ x: 20, y: 30 });
  });
});
