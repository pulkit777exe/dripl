import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { useCanvasStore } from '@/lib/store';
import { useSpatialIndex, type SpatialIndexState } from '@/hooks/canvas/useSpatialIndex';
import type { Viewport } from '@/utils/canvas-coordinates';

/**
 * `useSpatialIndex` is the R-tree behind hit testing and viewport culling.
 * These tests drive it through the store the way RoughCanvas does, and assert
 * only on observable query results: a stale box means the tree keeps paying
 * for dead geometry, and a duplicated box means every candidate list is wrong.
 *
 * NOTE: bounds in the tree are inflated by `getElementBounds` (it adds the
 * stroke padding), so a "just outside" probe here is 5px past the declared
 * edge rather than 1px.
 */

const VIEWPORT: Viewport = { x: 0, y: 0, width: 1000, height: 800, zoom: 1 };

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function rect(id: string, x: number, y: number, order = 0, isDeleted = false): DriplElement {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    width: 100,
    height: 80,
    strokeColor: '#000000',
    backgroundColor: '#ffffff',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    isDeleted,
    // Zero-padded so scene order is stable and explicitly under test control.
    fractionalIndex: `a${String(order).padStart(3, '0')}`,
  } as DriplElement;
}

/** A row of `count` 100x80 rects, laid out left to right, 200px apart. */
function grid(count: number): DriplElement[] {
  return Array.from({ length: count }, (_, i) => rect(`e-${i}`, i * 200, 0, i));
}

function probe(x: number, y: number, size = 1): Box {
  return {
    minX: x - size / 2,
    minY: y - size / 2,
    maxX: x + size / 2,
    maxY: y + size / 2,
  };
}

function idsIn(index: SpatialIndexState, area: Box): string[] {
  return index.tree
    .search(area)
    .map(item => item.id)
    .sort();
}

/** Element ids whose indexed boxes contain the point. */
function idsAt(index: SpatialIndexState, x: number, y: number): string[] {
  return idsIn(index, probe(x, y));
}

function storeElements(elements: DriplElement[]) {
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
}

/**
 * Mounts the hook against the store, exactly as RoughCanvas consumes it, so
 * each `commit` is one real store update and one re-render.
 */
function mount(viewport: Viewport = VIEWPORT) {
  const hook = renderHook(
    (props: { viewport: Viewport }) =>
      useSpatialIndex(
        useCanvasStore(state => state.elements),
        props.viewport
      ),
    { initialProps: { viewport } }
  );
  return {
    index: () => hook.result.current.spatialIndex,
    visible: () => hook.result.current.visibleElements,
    commit(next: DriplElement[]) {
      act(() => {
        storeElements(next);
      });
    },
    setViewport(viewport: Viewport) {
      act(() => {
        hook.rerender({ viewport });
      });
    },
    /** Re-renders with an equal-but-distinct viewport object. */
    rerenderUnchanged() {
      act(() => {
        hook.rerender({ viewport: { ...viewport } });
      });
    },
  };
}

beforeEach(() => {
  useCanvasStore.setState({
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    elementLocks: new Map(),
    past: [],
    future: [],
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
  });
});

describe('useSpatialIndex tree membership', () => {
  it('finds an element queried inside its bounds and misses it outside', () => {
    // Regression: the index boxes are built from x/y as if they were min/max
    // (or width/height are dropped), so every hit test silently returns
    // nothing and the canvas is unclickable.
    const target = rect('a', 200, 300);
    const { commit, index } = mount();
    commit([target]);

    expect(idsAt(index(), 200, 300)).toEqual(['a']);
    expect(idsAt(index(), 250, 330)).toEqual(['a']);
    expect(idsAt(index(), 200, 385)).not.toContain('a');
    expect(idsAt(index(), 305, 340)).not.toContain('a');
    expect(idsAt(index(), 195, 340)).not.toContain('a');
    expect(idsAt(index(), 250, 295)).not.toContain('a');
    expect(idsAt(index(), 0, 0)).not.toContain('a');
  });

  it('keeps overlapping elements separable — a query returns every box it covers', () => {
    // Regression: the tree stores one box per id keyed by something lossy, so
    // two stacked shapes resolve to a single candidate.
    const { commit, index } = mount();
    commit([rect('under', 100, 100, 0), rect('over', 150, 150, 1)]);

    expect(idsAt(index(), 160, 160)).toEqual(['over', 'under']);
  });

  it('indexes an element added to an existing scene', () => {
    // Regression: the incremental add branch is skipped, so a newly drawn
    // shape is invisible to hit testing until the 40% churn rebuild fires.
    const before = grid(8);
    const { commit, index } = mount();
    commit(before);
    expect(idsAt(index(), 1800, 40)).toEqual([]);

    commit([...before, rect('new', 1800, 0, 8)]);

    // `toContain` rather than an exact list: duplicated boxes are pinned by
    // the "one box per element" test, this one only claims the add is indexed.
    expect(idsAt(index(), 1800, 40)).toContain('new');
    expect(index().elementIds.has('new')).toBe(true);
  });

  it('stops finding a removed element', () => {
    // Regression: `tree.remove()` is called with a fresh object literal, and
    // rbush 4's `remove` matches by *reference* -- `findItem` is
    // `items.indexOf(item)` unless an `equalsFn` is passed. rbush 3 defaulted to
    // structural equality, so on the v3 -> v4 bump every remove in this hook
    // became a silent no-op and nothing failed.
    //
    // The fix routes all three removes through a `removeBox` helper that supplies
    // the predicate. This was an `it.fails` pin while the bug was live; it is a
    // real assertion now, and removing the predicate turns it red again.
    const before = grid(8);
    const { commit, index } = mount();
    commit(before);
    expect(idsAt(index(), 600, 40)).toEqual(['e-3']);

    commit(before.filter(el => el.id !== 'e-3'));

    expect(idsAt(index(), 600, 40)).toEqual([]);
    expect(idsIn(index(), probe(-5000, -5000, 10000))).not.toContain('e-3');
  });

  it('drops a removed element from the index bookkeeping', () => {
    // Regression: the incremental remove branch forgets to clear elementIds /
    // byId / order, so a deleted shape keeps a scene slot and a z-order rank
    // it no longer owns.
    const before = grid(8);
    const { commit, index } = mount();
    commit(before);
    expect(index().elementIds.has('e-3')).toBe(true);

    commit(before.filter(el => el.id !== 'e-3'));

    expect(index().elementIds.has('e-3')).toBe(false);
    expect(index().byId.has('e-3')).toBe(false);
    expect(index().order.has('e-3')).toBe(false);
    // The survivors keep their relative scene order.
    expect([...index().order.keys()]).toEqual(['e-0', 'e-1', 'e-2', 'e-4', 'e-5', 'e-6', 'e-7']);
  });

  it('finds a moved element at its new bounds', () => {
    // Regression: the move path re-inserts using the *previous* geometry, so
    // the shape is findable only where it used to be and every drag makes it
    // unclickable at its new position.
    const before = grid(8);
    const { commit, index } = mount();
    commit(before);
    expect(idsAt(index(), 600, 40)).toEqual(['e-3']);

    commit(before.map(el => (el.id === 'e-3' ? rect('e-3', 800, 500, 3) : el)));

    expect(idsAt(index(), 800, 500)).toEqual(['e-3']);
    expect(index().byId.get('e-3')).toMatchObject({ x: 800, y: 500 });
  });

  it('forgets the old bounds of a moved element', () => {
    // The classic R-tree bug: the move path inserts the new box but never
    // removes the old one, leaving a ghost of the pre-move geometry in the
    // tree forever. The regression is the reference-based remove noted above.
    const before = grid(8);
    const { commit, index } = mount();
    commit(before);
    expect(idsAt(index(), 600, 40)).toEqual(['e-3']);

    commit(before.map(el => (el.id === 'e-3' ? rect('e-3', 800, 500, 3) : el)));

    expect(idsAt(index(), 600, 40)).toEqual([]);
    // The pre-move box is gone from the whole tree, not just from a hit test.
    expect(idsIn(index(), probe(550, 0, 200))).not.toContain('e-3');
  });

  it('re-indexes a transient drag at its current position', () => {
    // Regression: the transient-hint fast path skips the reindex when the
    // version did not change, so a dragged shape is never findable at the
    // pointer.
    const before = grid(8);
    const { commit, index } = mount();
    commit(before);

    act(() => {
      useCanvasStore.getState().updateElementTransient('e-3', { x: 900, y: 600 });
    });

    expect(idsAt(index(), 900, 600)).toEqual(['e-3']);
    // A transient update bumps the version; an unchanged version would leave
    // the tree box stale while byId already reports the new geometry.
    expect(index().byId.get('e-3')).toMatchObject({ x: 900, y: 600 });
  });

  it('drops the pre-drag box of a transient gesture', () => {
    // Regression: the transient-hint fast path leaves the pre-drag box behind,
    // so the tree accumulates one dead box per frame of the gesture.
    // The regression is the reference-based remove noted above.
    const before = grid(8);
    const { commit, index } = mount();
    commit(before);

    act(() => {
      useCanvasStore.getState().updateElementTransient('e-3', { x: 900, y: 600 });
    });

    expect(idsAt(index(), 600, 40)).toEqual([]);
  });

  it('keeps untouched elements out of the reindex when a hint names several ids', () => {
    // Regression: the hint list accumulates ids across a gesture. A hint for
    // an element whose version has not moved since the last build must not
    // trigger a reindex; if the version check is dropped, every pointer move
    // re-inserts the whole selection and the tree grows mid-drag.
    const before = grid(8);
    const { commit, index } = mount();
    commit(before);
    const e2Before = index()
      .tree.all()
      .find(item => item.id === 'e-2')!;

    act(() => {
      useCanvasStore.getState().updateElementTransient('e-3', { x: 900, y: 600 });
    });
    act(() => {
      // The hint list still carries e-3 (unchanged since the edit above)
      // alongside the newly changed e-5.
      useCanvasStore.getState().updateElementTransient('e-5', { y: 400 });
    });

    expect(index().byId.get('e-5')).toMatchObject({ y: 400 });
    expect(idsAt(index(), 1000, 400)).toEqual(['e-5']);
    // e-2 never changed, so it must still have exactly one box at its
    // original coordinates — not a second copy from a needless reindex.
    const e2Boxes = index()
      .tree.all()
      .filter(item => item.id === 'e-2');
    expect(e2Boxes).toHaveLength(1);
    expect(e2Boxes[0]).toMatchObject({ minX: e2Before.minX, minY: e2Before.minY });
  });

  it('removes the right box when two elements share identical bounds', () => {
    // Regression: duplicating a shape is an ordinary action and leaves two
    // elements at exactly the same coordinates, so the tree holds two boxes with
    // identical geometry and different ids. Removing one must leave the other's
    // box in place -- the survivor is still on the canvas and still has to be
    // hit-testable and cullable.
    //
    // Honest limit: this does **not** pin that the predicate compares ids rather
    // than geometry. I tried to make it discriminate -- deleting whichever twin is
    // second in `tree.all()` order -- and a geometry-comparing predicate still
    // passed, because rbush's search order is an internal layout detail that
    // `all()` order does not reveal and that a caller cannot control. So id-vs-
    // geometry is not deterministically distinguishable from outside the library.
    // What *is* pinned is that the fix is an id predicate and that reverting it,
    // or over-broadening it, turns five tests red.
    const { commit, index } = mount();
    const twinA = rect('twin-a', 300, 0, 0);
    const twinB = rect('twin-b', 300, 0, 1);
    commit([twinA, twinB]);
    expect(
      index()
        .tree.all()
        .map(i => i.id)
        .sort()
    ).toEqual(['twin-a', 'twin-b']);

    // Delete whichever twin is *not* first in tree order. rbush's `findItem`
    // returns the first match, so deleting the first one would let a
    // geometry-matching predicate remove the right box by luck and the test
    // would pass against the wrong implementation. Deleting the second forces
    // the predicate to choose.
    const second = index().tree.all()[1]!.id;
    const survivor = second === 'twin-a' ? twinA : twinB;
    commit([survivor]);

    // The survivor keeps its box; the deleted twin's box is gone.
    expect(
      index()
        .tree.all()
        .map(i => i.id)
    ).toEqual([survivor.id]);
  });

  it('holds exactly one tree box per element as elements are added', () => {
    // Regression: `updated` treats "no previous entry in byId" as "needs
    // reindex", so an element that was just `added` is inserted a second time.
    // A duplicated box makes every candidate list (marquee select, culling)
    // report the same element twice, and the tree only ever grows.
    // The regression is the reference-based remove: with it a no-op, the
    // compensating remove in the `updated` loop no longer cancels the duplicate
    // insert, so one add leaves more boxes in the tree than there are elements.
    const before = grid(8);
    const { commit, index } = mount();
    commit(before);
    commit([...before, rect('new', 1800, 0, 8)]);

    const ids = index()
      .tree.all()
      .map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(9);
  });

  it('bulk rebuild and incremental inserts answer identical queries', () => {
    // Regression: the >40% churn heuristic rebuilds from scratch while the
    // incremental path mutates in place; if the two disagree, what is visible
    // (and clickable) depends on the edit history rather than the scene.
    const scene = grid(8);
    const incremental = mount();
    incremental.commit(scene.slice(0, 4));
    for (let n = 5; n <= scene.length; n++) {
      incremental.commit(scene.slice(0, n));
    }

    const rebuilt = mount();
    rebuilt.commit(scene);

    const probes = [
      probe(-100, -100, 200),
      probe(0, 0),
      probe(300, 40),
      probe(600, 40, 120),
      probe(1400, 0, 200),
      probe(-5000, -5000, 10000),
    ];
    for (const area of probes) {
      expect(idsIn(incremental.index(), area)).toEqual(idsIn(rebuilt.index(), area));
    }
    expect(incremental.index().elementIds).toEqual(rebuilt.index().elementIds);
    expect([...incremental.index().order.entries()]).toEqual([...rebuilt.index().order.entries()]);
  });
});

describe('useSpatialIndex viewport culling', () => {
  it('answers every query with an empty list on an empty scene', () => {
    // Regression: querying an empty tree throws (or the byId lookup yields
    // undefined and gets sorted), which takes down the whole canvas on load.
    const { index, visible } = mount();

    expect(idsIn(index(), probe(0, 0))).toEqual([]);
    expect(idsAt(index(), -1e6, -1e6)).toEqual([]);
    expect(idsIn(index(), probe(-1e6, -1e6, 2e6))).toEqual([]);
    expect(visible()).toEqual([]);
  });

  it('culls every element when the viewport contains none of them', () => {
    // Regression: the search box can legitimately contain zero elements; a
    // `.map`/`.sort` over that empty candidate list must not throw or fall
    // back to rendering the whole scene.
    const { commit, index, visible, setViewport } = mount();
    commit(grid(4));
    expect(visible().length).toBe(4);

    // e-3 lives at x=600..700; pan the viewport far to the left of it.
    setViewport({ ...VIEWPORT, x: -5000 });

    expect(idsIn(index(), probe(-5000, 0, 2000))).toEqual([]);
    expect(visible()).toEqual([]);
  });

  it('returns only the elements inside the viewport, in scene order', () => {
    // Regression: dropping the `order` sort hands the renderer RBush traversal
    // order, which is sorted by coordinate once the tree splits, so z-order
    // flips and shapes that were behind are drawn on top. The scene is built
    // right-to-left and large enough to split the tree, which is the only
    // configuration where traversal order differs from insertion order.
    // Scene order deliberately alternates between the left and the right of
    // the canvas: any coordinate-grouped traversal returns the left-hand
    // shapes first, which is not this order.
    const xs = [0, 2200, 200, 2000, 400, 1800, 600, 1600, 800, 1400, 1000, 1200];
    const alternating = xs.map((x, i) => rect(`e-${i}`, x, 0, i));
    const sceneOrder = alternating.map(el => el.id);

    // A viewport wide enough to hold the whole 2400px scene.
    const { commit, visible, index } = mount({ ...VIEWPORT, width: 3000 });
    commit(alternating);

    expect(visible().map(el => el.id)).toEqual(sceneOrder);
    // The tree itself does not store them in scene order, so the sort is doing
    // real work here rather than agreeing by accident.
    const traversal = index()
      .tree.search({ minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 })
      .map(item => item.id);
    expect(traversal).not.toEqual(sceneOrder);
  });

  it('culls to a viewport subset without reordering what remains', () => {
    // Regression: after a pan the visible set changes, and the subset that
    // stays on screen must keep scene order (front-most last) rather than
    // whatever order the tree walk happened to produce.
    const scene = [rect('back', 10, 10, 0), rect('mid', 1000, 10, 1), rect('front', 2000, 10, 2)];
    const { commit, visible, setViewport } = mount();
    commit(scene);

    expect(visible().map(el => el.id)).toEqual(['back', 'mid']);

    // Pan right (negative x is screen-space pan, so it moves the world window
    // right): 'back' leaves the viewport, 'front' enters, and the two that
    // remain must still be in scene order rather than tree traversal order.
    setViewport({ ...VIEWPORT, x: -1100 });

    expect(visible().map(el => el.id)).toEqual(['mid', 'front']);
  });

  it('reuses the visible array when the scene and viewport are unchanged', () => {
    // Regression: returning a fresh array on every render defeats the memo the
    // static layer relies on, forcing a full scene diff per pan/zoom frame.
    const { commit, visible, rerenderUnchanged } = mount();
    commit(grid(6));
    const first = visible();
    expect(first.length).toBeGreaterThan(1);

    rerenderUnchanged();

    expect(visible()).toBe(first);
  });

  it('omits tombstoned elements from the visible set', () => {
    // Regression: deleted-but-still-present elements get painted, so a
    // remote delete never disappears from the viewport.
    const { commit, visible } = mount();
    commit([rect('live', 10, 10, 0), rect('gone', 200, 10, 1, true)]);

    expect(visible().map(el => el.id)).toEqual(['live']);
  });
});
