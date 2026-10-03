import type { DriplElement } from '@dripl/common';
import {
  getElementBitmapCacheStatsForTest,
  invalidateElementCache,
  renderStaticScene,
  resetElementBitmapCacheForTest,
} from '../src/staticScene';
import { createCountingHost } from './counting-canvas';
import { makeScene } from './scene';

/**
 * Does anything leak out of the element bitmap cache?
 *
 * THE QUESTION
 * ------------
 * `clearStaticSceneCache` in `packages/element/src/staticScene.ts` has no
 * production callers. An audit claimed its absence leaks memory. The obvious
 * paths were already shown to prune — `invalidateElementCache` deletes from
 * `elementIdMap` and calls `dropCachedBitmap` with correct byte accounting, and
 * both branches of the store's `setElements` call it for every id not in the new
 * set. That proves the obvious paths prune; it does not prove no path leaks.
 *
 * The cache holds three structures, and only one of them is weakly keyed:
 *
 *   elementCanvasCache  WeakMap<element, entry>   reclaims with the element
 *   elementIdMap        Map<id, element>          STRONG
 *   bitmapOrder         Set<element>              STRONG
 *
 * `bitmapOrder` is the interesting one. It exists to find eviction candidates,
 * so it must hold strong references, and nothing in the render path ever removes
 * an element from it except `dropCachedBitmap` — which only runs when something
 * *invalidates by id*, when a byte/entry ceiling evicts, or on an explicit
 * reset. So the question is concrete: **is there a path that puts a new object
 * for an already-cached id into the cache without ever dropping the old one?**
 *
 * THE PATH THIS PROBE EXERCISES
 * -----------------------------
 * `apps/dripl-app/lib/store/arrangeActions.ts` does, for `bringForward` and
 * friends:
 *
 *     const nextElements = sorted.map(el => ({ ...el }));
 *
 * — a fresh object for *every* element in the scene, with the **same** id and the
 * **same** `version`. `setElements` only invalidates an id whose version changed,
 * so nothing prunes. The next frame then finds a WeakMap miss for each visible
 * element (correct: the object is new) and re-caches it under the same id, which
 * overwrites `elementIdMap` but *adds* to `bitmapOrder`. The superseded object
 * and its bitmap are still strongly held.
 *
 * The same shape appears for any remote delta that replaces an element object
 * without bumping its version, so this is not one exotic call site.
 *
 * OUTPUT
 * ------
 * Counts only, and they are exact integers: entries, tracked bytes, generated /
 * reused per frame. Deterministic by construction — every element carries a
 * seed, no Math.random is consulted on this path, and the scene is fixed.
 */

const VIEWPORT = { x: 0, y: 0, width: 1280, height: 720, zoom: 0.27 } as const;

function config() {
  return {
    gridEnabled: false,
    gridSize: 20,
    zoom: VIEWPORT.zoom,
    theme: 'light' as const,
    dpr: 1,
  };
}

/** One frame over the supplied array, with all bitmaps generated (cold cache). */
function frame(
  host: ReturnType<typeof createCountingHost>,
  elements: DriplElement[]
): { generated: number; reused: number; deferred: number; drawn: number; skipped: number } {
  let stats = { generated: 0, reused: 0, deferred: 0, drawn: 0, skipped: 0 };
  renderStaticScene(host.canvas, elements, VIEWPORT, {
    ...config(),
    elements,
    visibleElements: elements,
    maxNewBitmapsPerFrame: 100_000,
    onFrameStats: frame_ => {
      stats = {
        generated: frame_.bitmapsGenerated,
        reused: frame_.bitmapsReused,
        deferred: frame_.bitmapsDeferred,
        drawn: frame_.elementsDrawn,
        skipped: frame_.elementsSkipped,
      };
    },
  });
  return stats;
}

/**
 * `bringForward`: every element becomes a new object, id and version unchanged.
 * Nothing invalidates, because no version changed.
 */
function reObject(elements: readonly DriplElement[]): DriplElement[] {
  return elements.map(element => ({ ...element }));
}

function line(label: string, values: Record<string, unknown>): void {
  process.stdout.write(`${label.padEnd(46)} ${JSON.stringify(values)}\n`);
}

function main(): void {
  const flagIndex = process.argv.indexOf('--cycles');
  const cycles = flagIndex === -1 ? 5 : Number(process.argv[flagIndex + 1]);
  resetElementBitmapCacheForTest();
  const host = createCountingHost({ width: VIEWPORT.width, height: VIEWPORT.height });

  try {
    const scene = makeScene(1200, 'mixed');
    let current = scene;

    const first = frame(host, current);
    const afterFirst = getElementBitmapCacheStatsForTest();
    line('after frame 1 (cold)', {
      ...first,
      ...afterFirst,
      bytesPerEntry: Math.round(afterFirst.trackedBytes / afterFirst.entries),
    });

    // The scene holds 1,200 elements; only the ~1,000 in the viewport get a
    // bitmap. Entries above that number are retained objects nobody draws.
    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      current = reObject(current);
      const drawn = frame(host, current);
      const stats = getElementBitmapCacheStatsForTest();
      line(`after re-object cycle ${cycle}`, {
        ...drawn,
        ...stats,
        entriesBeyondViewport: stats.entries - afterFirst.entries,
        bytesBeyondViewportMB: Math.round(
          (stats.trackedBytes - afterFirst.trackedBytes) / (1024 * 1024)
        ),
      });
    }

    // Phase C: with the byte ceiling now saturated, render the *same* array
    // repeatedly. Nothing is a cache miss by construction — every element is the
    // same object with the same version — so any `generated` here is eviction
    // churn: a live bitmap thrown out and rebuilt for no reason.
    const saturated = frame(host, current);
    line('saturated, same array (frame A)', {
      ...saturated,
      ...getElementBitmapCacheStatsForTest(),
    });
    for (let repeat = 0; repeat < 3; repeat += 1) {
      const steady = frame(host, current);
      line(`saturated, same array (steady ${repeat})`, {
        ...steady,
        ...getElementBitmapCacheStatsForTest(),
      });
    }

    // What the explicit clear actually does, for comparison.
    const beforeClear = getElementBitmapCacheStatsForTest();
    resetElementBitmapCacheForTest();
    line('after resetElementBitmapCacheForTest()', getElementBitmapCacheStatsForTest());
    line('bytes released by the reset', {
      mb: Math.round(beforeClear.trackedBytes / (1024 * 1024)),
    });

    // And the self-correcting path: invalidating every id by hand.
    current = reObject(current);
    frame(host, current);
    const beforeInvalidate = getElementBitmapCacheStatsForTest();
    current.forEach(element => invalidateElementCache(element.id));
    line('after invalidating every id', getElementBitmapCacheStatsForTest());
    line('bytes released by invalidating every id', {
      mb: Math.round(beforeInvalidate.trackedBytes / (1024 * 1024)),
    });
  } finally {
    host.dispose();
    resetElementBitmapCacheForTest();
  }
}

main();
