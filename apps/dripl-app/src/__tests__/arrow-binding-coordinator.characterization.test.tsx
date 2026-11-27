import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RBush from 'rbush';
import type { DriplElement, LinearElement } from '@dripl/common';
import { getElementBounds } from '@dripl/math/intersection';
import { useCanvasPointerEvents } from '@/hooks/canvas/useCanvasPointerEvents';
import { useCanvasStore } from '@/lib/store';

/**
 * Characterization for arrow-binding coordinator orchestration before refactor.
 *
 * Pins the observable controller/hook behavior when bound shapes move, resize,
 * or rotate. These are the cross-module invariants the coordinator refactor must
 * preserve.
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
  return element(id, { type: 'rectangle', x, y, width: 100, height: 80, ...extra });
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
    readOnly: false,
  });
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
}

function spatialIndexFor(elements: DriplElement[]) {
  const tree = new RBush<{ minX: number; minY: number; maxX: number; maxY: number; id: string }>();
  const byId = new Map<string, DriplElement>();
  elements.forEach((el) => {
    const b = getElementBounds(el);
    tree.insert({ minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height, id: el.id });
    byId.set(el.id, el);
  });
  return { tree, byId };
}

function pointerEvent(x: number, y: number, extra: Record<string, unknown> = {}) {
  return {
    target: document.createElement('canvas'),
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

function setup(
  elements: DriplElement[],
  options: { getElementAtPosition?: (x: number, y: number) => DriplElement | null } = {}
) {
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
    getElementAtPosition: options.getElementAtPosition ?? vi.fn(() => null),
    getElementsAtPosition: vi.fn(() => []),
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
    finishDrawing: vi.fn(() => null),
    cancelDrawing: vi.fn(),
    applyFrameGrouping: vi.fn(),
    spatialIndex: spatialIndexFor(elements),
  };
  return { ...renderHook(() => useCanvasPointerEvents(props)), props };
}

function armResize(
  result: { current: ReturnType<typeof useCanvasPointerEvents> },
  elementId: string,
  handle: string
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

function armRotate(
  result: { current: ReturnType<typeof useCanvasPointerEvents> },
  elementId: string
) {
  act(() => {
    const interaction = result.current.interactionRef.current;
    interaction.rotating = true;
    interaction.historyPushed = false;
    interaction.rotateStartAngle = 0;
    interaction.rotateInitialAngle = 0;
    interaction.rotateInitialEl = structuredClone(
      useCanvasStore.getState().elementsById.get(elementId)!
    );
    useCanvasStore.getState().setIsRotating(true);
    useCanvasStore.getState().setEditingElementId(elementId);
  });
}

beforeEach(() => {
  seed([]);
});

describe('bound shape move updates arrow endpoints (characterization)', () => {
  it('dragging a bound shape moves the bound arrow endpoint through coordinator', () => {
    const shape = rect('box', 200, -40, {
      boundElements: [{ id: 'ar', type: 'arrow' }],
    });
    const ar = arrow('ar', 0, 0, 200, {
      endBinding: { elementId: 'box', fixedPoint: { x: 0, y: 0.5 }, mode: 'orbit' },
    });
    const elements = [shape, ar];

    const { result } = setup(elements, {
      getElementAtPosition: (x, y) => {
        const el = useCanvasStore.getState().elementsById.get('box');
        if (!el) return null;
        const b = getElementBounds(el);
        return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height ? el : null;
      },
    });

    act(() => {
      useCanvasStore.getState().setSelectedIds(new Set(['box']));
    });

    // Pointer down on shape, then move enough to start drag.
    act(() => {
      result.current.handlePointerDown(pointerEvent(250, 0));
    });
    act(() => {
      result.current.handlePointerMove(pointerEvent(270, 10));
    });

    const arrowAfter = useCanvasStore.getState().elementsById.get('ar') as LinearElement;
    expect(arrowAfter.points).toHaveLength(2);
    // End point should have moved with the shape (not remain at original relative position).
    const end = arrowAfter.points![arrowAfter.points!.length - 1]!;
    // Original end was at (200,0) relative to arrow origin (0,0). Shape moved by (20,10).
    // Recalculated binding should track the moved shape.
    expect(end.x).not.toBe(200);
  });
});

describe('bound shape resize updates arrow endpoints (characterization)', () => {
  it('resizing a bound shape updates the bound arrow endpoint', () => {
    const shape = rect('box', 200, -40, {
      boundElements: [{ id: 'ar', type: 'arrow' }],
    });
    const ar = arrow('ar', 0, 0, 200, {
      endBinding: { elementId: 'box', fixedPoint: { x: 0, y: 0.5 }, mode: 'orbit' },
    });
    const { result } = setup([shape, ar]);

    armResize(result, 'box', 'se');
    act(() => {
      result.current.handlePointerMove(pointerEvent(40, 20));
    });

    const arrowAfter = useCanvasStore.getState().elementsById.get('ar') as LinearElement;
    const end = arrowAfter.points![arrowAfter.points!.length - 1]!;
    // Shape resized; binding recalculation should move endpoint.
    expect(end.x).not.toBe(200);
  });
});

describe('rotation binding coordination (characterization)', () => {
  it('rotating a bound shape does not rebind arrow endpoints (labels-only mode)', () => {
    const shape = rect('box', 200, -40, {
      boundElements: [{ id: 'ar', type: 'arrow' }],
    });
    const ar = arrow('ar', 0, 0, 200, {
      endBinding: { elementId: 'box', fixedPoint: { x: 0, y: 0.5 }, mode: 'orbit' },
    });
    const { result } = setup([shape, ar]);

    const before = structuredClone(
      (useCanvasStore.getState().elementsById.get('ar') as LinearElement).points
    );

    armRotate(result, 'box');
    act(() => {
      // Rotate by moving pointer; angle computation depends on shape center.
      result.current.handlePointerMove(pointerEvent(300, 100));
    });

    const arrowAfter = useCanvasStore.getState().elementsById.get('ar') as LinearElement;
    expect(arrowAfter.points).toEqual(before);
  });
});

describe('delete coordination (characterization)', () => {
  it('deleting a bound shape unbinds arrows but keeps them', () => {
    const shape = rect('box', 200, -40, {
      boundElements: [{ id: 'ar', type: 'arrow' }],
    });
    const ar = arrow('ar', 0, 0, 200, {
      endBinding: { elementId: 'box', fixedPoint: { x: 0, y: 0.5 }, mode: 'orbit' },
    });
    seed([shape, ar]);

    act(() => {
      useCanvasStore.getState().deleteElements(['box']);
    });

    const arrowAfter = useCanvasStore.getState().elementsById.get('ar') as LinearElement;
    expect(arrowAfter).toBeDefined();
    expect(arrowAfter.isDeleted).toBeFalsy();
    expect(arrowAfter.endBinding).toBeNull();
  });
});
