import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import { useCanvasKeyboard } from '@/hooks/canvas/useCanvasKeyboard';
import type { InteractionState } from '@/hooks/canvas/useCanvasPointerEvents';
import type { ActiveTool } from '@/lib/store';
import type { DriplElement } from '@dripl/common';

function rect(id: string, x = 0, y = 0, extra: Partial<DriplElement> = {}): DriplElement {
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
    ...extra,
  } as DriplElement;
}

function seed(elements: DriplElement[] = [], selectedIds: string[] = []) {
  useCanvasStore.setState({
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    elementLocks: new Map(),
    userId: 'me',
    readOnly: false,
    activeTool: 'select',
    toolLocked: false,
    zoom: 1,
    panX: 0,
    panY: 0,
    gridEnabled: false,
    textInput: null,
    isDrawing: false,
    isDragging: false,
    draftElement: null,
    marqueeSelection: null,
    past: [],
    future: [],
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
  });
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
  useCanvasStore.getState().setSelectedIds(new Set(selectedIds));
}

function blankInteraction() {
  return { current: { isSpacePressed: false } as InteractionState };
}

interface HookProps {
  readOnly: boolean;
  activeTool: ActiveTool;
}

function setup(
  options: { readOnly?: boolean; activeTool?: ActiveTool; cascade?: 'spy' | 'store' } = {}
) {
  const spies = {
    setTextInput: vi.fn(),
    setDrawingState: vi.fn(),
    cancelDrawing: vi.fn(),
    collectCascadeDeleteIds:
      options.cascade === 'store'
        ? vi.fn((ids: Iterable<string>) => useCanvasStore.getState().collectCascadeDeleteIds(ids))
        : vi.fn((ids: Set<string>) => [...ids]),
    copySelectedToClipboard: vi.fn(async () => undefined),
    pasteFromClipboard: vi.fn(async () => undefined),
    duplicateSelection: vi.fn(),
    findOnCanvas: vi.fn(() => 1),
    fitAllToScreen: vi.fn(),
    copyElementStyle: vi.fn(() => true),
    pasteElementStyle: vi.fn(() => true),
  };
  const interactionRef = blankInteraction();
  const lastToolBeforeSpaceRef = { current: null as string | null };

  const hook = renderHook(
    (props: HookProps) =>
      useCanvasKeyboard({
        interactionRef,
        lastToolBeforeSpaceRef,
        activeTool: props.activeTool,
        readOnly: props.readOnly,
        ...spies,
      }),
    {
      initialProps: {
        readOnly: options.readOnly ?? false,
        activeTool: options.activeTool ?? 'select',
      },
    }
  );

  return { ...hook, interactionRef, lastToolBeforeSpaceRef, spies };
}

/**
 * Real key events land on the focused element and bubble to window, which is
 * what the hook's focus guards inspect. Dispatching straight on window would
 * make `event.target` the window and silently bypass every guard.
 */
function dispatch(
  target: EventTarget,
  type: 'keydown' | 'keyup',
  key: string,
  init: KeyboardEventInit = {}
) {
  const event = new KeyboardEvent(type, {
    key,
    bubbles: true,
    cancelable: true,
    code: key === ' ' ? 'Space' : `Key${key.toUpperCase()}`,
    ...init,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const keyTarget = () => (document.activeElement ?? document.body) as HTMLElement;

function keyDown(key: string, init: KeyboardEventInit = {}) {
  return dispatch(keyTarget(), 'keydown', key, init);
}

function keyUp(key: string, init: KeyboardEventInit = {}) {
  return dispatch(keyTarget(), 'keyup', key, init);
}

function focus(target: HTMLElement) {
  // Only attach when the caller has not already placed it — re-appending would
  // detach it from the dialog or container the test is exercising.
  if (!target.isConnected) document.body.appendChild(target);
  act(() => {
    target.focus();
  });
  expect(document.activeElement).toBe(target);
  return target;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('useCanvasKeyboard tool switching', () => {
  beforeEach(() => {
    seed();
  });

  it('maps letter and numeric shortcuts to tools', () => {
    setup();

    keyDown('r');
    expect(useCanvasStore.getState().activeTool).toBe('rectangle');

    keyDown('2');
    expect(useCanvasStore.getState().activeTool).toBe('rectangle');

    keyDown('9');
    expect(useCanvasStore.getState().activeTool).toBe('image');

    keyDown('h');
    expect(useCanvasStore.getState().activeTool).toBe('hand');
  });

  it('does not preventDefault on a letter shortcut so browser shortcuts survive', () => {
    setup();
    expect(keyDown('r').defaultPrevented).toBe(false);
    // Numeric shortcuts do preventDefault — they would otherwise type.
    expect(keyDown('2').defaultPrevented).toBe(true);
  });
});

describe('useCanvasKeyboard temporary hand tool', () => {
  beforeEach(() => {
    seed();
  });

  it('switches to hand on space-down and restores the prior tool on key-up', () => {
    const { rerender, interactionRef, lastToolBeforeSpaceRef } = setup({
      activeTool: 'rectangle',
    });

    keyDown(' ', { code: 'Space' });
    expect(interactionRef.current.isSpacePressed).toBe(true);
    expect(useCanvasStore.getState().activeTool).toBe('hand');
    expect(lastToolBeforeSpaceRef.current).toBe('rectangle');

    // The hook reads activeTool from props, so the real component re-renders
    // and passes 'hand' back in before the key-up arrives.
    act(() => {
      rerender({ readOnly: false, activeTool: 'hand' });
    });
    keyUp(' ', { code: 'Space' });

    expect(interactionRef.current.isSpacePressed).toBe(false);
    expect(useCanvasStore.getState().activeTool).toBe('rectangle');
  });

  it('leaves the hand tool alone when it was already active before space', () => {
    const { rerender, lastToolBeforeSpaceRef } = setup({ activeTool: 'hand' });
    useCanvasStore.getState().setActiveTool('hand');

    keyDown(' ', { code: 'Space' });
    expect(lastToolBeforeSpaceRef.current).toBeNull();

    act(() => {
      rerender({ readOnly: false, activeTool: 'hand' });
    });
    keyUp(' ', { code: 'Space' });

    expect(useCanvasStore.getState().activeTool).toBe('hand');
  });

  it('does not record the hand tool as its own restore target', () => {
    const { rerender } = setup({ activeTool: 'select' });
    keyDown(' ', { code: 'Space' });
    act(() => {
      rerender({ readOnly: false, activeTool: 'hand' });
    });
    keyUp(' ', { code: 'Space' });
    expect(useCanvasStore.getState().activeTool).toBe('select');
  });
});

describe('useCanvasKeyboard focus guards', () => {
  beforeEach(() => {
    seed();
  });

  it('ignores shortcuts while a text field has focus', () => {
    setup();
    const input = focus(document.createElement('input'));
    keyDown('r');
    expect(useCanvasStore.getState().activeTool).toBe('select');

    const textarea = focus(document.createElement('textarea'));
    keyDown('r');
    expect(useCanvasStore.getState().activeTool).toBe('select');

    input.blur();
    textarea.blur();
  });

  it('ignores shortcuts anywhere inside a dialog, even on a bare container', () => {
    setup();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const inner = document.createElement('div');
    inner.tabIndex = -1;
    dialog.appendChild(inner);
    document.body.appendChild(dialog);
    focus(inner);

    keyDown('r');
    expect(useCanvasStore.getState().activeTool).toBe('select');
  });

  it('ignores shortcuts on an interactive control but still honours Escape', () => {
    const { spies } = setup();
    useCanvasStore.setState({ selectedIds: new Set(['a']) });
    const button = focus(document.createElement('button'));

    keyDown('r');
    expect(useCanvasStore.getState().activeTool).toBe('select');
    expect(useCanvasStore.getState().selectedIds.size).toBe(1);

    keyDown('Escape');
    expect(useCanvasStore.getState().selectedIds.size).toBe(0);
    expect(spies.setTextInput).toHaveBeenCalledWith(null);
    expect(spies.setDrawingState).toHaveBeenCalledWith(false);
    button.blur();
  });

  it('ignores shortcuts from a contenteditable region', () => {
    setup();
    const editable = document.createElement('div');
    editable.tabIndex = 0;
    // jsdom leaves `isContentEditable` undefined, so supply what a browser
    // would report for a rich-text surface.
    Object.defineProperty(editable, 'isContentEditable', { configurable: true, value: true });
    focus(editable);

    keyDown('r');
    expect(useCanvasStore.getState().activeTool).toBe('select');
  });
});

describe('useCanvasKeyboard editing commands', () => {
  beforeEach(() => {
    seed();
  });

  it('escape clears the selection, the text editor, and the drawing gesture', () => {
    const { spies } = setup();
    useCanvasStore.setState({ selectedIds: new Set(['a']) });

    keyDown('Escape');

    expect(useCanvasStore.getState().selectedIds.size).toBe(0);
    expect(spies.setTextInput).toHaveBeenCalledWith(null);
    expect(spies.cancelDrawing).toHaveBeenCalledTimes(1);
    expect(spies.setDrawingState).toHaveBeenCalledWith(false);
    // Escape must not swallow the browser's own dismiss affordances.
  });

  it('delete hands the live selection to the cascade resolver and clears it', () => {
    seed([rect('a'), rect('b', 300)], ['a', 'b']);
    const { spies } = setup();

    keyDown('Delete');

    expect(spies.collectCascadeDeleteIds).toHaveBeenCalledTimes(1);
    expect([...spies.collectCascadeDeleteIds.mock.calls[0]![0]].sort()).toEqual(['a', 'b']);
    expect(useCanvasStore.getState().selectedIds.size).toBe(0);
  });

  it('delete removes an arrow together with its bound label', () => {
    // The injected resolver mirrors the store's own cascade semantics; assert
    // the end-to-end effect on the store rather than on the spy.
    const arrow = {
      id: 'arrow-1',
      type: 'arrow',
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 20 },
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
    seed([arrow, label], ['arrow-1']);
    setup({ cascade: 'store' });

    keyDown('Delete');

    const ids = useCanvasStore.getState().elements.map(el => el.id);
    expect(ids).not.toContain('arrow-1');
    expect(ids).not.toContain('label-1');
    expect(useCanvasStore.getState().selectedIds.size).toBe(0);
  });

  it('does nothing on delete without a selection', () => {
    seed([rect('a')], []);
    const { spies } = setup();

    expect(keyDown('Backspace').defaultPrevented).toBe(false);
    expect(spies.collectCascadeDeleteIds).not.toHaveBeenCalled();
  });

  it('does nothing on delete while read-only', () => {
    seed([rect('a')], ['a']);
    const { spies } = setup({ readOnly: true });

    expect(keyDown('Delete').defaultPrevented).toBe(false);
    expect(spies.collectCascadeDeleteIds).not.toHaveBeenCalled();
  });
});

describe('useCanvasKeyboard nudge', () => {
  beforeEach(() => {
    seed();
  });

  it('moves the selection by one pixel, or ten with shift', () => {
    seed([rect('a', 100, 100)], ['a']);
    setup();

    keyDown('ArrowRight', { code: 'ArrowRight' });
    expect(useCanvasStore.getState().elementsById.get('a')).toMatchObject({ x: 101, y: 100 });

    keyDown('ArrowDown', { code: 'ArrowDown', shiftKey: true });
    expect(useCanvasStore.getState().elementsById.get('a')).toMatchObject({ x: 101, y: 110 });
  });

  it('moves left and up by the same amount', () => {
    seed([rect('a', 100, 100)], ['a']);
    setup();

    keyDown('ArrowLeft', { code: 'ArrowLeft' });
    keyDown('ArrowUp', { code: 'ArrowUp' });
    expect(useCanvasStore.getState().elementsById.get('a')).toMatchObject({ x: 99, y: 99 });
  });

  it('ignores arrows with no selection', () => {
    seed([rect('a', 100, 100)], []);
    setup();

    expect(keyDown('ArrowRight', { code: 'ArrowRight' }).defaultPrevented).toBe(false);
    expect(useCanvasStore.getState().elementsById.get('a')?.x).toBe(100);
  });

  it('nests one history entry per key press, so undo steps back one nudge', () => {
    seed([rect('a', 100, 100)], ['a']);
    setup();
    const before = useCanvasStore.getState().past.length;

    keyDown('ArrowRight', { code: 'ArrowRight' });
    keyDown('ArrowRight', { code: 'ArrowRight' });
    expect(useCanvasStore.getState().past.length).toBe(before + 2);
    expect(useCanvasStore.getState().elementsById.get('a')?.x).toBe(102);

    act(() => {
      useCanvasStore.getState().undo();
    });
    expect(useCanvasStore.getState().elementsById.get('a')?.x).toBe(101);
  });
});

describe('useCanvasKeyboard viewport commands', () => {
  beforeEach(() => {
    seed();
  });

  it('steps zoom within the configured limits', () => {
    setup();
    useCanvasStore.setState({ zoom: 20 });
    keyDown('+');
    expect(useCanvasStore.getState().zoom).toBe(20);

    useCanvasStore.setState({ zoom: 0.1 });
    keyDown('-');
    expect(useCanvasStore.getState().zoom).toBe(0.1);
  });

  it('resets the viewport with the shifted-H shortcut', () => {
    setup();
    useCanvasStore.setState({ zoom: 4, panX: 120, panY: -30 });

    keyDown('H', { ctrlKey: true, shiftKey: true });
    expect(useCanvasStore.getState()).toMatchObject({ zoom: 1, panX: 0, panY: 0 });
  });

  it('fits to screen on cmd+shift+F without opening find', () => {
    const { spies } = setup();

    keyDown('F', { ctrlKey: true, shiftKey: true });
    expect(spies.fitAllToScreen).toHaveBeenCalledTimes(1);
    expect(spies.findOnCanvas).not.toHaveBeenCalled();
  });

  it('selects everything on cmd+A and toggles the grid on cmd+alt+G', () => {
    seed([rect('a'), rect('b', 300)], []);
    setup();

    keyDown('a', { ctrlKey: true });
    expect(useCanvasStore.getState().selectedIds.size).toBe(2);

    expect(useCanvasStore.getState().gridEnabled).toBe(false);
    keyDown('g', { ctrlKey: true, altKey: true });
    expect(useCanvasStore.getState().gridEnabled).toBe(true);
    keyDown('g', { ctrlKey: true, altKey: true });
    expect(useCanvasStore.getState().gridEnabled).toBe(false);
  });
});

describe('useCanvasKeyboard clipboard and style commands', () => {
  beforeEach(() => {
    seed();
  });

  it('routes copy, paste, duplicate, copy-style and paste-style to their callbacks', () => {
    const { spies } = setup();

    keyDown('c', { ctrlKey: true });
    expect(spies.copySelectedToClipboard).toHaveBeenCalledTimes(1);

    keyDown('v', { ctrlKey: true });
    expect(spies.pasteFromClipboard).toHaveBeenCalledTimes(1);

    keyDown('d', { ctrlKey: true });
    expect(spies.duplicateSelection).toHaveBeenCalledTimes(1);

    keyDown('c', { ctrlKey: true, shiftKey: true });
    expect(spies.copyElementStyle).toHaveBeenCalledTimes(1);
    expect(spies.copySelectedToClipboard).toHaveBeenCalledTimes(1);

    keyDown('v', { ctrlKey: true, shiftKey: true });
    expect(spies.pasteElementStyle).toHaveBeenCalledTimes(1);
    expect(spies.pasteFromClipboard).toHaveBeenCalledTimes(1);
  });

  it('refuses mutating clipboard and history commands while read-only', () => {
    const { spies } = setup({ readOnly: true });

    keyDown('v', { ctrlKey: true });
    keyDown('d', { ctrlKey: true });
    keyDown('v', { ctrlKey: true, shiftKey: true });
    keyDown('z', { ctrlKey: true });
    keyDown('z', { ctrlKey: true, shiftKey: true });

    expect(spies.pasteFromClipboard).not.toHaveBeenCalled();
    expect(spies.duplicateSelection).not.toHaveBeenCalled();
    expect(spies.pasteElementStyle).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().past).toHaveLength(0);
  });

  it('prompts for find and reports no matches', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('');
    const { spies } = setup();

    keyDown('f', { ctrlKey: true });
    expect(promptSpy).toHaveBeenCalledWith('Find on canvas', '');
    expect(spies.findOnCanvas).not.toHaveBeenCalled();

    promptSpy.mockReturnValue('   ');
    keyDown('f', { ctrlKey: true });
    expect(spies.findOnCanvas).not.toHaveBeenCalled();

    promptSpy.mockReturnValue('needle');
    spies.findOnCanvas.mockReturnValue(0);
    keyDown('f', { ctrlKey: true });
    expect(spies.findOnCanvas).toHaveBeenCalledWith('needle');
    expect(alertSpy).toHaveBeenCalledWith('No matching elements found on canvas.');
  });
});

describe('useCanvasKeyboard grouping and z-order', () => {
  beforeEach(() => {
    seed();
  });

  it('groups on cmd+G and ungroups on cmd+shift+G', () => {
    seed([rect('a'), rect('b', 300)], ['a', 'b']);
    setup();

    keyDown('g', { ctrlKey: true });
    const grouped = useCanvasStore.getState().elements;
    expect(new Set(grouped.map(el => el.groupId)).size).toBe(1);
    expect(grouped[0]?.groupId).toBeTruthy();

    keyDown('g', { ctrlKey: true, shiftKey: true });
    expect(useCanvasStore.getState().elements.every(el => !el.groupId)).toBe(true);
  });

  it('reorders with the bracket shortcuts', () => {
    seed([rect('a'), rect('b'), rect('c')], ['a']);
    setup();
    const idsBefore = useCanvasStore.getState().elements.map(el => el.id);

    keyDown(']', { code: 'BracketRight' });
    const idsAfter = useCanvasStore.getState().elements.map(el => el.id);
    expect(idsAfter).not.toEqual(idsBefore);
    expect([...idsAfter].sort()).toEqual([...idsBefore].sort());

    keyDown('[', { code: 'BracketLeft' });
    expect(useCanvasStore.getState().elements.map(el => el.id)).toEqual(idsBefore);
  });
});

describe('useCanvasKeyboard listener lifecycle', () => {
  beforeEach(() => {
    seed();
  });

  it('stops handling keys after unmount', () => {
    const { unmount } = setup();
    unmount();

    keyDown('r');
    expect(useCanvasStore.getState().activeTool).toBe('select');
  });

  it('removes the keyup listener too, so a released space cannot restore a stale tool', () => {
    const { rerender, unmount, lastToolBeforeSpaceRef } = setup({ activeTool: 'rectangle' });
    keyDown(' ', { code: 'Space' });
    expect(lastToolBeforeSpaceRef.current).toBe('rectangle');

    unmount();
    // Simulate the store having been switched to hand while the hook was gone.
    useCanvasStore.getState().setActiveTool('hand');
    keyUp(' ', { code: 'Space' });
    expect(rerender).toBeDefined();

    // With no listener the hand tool is never swapped back out.
    expect(useCanvasStore.getState().activeTool).toBe('hand');
  });
});
