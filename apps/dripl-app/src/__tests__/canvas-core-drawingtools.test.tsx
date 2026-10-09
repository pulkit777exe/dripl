import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import { useDrawingTools } from '@/hooks/useDrawingTools';
import { DriplElementSchema } from '@dripl/common';
import type { DriplElement } from '@dripl/common';

/**
 * The drawing hook's draft lifecycle: start → update → finish.
 *
 * `lib/draw/tool-state.ts` is already covered as pure functions, so what is
 * pinned here is the half that only exists in the hook — which calls reach
 * the store, what the commit guard throws away, and that a discarded draft
 * leaves no element, no history and no in-progress state behind. A draft that
 * survives a cancel is how a "phantom" shape appears in a saved scene.
 */

const BASE = {
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  strokeWidth: 2,
  opacity: 1,
  roughness: 1,
  strokeStyle: 'solid' as const,
  fillStyle: 'hachure' as const,
};

function seed(elements: DriplElement[] = [], extra: Record<string, unknown> = {}) {
  useCanvasStore.setState({
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    past: [],
    future: [],
    activeTool: 'select',
    draftElement: null,
    drawingLifecycle: 'idle',
    pendingEmbed: null,
    isDrawing: false,
    isDragging: false,
    isPanning: false,
    isResizing: false,
    isRotating: false,
    textInput: null,
    marqueeSelection: null,
    eraserPath: [],
    elementLocks: new Map<string, string>(),
    userId: 'me',
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
    ...extra,
  });
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
}

function draft(): DriplElement | null {
  return useCanvasStore.getState().draftElement;
}

beforeEach(() => {
  seed();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('draft lifecycle', () => {
  it('publishes a schema-valid draft on start and tracks the drag on update', () => {
    const { result } = renderHook(() => useDrawingTools());

    act(() => {
      result.current.startDrawing({ x: 10, y: 20 }, 'rectangle', { shiftKey: false }, BASE);
    });

    const started = draft();
    expect(started).toMatchObject({ type: 'rectangle', width: 0, height: 0 });
    expect(DriplElementSchema.safeParse(started).success).toBe(true);
    expect(result.current.isDrawing).toBe(true);
    expect(useCanvasStore.getState().drawingLifecycle).toBe('drawing');

    act(() => {
      result.current.updateDrawing({ x: 110, y: 90 }, { shiftKey: false, altKey: false });
    });

    // The draft follows the pointer rather than staying at the press point.
    expect(draft()).toMatchObject({ x: 10, y: 20, width: 100, height: 70 });
    // One id for the whole gesture, so the preview does not fork on move.
    expect(draft()!.id).toBe(started!.id);
  });

  it('ignores a start request for a tool that draws nothing', () => {
    const { result } = renderHook(() => useDrawingTools());

    act(() => {
      result.current.startDrawing({ x: 0, y: 0 }, 'select', { shiftKey: false }, BASE);
    });

    expect(draft()).toBeNull();
    expect(useCanvasStore.getState().drawingLifecycle).toBe('idle');
  });

  it('ignores an update or finish that was never started', () => {
    const { result } = renderHook(() => useDrawingTools());

    act(() => {
      result.current.updateDrawing({ x: 10, y: 10 }, { shiftKey: false, altKey: false });
    });
    let finished: DriplElement | null = null;
    act(() => {
      finished = result.current.finishDrawing();
    });

    expect(finished).toBeNull();
    expect(useCanvasStore.getState().elements).toHaveLength(0);
    expect(useCanvasStore.getState().draftElement).toBeNull();
  });

  it('commits the drag exactly once and clears the draft', () => {
    const { result } = renderHook(() => useDrawingTools());

    act(() => {
      result.current.startDrawing({ x: 0, y: 0 }, 'rectangle', { shiftKey: false }, BASE);
    });
    act(() => {
      result.current.updateDrawing({ x: 60, y: 40 }, { shiftKey: false, altKey: false });
    });

    let committed: DriplElement | null = null;
    act(() => {
      committed = result.current.finishDrawing();
    });

    const state = useCanvasStore.getState();
    expect(state.elements).toHaveLength(1);
    expect(state.elements[0]).toMatchObject({ id: committed!.id, width: 60, height: 40 });
    expect(state.draftElement).toBeNull();
    expect(state.drawingLifecycle).toBe('idle');
    expect(result.current.isDrawing).toBe(false);
    // The commit is undoable, and it is the only history entry.
    expect(state.past).toHaveLength(1);
  });

  it('refuses a second finish so one drag cannot commit two elements', () => {
    const { result } = renderHook(() => useDrawingTools());
    act(() => {
      result.current.startDrawing({ x: 0, y: 0 }, 'ellipse', { shiftKey: false }, BASE);
    });
    act(() => {
      result.current.updateDrawing({ x: 50, y: 50 }, { shiftKey: false, altKey: false });
    });

    act(() => {
      result.current.finishDrawing();
    });
    act(() => {
      result.current.finishDrawing();
    });

    expect(useCanvasStore.getState().elements).toHaveLength(1);
    expect(useCanvasStore.getState().past).toHaveLength(1);
  });

  it('throws away an accidental click without touching the scene or history', () => {
    const { result } = renderHook(() => useDrawingTools());
    act(() => {
      result.current.startDrawing({ x: 30, y: 30 }, 'rectangle', { shiftKey: false }, BASE);
    });
    act(() => {
      result.current.updateDrawing({ x: 32, y: 31 }, { shiftKey: false, altKey: false });
    });

    let finished: DriplElement | null = null;
    act(() => {
      finished = result.current.finishDrawing();
    });

    const state = useCanvasStore.getState();
    expect(finished).toBeNull();
    // The sub-5px guard is the difference between a click and a shape; a
    // committed 2x1 rectangle is the visible symptom of it failing.
    expect(state.elements).toHaveLength(0);
    expect(state.draftElement).toBeNull();
    expect(state.drawingLifecycle).toBe('idle');
    expect(state.past).toHaveLength(0);
  });

  it('drops the draft and the lifecycle on cancel', () => {
    const { result } = renderHook(() => useDrawingTools());
    act(() => {
      result.current.startDrawing({ x: 0, y: 0 }, 'rectangle', { shiftKey: false }, BASE);
    });
    act(() => {
      result.current.updateDrawing({ x: 90, y: 90 }, { shiftKey: false, altKey: false });
    });
    expect(useCanvasStore.getState().drawingLifecycle).toBe('drawing');

    act(() => {
      result.current.cancelDrawing();
    });

    const state = useCanvasStore.getState();
    expect(state.draftElement).toBeNull();
    expect(state.drawingLifecycle).toBe('idle');
    expect(state.elements).toHaveLength(0);
    expect(state.past).toHaveLength(0);
    expect(result.current.isDrawing).toBe(false);
  });

  it('cannot resurrect a cancelled gesture through a late update', () => {
    const { result } = renderHook(() => useDrawingTools());
    act(() => {
      result.current.startDrawing({ x: 0, y: 0 }, 'rectangle', { shiftKey: false }, BASE);
    });
    act(() => {
      result.current.cancelDrawing();
    });
    act(() => {
      result.current.updateDrawing({ x: 90, y: 90 }, { shiftKey: false, altKey: false });
    });

    expect(useCanvasStore.getState().draftElement).toBeNull();
    let finished: DriplElement | null = null;
    act(() => {
      finished = result.current.finishDrawing();
    });
    expect(finished).toBeNull();
  });
});

describe('tool-specific commits', () => {
  it.each([
    ['diamond', { x: 0, y: 0, width: 120, height: 60 }],
    ['line', { x: 0, y: 0, width: 120, height: 60 }],
    ['frame', { x: 0, y: 0, width: 120, height: 60 }],
  ] as const)('commits a %s drag with the dragged box', (tool, box) => {
    const { result } = renderHook(() => useDrawingTools());
    act(() => {
      result.current.startDrawing({ x: 0, y: 0 }, tool, { shiftKey: false }, BASE);
    });
    act(() => {
      result.current.updateDrawing({ x: 120, y: 60 }, { shiftKey: false, altKey: false });
    });
    act(() => {
      result.current.finishDrawing();
    });

    const committed = useCanvasStore.getState().elements[0]!;
    expect(committed.type).toBe(tool);
    expect(committed).toMatchObject(box);
    // Whatever the tool, the base style bag survives the round trip.
    expect(committed).toMatchObject({ strokeColor: '#1e1e1e', strokeWidth: 2, roughness: 1 });
    expect(DriplElementSchema.safeParse(committed).success).toBe(true);
  });

  it('commits a line as two points spanning the drag', () => {
    const { result } = renderHook(() => useDrawingTools());
    act(() => {
      result.current.startDrawing({ x: 10, y: 10 }, 'line', { shiftKey: false }, BASE);
    });
    act(() => {
      result.current.updateDrawing({ x: 70, y: 90 }, { shiftKey: false, altKey: false });
    });
    act(() => {
      result.current.finishDrawing();
    });

    const line = useCanvasStore.getState().elements[0]!;
    expect(line).toMatchObject({ type: 'line', x: 10, y: 10, width: 60, height: 80 });
    expect(line.points).toEqual([
      { x: 0, y: 0 },
      { x: 60, y: 80 },
    ]);
  });

  it('commits a frame with the title and padding the renderer reads', () => {
    const { result } = renderHook(() => useDrawingTools());
    act(() => {
      result.current.startDrawing({ x: 0, y: 0 }, 'frame', { shiftKey: false }, BASE);
    });
    act(() => {
      result.current.updateDrawing({ x: 200, y: 100 }, { shiftKey: false, altKey: false });
    });
    act(() => {
      result.current.finishDrawing();
    });

    const frame = useCanvasStore.getState().elements[0]! as unknown as Record<string, unknown>;
    expect(frame).toMatchObject({ type: 'frame', title: 'Frame', padding: 20 });
  });
  it('commits a freedraw stroke with its endpoints and its variable width', () => {
    const { result } = renderHook(() => useDrawingTools());
    act(() => {
      result.current.startDrawing({ x: 0, y: 0 }, 'freedraw', { shiftKey: false }, BASE);
    });
    for (let i = 1; i <= 12; i++) {
      act(() => {
        result.current.updateDrawing(
          { x: i * 10, y: i % 2 === 0 ? 0 : 4 },
          {
            shiftKey: false,
            altKey: false,
          }
        );
      });
    }

    let committed: DriplElement | null = null;
    act(() => {
      committed = result.current.finishDrawing();
    });

    const stroke = committed as unknown as {
      type: string;
      x: number;
      y: number;
      width: number;
      points: Array<{ x: number; y: number }>;
      pressureValues: number[];
      widths: number[];
    };
    expect(stroke.type).toBe('freedraw');
    expect(stroke.x).toBe(0);
    expect(stroke.width).toBeGreaterThan(0);
    expect(stroke.points.length).toBeGreaterThan(2);
    // The factory keys variable width off a 1:1 points/pressures pairing; the
    // stroke must commit with the pairing intact.
    expect(stroke.pressureValues).toHaveLength(stroke.points.length);
    expect(stroke.widths).toHaveLength(stroke.points.length);
    // The stroke's extremes survive: simplification may drop interior
    // samples, never the ends.
    const first = stroke.points[0]!;
    const last = stroke.points[stroke.points.length - 1]!;
    expect(stroke.x + first.x).toBe(0);
    expect(stroke.x + last.x).toBeCloseTo(120, 6);
    expect(useCanvasStore.getState().elements).toHaveLength(1);
  });

  it('records the pointer pressure of every freedraw sample', () => {
    // Frame queue: freedraw draft syncs land on a trailing edge, so the
    // assertions below run after a frame. The pressure plumbing under test —
    // every sample advancing the tool state — is unchanged.
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
    const { result } = renderHook(() => useDrawingTools());
    act(() => {
      result.current.startDrawing({ x: 0, y: 0 }, 'freedraw', { shiftKey: false }, BASE);
    });
    act(() => {
      result.current.updateDrawing(
        { x: 40, y: 30 },
        { shiftKey: false, altKey: false, pressure: 0.8 }
      );
    });
    act(() => {
      const pending = Array.from(frameQueue.values());
      frameQueue.clear();
      for (const cb of pending) cb(performance.now());
    });

    // One entry per sample: the start's default plus the pointer's value. A
    // plumbing regression that dropped `options.pressure` would leave a
    // uniform stroke, which is the only thing variable width reads.
    expect((draft() as unknown as { pressureValues: number[] }).pressureValues).toEqual([0.5, 0.8]);
    expect(draft()).toMatchObject({
      type: 'freedraw',
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 30 },
      ],
    });
  });

  it('binds a committed arrow to the shapes its endpoints landed on', () => {
    const box = {
      id: 'box',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeColor: '#000000',
      backgroundColor: 'transparent',
      strokeWidth: 2,
      opacity: 1,
      roughness: 1,
      version: 1,
      versionNonce: 1,
    } as unknown as DriplElement;
    seed([box]);
    const { result } = renderHook(() => useDrawingTools());

    act(() => {
      // Both endpoints inside the box.
      result.current.startDrawing({ x: 40, y: 50 }, 'arrow', { shiftKey: false }, BASE);
    });
    act(() => {
      result.current.updateDrawing(
        { x: 60, y: 50 },
        { shiftKey: false, altKey: false },
        useCanvasStore.getState().elements
      );
    });
    act(() => {
      result.current.finishDrawing();
    });

    const state = useCanvasStore.getState();
    const arrow = state.elements.find(el => el.id !== 'box')!;
    const bindings = arrow as unknown as {
      startBinding: { elementId: string } | null;
      endBinding: { elementId: string } | null;
    };
    expect(bindings.startBinding).toMatchObject({ elementId: 'box' });
    expect(bindings.endBinding).toMatchObject({ elementId: 'box' });
    // The reverse index is what makes the shape drag the arrow later, and only
    // the commit path writes it.
    expect((box as unknown as { boundElements?: unknown[] }).boundElements).toBeUndefined();
    expect(
      (
        (state.elementsById.get('box') as unknown as { boundElements?: Array<{ id: string }> })
          .boundElements ?? []
      ).map(b => b.id)
    ).toEqual([arrow.id]);
  });

  it('takes the embed url and title from the pending embed when the drag has none', () => {
    seed([], { pendingEmbed: { url: 'https://a.dev/watch', title: 'Watch' } });
    const { result } = renderHook(() => useDrawingTools());

    act(() => {
      result.current.startDrawing({ x: 0, y: 0 }, 'embed', { shiftKey: false }, BASE);
    });
    act(() => {
      result.current.updateDrawing({ x: 120, y: 80 }, { shiftKey: false, altKey: false });
    });
    act(() => {
      result.current.finishDrawing();
    });

    const embed = useCanvasStore.getState().elements[0]! as unknown as {
      type: string;
      url: string;
      title: string;
    };
    expect(embed).toMatchObject({ type: 'embed', url: 'https://a.dev/watch', title: 'Watch' });
  });

  it('lifts the bind mode to `inside` only for an alt arrow', () => {
    const { result } = renderHook(() => useDrawingTools());
    expect(result.current.bindModeRef.current).toBe('orbit');

    act(() => {
      result.current.startDrawing({ x: 0, y: 0 }, 'arrow', { shiftKey: false, altKey: true }, BASE);
    });
    expect(result.current.bindModeRef.current).toBe('inside');

    // A shape tool has no bind mode and must not disturb the arrow's.
    const other = renderHook(() => useDrawingTools());
    act(() => {
      other.result.current.startDrawing({ x: 0, y: 0 }, 'rectangle', { shiftKey: false }, BASE);
    });
    expect(other.result.current.bindModeRef.current).toBe('orbit');
  });
});

describe('committing into an occupied scene', () => {
  it('keeps the element count stable when a commit is rejected as a duplicate id', () => {
    // `commitDraft` refuses an id already in the scene. The hook must return
    // null in that case rather than reporting a commit that never happened.
    const { result } = renderHook(() => useDrawingTools());
    act(() => {
      result.current.startDrawing({ x: 0, y: 0 }, 'rectangle', { shiftKey: false }, BASE);
    });
    act(() => {
      result.current.updateDrawing({ x: 40, y: 40 }, { shiftKey: false, altKey: false });
    });

    let committedId = '';
    act(() => {
      committedId = result.current.finishDrawing()!.id;
    });
    expect(useCanvasStore.getState().elements).toHaveLength(1);

    // Re-arm by hand with the id already in the scene.
    act(() => {
      useCanvasStore.getState().setDraftElement({
        ...(useCanvasStore.getState().elements[0] as DriplElement),
      } as DriplElement);
    });
    let second: DriplElement | null = null;
    act(() => {
      second = result.current.finishDrawing();
    });

    expect(second).toBeNull();
    expect(useCanvasStore.getState().elements).toHaveLength(1);
    expect(committedId).not.toBe('');
    expect(useCanvasStore.getState().draftElement).toBeNull();
  });
});

describe('freedraw draft batching', () => {
  // Frame queue, scoped to these tests: the file's other suites keep their
  // synchronous timing, and `afterEach` above restores the spies.
  let frameQueue: Map<number, FrameRequestCallback>;
  let nextFrameId: number;

  function mockFrames() {
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
  }

  function runFrames() {
    act(() => {
      const pending = Array.from(frameQueue.values());
      frameQueue.clear();
      for (const cb of pending) cb(performance.now());
    });
  }

  function startFreedraw() {
    const { result } = renderHook(() => useDrawingTools());
    act(() => {
      result.current.startDrawing({ x: 0, y: 0 }, 'freedraw', { shiftKey: false }, BASE);
    });
    return { result };
  }

  // Draft commits observed, not spied. Spying on a Zustand state function
  // does not survive the store: `set()` copies the mock into every future
  // state object while `restoreAllMocks` only heals the stale one, so the
  // mock — and its call log — leaks across tests. A subscription counts each
  // draft identity change instead, which is also the re-render count, and it
  // detaches cleanly.
  let draftCommits: Array<DriplElement | null>;
  let stopWatching: (() => void) | null = null;

  function watchDrafts() {
    draftCommits = [];
    stopWatching?.();
    stopWatching = useCanvasStore.subscribe((s, p) => {
      if (s.draftElement !== p.draftElement) draftCommits.push(s.draftElement);
    });
  }

  afterEach(() => {
    stopWatching?.();
    stopWatching = null;
  });

  type FreedrawDraft = { points: Array<{ x: number; y: number }> };
  const draftPoints = () => (draft() as unknown as FreedrawDraft).points;

  it('syncs a frame of samples once with every sample preserved', () => {
    mockFrames();
    const { result } = startFreedraw();
    // Past the start's own commit: the initial draft is the whole content.
    watchDrafts();
    expect(draftPoints()).toEqual([{ x: 0, y: 0 }]);

    act(() => {
      result.current.updateDrawing({ x: 10, y: 0 }, { shiftKey: false, altKey: false });
    });
    act(() => {
      result.current.updateDrawing({ x: 20, y: 0 }, { shiftKey: false, altKey: false });
    });
    act(() => {
      result.current.updateDrawing({ x: 30, y: 0 }, { shiftKey: false, altKey: false });
    });
    // State advanced three times; the store heard nothing yet.
    expect(draftCommits).toHaveLength(0);

    runFrames();

    expect(draftCommits).toHaveLength(1);
    // Ends survive simplification (interior collinear samples are the tool
    // state's business, pinned by the pressure and commit tests): what the
    // batching guarantees is one commit carrying the frame's first-to-last.
    const points = draftPoints();
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 30, y: 0 });
  });

  it('commits unflushed samples on finish with no stale sync after', () => {
    mockFrames();
    const { result } = startFreedraw();
    watchDrafts();

    act(() => {
      result.current.updateDrawing({ x: 10, y: 0 }, { shiftKey: false, altKey: false });
    });
    act(() => {
      result.current.updateDrawing({ x: 20, y: 0 }, { shiftKey: false, altKey: false });
    });
    expect(draftCommits).toHaveLength(0);

    // No frame ran, yet the commit carries every sample: the preview is built
    // from the tool state, not from the deferred draft.
    let committed: DriplElement | null = null;
    act(() => {
      committed = result.current.finishDrawing();
    });
    const points = (committed as unknown as FreedrawDraft).points;
    expect(points[points.length - 1]).toEqual({ x: 20, y: 0 });
    // The finish's own preview sync plus the commit clearing the draft.
    expect(draftCommits).toHaveLength(2);
    expect(draftCommits[1]).toBeNull();

    runFrames();
    expect(draftCommits).toHaveLength(2);
    expect(draft()).toBeNull();
  });

  it('drops unflushed samples on cancel', () => {
    mockFrames();
    const { result } = startFreedraw();
    watchDrafts();
    expect(draftCommits).toHaveLength(0);

    act(() => {
      result.current.updateDrawing({ x: 10, y: 0 }, { shiftKey: false, altKey: false });
    });
    expect(draftCommits).toHaveLength(0);
    act(() => {
      result.current.cancelDrawing();
    });

    // Exactly the cancel's own nulling — no sample sync before or after.
    expect(draftCommits).toEqual([null]);
    runFrames();
    expect(draftCommits).toEqual([null]);
    expect(draft()).toBeNull();
  });

  it('keeps shape tools syncing every update', () => {
    mockFrames();
    const { result } = renderHook(() => useDrawingTools());

    // Only freedraw batches: every other tool delivers at most one sample per
    // frame already, so deferring them would change their contract for no gain.
    act(() => {
      result.current.startDrawing({ x: 10, y: 20 }, 'rectangle', { shiftKey: false }, BASE);
    });
    watchDrafts();
    act(() => {
      result.current.updateDrawing({ x: 60, y: 70 }, { shiftKey: false, altKey: false });
    });

    expect(draftCommits).toHaveLength(1);
    expect(draft()).toMatchObject({ type: 'rectangle' });
  });
});
