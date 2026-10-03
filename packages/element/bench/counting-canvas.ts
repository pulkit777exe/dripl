/**
 * A counting canvas host for the render path.
 *
 * WHY THIS EXISTS, AND WHY IT IS THE PRIMARY HARNESS
 * ----------------------------------------------------
 * The static scene path (`renderStaticScene`) runs in a browser: `<canvas>`,
 * Rough.js, per-element offscreen bitmaps. jsdom cannot allocate a 2D context
 * at all — `HTMLCanvasElement.prototype.getContext` throws "Not implemented",
 * which is why `generateElementCanvas` returns `null` under the existing test
 * suite and every test there exercises the `failed` branch rather than the real
 * draw. Adding `node-canvas` to make a benchmark work is not on the table.
 *
 * So the harness stubs the boundary instead: a `Proxy` that turns *every* 2D
 * context method into a counter. That choice is deliberate.
 *
 * - It measures **call counts and allocation counts**, which are integers.
 *   Wall-clock milliseconds on a shared machine move by 2-3x between identical
 *   runs; a draw-call count does not move at all. For "did this change remove
 *   work", a count is a stronger signal than a stopwatch.
 * - A `Proxy` counts methods the harness has never heard of. Rough.js reaches
 *   for `bezierCurveTo`, `quadraticCurveTo`, `arc`, `ellipse`, `setLineDash`,
 *   `clip` and more depending on shape and options; a hand-written method list
 *   would silently under-count whatever it forgot, which is the one failure mode
 *   that makes a benchmark lie.
 * - It separates the two costs that matter and that frame timings conflate:
 *   calls on the **visible** context (blits, clear, grid) versus calls on the
 *   **offscreen** contexts (Rough.js path generation). The existing docs record
 *   ~76 us to generate a bitmap against ~1.7 us to blit one, so "how many calls
 *   land where" is the measurement that says which one you are paying.
 *
 * WHAT IT DOES NOT MEASURE
 * ------------------------
 * It measures no pixels, no rasterization cost, and no GPU work. Every call is
 * O(1) here and O(rasterized area) in a browser. It therefore cannot rank two
 * implementations that issue the *same* number of calls but rasterize different
 * areas. It is the right tool for call-count and allocation claims and the wrong
 * tool for "is this frame under 16.7 ms"; that still needs the browser.
 */

/** Method name -> number of calls issued in the current window. */
export type CallTally = Record<string, number>;

export interface CountingHost {
  /** The on-screen canvas. Its context receives blits, clears and the grid. */
  readonly canvas: HTMLCanvasElement;
  /** Calls issued against the on-screen context. */
  readonly visible: CallTally;
  /** Calls issued against every offscreen (per-element bitmap) context. */
  readonly offscreen: CallTally;
  /** Offscreen canvases allocated since the last `reset()`. */
  offscreenCanvases: number;
  /** Sum of `width * height` over offscreen canvases allocated since `reset()`. */
  offscreenPixels: number;
  /** Zero the tallies and the allocation counters, keeping the same contexts. */
  reset(): void;
  /** Total calls in a tally, for a single comparable number. */
  total(tally: CallTally): number;
  /** Restore the `OffscreenCanvas` global this host replaced. */
  dispose(): void;
}

function emptyTally(): CallTally {
  return {};
}

export function tallyTotal(tally: CallTally): number {
  let total = 0;
  for (const value of Object.values(tally)) total += value;
  return total;
}

/**
 * Deterministic stand-in for `measureText`, proportional to length so text
 * layout is stable across runs. The exact width is irrelevant to call counts.
 */
function measureText(text: string): TextMetrics {
  return {
    width: text.length * 8,
    actualBoundingBoxAscent: 12,
    actualBoundingBoxDescent: 4,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: text.length * 8,
    alphabeticBaseline: 0,
    emHeightAscent: 12,
    emHeightDescent: 4,
    ideographicBaseline: 0,
  } as TextMetrics;
}

/**
 * Methods that must return a usable value rather than being a plain counted
 * call. Everything the harness has not heard of still gets counted, which is
 * the property that keeps the tally honest.
 */
const VALUE_RETURNING = new Set<string>([
  'measureText',
  'getLineDash',
  'isPointInPath',
  'isPointInStroke',
  'createPattern',
  'createImageData',
  'getImageData',
  'getTransform',
]);

/** Properties that must not be counted: promise probing and constructor lookup. */
const NON_CALL_PROPS = new Set<string>(['then', 'constructor']);

/**
 * Wrap a plain object of no-op canvas methods so every call is counted.
 *
 * `tally` is captured by closure, not read from the proxy, so one context can be
 * re-windowed by `reset()` without losing its identity — which the cache
 * scenarios need, since the visible context must survive across frames the way a
 * real one does.
 */
export function makeCountingContext(tally: CallTally): CanvasRenderingContext2D {
  const base: Record<string, unknown> = {
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
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineDashOffset: 0,
    filter: 'none',
    imageSmoothingEnabled: true,
    shadowBlur: 0,
    shadowColor: 'rgba(0, 0, 0, 0)',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };

  return new Proxy(base, {
    get(target, property) {
      if (typeof property === 'symbol') return Reflect.get(target, property);
      if (property in target) return Reflect.get(target, property);
      if (property === 'measureText') {
        return (text: string): TextMetrics => {
          tally.measureText = (tally.measureText ?? 0) + 1;
          return measureText(text);
        };
      }
      if (NON_CALL_PROPS.has(property)) return undefined;
      if (VALUE_RETURNING.has(property)) {
        return (): unknown => {
          tally[property] = (tally[property] ?? 0) + 1;
          return property === 'getLineDash' ? [] : false;
        };
      }
      return (...args: unknown[]): undefined => {
        tally[property] = (tally[property] ?? 0) + 1;
        void args;
        return undefined;
      };
    },
    set(target, property, value) {
      if (typeof property === 'symbol') return Reflect.set(target, property, value);
      target[property] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

export interface CountingHostOptions {
  /** CSS pixels of the on-screen canvas. */
  width?: number;
  height?: number;
  /** Device pixel ratio written into the on-screen canvas' backing store. */
  dpr?: number;
}

/**
 * A complete counting canvas environment: one on-screen canvas, a counted
 * `OffscreenCanvas`, and per-surface call tallies.
 *
 * `generateElementCanvas` branches on `typeof OffscreenCanvas !== 'undefined'`,
 * so `dispose()` has to put the global back. A leaked stub would silently
 * change which code path a later scenario measures.
 */
export function createCountingHost(options: CountingHostOptions = {}): CountingHost {
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const dpr = options.dpr ?? 1;

  const visibleTally = emptyTally();
  const offscreenTally = emptyTally();

  const visibleCtx = makeCountingContext(visibleTally);
  const canvas = {
    width: Math.floor(width * dpr),
    height: Math.floor(height * dpr),
    style: { width: `${width}px`, height: `${height}px` } as CSSStyleDeclaration,
    getContext: (kind: string): CanvasRenderingContext2D | null =>
      kind === '2d' ? visibleCtx : null,
  } as unknown as HTMLCanvasElement;

  const globalHolder = globalThis as unknown as { OffscreenCanvas?: unknown };
  const previousOffscreenCanvas = globalHolder.OffscreenCanvas;
  const host: CountingHost = {
    canvas,
    visible: visibleTally,
    offscreen: offscreenTally,
    offscreenCanvases: 0,
    offscreenPixels: 0,
    reset() {
      for (const key of Object.keys(visibleTally)) delete visibleTally[key];
      for (const key of Object.keys(offscreenTally)) delete offscreenTally[key];
      host.offscreenCanvases = 0;
      host.offscreenPixels = 0;
    },
    total: tallyTotal,
    dispose() {
      if (previousOffscreenCanvas === undefined) delete globalHolder.OffscreenCanvas;
      else globalHolder.OffscreenCanvas = previousOffscreenCanvas;
    },
  };

  class CountingOffscreenCanvas {
    width: number;
    height: number;
    private readonly ctx: CanvasRenderingContext2D;
    constructor(offscreenWidth: number, offscreenHeight: number) {
      this.width = offscreenWidth;
      this.height = offscreenHeight;
      host.offscreenCanvases += 1;
      host.offscreenPixels += offscreenWidth * offscreenHeight;
      this.ctx = makeCountingContext(offscreenTally);
    }
    getContext(): CanvasRenderingContext2D {
      return this.ctx;
    }
  }
  globalHolder.OffscreenCanvas = CountingOffscreenCanvas;

  return host;
}
