import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import RBush from 'rbush';
import { useCanvasStore } from '@/lib/store';
import { useHitTesting, type HitBounds } from '@/hooks/canvas/useHitTesting';
import { getElementBounds } from '@dripl/math/intersection';
import type { DriplElement } from '@dripl/common';

function rect(id: string, x: number, y: number, extra: Partial<DriplElement> = {}): DriplElement {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    width: 100,
    height: 100,
    strokeColor: '#000000',
    // Filled by default so a click anywhere inside counts as a hit; the
    // outline-only path needs a transparent background.
    backgroundColor: '#ffffff',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    ...extra,
  } as DriplElement;
}

/**
 * Mirrors `useSpatialIndex`'s output shape: scene order drives both the tree
 * insertion order and the `order` map used for front-to-back sorting.
 */
function spatialIndexFor(elements: DriplElement[]) {
  const tree = new RBush<{ minX: number; minY: number; maxX: number; maxY: number; id: string }>();
  const byId = new Map<string, DriplElement>();
  const order = new Map<string, number>();
  const elementIds = new Set<string>();
  elements.forEach((el, index) => {
    const b = getElementBounds(el);
    tree.insert({ minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height, id: el.id });
    byId.set(el.id, el);
    order.set(el.id, index);
    elementIds.add(el.id);
  });
  return { tree, byId, order, elementIds };
}

function setup(elements: DriplElement[], _bounds: HitBounds) {
  useCanvasStore.setState({
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    elementLocks: new Map(),
    userId: 'me',
    zoom: 1,
    past: [],
    future: [],
  });
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
  return renderHook(() => useHitTesting(spatialIndexFor(elements)));
}

const WHOLE_SCENE: HitBounds = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 };
const ONE_BOX: HitBounds = { minX: 400, minY: 400, maxX: 700, maxY: 700 };

describe('useHitTesting.getOrderedSpatialCandidates', () => {
  beforeEach(() => {
    useCanvasStore.setState({ elements: [], elementsById: new Map() });
  });

  it('returns front-most first and drops tombstones', () => {
    const a = rect('a', 0, 0);
    const b = rect('b', 0, 0);
    const ghost = rect('ghost', 0, 0, { isDeleted: true });
    const { result } = setup([a, b, ghost], WHOLE_SCENE);

    expect(result.current.getOrderedSpatialCandidates(WHOLE_SCENE).map(el => el.id)).toEqual([
      'b',
      'a',
    ]);
  });

  it('restricts candidates to the queried box', () => {
    const { result } = setup([rect('a', 0, 0), rect('b', 500, 500)], ONE_BOX);

    expect(result.current.getOrderedSpatialCandidates(ONE_BOX).map(el => el.id)).toEqual(['b']);
  });
});

describe('useHitTesting.getElementAtPosition', () => {
  it('returns the topmost element containing the point', () => {
    // `over` is offset far enough that the 8px hit threshold at zoom 1 does
    // not reach back to a point inside `under` alone.
    const { result } = setup([rect('under', 0, 0), rect('over', 60, 60)], WHOLE_SCENE);
    expect(result.current.getElementAtPosition(80, 80)?.id).toBe('over');
    expect(result.current.getElementAtPosition(5, 5)?.id).toBe('under');
  });

  it('returns null when nothing is near the point', () => {
    const { result } = setup([rect('a', 0, 0)], WHOLE_SCENE);
    expect(result.current.getElementAtPosition(9_000, 9_000)).toBeNull();
  });

  it('skips elements locked by another collaborator', () => {
    const { result } = setup([rect('under', 0, 0), rect('over', 10, 10)], WHOLE_SCENE);
    useCanvasStore.setState({ elementLocks: new Map([['over', 'someone-else']]) });
    expect(result.current.getElementAtPosition(50, 50)?.id).toBe('under');
  });

  it('still hits an element this user has locked', () => {
    const { result } = setup([rect('a', 0, 0)], WHOLE_SCENE);
    useCanvasStore.setState({ elementLocks: new Map([['a', 'me']]) });
    expect(result.current.getElementAtPosition(50, 50)?.id).toBe('a');
  });

  it('skips elements flagged locked', () => {
    const { result } = setup(
      [rect('under', 0, 0), rect('over', 10, 10, { locked: true })],
      WHOLE_SCENE
    );
    expect(result.current.getElementAtPosition(50, 50)?.id).toBe('under');
  });

  it('hits an unfilled rectangle only on its stroke', () => {
    const outline = rect('outline', 0, 0, { backgroundColor: 'transparent' });
    const { result } = setup([outline], WHOLE_SCENE);

    // On the left edge (with a 2px stroke, bounds start at x = -1).
    expect(result.current.getElementAtPosition(0, 50)?.id).toBe('outline');
    // Dead centre, far from any edge.
    expect(result.current.getElementAtPosition(50, 50)).toBeNull();
  });

  it('widens the tolerance as the canvas zooms out', () => {
    const outline = rect('outline', 0, 0, { backgroundColor: 'transparent' });
    const { result } = setup([outline], WHOLE_SCENE);

    // 14px outside the right edge (bounds reach x = 101 with a 2px stroke).
    useCanvasStore.setState({ zoom: 1 });
    expect(result.current.getElementAtPosition(115, 50)).toBeNull();

    // At zoom 0.25 the per-element threshold is 8 / 0.25 = 32px, so the same
    // point now lands inside the stroke tolerance.
    useCanvasStore.setState({ zoom: 0.25 });
    expect(result.current.getElementAtPosition(115, 50)?.id).toBe('outline');
  });

  it('redirects a hit on bound text to its container', () => {
    const container = rect('shape', 0, 0);
    const label = {
      id: 'label',
      type: 'text',
      x: 20,
      y: 20,
      width: 40,
      height: 20,
      text: 'hi',
      backgroundColor: 'transparent',
      strokeWidth: 1,
      boundElementId: 'shape',
    } as unknown as DriplElement;
    const { result } = setup([container, label], WHOLE_SCENE);

    // The label sits inside the container, so the container would win on
    // z-order alone; the redirect is still the documented behaviour when the
    // label is on top.
    expect(result.current.getElementAtPosition(30, 25)?.id).toBe('shape');
  });

  it('returns the text itself when its container is locked', () => {
    const container = rect('shape', 0, 0, { locked: true });
    const label = {
      id: 'label',
      type: 'text',
      x: 20,
      y: 20,
      width: 40,
      height: 20,
      text: 'hi',
      backgroundColor: 'transparent',
      strokeWidth: 1,
      containerId: 'shape',
    } as unknown as DriplElement;
    const { result } = setup([label, container], WHOLE_SCENE);

    expect(result.current.getElementAtPosition(30, 25)?.id).toBe('label');
  });
});

describe('useHitTesting.getElementsAtPosition', () => {
  it('returns every hit from top z-order down', () => {
    const { result } = setup([rect('a', 0, 0), rect('b', 10, 10), rect('c', 20, 20)], WHOLE_SCENE);
    expect(result.current.getElementsAtPosition(50, 50).map(el => el.id)).toEqual(['c', 'b', 'a']);
  });

  it('omits bound text so overlap resolution prefers the shape', () => {
    const shape = rect('shape', 0, 0);
    const label = {
      id: 'label',
      type: 'text',
      x: 20,
      y: 20,
      width: 40,
      height: 20,
      text: 'hi',
      backgroundColor: 'transparent',
      strokeWidth: 1,
      boundElementId: 'shape',
    } as unknown as DriplElement;
    const { result } = setup([shape, label], WHOLE_SCENE);

    expect(result.current.getElementsAtPosition(30, 25).map(el => el.id)).toEqual(['shape']);
  });

  it('applies the same lock skips as the single-hit path', () => {
    const { result } = setup([rect('a', 0, 0), rect('b', 10, 10)], WHOLE_SCENE);
    useCanvasStore.setState({ elementLocks: new Map([['b', 'someone-else']]) });

    expect(result.current.getElementsAtPosition(50, 50).map(el => el.id)).toEqual(['a']);
  });

  it('returns an empty list for empty space', () => {
    const { result } = setup([rect('a', 0, 0)], WHOLE_SCENE);
    expect(result.current.getElementsAtPosition(5_000, 5_000)).toEqual([]);
  });
});
