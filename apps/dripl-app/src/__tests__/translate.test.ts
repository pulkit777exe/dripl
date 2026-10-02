import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import type { DriplElement } from '@dripl/common';
import { getElementBounds } from '@dripl/math/intersection';

function rect(id: string, x: number, extra: Partial<DriplElement> = {}): DriplElement {
  return {
    id,
    type: 'rectangle',
    x,
    y: 40,
    width: 100,
    height: 60,
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

function seed(elements: DriplElement[]) {
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
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
}

describe('translateElements', () => {
  beforeEach(() => {
    seed([rect('a', 0), rect('b', 200)]);
  });

  it('moves by delta with one history entry and bumped versions', () => {
    const beforeVersion = useCanvasStore.getState().spatialVersion;
    useCanvasStore.getState().translateElements(['a', 'b'], 10, -5);
    const after = useCanvasStore.getState();
    expect(after.elements.map(e => [e.x, e.y])).toEqual([
      [10, 35],
      [210, 35],
    ]);
    expect(after.elementsById.get('a')?.version).toBe(2);
    expect(after.past).toHaveLength(1);
    expect(after.spatialVersion).toBe(beforeVersion + 1);
  });

  it('skips locked elements without touching history', () => {
    seed([rect('a', 0, { locked: true })]);
    useCanvasStore.getState().translateElements(['a'], 10, 10);
    const after = useCanvasStore.getState();
    expect(after.elements[0]?.x).toBe(0);
    expect(after.past).toHaveLength(0);
  });

  it('is a no-op for empty ids, zero delta, or non-finite deltas', () => {
    const store = useCanvasStore.getState();
    store.translateElements([], 10, 10);
    store.translateElements(['a'], 0, 0);
    store.translateElements(['a'], Number.NaN, 0);
    store.translateElements(['missing'], 5, 5);
    const after = useCanvasStore.getState();
    expect(after.elements.map(e => e.x)).toEqual([0, 200]);
    expect(after.past).toHaveLength(0);
  });

  it('keeps bound arrows glued to a nudged shape', () => {
    const shape = rect('shape', 0, {
      boundElements: [{ id: 'arrow-1', type: 'arrow' }],
    });
    const arrow = {
      id: 'arrow-1',
      type: 'arrow',
      x: 100,
      y: 60,
      width: 60,
      height: 10,
      version: 1,
      versionNonce: 1,
      points: [
        { x: 0, y: 5 },
        { x: 60, y: 5 },
      ],
      startBinding: { elementId: 'shape', fixedPoint: { x: 0.5, y: 0 }, mode: 'inside' },
    } as unknown as DriplElement;
    seed([shape, arrow]);

    useCanvasStore.getState().translateElements(['shape'], 20, 0);
    const after = useCanvasStore.getState();
    const movedShape = after.elementsById.get('shape');
    expect(movedShape?.x).toBe(20);
    // The arrow stayed attached: it was recomputed (version bump) and its
    // start endpoint re-anchored onto the moved shape's render bounds.
    const movedArrow = after.elementsById.get('arrow-1') as unknown as {
      x: number;
      points: Array<{ x: number; y: number }>;
      version: number;
    };
    expect(movedArrow.version).toBe(2);
    const startAbsX = movedArrow.x + movedArrow.points[0]!.x;
    const shapeBounds = getElementBounds(movedShape!);
    expect(startAbsX).toBeGreaterThanOrEqual(shapeBounds.x - 0.001);
    expect(startAbsX).toBeLessThanOrEqual(shapeBounds.x + shapeBounds.width + 0.001);
    expect(after.past).toHaveLength(1);
  });
});
