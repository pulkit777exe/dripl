import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import RBush from 'rbush';
import { useCanvasStore } from '@/lib/store';
import { getElementBounds } from '@dripl/math/intersection';
import { useCanvasPointerEvents } from '@/hooks/canvas/useCanvasPointerEvents';
import type { ActiveTool } from '@/lib/store';
import type { DriplElement } from '@dripl/common';

import * as imageTools from '@/utils/tools/image';

/**
 * The pointer branches of `useCanvasPointerEvents` that the gesture suite in
 * `pointer-events-gestures.test.tsx` does not reach: the selection-bounds
 * drag, the double-click short circuit, the overlay guard, the read-only move,
 * the eraser, the image tool and the frame hand-off.
 *
 * Fixtures use the real `type` strings from `DriplElementSchema` — a typo'd
 * type is dropped by validation rather than failing loudly, which is how an
 * earlier fixture in this repo produced a silent false negative.
 */

// Re-installed per test: `restoreAllMocks` in `afterEach` detaches a spy, and
// a detached spy silently passes the call through to the real network call.
let uploadSpy: MockInstance<typeof imageTools.uploadImageToServer>;
let loadSpy: MockInstance<typeof imageTools.loadImage>;

interface Fixture {
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  [key: string]: unknown;
}

function element(id: string, fixture: Fixture): DriplElement {
  return {
    id,
    x: fixture.x ?? 0,
    y: fixture.y ?? 0,
    width: fixture.width ?? 100,
    height: fixture.height ?? 80,
    strokeColor: '#000000',
    backgroundColor: '#ffffff',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    ...fixture,
    type: fixture.type ?? 'rectangle',
  } as unknown as DriplElement;
}

function rect(id: string, x: number, y: number, extra: Fixture = {}): DriplElement {
  return element(id, { ...extra, type: 'rectangle', x, y });
}

/** A two-point arrow whose world points run left-to-right across `x, y`. */
function arrow(id: string, x: number, y: number, extra: Fixture = {}): DriplElement {
  return element(id, {
    ...extra,
    type: 'arrow',
    x,
    y,
    width: 100,
    height: 0,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  });
}

function text(id: string, x: number, y: number, extra: Fixture = {}): DriplElement {
  return element(id, {
    ...extra,
    type: 'text',
    x,
    y,
    width: 60,
    height: 20,
    text: 'hi',
    fontSize: 16,
    fontFamily: 'sans-serif',
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
    ...extra,
  } as unknown as React.PointerEvent<HTMLCanvasElement>;
}

interface Overrides {
  elements?: DriplElement[];
  getElementAtPosition?: (x: number, y: number) => DriplElement | null;
  getElementsAtPosition?: (x: number, y: number) => DriplElement[];
  lockElementsForGesture?: ReturnType<typeof vi.fn<(ids: Iterable<string>) => void>>;
  unlockElement?: ReturnType<typeof vi.fn<(id: string) => void>>;
  unlockGestureElements?: ReturnType<typeof vi.fn<() => void>>;
  finishDrawing?: ReturnType<typeof vi.fn<() => DriplElement | null>>;
  applyFrameGrouping?: ReturnType<typeof vi.fn<(frame: DriplElement) => void>>;
  maybeRevertToSelectTool?: ReturnType<typeof vi.fn<(tool: ActiveTool) => void>>;
}

function setup(readOnly = false, overrides: Overrides = {}) {
  const elements = overrides.elements ?? [];
  seed(elements);
  const store = useCanvasStore.getState();
  const props = {
    readOnly,
    getCanvasCoordinates: (e: { clientX: number; clientY: number }) => ({
      x: e.clientX,
      y: e.clientY,
    }),
    snapPointToGrid: (p: { x: number; y: number }) => p,
    broadcastCursor: vi.fn(),
    addElement: store.addElement,
    getElementAtPosition: vi.fn(overrides.getElementAtPosition ?? (() => null)),
    getElementsAtPosition: vi.fn(overrides.getElementsAtPosition ?? (() => [])),
    updateElementTransient: store.updateElementTransient,
    updateElementsTransient: store.updateElementsTransient,
    updateElement: store.updateElement,
    pushHistory: store.pushHistory,
    lockElementsForGesture: overrides.lockElementsForGesture ?? vi.fn(),
    unlockElement: overrides.unlockElement ?? vi.fn(),
    unlockGestureElements: overrides.unlockGestureElements ?? vi.fn(),
    setEditingElementId: store.setEditingElementId,
    startDrawing: vi.fn(),
    updateDrawing: vi.fn(),
    setDrawingState: vi.fn(),
    maybeRevertToSelectTool: overrides.maybeRevertToSelectTool ?? vi.fn(),
    finishDrawing: overrides.finishDrawing ?? vi.fn(() => null),
    applyFrameGrouping: overrides.applyFrameGrouping ?? vi.fn(),
    spatialIndex: spatialIndexFor(elements),
  };
  return { ...renderHook(() => useCanvasPointerEvents(props)), props };
}

beforeEach(() => {
  uploadSpy = vi.spyOn(imageTools, 'uploadImageToServer');
  loadSpy = vi.spyOn(imageTools, 'loadImage');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dragging an existing selection', () => {
  it('drags only the unlocked members, and leaves a foreign lock alone', () => {
    // Two selected boxes, and a collaborator holds a lock on `b`. Pressing on
    // empty space inside the selection bounds is how a multi-select is moved,
    // so the lock filter on this path is the only thing standing between a
    // remote drag and two writers overwriting each other.
    const elements = [rect('a', 100, 100), rect('b', 300, 100)];
    const lockElementsForGesture = vi.fn<(ids: Iterable<string>) => void>();
    const { result } = setup(false, {
      elements,
      getElementsAtPosition: () => [],
      getElementAtPosition: () => null,
      lockElementsForGesture,
    });
    useCanvasStore.setState({
      selectedIds: new Set(['a', 'b']),
      elementLocks: new Map([['b', 'someone-else']]),
    });

    act(() => {
      result.current.handlePointerDown(pointerEvent(120, 120));
    });

    expect(useCanvasStore.getState().isDragging).toBe(true);
    expect(Array.from(result.current.interactionRef.current.dragInitialElements!.keys())).toEqual([
      'a',
    ]);
    expect(Array.from(lockElementsForGesture.mock.calls[0]![0] as Set<string>)).toEqual(['a']);

    act(() => {
      result.current.handlePointerMove(pointerEvent(170, 140));
    });

    const state = useCanvasStore.getState();
    expect(state.elementsById.get('a')).toMatchObject({ x: 150, y: 120 });
    expect(state.elementsById.get('b')).toMatchObject({ x: 300, y: 100 });
  });

  it('falls through to a marquee when every selected member is locked elsewhere', () => {
    const elements = [rect('a', 100, 100)];
    const lockElementsForGesture = vi.fn<(ids: Iterable<string>) => void>();
    const { result } = setup(false, {
      elements,
      getElementsAtPosition: () => [],
      lockElementsForGesture,
    });
    useCanvasStore.setState({
      selectedIds: new Set(['a']),
      elementLocks: new Map([['a', 'someone-else']]),
    });

    act(() => {
      result.current.handlePointerDown(pointerEvent(120, 120));
    });

    // No drag was armed, and the press starts a marquee instead — which will
    // replace the selection on release rather than moving someone else's box.
    expect(useCanvasStore.getState().isDragging).toBe(false);
    expect(lockElementsForGesture).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().marqueeSelection).toMatchObject({ active: true });
  });

  it('ignores unselected elements sitting inside the selection bounds', () => {
    // `b` overlaps the selection's box but is not part of it. If the press
    // swept it in, a drag would move an element the user never selected.
    const elements = [rect('a', 100, 100), rect('b', 150, 150)];
    const lockElementsForGesture = vi.fn<(ids: Iterable<string>) => void>();
    const { result } = setup(false, {
      elements,
      getElementsAtPosition: () => [],
      lockElementsForGesture,
    });
    useCanvasStore.setState({ selectedIds: new Set(['a']) });

    act(() => {
      result.current.handlePointerDown(pointerEvent(120, 120));
    });
    act(() => {
      result.current.handlePointerMove(pointerEvent(160, 190));
    });

    const state = useCanvasStore.getState();
    expect(state.elementsById.get('a')).toMatchObject({ x: 140, y: 170 });
    expect(state.elementsById.get('b')).toMatchObject({ x: 150, y: 150 });
  });

  it('does not treat a press outside the selection bounds as a drag', () => {
    const elements = [rect('a', 100, 100)];
    const { result } = setup(false, { elements, getElementsAtPosition: () => [] });
    useCanvasStore.setState({ selectedIds: new Set(['a']) });

    act(() => {
      result.current.handlePointerDown(pointerEvent(400, 400));
    });

    expect(useCanvasStore.getState().isDragging).toBe(false);
    expect(useCanvasStore.getState().marqueeSelection).toMatchObject({ active: true });
  });
});

describe('double click', () => {
  it('opens the text editor in place and does not touch the selection', () => {
    const target = text('t', 100, 100);
    const { result } = setup(false, { getElementAtPosition: () => target });

    act(() => {
      useCanvasStore.getState().setSelectedIds(new Set(['other']));
    });

    act(() => {
      result.current.handlePointerDown(pointerEvent(110, 110, { detail: 2 }));
    });

    expect(useCanvasStore.getState().textInput).toMatchObject({
      x: 100,
      y: 100,
      existingElementId: 't',
      value: 'hi',
    });
    // A double click that edits must not also start a drag or clear the
    // selection, which is what the press would otherwise do.
    expect(Array.from(useCanvasStore.getState().selectedIds)).toEqual(['other']);
    expect(useCanvasStore.getState().isDragging).toBe(false);
    expect(useCanvasStore.getState().marqueeSelection).toBeNull();
  });

  it('falls through to the normal press flow when the double click misses', () => {
    const { result, props } = setup(false, {
      getElementAtPosition: () => null,
      getElementsAtPosition: () => [],
    });

    act(() => {
      result.current.handlePointerDown(pointerEvent(300, 300, { detail: 2 }));
    });

    expect(props.getElementAtPosition).toHaveBeenCalled();
    expect(useCanvasStore.getState().marqueeSelection).toMatchObject({ active: true });
  });
});

describe('overlay guard', () => {
  it('ignores a press whose target opts into pointer events', () => {
    // Overlays drawn above the canvas (a resize handle, a context-menu anchor)
    // opt back into pointer events; the canvas must not also start a gesture,
    // or a single click both activates the control and mutates the scene.
    const { result } = setup(false, { getElementsAtPosition: () => [] });
    const target = document.createElement('div');
    target.className = 'pointer-events-auto';

    act(() => {
      result.current.handlePointerDown(pointerEvent(300, 300, { target }));
    });

    const state = useCanvasStore.getState();
    expect(state.marqueeSelection).toBeNull();
    expect(state.isPanning).toBe(false);
    expect(state.cursorPosition).toBeNull();
  });
});

describe('read-only', () => {
  it('tracks the cursor but never moves an element mid-gesture', () => {
    // A gesture can still be armed when the document flips to read-only
    // underneath the user (a share link resolving late). The pointer move
    // must stop at the read-only gate.
    const elements = [rect('a', 100, 100)];
    const { result } = setup(true, { elements, getElementsAtPosition: () => [] });

    act(() => {
      const interaction = result.current.interactionRef.current;
      interaction.dragging = true;
      interaction.historyPushed = false;
      interaction.dragStartCanvasPos = { x: 0, y: 0 };
      interaction.dragInitialElements = new Map([['a', structuredClone(elements[0]!)]]);
    });

    act(() => {
      result.current.handlePointerMove(pointerEvent(60, 40));
    });

    expect(useCanvasStore.getState().elementsById.get('a')).toMatchObject({ x: 100, y: 100 });
    // The cursor still follows: read-only viewers get a live pointer.
    expect(useCanvasStore.getState().cursorPosition).toEqual({ x: 60, y: 40 });
  });
});

describe('drop failures', () => {
  it('keeps the good file when a sibling upload fails', async () => {
    // `dropImageFiles` reports per file so one bad upload cannot swallow the
    // rest of a multi-file drop.
    uploadSpy.mockImplementation(async (file: File) => {
      if (file.name === 'bad.png') throw new Error('upload failed');
      return 'https://cdn.example/good.png';
    });
    loadSpy.mockResolvedValue({
      src: 'https://cdn.example/good.png',
      naturalWidth: 40,
      naturalHeight: 20,
      displayWidth: 40,
      displayHeight: 20,
    });
    const { result } = setup(false);
    const dragEvent = {
      preventDefault: vi.fn(),
      clientX: 200,
      clientY: 100,
      dataTransfer: {
        files: [
          new File(['x'], 'bad.png', { type: 'image/png' }),
          new File(['x'], 'good.png', { type: 'image/png' }),
        ],
      },
    } as unknown as React.DragEvent;

    await act(async () => {
      await result.current.handleDrop(dragEvent);
    });

    const elements = useCanvasStore.getState().elements;
    expect(elements).toHaveLength(1);
    expect((elements[0] as unknown as { src: string }).src).toBe('https://cdn.example/good.png');
  });
});

describe('resize gestures beyond the box handle', () => {
  it('moves the origin of a rotated shape with the rotation, not the axis', () => {
    // A 100x100 box at (200,200) rotated a quarter turn, dragged +40/+20 from
    // its south-east handle. Unrotated, a corner-fixed resize leaves the origin
    // at (200,200); rotated, the fixed corner is on the other axis, so the
    // origin has to move for that corner to stay put. The exact numbers come
    // from @dripl/element's rotation-aware origin, which is what the handler
    // delegates to — the point is that they are not the axis-aligned ones.
    const elements = [rect('a', 200, 200, { width: 100, height: 100, angle: Math.PI / 2 })];
    const { result } = setup(false, { elements });
    act(() => {
      const interaction = result.current.interactionRef.current;
      interaction.resizing = true;
      interaction.historyPushed = false;
      interaction.resizeHandle = 'se';
      interaction.resizeStartCanvasPos = { x: 0, y: 0 };
      interaction.resizeInitialEl = structuredClone(elements[0]!);
      useCanvasStore.getState().setIsResizing(true);
    });

    act(() => {
      result.current.handlePointerMove(pointerEvent(40, 20));
    });

    expect(useCanvasStore.getState().elementsById.get('a')).toMatchObject({
      x: 170,
      y: 210,
      width: 140,
      height: 120,
    });
  });

  it('re-wraps a text element and turns off its auto-resize on a side drag', () => {
    // jsdom has no 2d context, so text measurement is stubbed to zero width;
    // the invariant under test is the control flow (re-wrap path taken,
    // auto-resize released) rather than a font metric.
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (t: string) => ({ width: t.length * 4 }),
    } as unknown as CanvasRenderingContext2D);

    const elements = [
      element('t', {
        type: 'text',
        x: 100,
        y: 100,
        width: 200,
        height: 20,
        text: 'a long single line of words',
        originalText: 'a long single line of words',
        fontSize: 16,
        fontFamily: 'Arial',
        autoResize: true,
      }),
    ];
    const { result } = setup(false, { elements });
    act(() => {
      const interaction = result.current.interactionRef.current;
      interaction.resizing = true;
      interaction.historyPushed = false;
      interaction.resizeHandle = 'e';
      interaction.resizeStartCanvasPos = { x: 0, y: 0 };
      interaction.resizeInitialEl = structuredClone(elements[0]!);
      useCanvasStore.getState().setIsResizing(true);
    });

    act(() => {
      result.current.handlePointerMove(pointerEvent(-160, 0));
    });

    const resized = useCanvasStore.getState().elementsById.get('t')!;
    // Narrowing the frame re-wraps the text and hands sizing back to the
    // element, so the text stops driving its own width.
    expect((resized as unknown as { text: string }).text).toContain('\n');
    expect(resized).toMatchObject({ autoResize: false });
    expect(resized.width).toBeLessThan(200);
    getContext.mockRestore();
  });

  it('scales a linear path when its box is dragged by a compass handle', () => {
    // The path is stored relative to the element origin, so a box resize has
    // to scale the points too — otherwise the drawn line stops matching the
    // frame the overlay and the hit test both use.
    const elements = [
      element('ar', {
        type: 'arrow',
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 40 },
        ],
      }),
    ];
    const { result } = setup(false, { elements });
    act(() => {
      const interaction = result.current.interactionRef.current;
      interaction.resizing = true;
      interaction.historyPushed = false;
      interaction.resizeHandle = 'se';
      interaction.resizeStartCanvasPos = { x: 0, y: 0 };
      interaction.resizeInitialEl = structuredClone(elements[0]!);
      useCanvasStore.getState().setIsResizing(true);
    });

    act(() => {
      result.current.handlePointerMove(pointerEvent(50, 0));
    });

    const resized = useCanvasStore.getState().elementsById.get('ar')!;
    expect(resized).toMatchObject({ x: 0, y: 0, width: 150, height: 40 });
    expect(resized.points).toEqual([
      { x: 0, y: 0 },
      { x: 150, y: 40 },
    ]);
  });

  it('scales a perfectly axis-aligned linear path', () => {
    // A horizontal arrow has one zero extent — which is exactly what a
    // shift-snapped drag produces, and what `commitDraft` does not clamp. The
    // scaling branch used to be gated on `el.width !== 0 && el.height !== 0`,
    // so such an arrow took the branch's `else` and its path was never rescaled:
    // `width`/`height` changed, the drawn path did not, and because a linear
    // element's bounds come from its points the frame snapped straight back and
    // the drag read as inert.
    //
    // The control one row above is the same code path with a sloped arrow, so
    // this is about the zero extent specifically and not about the gesture.
    const horizontal = arrow('flat', 0, 0, {});
    const { result } = setup(false, { elements: [horizontal] });
    act(() => {
      const interaction = result.current.interactionRef.current;
      interaction.resizing = true;
      interaction.historyPushed = false;
      interaction.resizeHandle = 'se';
      interaction.resizeStartCanvasPos = { x: 0, y: 0 };
      interaction.resizeInitialEl = structuredClone(horizontal);
      useCanvasStore.getState().setIsResizing(true);
    });
    act(() => {
      result.current.handlePointerMove(pointerEvent(50, 0));
    });

    const flat = useCanvasStore.getState().elementsById.get('flat')!;
    expect(flat).toMatchObject({ width: 150 });
    // 100 wide, dragged 50 further: x scales by 1.5. The zero-height axis is
    // left alone rather than divided by, which is what `resizeSingleLinearElement`
    // guarantees with `prevHeight === 0 ? 1 : ...`.
    expect(flat.points).toEqual([
      { x: 0, y: 0 },
      { x: 150, y: 0 },
    ]);
  });

  it('leaves an element that cannot be dragged as a path alone', () => {
    // A linear handle on an element with no points: the drag helper returns
    // null and the frame must be dropped rather than written half-resized.
    const elements = [rect('a', 100, 100)];
    const { result } = setup(false, { elements });
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
      result.current.handlePointerMove(pointerEvent(40, 40));
    });

    expect(useCanvasStore.getState().elementsById.get('a')).toMatchObject({
      x: 100,
      y: 100,
      width: 100,
      height: 80,
    });
  });
});

describe('eraser', () => {
  it('never marks an element locked by another user for deletion', () => {
    const elements = [rect('a', 100, 100)];
    const { result } = setup(false, { elements });
    useCanvasStore.setState({
      elementLocks: new Map([['a', 'someone-else']]),
      activeTool: 'eraser',
    });

    act(() => {
      result.current.handlePointerDown(pointerEvent(150, 140));
    });
    act(() => {
      result.current.handlePointerMove(pointerEvent(155, 145));
    });

    // The eraser radius covers the element, but the lock wins.
    expect(useCanvasStore.getState().eraserPath).toHaveLength(2);
    expect(Array.from(result.current.eraserHitIdsRef.current)).toEqual([]);

    act(() => {
      result.current.handlePointerUp(pointerEvent(155, 145));
    });

    expect(useCanvasStore.getState().elementsById.has('a')).toBe(true);
    expect(useCanvasStore.getState().isDrawing).toBe(false);
  });

  it('deletes an arrow together with a label the stroke never touched', () => {
    // The label is parked far from the stroke — a user dragged it there — so
    // the only thing that can remove it is the cascade from the arrow.
    const elements = [
      arrow('ar', 100, 100, { labelId: 'lb' }),
      text('lb', 700, 700),
      rect('keep', 900, 100),
    ];
    const maybeRevertToSelectTool = vi.fn<(tool: ActiveTool) => void>();
    const { result } = setup(false, { elements, maybeRevertToSelectTool });
    useCanvasStore.setState({ activeTool: 'eraser' });

    act(() => {
      result.current.handlePointerDown(pointerEvent(150, 100));
    });
    act(() => {
      result.current.handlePointerMove(pointerEvent(150, 100));
    });
    act(() => {
      result.current.handlePointerUp(pointerEvent(150, 100));
    });

    const ids = Array.from(useCanvasStore.getState().elementsById.keys()).sort();
    // The label is a child of the arrow: leaving it behind orphans a text
    // element bound to nothing, which is what corrupts a saved scene.
    expect(ids).toEqual(['keep']);
    // Control: the stroke really only crossed the arrow.
    expect(Array.from(result.current.eraserHitIdsRef.current)).toEqual([]);
    expect(useCanvasStore.getState().eraserPath).toEqual([]);
    expect(maybeRevertToSelectTool).toHaveBeenCalledWith('eraser');
  });
});

describe('image tool', () => {
  /** Capture the hidden file input the hook clicks and hand it a file. */
  function captureFileInput() {
    const captured: HTMLInputElement[] = [];
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement
    ) {
      captured.push(this);
    });
    return captured;
  }

  async function choose(input: HTMLInputElement, file: File) {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    // `event.target` is only set once dispatched, and the handler reads the
    // file list off it; a bare `new Event('change')` has `target === null`.
    const event = new Event('change');
    Object.defineProperty(event, 'target', { value: input, configurable: true });
    await input.onchange?.(event);
  }

  it('centres the uploaded image on the press point and reverts to select', async () => {
    uploadSpy.mockResolvedValue('https://cdn.example/pick.png');
    loadSpy.mockResolvedValue({
      src: 'https://cdn.example/pick.png',
      naturalWidth: 400,
      naturalHeight: 200,
      displayWidth: 400,
      displayHeight: 200,
    });
    const inputs = captureFileInput();
    const maybeRevertToSelectTool = vi.fn<(tool: ActiveTool) => void>();
    const { result } = setup(false, { maybeRevertToSelectTool });
    useCanvasStore.setState({ activeTool: 'image' });

    act(() => {
      result.current.handlePointerDown(pointerEvent(300, 200));
    });

    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.accept).toBe('image/*');
    // The press must not leave a draft or a draw flag behind.
    expect(useCanvasStore.getState().isDrawing).toBe(false);

    await choose(inputs[0]!, new File(['x'], 'pick.png', { type: 'image/png' }));

    const elements = useCanvasStore.getState().elements;
    expect(elements).toHaveLength(1);
    // Centred on the press point, not anchored at its corner.
    expect(elements[0]).toMatchObject({
      type: 'image',
      src: 'https://cdn.example/pick.png',
      x: 100,
      y: 100,
      width: 400,
      height: 200,
    });
    expect(maybeRevertToSelectTool).toHaveBeenCalledWith('image');
  });

  it('adds nothing when the upload fails', async () => {
    uploadSpy.mockRejectedValue(new Error('offline'));
    const inputs = captureFileInput();
    const { result } = setup(false);
    useCanvasStore.setState({ activeTool: 'image' });

    act(() => {
      result.current.handlePointerDown(pointerEvent(300, 200));
    });
    await choose(inputs[0]!, new File(['x'], 'pick.png', { type: 'image/png' }));

    expect(useCanvasStore.getState().elements).toHaveLength(0);
  });

  it('does not yank the user back to a tool they already left', async () => {
    let releaseUpload: (url: string) => void = () => {};
    uploadSpy.mockReturnValue(
      new Promise<string>(resolve => {
        releaseUpload = resolve;
      })
    );
    loadSpy.mockResolvedValue({
      src: 'https://cdn.example/slow.png',
      naturalWidth: 10,
      naturalHeight: 10,
      displayWidth: 10,
      displayHeight: 10,
    });
    const inputs = captureFileInput();
    const maybeRevertToSelectTool = vi.fn<(tool: ActiveTool) => void>();
    const { result } = setup(false, { maybeRevertToSelectTool });
    useCanvasStore.setState({ activeTool: 'image' });

    act(() => {
      result.current.handlePointerDown(pointerEvent(300, 200));
    });
    // The user switches tools while the upload is still in flight.
    act(() => {
      useCanvasStore.setState({ activeTool: 'rectangle' });
    });
    releaseUpload('https://cdn.example/slow.png');
    await choose(inputs[0]!, new File(['x'], 'slow.png', { type: 'image/png' }));

    expect(useCanvasStore.getState().elements).toHaveLength(1);
    expect(maybeRevertToSelectTool).not.toHaveBeenCalled();
  });
});

describe('frame hand-off', () => {
  it('hands a finished frame to the grouping pass and nothing else', () => {
    const frame = element('f', { type: 'frame', x: 0, y: 0 });
    const applyFrameGrouping = vi.fn<(f: DriplElement) => void>();
    const maybeRevertToSelectTool = vi.fn<(tool: ActiveTool) => void>();
    const { result } = setup(false, {
      finishDrawing: vi.fn(() => frame),
      applyFrameGrouping,
      maybeRevertToSelectTool,
    });
    useCanvasStore.setState({ activeTool: 'frame', isDrawing: true });

    act(() => {
      result.current.handlePointerUp(pointerEvent(100, 100));
    });

    // A frame re-parents everything inside it; a shape must not go through
    // the same path or the grouping pass would fire on every rectangle.
    expect(applyFrameGrouping).toHaveBeenCalledTimes(1);
    expect(applyFrameGrouping.mock.calls[0]![0]).toBe(frame);
    expect(useCanvasStore.getState().isDrawing).toBe(false);
    expect(maybeRevertToSelectTool).toHaveBeenCalledWith('frame');
  });

  it('does not run the grouping pass for a non-frame commit', () => {
    const applyFrameGrouping = vi.fn<(f: DriplElement) => void>();
    const { result } = setup(false, {
      finishDrawing: vi.fn(() => rect('r', 0, 0)),
      applyFrameGrouping,
    });
    useCanvasStore.setState({ activeTool: 'rectangle', isDrawing: true });

    act(() => {
      result.current.handlePointerUp(pointerEvent(100, 100));
    });

    expect(applyFrameGrouping).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().isDrawing).toBe(false);
  });
});

describe('temporary pan tool restore', () => {
  it('returns to the pre-pan tool when the gesture ends on the hand tool', () => {
    // Space-drag on the select tool records `select`, and switching to the
    // hand tool mid-gesture must not strand the user in it after release.
    const { result } = setup(false);

    act(() => {
      result.current.interactionRef.current.isSpacePressed = true;
    });
    act(() => {
      result.current.handlePointerDown(pointerEvent(0, 0));
    });
    expect(result.current.lastToolBeforeSpaceRef.current).toBe('select');

    act(() => {
      result.current.interactionRef.current.isSpacePressed = false;
      useCanvasStore.setState({ activeTool: 'hand' });
    });
    act(() => {
      result.current.handlePointerUp(pointerEvent(10, 10));
    });

    expect(useCanvasStore.getState().activeTool).toBe('select');
    expect(useCanvasStore.getState().isPanning).toBe(false);
  });

  it('leaves a tool the user picked mid-gesture alone', () => {
    // Same press, but the user switches to the rectangle tool while the space
    // drag is still in flight. Releasing must not yank them back to `select`.
    const { result } = setup(false);
    act(() => {
      result.current.interactionRef.current.isSpacePressed = true;
    });
    act(() => {
      result.current.handlePointerDown(pointerEvent(0, 0));
    });
    act(() => {
      result.current.interactionRef.current.isSpacePressed = false;
      useCanvasStore.setState({ activeTool: 'rectangle' });
    });
    act(() => {
      result.current.handlePointerUp(pointerEvent(10, 10));
    });

    expect(useCanvasStore.getState().activeTool).toBe('rectangle');
  });

  it('keeps the hand tool when the gesture began on the hand tool', () => {
    const { result } = setup(false);
    act(() => {
      useCanvasStore.setState({ activeTool: 'hand' });
    });
    act(() => {
      result.current.handlePointerDown(pointerEvent(0, 0));
    });
    act(() => {
      result.current.handlePointerUp(pointerEvent(10, 10));
    });

    expect(useCanvasStore.getState().activeTool).toBe('hand');
  });
});
