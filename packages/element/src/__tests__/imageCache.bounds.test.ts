import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import { createImageCache } from '../image-cache';

/**
 * jsdom provides `Image` but never resolves it. Every test drives the real
 * lifecycle explicitly so the cache's own branching — load, error, timeout —
 * is exercised rather than stubbed out from underneath it.
 */
class ControlledImage {
  static instances: ControlledImage[] = [];

  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  width = 0;
  height = 0;

  private _src = '';

  constructor() {
    ControlledImage.instances.push(this);
  }

  set src(value: string) {
    this._src = value;
  }

  get src(): string {
    return this._src;
  }

  succeed(width = 320, height = 240): void {
    this.width = width;
    this.height = height;
    this.onload?.();
  }

  fail(): void {
    this.onerror?.();
  }
}

beforeEach(() => {
  ControlledImage.instances = [];
  vi.stubGlobal('Image', ControlledImage);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Resolve a `load()` whose image is already in flight. */
async function settle(times = 1): Promise<void> {
  await vi.advanceTimersByTimeAsync(times);
}

/** Let every queued microtask (the `await promise` inside `load`) drain. */
async function drain(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('image cache size ceiling', () => {
  it('defaults to a bound of 100 entries', () => {
    // The bound is the whole reason this class exists as written: unbounded
    // decoded bitmaps on a canvas with thousands of pasted images is a tab-killer.
    expect(createImageCache().getStats().maxSize).toBe(100);
  });

  it('never holds more than maxSize entries, however many are loaded', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 0, max: 20 }),
        async (maxSize, seed) => {
          const cache = createImageCache({ maxSize });
          const total = maxSize + 20;
          for (let i = 0; i < total; i += 1) {
            const pending = cache.load(`img-${seed}-${i}.png`);
            ControlledImage.instances.at(-1)?.succeed();
            await pending;
          }
          expect(cache.getStats().size).toBeLessThanOrEqual(maxSize);
        }
      ),
      { numRuns: 25 }
    );
  });

  it('evicts the least recently used entry first', async () => {
    const cache = createImageCache({ maxSize: 3 });
    for (const src of ['a.png', 'b.png', 'c.png']) {
      const pending = cache.load(src);
      ControlledImage.instances.at(-1)?.succeed();
      await pending;
    }

    // Touch 'a' so 'b' becomes the oldest.
    expect(cache.get('a.png')).toBeDefined();

    const pending = cache.load('d.png');
    ControlledImage.instances.at(-1)?.succeed();
    await pending;

    expect(cache.has('b.png')).toBe(false);
    expect(cache.has('a.png')).toBe(true);
    expect(cache.has('c.png')).toBe(true);
    expect(cache.has('d.png')).toBe(true);
  });

  it('evicts exactly as many entries as it is over the bound', async () => {
    const cache = createImageCache({ maxSize: 2 });
    for (const src of ['a.png', 'b.png', 'c.png', 'd.png', 'e.png']) {
      const pending = cache.load(src);
      ControlledImage.instances.at(-1)?.succeed();
      await pending;
    }
    expect(cache.getStats()).toEqual({ size: 2, maxSize: 2 });
  });
});

describe('image cache load lifecycle', () => {
  it('reports width and height for a decoded image', async () => {
    const cache = createImageCache();
    const pending = cache.load('ok.png');
    ControlledImage.instances.at(-1)?.succeed(640, 480);
    const cached = await pending;

    expect(cached.loaded).toBe(true);
    expect(cached.error).toBe(false);
    expect(cached.width).toBe(640);
    expect(cached.height).toBe(480);
    expect(cache.isLoaded('ok.png')).toBe(true);
    expect(cache.isError('ok.png')).toBe(false);
  });

  it('caches a failed load so the render path stops retrying', async () => {
    // `drawImageElement` distinguishes "failed" (draw the error tint, stop) from
    // "pending" (draw the placeholder, kick off a load). Only a cached entry
    // carries that distinction across frames, so an uncached failure is
    // re-requested on every single frame.
    const cache = createImageCache();
    const pending = cache.load('bad.png');
    ControlledImage.instances.at(-1)?.fail();
    const cached = await pending;

    expect(cached.loaded).toBe(false);
    expect(cached.error).toBe(true);
    expect(cache.has('bad.png')).toBe(true);
    expect(cache.isError('bad.png')).toBe(true);

    // The render path polls with `get`, so a cached failure is what stops it.
    expect(cache.get('bad.png')).toBe(cached);
  });

  it('caches a timed-out load instead of leaving it pending forever', async () => {
    // A source that fires neither onload nor onerror is the hang case. If the
    // timeout result were dropped rather than cached, `get()` would keep
    // returning undefined and `drawImageElement` would re-issue `load()` on
    // every frame — a new `Image` and a new timer per frame, per element, for a
    // request that is never going to succeed.
    const cache = createImageCache({ preloadTimeout: 5000 });
    const pending = cache.load('hung.png');
    await settle(5001);
    const cached = await pending;

    expect(cached.loaded).toBe(false);
    expect(cached.error).toBe(true);
    expect(cache.has('hung.png')).toBe(true);
    expect(cache.isError('hung.png')).toBe(true);

    // The render path polls with `get`, and a cached terminal result is what
    // makes it stop issuing new requests. (An explicit `load()` still retries,
    // exactly as it does for an `onerror` failure; the no-retry guarantee belongs
    // to the poll, not to `load`.)
    expect(cache.get('hung.png')).toBe(cached);
    expect(ControlledImage.instances).toHaveLength(1);
  });

  it('serves a decoded source from the cache without a new request', async () => {
    const cache = createImageCache();
    const first = cache.load('warm.png');
    ControlledImage.instances.at(-1)?.succeed(11, 22);
    const cached = await first;

    const second = await cache.load('warm.png');
    expect(second).toBe(cached);
    expect(ControlledImage.instances).toHaveLength(1);
  });

  it('reports a not-yet-decoded entry as neither loaded nor errored', async () => {
    const cache = createImageCache();
    const pending = cache.load('slow.png');
    expect(cache.has('slow.png')).toBe(false);
    expect(cache.isLoaded('slow.png')).toBe(false);
    expect(cache.isError('slow.png')).toBe(false);
    expect(cache.get('slow.png')).toBeUndefined();

    ControlledImage.instances.at(-1)?.succeed();
    await pending;
    expect(cache.isLoaded('slow.png')).toBe(true);
  });

  it('collapses concurrent loads of the same source into one request', async () => {
    const cache = createImageCache();
    const a = cache.load('same.png');
    const b = cache.load('same.png');
    const c = cache.load('same.png');

    expect(ControlledImage.instances).toHaveLength(1);
    ControlledImage.instances[0]?.succeed();
    const [first, second, third] = await Promise.all([a, b, c]);
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(ControlledImage.instances).toHaveLength(1);
  });

  it('re-requests a failed source when load is called explicitly', async () => {
    // Distinct from the render path above: an explicit `load()` on a source
    // whose entry records a failure starts a fresh attempt, so a transient
    // network blip is recoverable without a page reload.
    const cache = createImageCache();
    const first = cache.load('retry.png');
    ControlledImage.instances.at(-1)?.fail();
    await first;
    expect(cache.isError('retry.png')).toBe(true);

    const second = cache.load('retry.png');
    expect(ControlledImage.instances).toHaveLength(2);
    ControlledImage.instances[1]?.succeed(10, 20);
    expect((await second).loaded).toBe(true);
  });

  it('does not leave the in-flight bookkeeping behind after settling', async () => {
    // A leaked in-flight entry would make every later load of that source
    // return the first promise forever, even after `clear()`.
    const cache = createImageCache();
    const first = cache.load('leak.png');
    ControlledImage.instances.at(-1)?.succeed();
    await first;
    cache.clear();

    const second = cache.load('leak.png');
    expect(ControlledImage.instances).toHaveLength(2);
    ControlledImage.instances[1]?.succeed();
    expect((await second).loaded).toBe(true);
  });
});

describe('image cache maintenance', () => {
  it('preload starts a load for an unknown source', async () => {
    const cache = createImageCache();
    cache.preload('p.png');
    await drain();
    expect(ControlledImage.instances).toHaveLength(1);
    ControlledImage.instances[0]?.succeed();
    await settle();
    expect(cache.isLoaded('p.png')).toBe(true);
  });

  it('preload is a no-op for a source already in flight', async () => {
    const cache = createImageCache();
    const pending = cache.load('q.png');
    await drain();
    cache.preload('q.png');
    expect(ControlledImage.instances).toHaveLength(1);
    ControlledImage.instances[0]?.succeed();
    await pending;
    expect(ControlledImage.instances).toHaveLength(1);
  });

  it('preload is a no-op for a source already cached', async () => {
    const cache = createImageCache();
    const pending = cache.load('r.png');
    ControlledImage.instances.at(-1)?.succeed();
    await pending;
    cache.preload('r.png');
    expect(ControlledImage.instances).toHaveLength(1);
  });

  it('preloadMultiple starts one load per distinct source', async () => {
    const cache = createImageCache();
    cache.preloadMultiple(['m1.png', 'm2.png', 'm1.png', 'm3.png']);
    await drain();
    expect(ControlledImage.instances).toHaveLength(3);
    for (const instance of ControlledImage.instances) instance.succeed();
    await settle();
    expect(cache.getStats().size).toBe(3);
  });

  it('remove drops the entry from both the cache and the eviction order', async () => {
    // If the access-order entry survived, eviction would later try to delete a
    // key with no cache entry and its loop condition (`accessOrder.size > 0`)
    // could spin without bound.
    const cache = createImageCache({ maxSize: 2 });
    for (const src of ['s1.png', 's2.png']) {
      const pending = cache.load(src);
      ControlledImage.instances.at(-1)?.succeed();
      await pending;
    }
    cache.remove('s1.png');
    expect(cache.has('s1.png')).toBe(false);

    const pending = cache.load('s3.png');
    ControlledImage.instances.at(-1)?.succeed();
    await pending;
    expect(cache.getStats().size).toBe(2);
  });

  it('reloads a source after remove', async () => {
    const cache = createImageCache();
    const first = cache.load('gone.png');
    ControlledImage.instances.at(-1)?.succeed();
    await first;
    cache.remove('gone.png');

    const second = cache.load('gone.png');
    expect(ControlledImage.instances).toHaveLength(2);
    ControlledImage.instances[1]?.succeed();
    expect((await second).loaded).toBe(true);
  });

  it('clear empties the cache, the eviction order, and the in-flight map', async () => {
    const cache = createImageCache();
    const pending = cache.load('c1.png');
    ControlledImage.instances.at(-1)?.succeed();
    await pending;

    cache.clear();

    expect(cache.getStats().size).toBe(0);
    expect(cache.has('c1.png')).toBe(false);
    expect(cache.get('c1.png')).toBeUndefined();

    // The in-flight map is cleared too, so a later load is a real request and
    // not the promise of one that has already resolved.
    const second = cache.load('c2.png');
    expect(ControlledImage.instances).toHaveLength(2);
    ControlledImage.instances[1]?.succeed();
    expect((await second).loaded).toBe(true);
    expect(cache.getStats().size).toBe(1);
  });

  it('getStats reports the live size and the configured bound', async () => {
    const cache = createImageCache({ maxSize: 7 });
    expect(cache.getStats()).toEqual({ size: 0, maxSize: 7 });
    const pending = cache.load('g.png');
    ControlledImage.instances.at(-1)?.succeed();
    await pending;
    expect(cache.getStats()).toEqual({ size: 1, maxSize: 7 });
  });
});
