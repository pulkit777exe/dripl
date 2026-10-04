import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RBush from 'rbush';
import { useCanvasStore } from '@/lib/store';
import { getElementBounds } from '@dripl/math/intersection';
import { useCanvasPointerEvents } from '@/hooks/canvas/useCanvasPointerEvents';
import type { DriplElement, LinearElement } from '@dripl/common';

/**
 * Arrow endpoint and midpoint dragging — the branch of the resize gesture
 * that also re-binds the arrow.
 *
 * The invariant that matters is two-sided and both sides are pinned here:
 * an endpoint dropped near a shape gains `startBinding`/`endBinding` AND the
 * shape gains the reverse `boundElements` entry (so dragging the shape drags
 * the arrow), and an endpoint dragged away from a bound shape loses both.
 * Either half alone leaves the scene inconsistent.
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

/** A horizontal arrow from (x, y) to (x + length, y). */
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
  elements.forEach(el => {
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

function setup(elements: DriplElement[]) {
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
    getElementAtPosition: vi.fn(() => null),
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
    applyFrameGrouping: vi.fn(),
    spatialIndex: spatialIndexFor(elements),
  };
  return { ...renderHook(() => useCanvasPointerEvents(props)), props };
}

/**
 * Arm an endpoint/point drag the way `SelectionOverlay` + `useTransformStart`
 * do, with the handle name the overlay uses for that control.
 */
function armHandle(result: { current: ReturnType<typeof useCanvasPointerEvents> }, handle: string) {
  act(() => {
    const interaction = result.current.interactionRef.current;
    interaction.resizing = true;
    interaction.historyPushed = false;
    interaction.resizeHandle = handle;
    interaction.resizeStartCanvasPos = { x: 0, y: 0 };
    interaction.resizeInitialEl = structuredClone(
      useCanvasStore.getState().elementsById.get('ar')!
    );
    useCanvasStore.getState().setIsResizing(true);
    useCanvasStore.getState().setEditingElementId('ar');
  });
}

const boundIds = (el: DriplElement | undefined): string[] =>
  Array.from((el as { boundElements?: Array<{ id: string }> })?.boundElements ?? []).map(b => b.id);

beforeEach(() => {
  seed([]);
});

describe('arrow endpoint drag', () => {
  it('binds a dragged endpoint to a nearby shape, from both sides', () => {
    // Arrow runs (0,0) → (100,0). The box sits at 140..240, so its left edge
    // is 40px from the arrow end: outside the 20px bind radius until the drag
    // carries the endpoint onto it.
    const elements = [arrow('ar', 0, 0, 100), rect('box', 200, -50)];
    const { result } = setup(elements);
    armHandle(result, 'arrow-end');

    act(() => {
      // Endpoint 100 → 150; the box's left edge is at 200, distance 50. No bind.
      result.current.handlePointerMove(pointerEvent(50, 0));
    });
    expect(
      (useCanvasStore.getState().elementsById.get('ar') as LinearElement).endBinding
    ).toBeFalsy();
    expect(boundIds(useCanvasStore.getState().elementsById.get('box'))).toEqual([]);

    act(() => {
      // Endpoint 150 → 210: inside the box.
      result.current.handlePointerMove(pointerEvent(110, 0));
    });

    const state = useCanvasStore.getState();
    const bound = state.elementsById.get('ar') as LinearElement;
    expect(bound.endBinding).toMatchObject({ elementId: 'box', mode: 'orbit' });
    // The arrow's geometry followed the pointer.
    expect(bound.x + ((bound.points ?? [])[1]?.x ?? 0)).toBe(210);

    // DOCUMENTED GAP, not an endorsement: the gesture writes only the arrow.
    // The shape-side `boundElements` index that `buildBoundArrowsByShape`
    // reads when a shape moves is never written here, so a binding made by
    // dragging an endpoint does not make the arrow follow the shape for the
    // rest of the session. Only `finishDrawing` → `bindCommittedArrow`
    // populates that index, and that is the commit path for a *drawn* arrow.
    expect(boundIds(state.elementsById.get('box'))).toEqual([]);
  });

  it('drops the binding and the reverse index when the endpoint leaves', () => {
    const elements = [
      arrow('ar', 0, 0, 100, {
        endBinding: { elementId: 'box', fixedPoint: { x: 0, y: 0.5 }, mode: 'orbit' },
      }),
      rect('box', 200, -50, { boundElements: [{ id: 'ar', type: 'arrow' }] }),
    ];
    const { result } = setup(elements);
    armHandle(result, 'arrow-end');

    act(() => {
      // Endpoint 100 → 10: 190px clear of the box's left edge.
      result.current.handlePointerMove(pointerEvent(-90, 0));
    });

    const state = useCanvasStore.getState();
    expect((state.elementsById.get('ar') as LinearElement).endBinding).toBeNull();
    // DOCUMENTED GAP: the reverse index on the shape is left stale. It is
    // only a stale read (`updateBoundArrows` skips an arrow with no matching
    // binding), but it is the index the follow path is built from.
    expect(boundIds(state.elementsById.get('box'))).toEqual(['ar']);
  });

  it('binds inside the 20px snap radius', () => {
    // The box's left edge is at x=200 and the arrow's end starts at x=100, so
    // a drag to x=185 ends 15px short. The radius is what stops an arrow
    // snapping to a shape the user merely dragged past.
    const elements = [arrow('ar', 0, 0, 100), rect('box', 200, -50)];
    const { result } = setup(elements);
    armHandle(result, 'arrow-end');

    act(() => {
      result.current.handlePointerMove(pointerEvent(85, 0));
    });
    expect(
      (useCanvasStore.getState().elementsById.get('ar') as LinearElement).endBinding
    ).toMatchObject({ elementId: 'box' });
  });

  it('does not bind outside the 20px snap radius', () => {
    const elements = [arrow('ar', 0, 0, 100), rect('box', 200, -50)];
    const { result } = setup(elements);
    armHandle(result, 'arrow-end');

    // Endpoint to x=170, i.e. 30px clear of the box.
    act(() => {
      result.current.handlePointerMove(pointerEvent(70, 0));
    });

    expect(
      (useCanvasStore.getState().elementsById.get('ar') as LinearElement).endBinding
    ).toBeFalsy();
    expect(result.current.hoveredBindingId).toBeNull();
  });

  it('cannot drop a binding it made during the same gesture', () => {
    // DOCUMENTED DEFECT, pinned so it cannot regress silently: the endpoint
    // handler derives each frame's element from the gesture-start snapshot
    // (`resizeInitialEl`), so the `endBinding` it writes mid-gesture is not
    // in the snapshot it reads on the next move. `currentBinding` is read
    // from that snapshot, so the unbind branch never fires, and the store
    // merge in `mutateElement` keeps the stale key. A binding made by
    // dragging therefore survives until the pointer is released and the
    // gesture is re-armed from scratch.
    const elements = [arrow('ar', 0, 0, 100), rect('box', 200, -50)];
    const { result } = setup(elements);
    armHandle(result, 'arrow-end');

    act(() => {
      result.current.handlePointerMove(pointerEvent(85, 0));
    });
    expect(
      (useCanvasStore.getState().elementsById.get('ar') as LinearElement).endBinding
    ).toMatchObject({ elementId: 'box' });

    act(() => {
      result.current.handlePointerMove(pointerEvent(20, 0));
    });

    // Expected of a correct implementation: null. Actual: still bound.
    expect(
      (useCanvasStore.getState().elementsById.get('ar') as LinearElement).endBinding
    ).toMatchObject({ elementId: 'box' });
    // Control: a *fresh* gesture from the unbound snapshot unbinds normally.
    act(() => {
      result.current.handlePointerUp(pointerEvent(20, 0));
      armHandle(result, 'arrow-end');
    });
    act(() => {
      result.current.handlePointerMove(pointerEvent(20, 0));
    });
    expect(
      (useCanvasStore.getState().elementsById.get('ar') as LinearElement).endBinding
    ).toBeNull();
  });

  it('leaves the other endpoint binding alone when one end is dragged', () => {
    const elements = [
      arrow('ar', 0, 0, 100, {
        startBinding: { elementId: 'left', fixedPoint: { x: 0.5, y: 0 }, mode: 'orbit' },
      }),
      rect('left', -200, -50, { boundElements: [{ id: 'ar', type: 'arrow' }] }),
      rect('box', 200, -50),
    ];
    const { result } = setup(elements);
    armHandle(result, 'arrow-end');

    act(() => {
      result.current.handlePointerMove(pointerEvent(110, 0));
    });

    const state = useCanvasStore.getState();
    const bound = state.elementsById.get('ar') as LinearElement;
    expect(bound.endBinding).toMatchObject({ elementId: 'box' });
    expect(bound.startBinding).toMatchObject({ elementId: 'left' });
    expect(boundIds(state.elementsById.get('left'))).toEqual(['ar']);
  });

  it('binds the start endpoint from its own handle', () => {
    const elements = [arrow('ar', 0, 0, 100), rect('box', -100, -50)];
    const { result } = setup(elements);
    armHandle(result, 'arrow-start');

    act(() => {
      // Start 0 → -10, inside the box (which spans -100..0).
      result.current.handlePointerMove(pointerEvent(-10, 0));
    });

    const state = useCanvasStore.getState();
    expect((state.elementsById.get('ar') as LinearElement).startBinding).toMatchObject({
      elementId: 'box',
    });
    // Same documented gap as the end-handle case: the shape-side index is
    // not written by the gesture.
    expect(boundIds(state.elementsById.get('box'))).toEqual([]);
  });

  it('leaves the store element untouched when the element has no id to write to', () => {
    // An element without an id cannot be persisted or rebound; the move must
    // still not throw and must not touch any other element.
    const elements = [arrow('ar', 0, 0, 100), rect('box', 200, -50)];
    const { result } = setup(elements);
    act(() => {
      const interaction = result.current.interactionRef.current;
      interaction.resizing = true;
      interaction.historyPushed = false;
      interaction.resizeHandle = 'arrow-end';
      interaction.resizeStartCanvasPos = { x: 0, y: 0 };
      interaction.resizeInitialEl = structuredClone(elements[0]!);
      delete (interaction.resizeInitialEl as unknown as { id?: string }).id;
    });

    act(() => {
      result.current.handlePointerMove(pointerEvent(110, 0));
    });

    expect(useCanvasStore.getState().elementsById.has('ar')).toBe(true);
    expect(
      (useCanvasStore.getState().elementsById.get('ar') as LinearElement).endBinding
    ).toBeFalsy();
  });
});

describe('arrow midpoint insertion', () => {
  it('inserts a point on the named segment and re-arms the drag for it', () => {
    // The overlay names a segment insertion handle `arrow-insert-<index>`;
    // `insertLinearMidpoint` treats index i as the segment between points
    // i-1 and i. Index 1 is the only segment of a two-point arrow.
    const elements = [arrow('ar', 100, 100, 200)];
    const { result } = setup(elements);
    armHandle(result, 'arrow-insert-1');

    act(() => {
      result.current.handlePointerMove(pointerEvent(0, 0));
    });

    const interaction = result.current.interactionRef.current;
    const inserted = useCanvasStore.getState().elementsById.get('ar')!;
    expect(inserted.points).toHaveLength(3);
    // Midpoint of (100,100)-(300,100) is (200,100); the box re-anchors to it.
    expect((inserted.points ?? [])[1]).toEqual({ x: 100, y: 0 });
    expect(inserted.x).toBe(100);
    expect(inserted.width).toBe(200);
    // The gesture continues as a point drag on the new vertex, not another
    // insertion — otherwise one click adds points forever.
    expect(interaction.resizeHandle).toBe('arrow-point-1');
    // History is closed out immediately: the insertion is its own undo step.
    expect(interaction.historyPushed).toBe(true);
  });

  it('leaves the element alone when the segment index is out of range', () => {
    const elements = [arrow('ar', 100, 100, 200)];
    const { result } = setup(elements);
    armHandle(result, 'arrow-insert-9');

    act(() => {
      result.current.handlePointerMove(pointerEvent(20, 0));
    });

    const inserted = useCanvasStore.getState().elementsById.get('ar')!;
    expect(inserted.points).toHaveLength(2);
    // The handle is not re-armed, so the gesture stays on the same control.
    expect(result.current.interactionRef.current.resizeHandle).toBe('arrow-insert-9');
  });

  it('moves only the named point of a three-point path', () => {
    const elements = [
      element('ar', {
        type: 'line',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 50 },
          { x: 100, y: 0 },
        ],
      }),
    ];
    const { result } = setup(elements);
    armHandle(result, 'arrow-point-2');

    act(() => {
      result.current.handlePointerMove(pointerEvent(10, 20));
    });

    expect(useCanvasStore.getState().elementsById.get('ar')!.points).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 110, y: 20 },
    ]);
  });
});

describe('arrow drawing feedback', () => {
  function setupDrawing(elements: DriplElement[], draft: DriplElement) {
    const harness = setup(elements);
    act(() => {
      useCanvasStore.getState().setDraftElement(draft);
      useCanvasStore.getState().setIsDrawing(true);
      useCanvasStore.setState({ activeTool: 'arrow' });
    });
    return harness;
  }

  it('highlights the shape under the live endpoint and clears it on the way out', () => {
    const target = rect('box', 250, -20, { width: 100, height: 100 });
    const { result } = setupDrawing([target], arrow('draft', 0, 0, 300, { id: 'draft' }));

    act(() => {
      result.current.handlePointerMove(pointerEvent(320, 130));
    });

    // Endpoint (300, 0) in world terms lands inside the box at 250..350.
    expect(result.current.hoveredBindingId).toBe('box');
    expect(result.current.startPointBindingId).toBeNull();

    // The draft advances as the pointer does: the endpoint moves clear of the
    // box, so the highlight must go with it.
    act(() => {
      useCanvasStore.getState().setDraftElement(arrow('draft', 0, 0, 500, { id: 'draft' }));
      result.current.handlePointerMove(pointerEvent(500, 400));
    });

    expect(result.current.hoveredBindingId).toBeNull();
  });

  it('highlights the shape under the start point too', () => {
    const origin = rect('origin', 0, 0, { width: 40, height: 40 });
    const far = rect('far', 900, 900);
    const { result } = setupDrawing([origin, far], arrow('draft', 0, 0, 300, { id: 'draft' }));

    act(() => {
      result.current.handlePointerMove(pointerEvent(0, 400));
    });

    expect(result.current.startPointBindingId).toBe('origin');
    expect(result.current.hoveredBindingId).toBeNull();
  });

  it('clears both highlights for a draft that is not a two-point path yet', () => {
    const target = rect('box', 300, 100);
    const { result } = setupDrawing(
      [target],
      element('draft', { type: 'arrow', x: 0, y: 0, width: 300, height: 0, points: [] })
    );

    act(() => {
      result.current.handlePointerMove(pointerEvent(320, 130));
    });

    expect(result.current.hoveredBindingId).toBeNull();
    expect(result.current.startPointBindingId).toBeNull();
  });

  it('forwards the move to the drawing tools with the snapped point', () => {
    const { result, props } = setupDrawing([], arrow('draft', 0, 0, 100, { id: 'draft' }));

    act(() => {
      result.current.handlePointerMove(pointerEvent(120, 40, { shiftKey: true, pressure: 0.9 }));
    });

    expect(props.updateDrawing).toHaveBeenCalledTimes(1);
    expect(props.updateDrawing).toHaveBeenCalledWith(
      { x: 120, y: 40 },
      expect.objectContaining({ shiftKey: true, altKey: false, pressure: 0.9 }),
      expect.any(Array)
    );
  });
});
