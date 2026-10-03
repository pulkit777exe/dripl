import { beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { DriplElement } from '@dripl/common';
import { createMockCanvasContext } from '@dripl/test-utils';

import {
  clearStaticSceneCache,
  DEFAULT_MAX_NEW_BITMAPS_PER_FRAME,
  ELEMENT_BITMAP_CACHE_LIMITS,
  getElementBitmapCacheStatsForTest,
  getInvalidateCallCount,
  hasCachedBitmapForTest,
  invalidateElementCache,
  renderStaticScene,
  resetElementBitmapCacheForTest,
  resetInvalidateCallCount,
  seedCacheEntryForTest,
  type StaticSceneFrameStats,
} from '../staticScene';

function rect(overrides: Partial<DriplElement> = {}): DriplElement {
  return {
    id: 'r',
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

/**
 * jsdom cannot allocate a 2D context, so the per-element offscreen canvas always
 * fails to build here. That is the `failed` path, and it is exercised explicitly
 * in the culling suite.
 */
interface Recorded {
  rotate: number[];
  translate: { x: number; y: number }[];
  fillRect: { x: number; y: number; width: number; height: number; style: unknown }[];
  strokeRect: { x: number; y: number; width: number; height: number }[];
  setLineDash: number[][];
  globalAlpha: number[];
}

function recordingHost(): { canvas: HTMLCanvasElement; recorded: Recorded } {
  const recorded: Recorded = {
    rotate: [],
    translate: [],
    fillRect: [],
    strokeRect: [],
    setLineDash: [],
    globalAlpha: [],
  };
  const state = { alpha: 1 };
  const ctx = {
    save: () => undefined,
    restore: () => undefined,
    setTransform: () => undefined,
    clearRect: () => undefined,
    scale: () => undefined,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    drawImage: () => undefined,
    measureText: () => ({ width: 0 }),
    fillRect: (x: number, y: number, width: number, height: number) =>
      recorded.fillRect.push({ x, y, width, height, style: ctx.fillStyle }),
    strokeRect: (x: number, y: number, width: number, height: number) =>
      recorded.strokeRect.push({ x, y, width, height }),
    setLineDash: (pattern: number[]) => recorded.setLineDash.push(pattern),
    rotate: (angle: number) => recorded.rotate.push(angle),
    translate: (x: number, y: number) => recorded.translate.push({ x, y }),
  };
  Object.defineProperty(ctx, 'globalAlpha', {
    get: () => state.alpha,
    set: (value: number) => {
      state.alpha = value;
      recorded.globalAlpha.push(value);
    },
  });

  return {
    canvas: {
      getContext: () => ctx,
      width: 800,
      height: 600,
      style: {},
    } as unknown as HTMLCanvasElement,
    recorded,
  };
}

beforeEach(() => {
  resetElementBitmapCacheForTest();
  resetInvalidateCallCount();
});

describe('deferred-element placeholder', () => {
  // A deferred element is drawn directly as a crude box so the frame stays
  // complete. Everything below pins that it lands in the right place, at the
  // right size, colour, rotation, and opacity — a placeholder in the wrong
  // place is a visible jump on the following frame.

  function deferredFrame(elements: DriplElement[]): Recorded {
    const { canvas, recorded } = recordingHost();
    renderStaticScene(
      canvas,
      elements,
      { x: 0, y: 0, width: 800, height: 600, zoom: 1 },
      {
        gridEnabled: false,
        gridSize: 20,
        zoom: 1,
        theme: 'light',
        dpr: 1,
        maxNewBitmapsPerFrame: 0,
      }
    );
    return recorded;
  }

  it('outlines the element at its own bounds when the budget is spent', () => {
    const recorded = deferredFrame([rect({ id: 'a', x: 10, y: 20, width: 30, height: 40 })]);
    expect(recorded.strokeRect).toHaveLength(1);
    expect(recorded.strokeRect[0]).toMatchObject({ x: 10, y: 20, width: 30, height: 40 });
  });

  it('fills the element when it has a visible background', () => {
    const recorded = deferredFrame([rect({ id: 'a', backgroundColor: '#ff0000' })]);
    expect(recorded.fillRect).toHaveLength(1);
    expect(recorded.fillRect[0]?.style).toBe('#ff0000');
  });

  it('does not fill a transparent element', () => {
    const recorded = deferredFrame([rect({ id: 'a', backgroundColor: 'transparent' })]);
    expect(recorded.fillRect).toHaveLength(0);
    expect(recorded.strokeRect).toHaveLength(1);
  });

  it('honours the legacy fillColor field when backgroundColor is absent', () => {
    // Legacy and imported scenes carry `fillColor`; dropping it makes every
    // deferred element outline-only, which is a visible flash on a dense scene.
    const legacy = rect({
      id: 'a',
      backgroundColor: undefined,
    } as unknown as Partial<DriplElement>);
    (legacy as unknown as Record<string, unknown>).fillColor = '#00ff00';
    const recorded = deferredFrame([legacy]);
    expect(recorded.fillRect).toHaveLength(1);
    expect(recorded.fillRect[0]?.style).toBe('#00ff00');
  });

  it('falls back to a theme-appropriate stroke colour', () => {
    const unsetStroke = { strokeColor: undefined } as unknown as Partial<DriplElement>;
    const light = deferredFrame([rect({ id: 'a', ...unsetStroke })]);
    const { canvas, recorded } = recordingHost();
    renderStaticScene(
      canvas,
      [rect({ id: 'a', ...unsetStroke })],
      {
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        zoom: 1,
      },
      {
        gridEnabled: false,
        gridSize: 20,
        zoom: 1,
        theme: 'dark',
        dpr: 1,
        maxNewBitmapsPerFrame: 0,
      }
    );
    // The dark-theme run is the second one; assert it produced an outline.
    expect(recorded.strokeRect).toHaveLength(1);
    expect(light.strokeRect).toHaveLength(1);
  });

  it('applies opacity and rotates about the element centre', () => {
    const recorded = deferredFrame([
      rect({ id: 'a', x: 10, y: 20, width: 30, height: 40, opacity: 0.5, angle: Math.PI / 5 }),
    ]);
    expect(recorded.globalAlpha).toContain(0.5);
    expect(recorded.rotate).toContain(Math.PI / 5);
    // Centre of a 30x40 box at (10,20) is (25,40).
    expect(recorded.translate).toContainEqual({ x: 25, y: 40 });
    expect(recorded.translate).toContainEqual({ x: -25, y: -40 });
  });

  it('draws nothing for a degenerate zero-size element', () => {
    const recorded = deferredFrame([rect({ id: 'a', width: 0, height: 0 })]);
    expect(recorded.strokeRect).toHaveLength(0);
    expect(recorded.fillRect).toHaveLength(0);
  });

  it('never defers an element that already has a cached bitmap', () => {
    // The budget is a per-frame allocation budget, not a rendering budget. A
    // cached element must still be blitted once the budget is spent, or the
    // scene would blank out as the cache warmed up.
    const element = rect({ id: 'a' });
    seedCacheEntryForTest(element);
    const recorded = deferredFrame([element]);
    // A cached bitmap is blitted, not outlined, so no placeholder is drawn.
    expect(recorded.strokeRect).toHaveLength(0);
  });
});

describe('canvas bootstrap', () => {
  it('resizes the backing store to the viewport times the device pixel ratio', () => {
    const canvas = {
      getContext: () => createMockCanvasContext(),
      width: 0,
      height: 0,
      style: {} as CSSStyleDeclaration,
    };
    renderStaticScene(
      canvas as unknown as HTMLCanvasElement,
      [],
      {
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        zoom: 1,
      },
      {
        gridEnabled: false,
        gridSize: 20,
        zoom: 1,
        theme: 'light',
        dpr: 2,
      }
    );
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('600px');
  });

  it('leaves the backing store alone when the dimensions have not changed', () => {
    // Resizing a canvas clears it, so doing it every frame is a flicker source.
    const style = { width: '800px', height: '600px' };
    const canvas = {
      getContext: () => createMockCanvasContext(),
      width: 1600,
      height: 1200,
      style,
    };
    renderStaticScene(
      canvas as unknown as HTMLCanvasElement,
      [],
      {
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        zoom: 1,
      },
      {
        gridEnabled: false,
        gridSize: 20,
        zoom: 1,
        theme: 'light',
        dpr: 2,
      }
    );
    expect(canvas.style).toBe(style);
    expect(canvas.width).toBe(1600);
  });
});

describe('invalidation instrumentation and cache reset', () => {
  it('counts invalidations so an O(scene) regression is visible', () => {
    // This counter exists because the previous implementation walked every
    // cached element on every mutation, which was invisible from the output.
    expect(getInvalidateCallCount()).toBe(0);

    const element = rect({ id: 'a' });
    seedCacheEntryForTest(element);
    invalidateElementCache('a');
    invalidateElementCache('a');
    invalidateElementCache('never-rendered');

    expect(getInvalidateCallCount()).toBe(3);

    resetInvalidateCallCount();
    expect(getInvalidateCallCount()).toBe(0);
  });

  it('clearStaticSceneCache empties the eviction order and the byte total', () => {
    // The parallel id map and the eviction order hold *strong* references, so
    // dropping only the WeakMap would still pin every element ever drawn.
    for (let i = 0; i < 50; i += 1) seedCacheEntryForTest(rect({ id: `e${i}` }));
    expect(getElementBitmapCacheStatsForTest().entries).toBe(50);

    clearStaticSceneCache();

    expect(getElementBitmapCacheStatsForTest()).toEqual({ entries: 0, trackedBytes: 0 });
    // An id that was cached before the clear no longer resolves to an element,
    // which is the whole point of clearing the index.
    expect(() => invalidateElementCache('e0')).not.toThrow();
  });

  it('publishes the ceiling it enforces', () => {
    // The byte budget and the entry limit are a correctness guard against a tab
    // taking multiple gigabytes of bitmap, so the published values must be the
    // enforced ones.
    expect(ELEMENT_BITMAP_CACHE_LIMITS.byteBudget).toBe(128 * 1024 * 1024);
    expect(ELEMENT_BITMAP_CACHE_LIMITS.entryLimit).toBe(20_000);
    expect(DEFAULT_MAX_NEW_BITMAPS_PER_FRAME).toBeGreaterThan(0);
  });
});

describe('bitmap byte accounting', () => {
  it('holds the byte ceiling no matter how many elements are cached', () => {
    // Seeded stubs avoid allocating hundreds of megabytes of real canvas, which
    // is the point of the seed helper existing.
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 4000 }), { minLength: 1, maxLength: 60 }),
        sizes => {
          resetElementBitmapCacheForTest();
          let index = 0;
          for (const size of sizes) {
            index += 1;
            // A 4000x4000 stub entry is 64 MB, so a handful crosses 128 MB.
            seedCacheEntryForTest(rect({ id: `e${index}` }), size, size);
          }
          const stats = getElementBitmapCacheStatsForTest();
          expect(stats.trackedBytes).toBeGreaterThanOrEqual(0);
          expect(stats.trackedBytes).toBeLessThanOrEqual(ELEMENT_BITMAP_CACHE_LIMITS.byteBudget);
          expect(stats.entries).toBeLessThanOrEqual(ELEMENT_BITMAP_CACHE_LIMITS.entryLimit);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('never lets the tracked total drift above what is actually cached', () => {
    // Regeneration must subtract the entry it replaces. If it did not, the
    // ceiling would be reached by an empty cache and every bitmap would be
    // evicted immediately.
    resetElementBitmapCacheForTest();
    const element = rect({ id: 'a' });
    seedCacheEntryForTest(element, 500, 500);
    const seeded = getElementBitmapCacheStatsForTest().trackedBytes;
    expect(seeded).toBe(500 * 500 * 4);

    // Seeding the same element again replaces its entry rather than adding one.
    seedCacheEntryForTest(element, 500, 500);
    expect(getElementBitmapCacheStatsForTest().trackedBytes).toBe(seeded);
    expect(getElementBitmapCacheStatsForTest().entries).toBe(1);
  });

  it('drops the strong eviction reference when the bitmap is invalidated', () => {
    const element = rect({ id: 'a' });
    seedCacheEntryForTest(element);
    invalidateElementCache('a');
    expect(hasCachedBitmapForTest(element)).toBe(false);
    expect(getElementBitmapCacheStatsForTest().entries).toBe(0);
    expect(getElementBitmapCacheStatsForTest().trackedBytes).toBe(0);
  });
});

describe('OffscreenCanvas preference', () => {
  /** Tolerant of any method Rough.js reaches for, like the culling suite. */
  function tolerant(): CanvasRenderingContext2D {
    const base = createMockCanvasContext() as unknown as Record<string, unknown>;
    return new Proxy(base, {
      get(target, property) {
        if (property in target) return target[property as string];
        return () => undefined;
      },
    }) as unknown as CanvasRenderingContext2D;
  }

  it('uses OffscreenCanvas when the runtime provides one', () => {
    // The per-element canvas is allocated once per visible element per cold
    // frame. A DOM canvas means a DOM node per element, which is the reason the
    // offscreen path exists at all.
    let constructed = 0;
    class StubOffscreenCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        constructed += 1;
        this.width = width;
        this.height = height;
      }
      getContext(): CanvasRenderingContext2D {
        return tolerant();
      }
    }
    vi.stubGlobal('OffscreenCanvas', StubOffscreenCanvas);

    const elements = Array.from({ length: 3 }, (_, i) => rect({ id: `e${i}` }));
    const { canvas } = recordingHost();
    let stats: StaticSceneFrameStats | null = null;
    renderStaticScene(
      canvas,
      elements,
      { x: 0, y: 0, width: 800, height: 600, zoom: 1 },
      {
        gridEnabled: false,
        gridSize: 20,
        zoom: 1,
        theme: 'light',
        dpr: 1,
        onFrameStats: s => {
          stats = s;
        },
      }
    );

    expect(constructed).toBe(3);
    expect((stats as unknown as StaticSceneFrameStats).bitmapsGenerated).toBe(3);
    vi.unstubAllGlobals();
  });

  it('allocates at the logical size the renderer will blit back into', () => {
    // 100x100 element plus 10px padding on each side, at dpr 2.
    const sizes: [number, number][] = [];
    class StubOffscreenCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        sizes.push([width, height]);
        this.width = width;
        this.height = height;
      }
      getContext(): CanvasRenderingContext2D {
        return tolerant();
      }
    }
    vi.stubGlobal('OffscreenCanvas', StubOffscreenCanvas);

    const { canvas } = recordingHost();
    renderStaticScene(
      canvas,
      [rect({ id: 'a', width: 100, height: 100 })],
      {
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        zoom: 1,
      },
      {
        gridEnabled: false,
        gridSize: 20,
        zoom: 1,
        theme: 'light',
        dpr: 2,
      }
    );

    expect(sizes).toEqual([[240, 240]]);
    vi.unstubAllGlobals();
  });

  it('reuses a cached bitmap instead of reallocating one', () => {
    // Two frames with no version change must allocate once. A regression here
    // is the difference between a 1.7us blit and a 76us generation per element,
    // which is the entire reason the cache and its version check exist.
    let constructed = 0;
    class StubOffscreenCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        constructed += 1;
        this.width = width;
        this.height = height;
      }
      getContext(): CanvasRenderingContext2D {
        return tolerant();
      }
    }
    vi.stubGlobal('OffscreenCanvas', StubOffscreenCanvas);

    const element = rect({ id: 'a' });
    const { canvas } = recordingHost();
    const draw = (): StaticSceneFrameStats => {
      let stats: StaticSceneFrameStats | null = null;
      renderStaticScene(
        canvas,
        [element],
        { x: 0, y: 0, width: 800, height: 600, zoom: 1 },
        {
          gridEnabled: false,
          gridSize: 20,
          zoom: 1,
          theme: 'light',
          dpr: 1,
          onFrameStats: s => {
            stats = s;
          },
        }
      );
      return stats as unknown as StaticSceneFrameStats;
    };

    const first = draw();
    expect(first.bitmapsGenerated).toBe(1);
    expect(constructed).toBe(1);

    const second = draw();
    expect(second.bitmapsReused).toBe(1);
    expect(second.bitmapsGenerated).toBe(0);
    expect(constructed).toBe(1);
    vi.unstubAllGlobals();
  });

  it('reallocates after a theme change, because the bitmap is theme-baked', () => {
    let constructed = 0;
    class StubOffscreenCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        constructed += 1;
        this.width = width;
        this.height = height;
      }
      getContext(): CanvasRenderingContext2D {
        return tolerant();
      }
    }
    vi.stubGlobal('OffscreenCanvas', StubOffscreenCanvas);

    const element = rect({ id: 'a' });
    const { canvas } = recordingHost();
    const draw = (theme: 'light' | 'dark'): void => {
      renderStaticScene(
        canvas,
        [element],
        { x: 0, y: 0, width: 800, height: 600, zoom: 1 },
        {
          gridEnabled: false,
          gridSize: 20,
          zoom: 1,
          theme,
          dpr: 1,
        }
      );
    };

    draw('light');
    draw('dark');
    expect(constructed).toBe(2);

    // And back again, so a theme toggle is not a one-way trip.
    draw('light');
    expect(constructed).toBe(3);
    vi.unstubAllGlobals();
  });

  it('reallocates after a version bump, and keeps the byte total honest', () => {
    let constructed = 0;
    class StubOffscreenCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        constructed += 1;
        this.width = width;
        this.height = height;
      }
      getContext(): CanvasRenderingContext2D {
        return tolerant();
      }
    }
    vi.stubGlobal('OffscreenCanvas', StubOffscreenCanvas);

    const first = rect({ id: 'a', version: 1 });
    const { canvas } = recordingHost();
    const draw = (element: DriplElement): void => {
      renderStaticScene(
        canvas,
        [element],
        { x: 0, y: 0, width: 800, height: 600, zoom: 1 },
        {
          gridEnabled: false,
          gridSize: 20,
          zoom: 1,
          theme: 'light',
          dpr: 1,
        }
      );
    };

    draw(first);
    const afterFirst = getElementBitmapCacheStatsForTest();
    expect(afterFirst.entries).toBe(1);

    // A mutated element is a new object, so this is a fresh cache key.
    //
    // In production the superseded object is dropped by `mutateElement`'s
    // id-keyed invalidation — but this test drives `renderStaticScene` directly,
    // so no invalidation happens and `getOrCreateElementCanvas` has to drop the
    // object it supersedes itself. It used not to, which is why this assertion
    // said 2: `bitmapOrder` holds strong references by necessity, so the old
    // object and its bitmap stayed accounted for until a ceiling evicted them.
    // `bench/cache-retention.ts` measures what that cost: five rounds of
    // replacing every element object in a 1,200-element viewport left 3,270
    // entries and 81 MB of a 128 MB budget holding objects the scene could no
    // longer draw.
    draw({ ...first, version: 2 });
    const afterSecond = getElementBitmapCacheStatsForTest();
    expect(afterSecond.entries).toBe(1);
    // One live entry of the same size, not two: the total still tracks reality.
    expect(afterSecond.trackedBytes).toBe(afterFirst.trackedBytes);
    expect(constructed).toBe(2);
    vi.unstubAllGlobals();
  });
});
