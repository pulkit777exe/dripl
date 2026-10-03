import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import { useCanvasActions } from '@/hooks/canvas/useCanvasActions';
import type { ActiveTool } from '@/lib/store';
import type { DriplElement } from '@dripl/common';

function rect(id: string, x: number, y: number, width: number, height: number): DriplElement {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    width,
    height,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 0,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
  } as DriplElement;
}

function seed(elements: DriplElement[] = []) {
  useCanvasStore.setState({
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    activeTool: 'select',
    toolLocked: false,
    readOnly: false,
    textInput: null,
    currentStrokeColor: '#000000',
    past: [],
    future: [],
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
  });
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
}

/** The hook closes over `elements` from its props, so callers pass the live array. */
function setup(elements: DriplElement[] = useCanvasStore.getState().elements) {
  return renderHook(() => useCanvasActions({ elements }));
}

describe('useCanvasActions.maybeRevertToSelectTool', () => {
  beforeEach(() => {
    seed();
  });

  it('returns to the select tool after a one-shot tool finishes', () => {
    act(() => useCanvasStore.getState().setActiveTool('rectangle'));
    const { result } = setup();

    act(() => {
      result.current.maybeRevertToSelectTool('rectangle');
    });
    expect(useCanvasStore.getState().activeTool).toBe('select');
  });

  it('keeps a locked tool selected', () => {
    act(() => {
      useCanvasStore.setState({ activeTool: 'ellipse', toolLocked: true });
    });
    const { result } = setup();

    act(() => {
      result.current.maybeRevertToSelectTool('ellipse');
    });
    expect(useCanvasStore.getState().activeTool).toBe('ellipse');
  });

  it('keeps the laser active, which has no select fallback', () => {
    act(() => useCanvasStore.getState().setActiveTool('laser'));
    const { result } = setup();

    act(() => {
      result.current.maybeRevertToSelectTool('laser');
    });
    expect(useCanvasStore.getState().activeTool).toBe('laser');
  });
});

describe('useCanvasActions.collectCascadeDeleteIdsCallback', () => {
  beforeEach(() => {
    seed();
  });

  it('pulls in a bound label when its arrow is deleted', () => {
    const arrow = {
      id: 'arrow-1',
      type: 'arrow',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      labelId: 'label-1',
    } as unknown as DriplElement;
    const label = {
      id: 'label-1',
      type: 'text',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      text: 'label',
    } as unknown as DriplElement;
    seed([arrow, label]);
    const { result } = setup();

    expect(result.current.collectCascadeDeleteIdsCallback(['arrow-1']).sort()).toEqual([
      'arrow-1',
      'label-1',
    ]);
    expect(result.current.collectCascadeDeleteIdsCallback([])).toEqual([]);
  });
});

describe('useCanvasActions.applyFrameGrouping', () => {
  beforeEach(() => {
    seed();
  });

  it('groups only the elements fully contained by the frame', () => {
    const frame = { ...rect('frame', 0, 0, 400, 400), type: 'frame' } as DriplElement;
    const inside = rect('inside', 50, 50, 100, 100);
    const straddling = rect('straddling', 350, 50, 200, 100);
    const outside = rect('outside', 900, 900, 50, 50);
    seed([frame, inside, straddling, outside]);
    const { result } = setup();

    act(() => {
      result.current.applyFrameGrouping(frame);
    });

    const elements = useCanvasStore.getState().elements;
    const groupOf = (id: string) => elements.find(el => el.id === id)?.groupId;
    expect(groupOf('frame')).toBe('frame-frame');
    expect(groupOf('inside')).toBe('frame-frame');
    expect(groupOf('straddling')).toBeUndefined();
    expect(groupOf('outside')).toBeUndefined();
    expect(Array.from(useCanvasStore.getState().selectedIds).sort()).toEqual(['frame', 'inside']);
  });

  it('leaves the scene untouched when the frame contains nothing', () => {
    const frame = { ...rect('frame', 0, 0, 50, 50), type: 'frame' } as DriplElement;
    const far = rect('far', 500, 500, 10, 10);
    seed([frame, far]);
    const before = useCanvasStore.getState().elements;
    const { result } = setup();

    act(() => {
      result.current.applyFrameGrouping(frame);
    });

    // Same array identity: no store write happened at all.
    expect(useCanvasStore.getState().elements).toBe(before);
    expect(useCanvasStore.getState().selectedIds.size).toBe(0);
  });

  it('ignores a non-frame element', () => {
    const notAFrame = rect('rect', 0, 0, 400, 400);
    const other = rect('other', 10, 10, 10, 10);
    seed([notAFrame, other]);
    const before = useCanvasStore.getState().elements;
    const { result } = setup();

    act(() => {
      result.current.applyFrameGrouping(notAFrame);
    });
    expect(useCanvasStore.getState().elements).toBe(before);
    expect(useCanvasStore.getState().selectedIds.size).toBe(0);
  });

  it('does not group while the canvas is read-only', () => {
    const frame = { ...rect('frame', 0, 0, 400, 400), type: 'frame' } as DriplElement;
    seed([frame, rect('inner', 10, 10, 10, 10)]);
    useCanvasStore.setState({ readOnly: true });
    const before = useCanvasStore.getState().elements;
    const { result } = setup();

    act(() => {
      result.current.applyFrameGrouping(frame);
    });

    expect(useCanvasStore.getState().elements).toBe(before);
    expect(useCanvasStore.getState().elements.every(el => !el.groupId)).toBe(true);
    expect(useCanvasStore.getState().selectedIds.size).toBe(0);
  });
});

describe('useCanvasActions.handleTextSubmit', () => {
  beforeEach(() => {
    seed();
  });

  it('creates a text element sized from the submitted content', () => {
    act(() => {
      useCanvasStore.getState().setActiveTool('text');
      useCanvasStore.getState().setTextInput({ x: 30, y: 40, id: 'text-1', value: '' });
    });
    const { result } = setup();

    act(() => {
      result.current.handleTextSubmit('hello');
    });

    const created = useCanvasStore.getState().elements[0]!;
    // 5 chars × (20 × 0.55 = 11) = 55, above the 40px floor.
    expect(created).toMatchObject({
      id: 'text-1',
      type: 'text',
      x: 30,
      y: 40,
      width: 55,
      // One line × (20 × 1.25 = 25).
      height: 25,
      text: 'hello',
      fontSize: 20,
    });
    expect(useCanvasStore.getState().textInput).toBeNull();
    expect(useCanvasStore.getState().activeTool).toBe('select');
  });

  it('grows with the widest line and the line count', () => {
    act(() => {
      useCanvasStore.getState().setTextInput({ x: 0, y: 0, id: 'text-1', value: '' });
    });
    const { result } = setup();

    act(() => {
      result.current.handleTextSubmit('a\nabcdefghij\nbb');
    });

    const created = useCanvasStore.getState().elements[0]!;
    // Widest line is 10 chars × 11 = 110.
    expect(created.width).toBe(110);
    // 3 lines × 25.
    expect(created.height).toBe(75);
  });

  it('honours a 40px minimum width for a single character', () => {
    act(() => {
      useCanvasStore.getState().setTextInput({ x: 0, y: 0, id: 'text-1', value: '' });
    });
    const { result } = setup();

    act(() => {
      result.current.handleTextSubmit('x');
    });
    expect(useCanvasStore.getState().elements[0]!.width).toBe(40);
  });

  it('updates an existing element in place and keeps its typography', () => {
    const existing = {
      ...rect('text-1', 100, 200, 60, 24),
      type: 'text',
      text: 'old',
      fontSize: 48,
      fontFamily: 'Inter',
    } as unknown as DriplElement;
    seed([existing]);
    act(() => {
      useCanvasStore.getState().setTextInput({
        x: 0,
        y: 0,
        id: 'ignored',
        existingElementId: 'text-1',
        value: 'old',
      });
    });
    const { result } = setup();

    act(() => {
      result.current.handleTextSubmit('new text');
    });

    const elements = useCanvasStore.getState().elements;
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({
      id: 'text-1',
      text: 'new text',
      x: 100,
      y: 200,
      // Measurement uses the element's own font size: 8 chars × (48 × 0.55).
      width: 8 * 48 * 0.55,
      height: 48 * 1.25,
      fontSize: 48,
      fontFamily: 'Inter',
    });
    expect(useCanvasStore.getState().textInput).toBeNull();
  });

  it('discards whitespace-only text and reverts the tool', () => {
    act(() => {
      useCanvasStore.getState().setActiveTool('text');
      useCanvasStore.getState().setTextInput({ x: 0, y: 0, id: 'text-1', value: '' });
    });
    const { result } = setup();

    act(() => {
      result.current.handleTextSubmit('   \n  ');
    });

    expect(useCanvasStore.getState().elements).toHaveLength(0);
    expect(useCanvasStore.getState().textInput).toBeNull();
    expect(useCanvasStore.getState().activeTool).toBe('select');
  });

  it('keeps the tool when it is locked', () => {
    act(() => {
      useCanvasStore.setState({
        activeTool: 'text' as ActiveTool,
        toolLocked: true,
        textInput: { x: 0, y: 0, id: 'text-1', value: '' },
      });
    });
    const { result } = setup();

    act(() => {
      result.current.handleTextSubmit('   ');
    });
    expect(useCanvasStore.getState().activeTool).toBe('text');
  });

  it('only closes the editor while read-only, creating nothing', () => {
    act(() => {
      useCanvasStore.setState({
        readOnly: true,
        activeTool: 'text',
        textInput: { x: 0, y: 0, id: 'text-1', value: '' },
      });
    });
    const { result } = setup();

    act(() => {
      result.current.handleTextSubmit('hello');
    });

    expect(useCanvasStore.getState().elements).toHaveLength(0);
    expect(useCanvasStore.getState().textInput).toBeNull();
    // read-only returns before the reversion branch, so the tool is unchanged.
    expect(useCanvasStore.getState().activeTool).toBe('text');
  });

  it('does nothing without an open editor', () => {
    const { result } = setup();
    act(() => {
      result.current.handleTextSubmit('hello');
    });
    expect(useCanvasStore.getState().elements).toHaveLength(0);
    expect(useCanvasStore.getState().activeTool).toBe('select');
  });

  it('leaves a non-text tool selected when text is committed', () => {
    act(() => {
      useCanvasStore.getState().setActiveTool('select');
      useCanvasStore.getState().setTextInput({ x: 0, y: 0, id: 'text-1', value: '' });
    });
    const { result } = setup();

    act(() => {
      result.current.handleTextSubmit('hello');
    });
    expect(useCanvasStore.getState().activeTool).toBe('select');
    expect(useCanvasStore.getState().elements).toHaveLength(1);
  });
});
