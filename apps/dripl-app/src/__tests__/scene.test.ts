import { describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { compareZOrder, repairFractionalIndexes, sortElementsByZIndex } from '@/utils/zIndexUtils';
import {
  applyRestoredAppState,
  reconcileScene,
  restoreAppState,
  restoreElements,
  type AppStateActions,
} from '@/lib/scene';
import { createTombstoneStore } from '@/lib/collab/tombstones';
import { sortedInsert } from '@/lib/store/helpers';

const rect = (id: string, extra: Partial<DriplElement> = {}): DriplElement =>
  ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version: 1,
    versionNonce: 1,
    ...extra,
  }) as DriplElement;

describe('deterministic z-order (equal-index tie-break)', () => {
  it('breaks equal fractional indices by element ID', () => {
    const b = rect('b', { fractionalIndex: 'a0' });
    const a = rect('a', { fractionalIndex: 'a0' });
    expect(sortElementsByZIndex([b, a]).map(e => e.id)).toEqual(['a', 'b']);
    expect(compareZOrder(a, b)).toBeLessThan(0);
  });

  it('sorts identically regardless of input order', () => {
    const els = [
      rect('c', { fractionalIndex: 'a0' }),
      rect('a', { fractionalIndex: 'a0' }),
      rect('b', { fractionalIndex: 'a0' }),
    ];
    const forward = sortElementsByZIndex(els).map(e => e.id);
    const reversed = sortElementsByZIndex([...els].reverse()).map(e => e.id);
    expect(forward).toEqual(['a', 'b', 'c']);
    expect(reversed).toEqual(forward);
  });

  it('repairs duplicate indices into unique keys preserving order', () => {
    const els = [rect('b', { fractionalIndex: 'a0' }), rect('a', { fractionalIndex: 'a0' })];
    const repaired = repairFractionalIndexes(els);
    expect(repaired.map(e => e.id)).toEqual(['a', 'b']);
    expect(new Set(repaired.map(e => e.fractionalIndex)).size).toBe(2);
  });

  it('inserts with the total order (index, then id)', () => {
    const base = sortElementsByZIndex([
      rect('b', { fractionalIndex: 'a0' }),
      rect('c', { fractionalIndex: 'a1' }),
    ]);
    const next = sortedInsert(base, rect('a', { fractionalIndex: 'a0' }));
    expect(next.map(e => e.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('scene restore + reconcile', () => {
  it('restores unknown input into a sorted indexed scene', () => {
    const out = restoreElements([
      rect('b', { fractionalIndex: 'a1' }),
      rect('a', { fractionalIndex: 'a0' }),
      null,
    ]);
    expect(out.map(e => e.id)).toEqual(['a', 'b']);
    expect(out.every(e => typeof e.fractionalIndex === 'string')).toBe(true);
  });

  it('rejects stale remote versions and protects locked ids', () => {
    const local = rect('e', { version: 3, versionNonce: 10 });
    const stale = rect('e', { version: 2, versionNonce: 99 });
    const fresh = rect('e', { version: 4, versionNonce: 1 });
    const locked = rect('locked', { version: 1, versionNonce: 1 });
    const localById = new Map([
      ['e', local],
      ['locked', locked],
    ]);

    const staleResult = reconcileScene({
      localById,
      added: [],
      updated: [stale],
      deleted: [],
    });
    expect(staleResult.changed).toBe(false);

    const freshResult = reconcileScene({
      localById,
      added: [],
      updated: [fresh],
      deleted: [],
    });
    expect(freshResult.changed).toBe(true);
    expect(freshResult.nextById.get('e')).toEqual(fresh);

    const lockedResult = reconcileScene({
      localById,
      added: [],
      updated: [{ ...locked, version: 2, versionNonce: 2 }],
      deleted: ['locked'],
      isLocked: id => id === 'locked',
    });
    expect(lockedResult.changed).toBe(false);
    expect(lockedResult.nextById.has('locked')).toBe(true);
  });

  it('suppresses stale adds/updates for tombstoned ids and reports applied deletes', () => {
    const tombstones = createTombstoneStore();
    tombstones.add('gone');
    const ghost = rect('gone', { version: 9, versionNonce: 9 });
    const resurrected = reconcileScene({
      localById: new Map(),
      added: [ghost],
      updated: [ghost],
      deleted: [],
      tombstones,
    });
    expect(resurrected.changed).toBe(false);
    expect(resurrected.nextById.has('gone')).toBe(false);

    const local = rect('doomed', { version: 1, versionNonce: 1 });
    const deleteResult = reconcileScene({
      localById: new Map([['doomed', local]]),
      added: [],
      updated: [],
      deleted: ['doomed'],
      tombstones,
    });
    expect(deleteResult.changed).toBe(true);
    expect(deleteResult.appliedDeleted).toEqual(['doomed']);
  });
});

describe('tombstone store', () => {
  it('expires markers after the TTL', () => {
    vi.useFakeTimers();
    try {
      const store = createTombstoneStore(1_000);
      store.add('a');
      expect(store.has('a')).toBe(true);
      vi.advanceTimersByTime(1_001);
      expect(store.has('a')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps entries by evicting oldest first', () => {
    const store = createTombstoneStore(60_000, 2);
    store.add(['a', 'b', 'c']);
    expect(store.size).toBe(2);
    expect(store.has('a')).toBe(false);
    expect(store.has('c')).toBe(true);
  });

  it('clears all markers', () => {
    const store = createTombstoneStore();
    store.add(['a', 'b']);
    store.clear();
    expect(store.size).toBe(0);
    expect(store.has('a')).toBe(false);
  });
});

describe('restoreAppState', () => {
  it('allow-lists known fields and drops unknown keys', () => {
    const out = restoreAppState({
      theme: 'dark',
      zoom: 1.5,
      panX: 10,
      panY: 20,
      activeTool: 'rectangle',
      evil: 'x',
    });
    expect(out).toMatchObject({
      theme: 'dark',
      zoom: 1.5,
      panX: 10,
      panY: 20,
      activeTool: 'rectangle',
    });
    expect(out).not.toHaveProperty('evil');
  });

  it('rejects invalid enum values and non-objects', () => {
    expect(restoreAppState({ theme: 'neon', activeTool: 'nuke' })).toEqual({});
    expect(restoreAppState(null)).toEqual({});
    expect(restoreAppState('zoom')).toEqual({});
  });

  it('allow-lists hex canvas backgrounds and explicit null', () => {
    expect(restoreAppState({ canvasBackground: '#ff0000' })).toEqual({
      canvasBackground: '#ff0000',
    });
    expect(restoreAppState({ canvasBackground: null })).toEqual({ canvasBackground: null });
    expect(restoreAppState({ canvasBackground: 'red' })).toEqual({});
    expect(restoreAppState({ canvasBackground: '#zzzzzz' })).toEqual({});
    expect(restoreAppState({ canvasBackground: 42 })).toEqual({});
  });

  it('validates grid fields', () => {
    expect(restoreAppState({ gridEnabled: true, gridSize: 20 })).toMatchObject({
      gridEnabled: true,
      gridSize: 20,
    });
    expect(restoreAppState({ gridEnabled: 'yes', gridSize: NaN })).toEqual({});
  });
});

describe('applyRestoredAppState', () => {
  it('fans validated state out to the provided setters only', () => {
    const seen: Array<[string, unknown]> = [];
    const actions: AppStateActions = {
      setTheme: v => {
        seen.push(['theme', v]);
      },
      setZoom: v => {
        seen.push(['zoom', v]);
      },
      setPan: (x, y) => {
        seen.push(['pan', [x, y]]);
      },
      setGridEnabled: v => {
        seen.push(['grid', v]);
      },
      setCanvasBackground: v => {
        seen.push(['bg', v]);
      },
    };
    applyRestoredAppState(
      { theme: 'dark', zoom: 2, panX: 1, panY: 2, gridEnabled: true, canvasBackground: null },
      actions
    );
    expect(seen).toEqual([
      ['theme', 'dark'],
      ['zoom', 2],
      ['pan', [1, 2]],
      ['grid', true],
      ['bg', null],
    ]);
  });

  it('skips absent values without touching setters', () => {
    const setZoom = vi.fn();
    applyRestoredAppState({}, { setZoom });
    expect(setZoom).not.toHaveBeenCalled();
  });
});
