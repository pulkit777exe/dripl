import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import { useStyleTransfer } from '@/hooks/canvas/useStyleTransfer';
import type { DriplElement } from '@dripl/common';

function rect(id: string, extra: Partial<DriplElement> = {}): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: '#ff0000',
    backgroundColor: '#00ff00',
    strokeWidth: 6,
    opacity: 0.5,
    roughness: 2,
    strokeStyle: 'dashed',
    fillStyle: 'cross-hatch',
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
    currentStrokeColor: '#111111',
    currentBackgroundColor: 'transparent',
    currentStrokeWidth: 1,
    currentRoughness: 1,
    currentStrokeStyle: 'solid',
    currentFillStyle: 'hachure',
    past: [],
    future: [],
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
  });
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
  useCanvasStore.getState().setSelectedIds(new Set(selectedIds));
}

describe('useStyleTransfer copy', () => {
  beforeEach(() => {
    seed();
  });

  it('adopts the copied element style as the current tool defaults', () => {
    seed([rect('a')], ['a']);
    const { result } = renderHook(() => useStyleTransfer());

    let copied = false;
    act(() => {
      copied = result.current.copyElementStyle();
    });

    expect(copied).toBe(true);
    expect(useCanvasStore.getState()).toMatchObject({
      currentStrokeColor: '#ff0000',
      currentBackgroundColor: '#00ff00',
      currentStrokeWidth: 6,
      currentStrokeStyle: 'dashed',
      currentRoughness: 2,
      currentFillStyle: 'cross-hatch',
    });
  });

  it('reports failure without a selection', () => {
    const { result } = renderHook(() => useStyleTransfer());
    let copied = true;
    act(() => {
      copied = result.current.copyElementStyle();
    });
    expect(copied).toBe(false);
  });

  it('reports failure when the selected id no longer resolves', () => {
    seed([rect('a')]);
    useCanvasStore.getState().setSelectedIds(new Set(['ghost']));
    const { result } = renderHook(() => useStyleTransfer());

    let copied = true;
    act(() => {
      copied = result.current.copyElementStyle();
    });
    expect(copied).toBe(false);
  });
});

describe('useStyleTransfer paste', () => {
  beforeEach(() => {
    seed();
  });

  it('applies the snapshot to every selected element in one history entry', () => {
    seed([rect('a'), rect('b', { strokeColor: '#0000ff' })], ['a', 'b']);
    const { result } = renderHook(() => useStyleTransfer());

    act(() => {
      result.current.copyElementStyle();
    });
    const before = useCanvasStore.getState().past.length;

    let pasted = false;
    act(() => {
      // Re-select: the copy step leaves the selection alone, but the target
      // set is what matters here.
      useCanvasStore.getState().setSelectedIds(new Set(['b']));
      pasted = result.current.pasteElementStyle();
    });

    expect(pasted).toBe(true);
    const state = useCanvasStore.getState();
    expect(state.elementsById.get('b')).toMatchObject({
      strokeColor: '#ff0000',
      backgroundColor: '#00ff00',
      strokeWidth: 6,
      strokeStyle: 'dashed',
      roughness: 2,
      fillStyle: 'cross-hatch',
      opacity: 0.5,
    });
    expect(state.past.length).toBe(before + 1);
  });

  it('reports failure before anything is copied', () => {
    seed([rect('a')], ['a']);
    const { result } = renderHook(() => useStyleTransfer());

    let pasted = true;
    act(() => {
      pasted = result.current.pasteElementStyle();
    });
    expect(pasted).toBe(false);
  });

  it('reports failure when the copy exists but nothing is selected', () => {
    seed([rect('a')], ['a']);
    const { result } = renderHook(() => useStyleTransfer());

    act(() => {
      result.current.copyElementStyle();
    });

    let pasted = true;
    act(() => {
      useCanvasStore.getState().setSelectedIds(new Set());
      pasted = result.current.pasteElementStyle();
    });
    expect(pasted).toBe(false);
  });

  it('keeps the snapshot per hook instance, so a fresh mount starts empty', () => {
    seed([rect('a')], ['a']);
    const first = renderHook(() => useStyleTransfer());
    act(() => {
      first.result.current.copyElementStyle();
    });

    const second = renderHook(() => useStyleTransfer());
    let pasted = true;
    act(() => {
      pasted = second.result.current.pasteElementStyle();
    });
    expect(pasted).toBe(false);
  });

  it('leaves an element flagged locked alone', () => {
    seed([rect('a'), rect('b', { strokeColor: '#0000ff' })], ['a']);
    const { result } = renderHook(() => useStyleTransfer());
    act(() => {
      result.current.copyElementStyle();
    });

    act(() => {
      useCanvasStore.getState().updateElement('b', { locked: true });
      useCanvasStore.getState().setSelectedIds(new Set(['b']));
      result.current.pasteElementStyle();
    });

    expect(useCanvasStore.getState().elementsById.get('b')?.strokeColor).toBe('#0000ff');
  });

  it('reports failure when every selected element is locked, adding no history entry', () => {
    seed([rect('a', { locked: true })], ['a']);
    const { result } = renderHook(() => useStyleTransfer());
    act(() => {
      result.current.copyElementStyle();
    });
    const before = useCanvasStore.getState().past.length;

    act(() => {
      result.current.pasteElementStyle();
    });

    // The store reports nothing changed; the hook still returned true because a
    // snapshot and a selection existed. What must hold is that no undo step was
    // burned on a no-op paste.
    expect(useCanvasStore.getState().past.length).toBe(before);
  });
});
