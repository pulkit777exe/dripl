/**
 * Recording 2D context for renderer tests.
 *
 * `packages/test-utils/src/mock-canvas.ts` already fakes a `CanvasRenderingContext2D`
 * for the `@dripl/element` renderer, but `@dripl/test-utils` is not a dependency
 * of `dripl-app`, and adding one would change the workspace dependency graph.
 * So this is the same idea locally: a fake context that is inert unless a test
 * asks it to record.
 *
 * What it records, and why that is enough to assert behaviour:
 *
 * - **Every drawing call** (`rect`, `arc`, `lineTo`, `fillText`, `strokeRect`, …)
 *   with its arguments, the drawing state in force at the time, and the save/restore
 *   depth. A renderer bug — a dropped field, an inverted comparison, a mis-ordered
 *   overlay — shows up as a difference in this log.
 * - **`measureText`**, driven by a per-string width table so text metrics are exact
 *   rather than approximate. `renderText` reads metrics back out of a module-level
 *   cache, so the width table has to be deterministic.
 * - **The transform phase**: the index of the last `setTransform`. `renderInteractiveScene`
 *   uses exactly two transforms (world, then screen), which is the only observable
 *   difference between its two draw passes, and it is what makes draw ORDER assertable
 *   rather than just draw membership.
 */

export interface RecordedStyle {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  lineCap: string;
  lineJoin: string;
  lineDash: number[];
}

export interface RecordedOp {
  method: string;
  args: readonly unknown[];
  style: RecordedStyle;
  /** `save()` nesting depth when the call was made; 0 at the top level. */
  depth: number;
  /** Index of the most recent `setTransform`; distinguishes world vs screen pass. */
  phase: number;
}

export interface RecordingContext {
  ctx: CanvasRenderingContext2D;
  ops: RecordedOp[];
  /** Every recorded call to `method`, in order. */
  calls(method: string): RecordedOp[];
  /** Arguments of every recorded call to `method`, in order. */
  argLists(method: string): unknown[][];
  countOf(method: string): number;
  reset(): void;
  /** Snapshot of the context's drawing state right now. */
  style(): RecordedStyle;
}

/** Path construction and painting calls; all recorded uniformly. */
const RECORDED_METHODS = [
  'beginPath',
  'closePath',
  'moveTo',
  'lineTo',
  'arc',
  'arcTo',
  'ellipse',
  'rect',
  'roundRect',
  'quadraticCurveTo',
  'bezierCurveTo',
  'fill',
  'stroke',
  'clip',
  'fillRect',
  'strokeRect',
  'clearRect',
  'fillText',
  'strokeText',
  'drawImage',
  'translate',
  'rotate',
  'scale',
  'transform',
] as const;

export interface RecordingContextOptions {
  /** Exact widths for `measureText`. Any string not listed falls back to `length * defaultCharWidth`. */
  textWidths?: Record<string, number>;
  /** Per-character width for strings absent from `textWidths`. Default 0. */
  defaultCharWidth?: number;
}

/**
 * Build a fake `CanvasRenderingContext2D` that records every call.
 *
 * The returned object satisfies the full `CanvasRenderingContext2D` type via a
 * single cast at the end; everything the renderer actually touches is implemented
 * above, so the cast is not hiding missing behaviour for the code under test.
 */
export function createRecordingContext(options: RecordingContextOptions = {}): RecordingContext {
  const { textWidths = {}, defaultCharWidth = 0 } = options;

  const ops: RecordedOp[] = [];
  const stateStack: RecordedStyle[] = [];
  let phase = 0;

  const state: RecordedStyle = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    globalAlpha: 1,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    lineCap: 'butt',
    lineJoin: 'miter',
    lineDash: [],
  };

  const snapshot = (): RecordedStyle => ({ ...state, lineDash: [...state.lineDash] });

  function record(method: string, ...args: unknown[]): void {
    ops.push({ method, args, style: snapshot(), depth: stateStack.length, phase });
  }

  const fake: Record<string, unknown> = {};

  for (const method of RECORDED_METHODS) {
    fake[method] = (...args: unknown[]) => record(method, ...args);
  }

  fake.save = () => {
    stateStack.push(snapshot());
    record('save');
  };

  fake.restore = () => {
    record('restore');
    const previous = stateStack.pop();
    if (previous) Object.assign(state, previous, { lineDash: [...previous.lineDash] });
  };

  fake.setTransform = (...args: unknown[]) => {
    phase += 1;
    record('setTransform', ...args);
  };

  fake.setLineDash = (...args: unknown[]) => {
    const [segments] = args as [number[] | undefined];
    state.lineDash = segments ? [...segments] : [];
    record('setLineDash', ...args);
  };

  fake.getLineDash = () => [...state.lineDash];

  fake.measureText = (text: string) => {
    record('measureText', text);
    const width = textWidths[text] ?? text.length * defaultCharWidth;
    return { width } as TextMetrics;
  };

  fake.createLinearGradient = () => ({ addColorStop: () => {} });
  fake.createRadialGradient = () => ({ addColorStop: () => {} });
  fake.direction = 'inherit';
  fake.globalCompositeOperation = 'source-over';

  for (const key of [
    'fillStyle',
    'strokeStyle',
    'lineWidth',
    'globalAlpha',
    'font',
    'textAlign',
    'textBaseline',
    'lineCap',
    'lineJoin',
  ] as const) {
    Object.defineProperty(fake, key, {
      get: () => state[key],
      set: (value: unknown) => {
        state[key] = value as never;
      },
      enumerable: true,
      configurable: true,
    });
  }

  const ctx = fake as unknown as CanvasRenderingContext2D;

  return {
    ctx,
    ops,
    calls: (method: string) => ops.filter(op => op.method === method),
    argLists: (method: string) => ops.filter(op => op.method === method).map(op => [...op.args]),
    countOf: (method: string) => ops.filter(op => op.method === method).length,
    reset: () => {
      ops.length = 0;
      stateStack.length = 0;
      phase = 0;
    },
    style: snapshot,
  };
}

/** Numeric args of every `arc` call, as `[cx, cy, r, start, end]`. */
export function arcs(rec: RecordingContext): number[][] {
  return rec.argLists('arc').map(args => args.map(value => Number(value)));
}

/** Numeric args of every `lineTo` call, as `[x, y]`. */
export function lineTos(rec: RecordingContext): Array<[number, number]> {
  return rec.argLists('lineTo').map(args => [Number(args[0]), Number(args[1])] as [number, number]);
}

/** Numeric args of every `moveTo` call, as `[x, y]`. */
export function moveTos(rec: RecordingContext): Array<[number, number]> {
  return rec.argLists('moveTo').map(args => [Number(args[0]), Number(args[1])] as [number, number]);
}

/** Every `rect` call's `[x, y, width, height]`. */
export function rects(rec: RecordingContext): Array<[number, number, number, number]> {
  return rec
    .argLists('rect')
    .map(
      args =>
        [Number(args[0]), Number(args[1]), Number(args[2]), Number(args[3])] as [
          number,
          number,
          number,
          number,
        ]
    );
}

/** Every `strokeRect` call's `[x, y, width, height]`. */
export function strokeRects(rec: RecordingContext): Array<[number, number, number, number]> {
  return rec
    .argLists('strokeRect')
    .map(
      args =>
        [Number(args[0]), Number(args[1]), Number(args[2]), Number(args[3])] as [
          number,
          number,
          number,
          number,
        ]
    );
}

/** Every `fillText` call, as `[text, x, y]`. */
export function fillTexts(rec: RecordingContext): Array<[string, number, number]> {
  return rec
    .argLists('fillText')
    .map(args => [String(args[0]), Number(args[1]), Number(args[2])] as [string, number, number]);
}

/** Every `translate` call, as `[x, y]`. */
export function translates(rec: RecordingContext): Array<[number, number]> {
  return rec
    .argLists('translate')
    .map(args => [Number(args[0]), Number(args[1])] as [number, number]);
}

/** Every `rotate` call, as `[angle]`. */
export function rotates(rec: RecordingContext): number[] {
  return rec.argLists('rotate').map(args => Number(args[0]));
}

/** Every `ellipse` call, as `[cx, cy, rx, ry, rotation, start, end]`. */
export function ellipses(rec: RecordingContext): number[][] {
  return rec.argLists('ellipse').map(args => args.map(value => Number(value)));
}
