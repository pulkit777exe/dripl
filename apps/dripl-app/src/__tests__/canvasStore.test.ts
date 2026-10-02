import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import type { DriplElement } from '@dripl/common';

function element(id: string, x: number, width = 100): DriplElement {
  return {
    id,
    type: 'rectangle',
    x,
    y: 40,
    width,
    height: 60,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
  };
}

describe('canvas arrangement actions', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      elements: [],
      elementsById: new Map(),
      selectedIds: new Set(),
      past: [],
      future: [],
      spatialVersion: 0,
      spatialChangedIds: [],
      spatialChangedIdsVersion: 0,
    });
  });

  it('batches transient updates into one array and spatial revision', () => {
    useCanvasStore
      .getState()
      .setElements([element('a', 0), element('b', 200)], { skipHistory: true });
    const before = useCanvasStore.getState();
    const beforeArray = before.elements;
    const beforeVersion = before.spatialVersion;

    before.updateElementsTransient(
      new Map([
        ['a', { x: 25 }],
        ['b', { x: 225 }],
      ])
    );

    const after = useCanvasStore.getState();
    expect(after.elements).not.toBe(beforeArray);
    expect(after.elements.map(item => item.x)).toEqual([25, 225]);
    expect(after.elementsById.get('a')?.version).toBe(2);
    expect(after.elementsById.get('b')?.version).toBe(2);
    expect(after.spatialVersion).toBe(beforeVersion + 1);
  });

  it('bumps the element version on a transient update that only changes points', () => {
    // The spatial index re-keys a changed element on `version`, because
    // `getElementBounds` also depends on `points` and `strokeWidth`. A polyline
    // can therefore change shape while keeping identical x/y/width/height, and
    // the index must still re-key it. If the version did not move, the RBush
    // entry would keep stale bounds and the element could be culled away while
    // still on screen.
    const line = {
      ...element('l', 0),
      type: 'line' as const,
      width: 100,
      height: 100,
      points: [
        { x: 0, y: 0, pressure: 1 },
        { x: 100, y: 100, pressure: 1 },
      ],
    };
    useCanvasStore.getState().setElements([line], { skipHistory: true });
    const before = useCanvasStore.getState().elementsById.get('l')!;

    useCanvasStore.getState().updateElementsTransient(
      new Map([
        [
          'l',
          {
            points: [
              { x: 0, y: 0, pressure: 1 },
              { x: 100, y: 20, pressure: 1 },
            ],
          } as never,
        ],
      ])
    );

    const after = useCanvasStore.getState().elementsById.get('l')!;
    // Geometry fields are unchanged on purpose; only the version proves the
    // index was told to re-key.
    expect(after.x).toBe(before.x);
    expect(after.width).toBe(before.width);
    expect(after.version ?? 0).toBeGreaterThan(before.version ?? 0);
  });

  it('merges hints across consecutive transient updates', () => {
    useCanvasStore
      .getState()
      .setElements([element('a', 0), element('b', 200)], { skipHistory: true });
    useCanvasStore.getState().updateElementTransient('a', { x: 10 });
    useCanvasStore.getState().updateElementTransient('b', { x: 210 });

    const state = useCanvasStore.getState();
    expect(state.spatialChangedIds).toEqual(['a', 'b']);
    expect(state.spatialChangedIdsVersion).toBe(state.spatialVersion);
  });

  it('aligns multiple elements to their shared bounds in one history entry', () => {
    useCanvasStore
      .getState()
      .setElements([element('a', 0), element('b', 220, 60)], { skipHistory: true });
    useCanvasStore.getState().clearHistory();
    useCanvasStore.getState().setSelectedIds(new Set(['a', 'b']));
    useCanvasStore.getState().alignElements('left');

    const state = useCanvasStore.getState();
    expect(state.elements.find(item => item.id === 'a')?.x).toBe(0);
    expect(state.elements.find(item => item.id === 'b')?.x).toBe(0);
    expect(state.past).toHaveLength(1);
    expect(state.elements.find(item => item.id === 'a')?.version).toBe(1);
    expect(state.elements.find(item => item.id === 'b')?.version).toBe(2);
  });

  it('distributes three elements with equal gaps', () => {
    useCanvasStore
      .getState()
      .setElements([element('a', 0, 20), element('b', 100, 20), element('c', 300, 20)], {
        skipHistory: true,
      });
    useCanvasStore.getState().clearHistory();
    useCanvasStore.getState().setSelectedIds(new Set(['a', 'b', 'c']));
    useCanvasStore.getState().distributeElements('horizontal');

    const positions = useCanvasStore
      .getState()
      .elements.map(item => item.x)
      .sort((a, b) => a - b);
    expect(positions).toEqual([0, 150, 300]);
  });
});
