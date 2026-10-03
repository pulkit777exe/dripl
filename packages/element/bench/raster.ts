import { tallyTotal, type CallTally } from './counting-canvas';

/**
 * A deterministic software rasterizer for the render-path harness.
 *
 * WHY THIS EXISTS
 * ---------------
 * `bench/counting-canvas.ts` counts calls but measures no pixels, so it cannot
 * answer the only question that matters when the `save`/`restore` pair around a
 * cached-bitmap blit is on the table: *does the rendered image change?* The
 * answer has to be demonstrated with pixels, and jsdom cannot allocate a 2D
 * context at all, and `node-canvas` is not an available dependency. So this
 * implements the boundary: a `CanvasRenderingContext2D` that rasterizes into an
 * RGBA byte buffer.
 *
 * It is driven by the *real* `renderStaticScene`, so the bytes it produces come
 * from the production code path, not from a re-implementation of it.
 *
 * THE ONE PROPERTY THAT MAKES IT TRUSTWORTHY
 * ------------------------------------------
 * Every operation it does not implement **throws**. A rasterizer that silently
 * ignored `clip`, `globalCompositeOperation` or `shadowBlur` would produce two
 * confidently identical images for two different renderings and report "no
 * regression" — the failure mode that makes a pixel diff worse than none. So an
 * unmodelled op is a crash, not a shrug.
 *
 * HOW FAITHFUL IS IT, PRECISELY
 * -----------------------------
 * Faithful enough to detect any change a render-path edit could plausibly make:
 *
 * - Full CTM stack: `setTransform`/`scale`/`translate`/`rotate`/`transform`,
 *   `save`/`restore`, composed exactly as the spec composes them.
 * - `globalAlpha`, `globalCompositeOperation` (`source-over`, `destination-out`),
 *   `fillStyle`/`strokeStyle`/`lineWidth` (scaled by the CTM, as canvas
 *   resolves it) and `lineDash`.
 * - `fill` by nonzero winding over scanlines; `stroke` as thick-segment quads
 *   with vertex patches; `bezierCurveTo`/`quadraticCurveTo` flattened at a fixed
 *   step count, so the same call always yields the same pixels.
 * - `drawImage` by nearest-neighbour inverse mapping, which is what makes a
 *   one-device-pixel offset visible instead of averaged away.
 * - `fillText` as a filled box of the measured width and font size. Glyphs are
 *   not shaped. It stays sensitive to text position, alignment, alpha, colour
 *   and size, which is everything a render-path edit can move.
 *
 * Resolution: `SAMPLES_PER_AXIS` samples per pixel at pixel-relative positions
 * `(s + 0.5) / SAMPLES_PER_AXIS`, with coverage-weighted compositing. So a
 * change smaller than about half a device pixel is invisible here by
 * construction. This file states that rather than implying pixel-exact
 * equivalence with a browser.
 */

export interface Surface {
  readonly width: number;
  readonly height: number;
  /** RGBA, four bytes per pixel, row-major, non-premultiplied. */
  readonly data: Uint8ClampedArray;
}

/** Samples per pixel along each axis. 2 => four samples => ~0.5 px sensitivity. */
export const SAMPLES_PER_AXIS = 2;

type Matrix = [number, number, number, number, number, number];
interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}
interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
type Point = [number, number];
type Run = [Point, Point];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const SAMPLES_PER_PIXEL = SAMPLES_PER_AXIS * SAMPLES_PER_AXIS;
const COVERAGE_PER_SAMPLE = 1 / SAMPLES_PER_PIXEL;
const EPSILON = 1e-9;

// ─── Matrix helpers ───────────────────────────────────────────────────────────

/** `outer ∘ inner`: the matrix that applies `inner` first, then `outer`. */
function multiply(outer: Matrix, inner: Matrix): Matrix {
  return [
    outer[0] * inner[0] + outer[2] * inner[1],
    outer[1] * inner[0] + outer[3] * inner[1],
    outer[0] * inner[2] + outer[2] * inner[3],
    outer[1] * inner[2] + outer[3] * inner[3],
    outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
    outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
  ];
}

function apply(m: Matrix, x: number, y: number): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Determinant magnitude, i.e. how much the matrix scales area — the line width. */
function meanScale(m: Matrix): number {
  const determinant = Math.abs(m[0] * m[3] - m[1] * m[2]);
  return determinant === 0 ? 1 : Math.sqrt(determinant);
}

// ─── Colour ───────────────────────────────────────────────────────────────────

const NAMED_COLORS: Record<string, string> = {
  transparent: '#00000000',
  black: '#000000',
  white: '#ffffff',
};

function clamp255(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * Parse a CSS colour into RGBA.
 *
 * Only what this render path actually writes is accepted; anything else throws
 * rather than being approximated, so an unmodelled colour can never be mistaken
 * for a matching one.
 */
export function parseColor(input: unknown): Rgba {
  if (typeof input !== 'string') {
    throw new Error(`raster: unsupported colour value ${String(input)}`);
  }
  const text = (NAMED_COLORS[input] ?? input).trim();

  if (text.startsWith('#')) {
    const hex = text.slice(1);
    const expand = (part: string): number => parseInt(part.length === 1 ? part + part : part, 16);
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: expand(hex[0] as string),
        g: expand(hex[1] as string),
        b: expand(hex[2] as string),
        a: hex.length === 4 ? expand(hex[3] as string) / 255 : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
    throw new Error(`raster: unsupported hex colour ${input}`);
  }

  const functional = /^rgba?\(([^)]+)\)$/.exec(text);
  if (functional?.[1]) {
    const parts = functional[1].split(',').map(part => part.trim());
    if (parts.length >= 3) {
      const channel = (raw: string): number =>
        raw.endsWith('%') ? (Number.parseFloat(raw) / 100) * 255 : Number.parseFloat(raw);
      const alphaRaw = parts[3];
      return {
        r: clamp255(channel(parts[0] as string)),
        g: clamp255(channel(parts[1] as string)),
        b: clamp255(channel(parts[2] as string)),
        a: alphaRaw === undefined ? 1 : Math.max(0, Math.min(1, Number.parseFloat(alphaRaw))),
      };
    }
  }

  throw new Error(`raster: unsupported colour ${input}`);
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function polygonEdges(points: readonly Point[]): Edge[] {
  const edges: Edge[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index] as Point;
    const b = points[(index + 1) % points.length] as Point;
    if (a[1] === b[1]) continue;
    edges.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1] });
  }
  return edges;
}

/** The four edges of the rectangle swept by a thick segment. */
function quadEdges(a: Point, b: Point, halfWidth: number): Edge[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON) return [];
  const nx = (-dy / length) * halfWidth;
  const ny = (dx / length) * halfWidth;
  return polygonEdges([
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny],
  ]);
}

/** An axis-aligned patch at a vertex, so joins do not leave gaps. */
function vertexPatchEdges(point: Point, halfWidth: number): Edge[] {
  return polygonEdges([
    [point[0] - halfWidth, point[1] - halfWidth],
    [point[0] + halfWidth, point[1] - halfWidth],
    [point[0] + halfWidth, point[1] + halfWidth],
    [point[0] - halfWidth, point[1] + halfWidth],
  ]);
}

/** Fixed flattening step, so a given call always produces the same points. */
const BEZIER_STEPS = 12;

function flattenCubic(from: Point, c1: Point, c2: Point, to: Point, into: Point[]): void {
  for (let step = 1; step <= BEZIER_STEPS; step += 1) {
    const t = step / BEZIER_STEPS;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    into.push([
      a * from[0] + b * c1[0] + c * c2[0] + d * to[0],
      a * from[1] + b * c1[1] + c * c2[1] + d * to[1],
    ]);
  }
}

function flattenQuadratic(from: Point, control: Point, to: Point, into: Point[]): void {
  // Elevated to a cubic so one flattener covers both curve types.
  flattenCubic(
    from,
    [from[0] + (2 / 3) * (control[0] - from[0]), from[1] + (2 / 3) * (control[1] - from[1])],
    [to[0] + (2 / 3) * (control[0] - to[0]), to[1] + (2 / 3) * (control[1] - to[1])],
    to,
    into
  );
}

/**
 * Split a polyline into the "on" runs of a dash pattern.
 *
 * Returns a list of runs rather than one polyline, because a stroked dash is a
 * set of disconnected segments; joining them would draw the gaps back in.
 */
function applyDash(points: readonly Point[], dash: readonly number[], offset: number): Run[] {
  const pattern = dash.length % 2 === 0 ? [...dash] : [...dash, ...dash];
  const patternLength = pattern.reduce((sum, value) => sum + value, 0);
  const first = points[0];
  if (patternLength <= EPSILON || !first) return [[first ?? [0, 0], first ?? [0, 0]]];

  // Phase: consume the pattern up to the offset.
  let index = 0;
  let remaining = pattern[0] as number;
  let on = true;
  let cursor = ((offset % patternLength) + patternLength) % patternLength;
  while (cursor > EPSILON) {
    if (cursor < remaining) {
      remaining -= cursor;
      cursor = 0;
      break;
    }
    cursor -= remaining;
    index = (index + 1) % pattern.length;
    remaining = pattern[index] as number;
    on = !on;
  }

  const runs: Run[] = [];
  let runStart: Point | null = on ? first : null;

  for (let segment = 1; segment < points.length; segment += 1) {
    const to = points[segment] as Point;
    let from = (points[segment - 1] as Point) ?? to;
    let segmentLength = Math.hypot(to[0] - from[0], to[1] - from[1]);
    while (segmentLength > EPSILON) {
      const step = Math.min(remaining, segmentLength);
      const boundary: Point = [
        from[0] + ((to[0] - from[0]) * step) / segmentLength,
        from[1] + ((to[1] - from[1]) * step) / segmentLength,
      ];
      remaining -= step;
      segmentLength -= step;
      from = boundary;
      if (remaining <= EPSILON) {
        if (on) {
          runs.push([runStart ?? boundary, boundary]);
          runStart = null;
        } else {
          runStart = boundary;
        }
        index = (index + 1) % pattern.length;
        remaining = pattern[index] as number;
      }
    }
  }

  const last = points[points.length - 1] as Point;
  if (on && runStart) runs.push([runStart, last]);
  return runs;
}

// ─── The context ──────────────────────────────────────────────────────────────

interface SavedState {
  ctm: Matrix;
  alpha: number;
  composite: GlobalCompositeOperation;
  fillColour: Rgba;
  strokeColour: Rgba;
  width: number;
  dash: number[];
  dashOffset: number;
  fontSize: number;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
}

/**
 * A counting, rasterizing 2D context.
 *
 * It counts calls for the same reason `counting-canvas.ts` does, and the two
 * hosts cross-check each other: identical tallies over the same scene is what
 * shows this one did not quietly skip an operation the counter would have seen.
 */
class RasterContext {
  // The save/restore stack.
  private ctm: Matrix = IDENTITY;
  private alpha = 1;
  private composite: GlobalCompositeOperation = 'source-over';
  // Named `fillColour`/`strokeColour`, not `fill`/`stroke`: a field of that name
  // would shadow the same-named drawing methods on the prototype.
  private fillColour: Rgba = { r: 0, g: 0, b: 0, a: 1 };
  private strokeColour: Rgba = { r: 0, g: 0, b: 0, a: 1 };
  private width = 1;
  private dash: number[] = [];
  private dashOffset = 0;
  private fontSize = 10;
  private align: CanvasTextAlign = 'start';
  private baseline: CanvasTextBaseline = 'alphabetic';
  private stack: SavedState[] = [];

  // Path, in device space: points are transformed as they are appended, which
  // is what the spec requires and what makes a CTM change visible in the fill.
  private subpaths: Point[][] = [];
  private current: Point[] | null = null;

  /**
   * `surface` is an accessor, not a value, and that is load-bearing: resizing a
   * canvas reallocates its backing store, and a context holding the old buffer
   * would draw into a surface nobody ever looks at again. That failure is silent
   * -- the `dpr: 2` scene simply rendered blank -- so the context follows the
   * canvas, exactly as a real one does.
   */
  constructor(
    private readonly surfaceRef: () => Surface,
    private readonly tally: CallTally
  ) {}

  private get surface(): Surface {
    return this.surfaceRef();
  }

  private count(name: string): void {
    this.tally[name] = (this.tally[name] ?? 0) + 1;
  }

  private unsupported(name: string): never {
    throw new Error(
      `raster: "${name}" is not implemented. A rasterizer that ignores an operation ` +
        'cannot prove two renderings are identical, so this throws instead.'
    );
  }

  // -- state ------------------------------------------------------------------

  save(): void {
    this.count('save');
    this.stack.push({
      ctm: [...this.ctm] as Matrix,
      alpha: this.alpha,
      composite: this.composite,
      fillColour: this.fillColour,
      strokeColour: this.strokeColour,
      width: this.width,
      dash: [...this.dash],
      dashOffset: this.dashOffset,
      fontSize: this.fontSize,
      align: this.align,
      baseline: this.baseline,
    });
  }

  restore(): void {
    this.count('restore');
    const state = this.stack.pop();
    if (!state) throw new Error('raster: restore() with an empty state stack');
    this.ctm = state.ctm;
    this.alpha = state.alpha;
    this.composite = state.composite;
    this.fillColour = state.fillColour;
    this.strokeColour = state.strokeColour;
    this.width = state.width;
    this.dash = state.dash;
    this.dashOffset = state.dashOffset;
    this.fontSize = state.fontSize;
    this.align = state.align;
    this.baseline = state.baseline;
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.count('setTransform');
    this.ctm = [a, b, c, d, e, f];
  }

  resetTransform(): void {
    this.count('resetTransform');
    this.ctm = IDENTITY;
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.count('transform');
    this.ctm = multiply(this.ctm, [a, b, c, d, e, f]);
  }

  scale(x: number, y: number): void {
    this.count('scale');
    this.ctm = multiply(this.ctm, [x, 0, 0, y, 0, 0]);
  }

  translate(x: number, y: number): void {
    this.count('translate');
    this.ctm = multiply(this.ctm, [1, 0, 0, 1, x, y]);
  }

  rotate(angle: number): void {
    this.count('rotate');
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.ctm = multiply(this.ctm, [cos, sin, -sin, cos, 0, 0]);
  }

  setLineDash(segments: number[]): void {
    this.count('setLineDash');
    this.dash = segments.filter(value => value >= 0);
  }

  getLineDash(): number[] {
    this.count('getLineDash');
    return [...this.dash];
  }

  getTransform(): DOMMatrix {
    this.count('getTransform');
    return {
      a: this.ctm[0],
      b: this.ctm[1],
      c: this.ctm[2],
      d: this.ctm[3],
      e: this.ctm[4],
      f: this.ctm[5],
    } as DOMMatrix;
  }

  measureText(text: string): TextMetrics {
    this.count('measureText');
    const width = text.length * 8;
    return {
      width,
      actualBoundingBoxAscent: this.fontSize,
      actualBoundingBoxDescent: 0,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: width,
      alphabeticBaseline: 0,
      emHeightAscent: this.fontSize,
      emHeightDescent: 0,
      fontBoundingBoxAscent: this.fontSize,
      fontBoundingBoxDescent: 0,
    } as TextMetrics;
  }

  // -- path construction ------------------------------------------------------

  beginPath(): void {
    this.count('beginPath');
    this.subpaths = [];
    this.current = null;
  }

  closePath(): void {
    this.count('closePath');
    this.current = null;
  }

  moveTo(x: number, y: number): void {
    this.count('moveTo');
    const sub: Point[] = [apply(this.ctm, x, y)];
    this.subpaths.push(sub);
    this.current = sub;
  }

  lineTo(x: number, y: number): void {
    this.count('lineTo');
    if (!this.current) this.moveTo(x, y);
    else this.current.push(apply(this.ctm, x, y));
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.count('bezierCurveTo');
    const from = this.current?.[this.current.length - 1];
    const sub = this.current;
    if (!from || !sub) {
      this.lineTo(x, y);
      return;
    }
    flattenCubic(
      from,
      apply(this.ctm, c1x, c1y),
      apply(this.ctm, c2x, c2y),
      apply(this.ctm, x, y),
      sub
    );
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.count('quadraticCurveTo');
    const from = this.current?.[this.current.length - 1];
    const sub = this.current;
    if (!from || !sub) {
      this.lineTo(x, y);
      return;
    }
    flattenQuadratic(from, apply(this.ctm, cpx, cpy), apply(this.ctm, x, y), sub);
  }

  arc(x: number, y: number, radius: number, start: number, end: number): void {
    this.count('arc');
    const steps = Math.max(8, Math.ceil((Math.abs(end - start) / (Math.PI / 16)) * BEZIER_STEPS));
    const sub = this.current ?? [];
    for (let step = 0; step <= steps; step += 1) {
      const angle = start + ((end - start) * step) / steps;
      sub.push(apply(this.ctm, x + Math.cos(angle) * radius, y + Math.sin(angle) * radius));
    }
    if (!this.current) {
      this.subpaths.push(sub);
      this.current = sub;
    }
  }

  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    start: number,
    end: number
  ): void {
    this.count('ellipse');
    const steps = Math.max(16, Math.ceil((Math.abs(end - start) / (Math.PI / 16)) * BEZIER_STEPS));
    const sub = this.current ?? [];
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    for (let step = 0; step <= steps; step += 1) {
      const angle = start + ((end - start) * step) / steps;
      const ex = Math.cos(angle) * radiusX;
      const ey = Math.sin(angle) * radiusY;
      sub.push(apply(this.ctm, x + ex * cos - ey * sin, y + ex * sin + ey * cos));
    }
    if (!this.current) {
      this.subpaths.push(sub);
      this.current = sub;
    }
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.count('rect');
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }

  clip(): void {
    // Clipping is deliberately *not* modelled: if a scene ever reaches it the
    // run must stop rather than quietly render something a browser would clip.
    this.unsupported('clip');
  }

  // -- painting ---------------------------------------------------------------

  fill(fillRule: CanvasFillRule = 'nonzero'): void {
    this.count('fill');
    // Rough.js asks for `evenodd` on arrowhead polygons and `nonzero`
    // elsewhere. Both are real rules, so both are rasterized.
    if (fillRule !== 'nonzero' && fillRule !== 'evenodd') {
      this.unsupported(`fill rule "${fillRule}"`);
    }
    const edges: Edge[] = [];
    for (const sub of this.subpaths) {
      for (let index = 0; index + 1 < sub.length; index += 1) {
        const a = sub[index] as Point;
        const b = sub[index + 1] as Point;
        if (a[1] !== b[1]) edges.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1] });
      }
      const first = sub[0];
      const last = sub[sub.length - 1];
      if (sub.length > 2 && first && last && first[1] !== last[1]) {
        edges.push({ x0: last[0], y0: last[1], x1: first[0], y1: first[1] });
      }
    }
    this.rasterize(edges, this.fillColour, 'paint', fillRule);
  }

  stroke(): void {
    this.count('stroke');
    const halfWidth = Math.max(this.width * meanScale(this.ctm), 0.1) / 2;
    for (const sub of this.subpaths) {
      const runs = this.dash.length > 0 ? applyDash(sub, this.dash, this.dashOffset) : [sub];
      for (const run of runs) {
        for (let index = 0; index + 1 < run.length; index += 1) {
          const a = run[index] as Point;
          const b = run[index + 1] as Point;
          this.rasterize(
            [
              ...quadEdges(a, b, halfWidth),
              ...vertexPatchEdges(a, halfWidth),
              ...vertexPatchEdges(b, halfWidth),
            ],
            this.strokeColour,
            'paint'
          );
        }
      }
    }
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.count('fillRect');
    this.rasterize(this.rectEdges(x, y, w, h), this.fillColour, 'paint');
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.count('strokeRect');
    const halfWidth = Math.max(this.width * meanScale(this.ctm), 0.1) / 2;
    const [topLeft, topRight, bottomRight, bottomLeft] = this.corners(x, y, w, h);
    for (const [a, b] of [
      [topLeft, topRight],
      [topRight, bottomRight],
      [bottomRight, bottomLeft],
      [bottomLeft, topLeft],
    ] as Run[]) {
      this.rasterize(
        [
          ...quadEdges(a, b, halfWidth),
          ...vertexPatchEdges(a, halfWidth),
          ...vertexPatchEdges(b, halfWidth),
        ],
        this.strokeColour,
        'paint'
      );
    }
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    this.count('clearRect');
    // Erases to transparent rather than compositing, which is what makes the
    // per-frame `clearRect` in `bootstrapCanvas` actually clear.
    this.rasterize(this.rectEdges(x, y, w, h), { r: 0, g: 0, b: 0, a: 1 }, 'erase');
  }

  fillText(text: string, x: number, y: number): void {
    this.count('fillText');
    // Glyphs are not shaped: a filled box of the measured advance width and the
    // font size stands in for them.
    const width = text.length * 8;
    let left = x;
    if (this.align === 'center') left -= width / 2;
    else if (this.align === 'right' || this.align === 'end') left -= width;
    let top = y;
    if (this.baseline === 'middle') top = y - this.fontSize / 2;
    else if (
      this.baseline === 'bottom' ||
      this.baseline === 'alphabetic' ||
      this.baseline === 'ideographic'
    ) {
      top = y - this.fontSize * 0.8;
    }
    this.rasterize(this.rectEdges(left, top, width, this.fontSize), this.fillColour, 'paint');
  }

  strokeText(): void {
    this.count('strokeText');
    this.unsupported('strokeText');
  }

  drawImage(source: unknown, dx: number, dy: number, dw?: number, dh?: number): void {
    this.count('drawImage');
    const bitmap = readBitmap(source);
    const width = dw ?? bitmap.width;
    const height = dh ?? bitmap.height;
    if (width <= 0 || height <= 0) return;

    const origin = apply(this.ctm, dx, dy);
    const ux = apply(this.ctm, dx + width, dy);
    const uy = apply(this.ctm, dx, dy + height);
    const uVector: Point = [ux[0] - origin[0], ux[1] - origin[1]];
    const vVector: Point = [uy[0] - origin[0], uy[1] - origin[1]];
    const determinant = uVector[0] * vVector[1] - uVector[1] * vVector[0];
    if (Math.abs(determinant) <= EPSILON) return;

    const corners: Point[] = [
      origin,
      [origin[0] + uVector[0], origin[1] + uVector[1]],
      [origin[0] + uVector[0] + vVector[0], origin[1] + uVector[1] + vVector[1]],
      [origin[0] + vVector[0], origin[1] + vVector[1]],
    ];
    const minX = Math.max(0, Math.floor(Math.min(...corners.map(point => point[0]))));
    const maxX = Math.min(
      this.surface.width - 1,
      Math.ceil(Math.max(...corners.map(point => point[0])))
    );
    const minY = Math.max(0, Math.floor(Math.min(...corners.map(point => point[1]))));
    const maxY = Math.min(
      this.surface.height - 1,
      Math.ceil(Math.max(...corners.map(point => point[1])))
    );

    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        let red = 0;
        let green = 0;
        let blue = 0;
        let alpha = 0;
        for (let sample = 0; sample < SAMPLES_PER_PIXEL; sample += 1) {
          const sampleX = px + ((sample % SAMPLES_PER_AXIS) + 0.5) / SAMPLES_PER_AXIS;
          const sampleY = py + (Math.floor(sample / SAMPLES_PER_AXIS) + 0.5) / SAMPLES_PER_AXIS;
          const ex = sampleX - origin[0];
          const ey = sampleY - origin[1];
          const u = (ex * vVector[1] - ey * vVector[0]) / determinant;
          const v = (ey * uVector[0] - ex * uVector[1]) / determinant;
          if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
          const sx = Math.min(bitmap.width - 1, Math.floor(u * bitmap.width));
          const sy = Math.min(bitmap.height - 1, Math.floor(v * bitmap.height));
          const offset = (sy * bitmap.width + sx) * 4;
          red += bitmap.data[offset] as number;
          green += bitmap.data[offset + 1] as number;
          blue += bitmap.data[offset + 2] as number;
          alpha += (bitmap.data[offset + 3] as number) / 255;
        }
        if (alpha <= 0) continue;
        this.blend(
          px,
          py,
          red / SAMPLES_PER_PIXEL,
          green / SAMPLES_PER_PIXEL,
          blue / SAMPLES_PER_PIXEL,
          alpha / SAMPLES_PER_PIXEL,
          COVERAGE_PER_SAMPLE
        );
      }
    }
  }

  // -- internals --------------------------------------------------------------

  private corners(x: number, y: number, w: number, h: number): [Point, Point, Point, Point] {
    return [
      apply(this.ctm, x, y),
      apply(this.ctm, x + w, y),
      apply(this.ctm, x + w, y + h),
      apply(this.ctm, x, y + h),
    ];
  }

  private rectEdges(x: number, y: number, w: number, h: number): Edge[] {
    return polygonEdges(this.corners(x, y, w, h));
  }

  private blend(
    px: number,
    py: number,
    r: number,
    g: number,
    b: number,
    sourceAlpha: number,
    coverage: number
  ): void {
    const alpha = this.alpha * sourceAlpha * coverage;
    if (alpha <= 0) return;
    const index = (py * this.surface.width + px) * 4;
    const data = this.surface.data;
    const dstAlpha = (data[index + 3] as number) / 255;
    if (this.composite === 'destination-out') {
      data[index + 3] = Math.round(dstAlpha * (1 - alpha) * 255);
      return;
    }
    if (this.composite !== 'source-over') this.unsupported(this.composite);
    const outAlpha = alpha + dstAlpha * (1 - alpha);
    if (outAlpha <= 0) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
      data[index + 3] = 0;
      return;
    }
    data[index] = Math.round(
      (r * alpha + (data[index] as number) * dstAlpha * (1 - alpha)) / outAlpha
    );
    data[index + 1] = Math.round(
      (g * alpha + (data[index + 1] as number) * dstAlpha * (1 - alpha)) / outAlpha
    );
    data[index + 2] = Math.round(
      (b * alpha + (data[index + 2] as number) * dstAlpha * (1 - alpha)) / outAlpha
    );
    data[index + 3] = Math.round(outAlpha * 255);
  }

  /**
   * Scanline fill of `edges`, with per-pixel coverage.
   *
   * Coverage accumulates across sub-scanlines and is applied once per pixel, so
   * overlapping spans inside one fill cannot double-blend. That matters because
   * a Rough.js hachure fill is a single `stroke` made of many overlapping thick
   * segments, and summing them would darken the fill at every crossing.
   */
  private rasterize(
    edges: Edge[],
    colour: Rgba,
    mode: 'paint' | 'erase',
    rule: CanvasFillRule = 'nonzero'
  ): void {
    if (edges.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const edge of edges) {
      minX = Math.min(minX, edge.x0, edge.x1);
      maxX = Math.max(maxX, edge.x0, edge.x1);
      minY = Math.min(minY, edge.y0, edge.y1);
      maxY = Math.max(maxY, edge.y0, edge.y1);
    }
    const x0 = Math.max(0, Math.floor(minX));
    const x1 = Math.min(this.surface.width - 1, Math.ceil(maxX));
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.surface.height - 1, Math.ceil(maxY));
    if (x1 < x0 || y1 < y0) return;

    const coverage = new Float32Array(x1 - x0 + 1);
    const crossings: Array<{ x: number; winding: number }> = [];

    for (let py = y0; py <= y1; py += 1) {
      coverage.fill(0);
      let touched = false;
      for (let sub = 0; sub < SAMPLES_PER_AXIS; sub += 1) {
        const sampleY = py + (sub + 0.5) / SAMPLES_PER_AXIS;
        crossings.length = 0;
        for (const edge of edges) {
          const low = Math.min(edge.y0, edge.y1);
          const high = Math.max(edge.y0, edge.y1);
          if (sampleY < low || sampleY >= high) continue;
          const t = (sampleY - edge.y0) / (edge.y1 - edge.y0);
          crossings.push({
            x: edge.x0 + t * (edge.x1 - edge.x0),
            winding: edge.y1 > edge.y0 ? 1 : -1,
          });
        }
        if (crossings.length < 2) continue;
        crossings.sort((a, b) => a.x - b.x);
        let winding = 0;
        for (let index = 0; index + 1 < crossings.length; index += 1) {
          const from = crossings[index] as { x: number; winding: number };
          const to = crossings[index + 1] as { x: number; winding: number };
          winding += from.winding;
          // Nonzero looks at accumulated winding direction; even-odd only at the
          // parity of the crossing count.
          const inside = rule === 'evenodd' ? index % 2 === 0 : winding !== 0;
          if (!inside) continue;
          const first = Math.max(x0, Math.floor(from.x));
          const last = Math.min(x1, Math.ceil(to.x));
          for (let px = first; px <= last; px += 1) {
            for (let sample = 0; sample < SAMPLES_PER_AXIS; sample += 1) {
              const sampleX = px + (sample + 0.5) / SAMPLES_PER_AXIS;
              if (sampleX >= from.x && sampleX < to.x) {
                coverage[px - x0] += COVERAGE_PER_SAMPLE;
                touched = true;
              }
            }
          }
        }
      }
      if (!touched) continue;
      for (let px = x0; px <= x1; px += 1) {
        const value = coverage[px - x0] as number;
        if (value <= 0) continue;
        if (mode === 'erase') {
          const index = (py * this.surface.width + px) * 4;
          this.surface.data[index] = 0;
          this.surface.data[index + 1] = 0;
          this.surface.data[index + 2] = 0;
          this.surface.data[index + 3] = 0;
          continue;
        }
        this.blend(px, py, colour.r, colour.g, colour.b, colour.a, value);
      }
    }
  }

  // -- properties -------------------------------------------------------------

  get globalAlpha(): number {
    return this.alpha;
  }
  set globalAlpha(value: number) {
    this.alpha = value;
  }

  get globalCompositeOperation(): GlobalCompositeOperation {
    return this.composite;
  }
  set globalCompositeOperation(value: GlobalCompositeOperation) {
    this.composite = value;
  }

  get fillStyle(): string {
    return `rgba(${this.fillColour.r}, ${this.fillColour.g}, ${this.fillColour.b}, ${this.fillColour.a})`;
  }
  set fillStyle(value: string | CanvasGradient | CanvasPattern) {
    this.fillColour = parseColor(value);
  }

  get strokeStyle(): string {
    return `rgba(${this.strokeColour.r}, ${this.strokeColour.g}, ${this.strokeColour.b}, ${this.strokeColour.a})`;
  }
  set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
    this.strokeColour = parseColor(value);
  }

  get lineWidth(): number {
    return this.width;
  }
  set lineWidth(value: number) {
    this.width = value;
  }

  get lineDashOffset(): number {
    return this.dashOffset;
  }
  set lineDashOffset(value: number) {
    this.dashOffset = value;
  }

  get lineCap(): CanvasLineCap {
    return 'butt';
  }
  set lineCap(_value: CanvasLineCap) {
    // Square caps are drawn unconditionally; the value is read by nothing here.
  }

  get lineJoin(): CanvasLineJoin {
    return 'miter';
  }
  set lineJoin(_value: CanvasLineJoin) {
    // Joins are approximated by vertex patches.
  }

  get miterLimit(): number {
    return 10;
  }
  set miterLimit(_value: number) {
    // Unused by the rasterizer; accepted so setting it is not a hard failure.
  }

  get font(): string {
    return `${this.fontSize}px sans-serif`;
  }
  set font(value: string) {
    const match = /(\d+(?:\.\d+)?)px/.exec(value);
    this.fontSize = match?.[1] ? Number.parseFloat(match[1]) : 10;
  }

  get textAlign(): CanvasTextAlign {
    return this.align;
  }
  set textAlign(value: CanvasTextAlign) {
    this.align = value;
  }

  get textBaseline(): CanvasTextBaseline {
    return this.baseline;
  }
  set textBaseline(value: CanvasTextBaseline) {
    this.baseline = value;
  }

  get direction(): string {
    return 'inherit';
  }
  set direction(_value: string) {}

  get shadowBlur(): number {
    return 0;
  }
  set shadowBlur(_value: number) {
    this.unsupported('shadowBlur');
  }

  get shadowColor(): string {
    return 'rgba(0, 0, 0, 0)';
  }
  set shadowColor(_value: string) {
    // Only settable when non-zero; a zero shadow is a no-op.
    if (
      typeof _value === 'string' &&
      /rgba\(\s*0[,\s]/.test(_value) === false &&
      _value !== 'transparent' &&
      _value !== ''
    ) {
      this.unsupported('shadowColor');
    }
  }

  get shadowOffsetX(): number {
    return 0;
  }
  set shadowOffsetX(_value: number) {}

  get shadowOffsetY(): number {
    return 0;
  }
  set shadowOffsetY(_value: number) {}

  get filter(): string {
    return 'none';
  }
  set filter(value: string) {
    if (value !== 'none') this.unsupported(`filter "${value}"`);
  }

  get imageSmoothingEnabled(): boolean {
    return true;
  }
  set imageSmoothingEnabled(_value: boolean) {}

  get canvas(): HTMLCanvasElement {
    return { width: this.surface.width, height: this.surface.height } as HTMLCanvasElement;
  }
}

// ─── Surfaces and hosts ───────────────────────────────────────────────────────

function allocate(width: number, height: number): Surface {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}

interface RasterCanvas {
  width: number;
  height: number;
  readonly surface: Surface;
  getContext(kind: string): CanvasRenderingContext2D | null;
}

/** A canvas whose `width`/`height` setters reallocate, as the real ones do. */
function createRasterCanvas(width: number, height: number, tally: CallTally): RasterCanvas {
  let surface = allocate(width, height);
  const canvas = {
    get width(): number {
      return surface.width;
    },
    set width(value: number) {
      surface = allocate(value, surface.height);
    },
    get height(): number {
      return surface.height;
    },
    set height(value: number) {
      surface = allocate(surface.width, value);
    },
    get surface(): Surface {
      return surface;
    },
    style: {} as CSSStyleDeclaration,
    getContext: (kind: string): CanvasRenderingContext2D | null =>
      kind === '2d'
        ? (new RasterContext(() => surface, tally) as unknown as CanvasRenderingContext2D)
        : null,
  };
  return canvas as unknown as RasterCanvas;
}

/** Read the pixel buffer out of whatever a `drawImage` was handed. */
function readBitmap(source: unknown): Surface {
  const candidate = source as { surface?: Surface };
  if (!candidate.surface) throw new Error('raster: drawImage source is not a raster canvas');
  return candidate.surface;
}

export interface RasterHost {
  /** The on-screen canvas, standing in for the real one. */
  readonly canvas: HTMLCanvasElement;
  readonly visible: CallTally;
  readonly offscreen: CallTally;
  offscreenCanvases: number;
  offscreenPixels: number;
  /** The finished on-screen pixels. */
  surface(): Surface;
  total(tally: CallTally): number;
  dispose(): void;
}

/**
 * A canvas environment that rasterizes, and counts calls for the same reason the
 * counting host does.
 *
 * The two hosts exist to cross-check each other: the same scene through both
 * must produce identical call tallies, which is what shows the rasterizer did not
 * skip an operation the counter would have seen.
 */
export function createRasterHost(width: number, height: number): RasterHost {
  const visibleTally: CallTally = {};
  const offscreenTally: CallTally = {};
  const visible = createRasterCanvas(width, height, visibleTally);

  const globalHolder = globalThis as unknown as { OffscreenCanvas?: unknown };
  const previousOffscreenCanvas = globalHolder.OffscreenCanvas;
  const host = {
    offscreenCanvases: 0,
    offscreenPixels: 0,
  } as { offscreenCanvases: number; offscreenPixels: number };

  class RasterOffscreenCanvas {
    private readonly inner: RasterCanvas;
    constructor(w: number, h: number) {
      this.inner = createRasterCanvas(w, h, offscreenTally);
      host.offscreenCanvases += 1;
      host.offscreenPixels += this.inner.width * this.inner.height;
    }
    get width(): number {
      return this.inner.width;
    }
    set width(value: number) {
      this.inner.width = value;
    }
    get height(): number {
      return this.inner.height;
    }
    set height(value: number) {
      this.inner.height = value;
    }
    /** The pixels behind this backing store, for a later `drawImage` of it. */
    get surface(): Surface {
      return this.inner.surface;
    }
    getContext(kind: string): CanvasRenderingContext2D | null {
      return this.inner.getContext(kind);
    }
  }
  globalHolder.OffscreenCanvas = RasterOffscreenCanvas;

  return {
    canvas: visible as unknown as HTMLCanvasElement,
    visible: visibleTally,
    offscreen: offscreenTally,
    get offscreenCanvases(): number {
      return host.offscreenCanvases;
    },
    get offscreenPixels(): number {
      return host.offscreenPixels;
    },
    surface: () => visible.surface,
    total: tallyTotal,
    dispose() {
      if (previousOffscreenCanvas === undefined) delete globalHolder.OffscreenCanvas;
      else globalHolder.OffscreenCanvas = previousOffscreenCanvas;
    },
  };
}

export interface PixelDiff {
  /** Pixels whose RGBA differs at all. */
  differingPixels: number;
  /** Largest absolute per-channel difference found. */
  maxChannelDelta: number;
  /** Sum of absolute per-channel differences, so a near-miss is not a zero. */
  totalChannelDelta: number;
  /** Non-transparent pixels, so a diff reads as a share of the painted image. */
  paintedPixels: number;
  width: number;
  height: number;
}

/**
 * Compare two surfaces pixel by pixel.
 *
 * `differingPixels: 0` is a claim about the *whole* frame: every element's
 * position, size, colour, alpha, rotation, z-order and sketch geometry, because
 * every one of those is already baked into these bytes.
 */
export function diffSurfaces(a: Surface, b: Surface): PixelDiff {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`raster: cannot diff ${a.width}x${a.height} against ${b.width}x${b.height}`);
  }
  let differingPixels = 0;
  let maxChannelDelta = 0;
  let totalChannelDelta = 0;
  let paintedPixels = 0;
  for (let pixel = 0; pixel < a.width * a.height; pixel += 1) {
    const offset = pixel * 4;
    if ((a.data[offset + 3] as number) > 0 || (b.data[offset + 3] as number) > 0)
      paintedPixels += 1;
    let different = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(
        (a.data[offset + channel] as number) - (b.data[offset + channel] as number)
      );
      if (delta > 0) different = true;
      if (delta > maxChannelDelta) maxChannelDelta = delta;
      totalChannelDelta += delta;
    }
    if (different) differingPixels += 1;
  }
  return {
    differingPixels,
    maxChannelDelta,
    totalChannelDelta,
    paintedPixels,
    width: a.width,
    height: a.height,
  };
}
