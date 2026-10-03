import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';

import {
  getElementBitmapCacheStatsForTest,
  hasCachedBitmapForTest,
  renderStaticScene,
  resetElementBitmapCacheForTest,
} from '../staticScene';

/**
 * The state a cached-bitmap blit touches, and the state it must not leave behind.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A blit used to be wrapped in `ctx.save()` / `ctx.restore()` for every element,
 * which measured as exactly two calls per blit — 66.5% of every call a steady
 * frame makes on the visible canvas. The pair is gone for unrotated elements, and
 * this file is the regression guard for why that is safe:
 *
 * - a rotated element still gets the pair, because it mutates the transform;
 * - every blit still sets the alpha it draws with, so no element inherits the
 *   previous element's alpha;
 * - the alpha the *caller* set on the context is handed back when the frame
 *   ends, so the next frame — which draws the grid before touching alpha itself —
 *   starts from the same value it always did.
 *
 * The last one is the one that would be invisible in a screenshot of a single
 * frame, which is why it is pinned directly rather than inferred from output.
 *
 * WHY THE HOST IS BUILT HERE
 * --------------------------
 * jsdom cannot allocate a 2D context, so `generateElementCanvas` returns null and
 * every element takes the `failed` branch. These tests need real blits, so they
 * substitute both surfaces: a counting visible context and an `OffscreenCanvas`
 * whose context is a no-op mock. Without that substitution an unrotated-blit test
 * would silently assert nothing, because nothing would be drawn.
 */

interface TraceEntry {
  op: string;
  alpha: number;
}

interface InstrumentedContext {
  ctx: Record<string, unknown>;
  trace: TraceEntry[];
  alphas: number[];
  count(op: string): number;
}

/**
 * A 2D context that records every call and every alpha assignment.
 *
 * It is used for both surfaces: the visible one (whose calls are asserted) and
 * each per-element offscreen one (whose calls are not). The offscreen context has
 * to be a *complete* mock rather than the shared `createMockCanvasContext`,
 * because Rough.js reaches for `bezierCurveTo` and the shared mock does not
 * define it — a partial mock makes bitmap generation throw, and every element
 * then silently takes the `failed` branch, which would make these assertions
 * vacuous.
 */
function instrumentedContext(initialAlpha = 1): InstrumentedContext {
  const trace: TraceEntry[] = [];
  const alphas: number[] = [];
  const counts: Record<string, number> = {};
  const state = { alpha: initialAlpha };

  const record = (op: string) => (): undefined => {
    counts[op] = (counts[op] ?? 0) + 1;
    trace.push({ op, alpha: state.alpha });
    return undefined;
  };

  const ctx: Record<string, unknown> = {
    canvas: null,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    direction: 'inherit',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    globalCompositeOperation: 'source-over',
    lineDashOffset: 0,
    imageSmoothingEnabled: true,
    shadowBlur: 0,
    shadowColor: 'rgba(0, 0, 0, 0)',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    filter: 'none',
    save: record('save'),
    restore: record('restore'),
    setTransform: record('setTransform'),
    resetTransform: record('resetTransform'),
    transform: record('transform'),
    clearRect: record('clearRect'),
    scale: record('scale'),
    translate: record('translate'),
    rotate: record('rotate'),
    drawImage: record('drawImage'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    fillText: record('fillText'),
    strokeText: record('strokeText'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    bezierCurveTo: record('bezierCurveTo'),
    quadraticCurveTo: record('quadraticCurveTo'),
    arc: record('arc'),
    ellipse: record('ellipse'),
    rect: record('rect'),
    closePath: record('closePath'),
    fill: record('fill'),
    stroke: record('stroke'),
    clip: record('clip'),
    setLineDash: record('setLineDash'),
    getLineDash: () => [],
    measureText: (text: string) => ({ width: text.length * 8 }) as TextMetrics,
  };
  Object.defineProperty(ctx, 'globalAlpha', {
    get: () => state.alpha,
    set: (value: number) => {
      state.alpha = value;
      alphas.push(value);
    },
    enumerable: true,
    configurable: true,
  });

  return { ctx, trace, alphas, count: (op: string) => counts[op] ?? 0 };
}

interface CountingHost extends InstrumentedContext {
  canvas: HTMLCanvasElement;
}

function installCountingHost(width = 800, height = 600, initialAlpha = 1): CountingHost {
  const instrumented = instrumentedContext(initialAlpha);
  return {
    ...instrumented,
    canvas: {
      getContext: () => instrumented.ctx,
      width,
      height,
      style: {},
    } as unknown as HTMLCanvasElement,
  };
}

let restoreOffscreen: (() => void) | null = null;

/**
 * `generateElementCanvas` branches on `typeof OffscreenCanvas !== 'undefined'`,
 * and jsdom has none, so without this substitution nothing is ever rasterized.
 */
function installOffscreenCanvas(): void {
  const holder = globalThis as unknown as { OffscreenCanvas?: unknown };
  const previous = holder.OffscreenCanvas;
  class StubOffscreenCanvas {
    width: number;
    height: number;
    private readonly context: InstrumentedContext;
    constructor(offscreenWidth: number, offscreenHeight: number) {
      this.width = offscreenWidth;
      this.height = offscreenHeight;
      this.context = instrumentedContext();
    }
    getContext(): CanvasRenderingContext2D {
      return this.context.ctx as unknown as CanvasRenderingContext2D;
    }
  }
  holder.OffscreenCanvas = StubOffscreenCanvas;
  restoreOffscreen = () => {
    if (previous === undefined) delete holder.OffscreenCanvas;
    else holder.OffscreenCanvas = previous;
  };
}

function rect(overrides: Partial<DriplElement> = {}): DriplElement {
  return {
    id: 'r',
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 70,
    strokeColor: '#000000',
    backgroundColor: '#dbe4ff',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    ...overrides,
  } as DriplElement;
}

interface FrameOptions {
  gridEnabled?: boolean;
  maxNewBitmapsPerFrame?: number;
  width?: number;
  height?: number;
}

function renderFrame(
  host: CountingHost,
  elements: DriplElement[],
  options: FrameOptions = {}
): void {
  const width = options.width ?? 800;
  const height = options.height ?? 600;
  // `exactOptionalPropertyTypes` is on, so an absent budget must be absent rather
  // than present-and-undefined: the two mean different things here, the default
  // being the module's `DEFAULT_MAX_NEW_BITMAPS_PER_FRAME`.
  const budget =
    options.maxNewBitmapsPerFrame === undefined
      ? {}
      : { maxNewBitmapsPerFrame: options.maxNewBitmapsPerFrame };
  renderStaticScene(
    host.canvas,
    elements,
    { x: 0, y: 0, width, height, zoom: 1 },
    {
      gridEnabled: options.gridEnabled ?? false,
      gridSize: 20,
      zoom: 1,
      theme: 'light',
      dpr: 1,
      ...budget,
      elements,
      visibleElements: elements,
    }
  );
}

beforeEach(() => {
  resetElementBitmapCacheForTest();
  installOffscreenCanvas();
});

afterEach(() => {
  restoreOffscreen?.();
  restoreOffscreen = null;
  resetElementBitmapCacheForTest();
});

describe('cached-bitmap blit state', () => {
  it('blits an unrotated element without a save/restore pair', () => {
    const host = installCountingHost();
    renderFrame(host, [rect()]);

    expect(host.count('drawImage')).toBe(1);
    // The whole point: two fewer canvas calls for the same pixels.
    expect(host.count('save')).toBe(0);
    expect(host.count('restore')).toBe(0);
    // The frame still establishes the camera once, not once per element.
    expect(host.count('setTransform')).toBe(1);
    expect(host.count('scale')).toBe(2);
  });

  it('still saves, rotates and restores for a rotated element', () => {
    const host = installCountingHost();
    renderFrame(host, [rect({ angle: 0.5 })]);

    expect(host.count('save')).toBe(1);
    expect(host.count('restore')).toBe(1);
    // translate(cx, cy), rotate, translate(-cx, -cy)
    expect(host.count('rotate')).toBe(1);
    expect(host.count('drawImage')).toBe(1);
  });

  it('gives each element its own alpha rather than inheriting the last one', () => {
    const host = installCountingHost();
    const elements = [
      rect({ id: 'half', x: 0, opacity: 0.5 }),
      rect({ id: 'full', x: 200, opacity: 1 }),
      rect({ id: 'faint', x: 400, opacity: 0.25 }),
    ];
    renderFrame(host, elements);

    expect(host.count('drawImage')).toBe(3);
    // Every blit assigns the alpha it draws with, in element order.
    expect(host.alphas.slice(0, 3)).toEqual([0.5, 1, 0.25]);
  });

  it('hands the context back the alpha the caller set', () => {
    const host = installCountingHost(800, 600, 0.25);
    renderFrame(host, [rect({ opacity: 0.5 })]);

    const context = host.canvas.getContext('2d');
    // A caller that owns the context must find it as it left it: the old
    // per-element `restore` did this implicitly for every element.
    expect(context?.globalAlpha).toBe(0.25);
  });

  it('does not let one frame alpha reach the next frame grid', () => {
    // The regression this whole change could plausibly cause: the grid is drawn at
    // the top of a frame, before any element assigns alpha, so a leaked alpha
    // would draw the next frame's grid at the wrong opacity with nothing in that
    // frame to account for it.
    const host = installCountingHost(800, 600, 0.8);
    const elements = [rect({ opacity: 0.5 }), rect({ id: 'second', x: 200, opacity: 0.1 })];

    renderFrame(host, elements, { gridEnabled: true });
    host.trace.length = 0;
    renderFrame(host, elements, { gridEnabled: true });

    const gridStroke = host.trace.find(entry => entry.op === 'stroke');
    expect(gridStroke).toBeDefined();
    expect(gridStroke?.alpha).toBe(0.8);
  });

  it('leaves the alpha alone when a frame draws no elements', () => {
    const host = installCountingHost(800, 600, 0.3);
    renderFrame(host, []);

    expect(host.canvas.getContext('2d')?.globalAlpha).toBe(0.3);
    expect(host.alphas).toEqual([]);
  });
});

describe('deferred-element placeholder state', () => {
  it('draws an unrotated placeholder without a save/restore pair', () => {
    const host = installCountingHost();
    renderFrame(host, [rect()], { maxNewBitmapsPerFrame: 0 });

    expect(host.count('save')).toBe(0);
    expect(host.count('restore')).toBe(0);
    expect(host.count('fillRect')).toBe(1);
    expect(host.count('strokeRect')).toBe(1);
    expect(host.count('drawImage')).toBe(0);
  });

  it('still saves and restores a rotated placeholder', () => {
    const host = installCountingHost();
    renderFrame(host, [rect({ angle: 1.2 })], { maxNewBitmapsPerFrame: 0 });

    expect(host.count('save')).toBe(1);
    expect(host.count('restore')).toBe(1);
    expect(host.count('strokeRect')).toBe(1);
  });

  it('sets the placeholder alpha explicitly', () => {
    const host = installCountingHost(800, 600, 1);
    renderFrame(host, [rect({ opacity: 0.3 })], { maxNewBitmapsPerFrame: 0 });

    expect(host.alphas).toContain(0.3);
    expect(host.canvas.getContext('2d')?.globalAlpha).toBe(1);
  });
});

describe('a new element object for a cached id', () => {
  // `bringForward` in the store maps the whole scene to fresh `{ ...el }` objects
  // without bumping `version`, so the cache sees a new object for an id it
  // already holds. The superseded object has to be dropped at that moment:
  // `bitmapOrder` holds strong references by necessity, and nothing else removes
  // an entry that was never invalidated by id.
  const objectBytes = 120 * 90 * 4;

  it('replaces the cached entry instead of accumulating one per object', () => {
    const first = rect({ id: 'shared' });
    renderFrame(installCountingHost(), [first]);
    expect(getElementBitmapCacheStatsForTest().entries).toBe(1);
    expect(getElementBitmapCacheStatsForTest().trackedBytes).toBe(objectBytes);

    // Same id, same version, new object: exactly what a z-order change produces.
    const second = { ...first };
    renderFrame(installCountingHost(), [second]);

    const stats = getElementBitmapCacheStatsForTest();
    expect(stats.entries).toBe(1);
    expect(stats.trackedBytes).toBe(objectBytes);
    expect(hasCachedBitmapForTest(first)).toBe(false);
    expect(hasCachedBitmapForTest(second)).toBe(true);
  });

  it('does not accumulate across repeated replacements', () => {
    let current = rect({ id: 'churn' });
    renderFrame(installCountingHost(), [current]);
    for (let round = 0; round < 10; round += 1) {
      current = { ...current };
      renderFrame(installCountingHost(), [current]);
    }

    const stats = getElementBitmapCacheStatsForTest();
    expect(stats.entries).toBe(1);
    expect(stats.trackedBytes).toBe(objectBytes);
    expect(hasCachedBitmapForTest(current)).toBe(true);
  });

  it('leaves other ids alone', () => {
    const kept = rect({ id: 'kept' });
    const replaced = rect({ id: 'replaced' });
    renderFrame(installCountingHost(), [kept, replaced]);

    const replacement = { ...replaced };
    renderFrame(installCountingHost(), [kept, replacement]);

    const stats = getElementBitmapCacheStatsForTest();
    expect(stats.entries).toBe(2);
    expect(hasCachedBitmapForTest(kept)).toBe(true);
    expect(hasCachedBitmapForTest(replacement)).toBe(true);
    expect(hasCachedBitmapForTest(replaced)).toBe(false);
  });

  it('regenerates a superseded object if it comes back', () => {
    // Undo restores history snapshots, whose objects are the older ones. The old
    // object must still draw correctly — it just draws from a fresh bitmap.
    const original = rect({ id: 'undone' });
    renderFrame(installCountingHost(), [original]);
    renderFrame(installCountingHost(), [{ ...original }]);
    expect(hasCachedBitmapForTest(original)).toBe(false);

    const host = installCountingHost();
    renderFrame(host, [original]);

    expect(host.count('drawImage')).toBe(1);
    expect(hasCachedBitmapForTest(original)).toBe(true);
    expect(getElementBitmapCacheStatsForTest().entries).toBe(1);
  });
});
