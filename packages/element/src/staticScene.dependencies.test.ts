import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';

import {
  collectDependencyIdsForTest,
  dependenciesUnchangedForTest,
  hasCachedBitmapForTest,
  invalidateElementCache,
  seedCacheEntryForTest,
} from './staticScene';

function rect(overrides: Partial<DriplElement> = {}): DriplElement {
  return {
    id: 'r1',
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
    ...overrides,
  } as DriplElement;
}

function text(id: string, version: number): DriplElement {
  return { id, type: 'text', version } as DriplElement;
}

describe('element bitmap dependencies', () => {
  it('reports no dependencies for a plain element', () => {
    expect(collectDependencyIdsForTest(rect())).toEqual([]);
  });

  it('collects label, binding, and bound-text ids', () => {
    const owner = rect({
      labelId: 'label-1',
      boundElementId: 'bound-1',
      boundElements: [{ id: 't1' }, { id: 't2' }] as never,
    });
    expect(collectDependencyIdsForTest(owner).sort()).toEqual(['bound-1', 'label-1', 't1', 't2']);
  });

  it('ignores non-string dependency fields instead of throwing', () => {
    const owner = rect({ boundElementId: undefined, labelId: '' });
    expect(collectDependencyIdsForTest(owner)).toEqual([]);
  });

  it('accepts a cache entry whose dependencies are unchanged', () => {
    const scene = [rect({ labelId: 'l1' }), text('l1', 3)];
    const owner = scene[0] as DriplElement;
    const recorded = new Map([['l1', 3]]);
    expect(dependenciesUnchangedForTest(recorded, owner, scene)).toBe(true);
  });

  it('rejects the cache when a label version moved', () => {
    // This is the case the old eager scan used to handle by walking every
    // cached element. It must still be caught, or an arrow keeps a stale cutout.
    const scene = [rect({ labelId: 'l1' }), text('l1', 4)];
    const owner = scene[0] as DriplElement;
    const recorded = new Map([['l1', 3]]);
    expect(dependenciesUnchangedForTest(recorded, owner, scene)).toBe(false);
  });

  it('rejects the cache when a dependency disappears from the scene', () => {
    const owner = rect({ labelId: 'l1' });
    const recorded = new Map([['l1', 3]]);
    expect(dependenciesUnchangedForTest(recorded, owner, [owner])).toBe(false);
  });

  it('rejects the cache when the owner gains a new dependency', () => {
    // The owner now has two dependencies but the cache only recorded one, so
    // the size check must fail before any version comparison happens.
    const owner = rect({ labelId: 'l1', boundElements: [{ id: 't2' }] as never });
    const scene = [owner, text('l1', 1), text('t2', 1)];
    const recorded = new Map([['l1', 1]]);
    expect(dependenciesUnchangedForTest(recorded, owner, scene)).toBe(false);
  });

  it('treats an entry with no recorded dependencies as valid', () => {
    const scene = [rect()];
    const owner = scene[0] as DriplElement;
    expect(dependenciesUnchangedForTest(null, owner, scene)).toBe(true);
  });

  it('is cheap for the common case: no dependencies means no map lookups', () => {
    // The whole point of the change is that per-frame work no longer scales with
    // the scene. An element with no label or binding must not touch the scene
    // lookup at all, so this passes an undefined scene and must still succeed.
    const owner = rect();
    expect(dependenciesUnchangedForTest(null, owner, undefined)).toBe(true);
  });
});

describe('invalidateElementCache is O(1) and does not drop dependents', () => {
  it('leaves an unrelated element cached', () => {
    const a = rect({ id: 'a' });
    const b = rect({ id: 'b' });
    seedCacheEntryForTest(a);
    seedCacheEntryForTest(b);
    expect(hasCachedBitmapForTest(b)).toBe(true);

    invalidateElementCache('a');

    // The old implementation walked every cached element here and deleted the
    // bitmaps of anything referencing 'a'. 'b' references nothing, and is now
    // left alone.
    expect(hasCachedBitmapForTest(a)).toBe(false);
    expect(hasCachedBitmapForTest(b)).toBe(true);
  });

  it('leaves a dependent cached, because it rebuilds itself on next draw', () => {
    // This is the trade: the owner keeps its entry, and the lazy check is what
    // guarantees correctness. Both halves are asserted so neither can regress
    // silently.
    const label = text('l1', 1);
    const owner = rect({ id: 'owner', labelId: 'l1' });
    seedCacheEntryForTest(label);
    seedCacheEntryForTest(owner);

    invalidateElementCache('l1');

    expect(hasCachedBitmapForTest(owner)).toBe(true);
    // Label bumped: the owner must be considered stale on its next draw.
    const bumped = text('l1', 2);
    expect(dependenciesUnchangedForTest(new Map([['l1', 1]]), owner, [owner, bumped])).toBe(false);
  });

  it('ignores an id that was never cached', () => {
    expect(() => invalidateElementCache('never-existed')).not.toThrow();
  });
});
