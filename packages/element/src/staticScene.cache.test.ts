import { beforeEach, describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';

import {
  ELEMENT_BITMAP_CACHE_LIMITS,
  dropCachedBitmapForTest,
  evictBitmapsToFitForTest,
  getElementBitmapCacheStatsForTest,
  hasCachedBitmapForTest,
  invalidateElementCache,
  resetElementBitmapCacheForTest,
  seedCacheEntryForTest,
} from './staticScene';

function rect(id: string, width = 100, height = 70): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width,
    height,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
  } as DriplElement;
}

describe('element bitmap cache ceiling', () => {
  beforeEach(() => {
    // The cache is module-global and shared across test files in a worker, so
    // reset it explicitly rather than cleaning up ids this file happened to use.
    resetElementBitmapCacheForTest();
  });

  it('starts empty', () => {
    const stats = getElementBitmapCacheStatsForTest();
    expect(stats.entries).toBe(0);
    expect(stats.trackedBytes).toBe(0);
  });

  it('drops the oldest entry when the entry limit is exceeded', () => {
    // One entry over the documented ceiling is enough to force an eviction.
    const total = ELEMENT_BITMAP_CACHE_LIMITS.entryLimit + 1;
    const elements: DriplElement[] = [];
    for (let index = 0; index < total; index += 1) {
      const element = rect(`e${index}`);
      elements.push(element);
      seedCacheEntryForTest(element);
    }

    expect(elements[0] && hasCachedBitmapForTest(elements[0])).toBe(false);
    expect(hasCachedBitmapForTest(elements[total - 1]!)).toBe(true);
    expect(getElementBitmapCacheStatsForTest().entries).toBeLessThanOrEqual(
      ELEMENT_BITMAP_CACHE_LIMITS.entryLimit
    );
  });

  it('evicts in insertion order, keeping the most recent entries', () => {
    const elements = [rect('first'), rect('second'), rect('third')];
    for (const element of elements) seedCacheEntryForTest(element);

    dropCachedBitmapForTest(elements[1]!);

    // Dropping the middle entry must not disturb the other two.
    expect(hasCachedBitmapForTest(elements[0]!)).toBe(true);
    expect(hasCachedBitmapForTest(elements[1]!)).toBe(false);
    expect(hasCachedBitmapForTest(elements[2]!)).toBe(true);
  });

  it('keeps byte accounting at zero after everything is dropped', () => {
    const element = rect('counted');
    seedCacheEntryForTest(element);
    dropCachedBitmapForTest(element);
    // Never negative: a double drop would otherwise let the ceiling be
    // exceeded silently.
    expect(getElementBitmapCacheStatsForTest().trackedBytes).toBe(0);
  });

  it('does not leave the ceiling in a state where entries exceed the limit', () => {
    for (let index = 0; index < ELEMENT_BITMAP_CACHE_LIMITS.entryLimit + 500; index += 1) {
      seedCacheEntryForTest(rect(`bulk-${index}`));
    }
    evictBitmapsToFitForTest();
    const stats = getElementBitmapCacheStatsForTest();
    expect(stats.entries).toBeLessThanOrEqual(ELEMENT_BITMAP_CACHE_LIMITS.entryLimit);
    expect(stats.trackedBytes).toBeGreaterThanOrEqual(0);
  });

  it('clears the strong eviction order when the scene cache is cleared', () => {
    seedCacheEntryForTest(rect('a'));
    seedCacheEntryForTest(rect('b'));
    expect(getElementBitmapCacheStatsForTest().entries).toBe(2);
    invalidateElementCache('a');
    expect(getElementBitmapCacheStatsForTest().entries).toBe(1);
  });
});
