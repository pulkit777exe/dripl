import { describe, expect, it } from 'vitest';
import type { DriplElement, LinearElement, Point } from '@dripl/common';

import { renderRoughElement, type Drawable } from '../rough-renderer';

/**
 * With `roughness: 0` Rough.js emits exact geometry, so the path operations can
 * be asserted against values derived by hand. At the default roughness every
 * coordinate is jittered by a seeded random offset, which would make any
 * geometric assertion a test of the RNG rather than of the mapping.
 */
function base(overrides: Partial<DriplElement> = {}): DriplElement {
  return {
    id: 'e1',
    type: 'rectangle',
    x: 10,
    y: 20,
    width: 120,
    height: 80,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 0,
    version: 1,
    versionNonce: 1,
    ...overrides,
  } as DriplElement;
}

interface RecordedCalls {
  save: number;
  restore: number;
  translate: { x: number; y: number }[];
  rotate: number[];
  fillText: { text: string; x: number; y: number }[];
  fillRect: { x: number; y: number; width: number; height: number }[];
  strokeRect: { x: number; y: number; width: number; height: number }[];
  setLineDash: number[][];
  drawImage: unknown[][];
  globalAlpha: number[];
}

interface TraceContext {
  /** Everything the renderer drew, in call order. */
  readonly calls: RecordedCalls;
  font: string;
  textAlign: string;
  textBaseline: string;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  composite: string;
}

/**
 * Rough.js draws into whatever context it is handed, and every primitive it
 * reaches for must exist. A Proxy returning no-ops for unknown members keeps the
 * suite from breaking whenever Rough.js reaches for a new one — the same
 * tolerance the existing suite applies.
 *
 * Drawing methods live on the proxy target and the record of their use lives on
 * `calls`, because a canvas property and the trace of its use share a name
 * (`ctx.translate` is both).
 */
function makeContext(): TraceContext {
  const calls: RecordedCalls = {
    save: 0,
    restore: 0,
    translate: [],
    rotate: [],
    fillText: [],
    fillRect: [],
    strokeRect: [],
    setLineDash: [],
    drawImage: [],
    globalAlpha: [],
  };

  const scalars: Record<string, unknown> = {
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    composite: 'source-over',
    globalAlpha: 1,
  };

  const methods: Record<string, unknown> = {
    save: () => {
      calls.save += 1;
    },
    restore: () => {
      calls.restore += 1;
    },
    translate: (x: number, y: number) => calls.translate.push({ x, y }),
    rotate: (angle: number) => calls.rotate.push(angle),
    fillText: (text: string, x: number, y: number) => calls.fillText.push({ text, x, y }),
    fillRect: (x: number, y: number, width: number, height: number) =>
      calls.fillRect.push({ x, y, width, height }),
    strokeRect: (x: number, y: number, width: number, height: number) =>
      calls.strokeRect.push({ x, y, width, height }),
    setLineDash: (pattern: number[]) => calls.setLineDash.push(pattern),
    drawImage: (...args: unknown[]) => void calls.drawImage.push(args),
  };

  // `scalars` is read live rather than snapshotted: the renderer writes
  // `ctx.font` and the test reads it back, so a copy would read empty.
  return new Proxy(methods, {
    get(t, property) {
      if (property === 'calls') return calls;
      if (property in t) return t[property as string];
      if (typeof property === 'string' && property in scalars) return scalars[property];
      if (typeof property === 'string' && property.startsWith('measure')) {
        return () => ({ width: 10 });
      }
      return () => undefined;
    },
    set(_t, property, value) {
      if (typeof property !== 'string') return true;
      scalars[property] = value;
      if (property === 'globalAlpha') calls.globalAlpha.push(value as number);
      return true;
    },
  }) as unknown as TraceContext;
}

function render(
  element: DriplElement,
  elements: DriplElement[] = [],
  theme: 'light' | 'dark' = 'light',
  isExporting = false
): { drawn: Drawable[]; ctx: TraceContext } {
  const drawn: Drawable[] = [];
  const rc = {
    draw: (...args: unknown[]) => {
      drawn.push(args[0] as Drawable);
    },
  } as unknown as Parameters<typeof renderRoughElement>[0];
  const ctx = makeContext();
  renderRoughElement(
    rc,
    ctx as unknown as CanvasRenderingContext2D,
    element,
    elements,
    theme,
    isExporting
  );
  return { drawn, ctx };
}

function optionsOf(drawable: Drawable | undefined): Record<string, unknown> {
  return (drawable as unknown as { options: Record<string, unknown> }).options;
}

/** Rough.js tags each drawable with the primitive name that produced it. */
function primitiveOf(drawable: Drawable | undefined): string {
  return (drawable as unknown as { shape: string }).shape;
}

interface Op {
  op: string;
  data: number[];
}

interface RoughSet {
  type: string;
  ops: Op[];
}

/**
 * The stroke pass's operations, which carry the geometry.
 *
 * A shape with a fill produces a `fillPath` set first (straight `lineTo` ops)
 * and the `path` stroke set after it, so taking `sets[0]` would read the fill
 * outline instead of the drawn one.
 */
function opsOf(drawable: Drawable | undefined): Op[] {
  const sets = (drawable as unknown as { sets?: RoughSet[] }).sets ?? [];
  return sets.find(set => set.type === 'path')?.ops ?? sets[0]?.ops ?? [];
}

/**
 * The vertices of the single-pass outline.
 *
 * Rough.js strokes every edge twice for the hand-drawn double line, and the two
 * strokes of an edge are adjacent, so the op list is a sequence of
 * `move(start) bcurveTo(end)` pairs in which each pair appears twice. Dropping
 * the repeated pairs and collapsing the shared vertex between one edge's end and
 * the next edge's start leaves the outline once. Closed shapes return to the
 * first vertex at the end, and that repeat is dropped too.
 */
function movePoints(drawable: Drawable | undefined): number[][] {
  const ops = opsOf(drawable);
  const points: number[][] = [];
  const push = (point: number[]): void => {
    const last = points.at(-1);
    if (last && last[0] === point[0] && last[1] === point[1]) return;
    points.push(point);
  };

  let previousStart: number[] | null = null;
  let previousEnd: number[] | null = null;

  for (let index = 0; index + 1 < ops.length; index += 2) {
    const move = ops[index];
    const curve = ops[index + 1];
    if (move?.op !== 'move' || (curve?.op !== 'bcurveTo' && curve?.op !== 'curveTo')) continue;

    const start = move.data;
    const end = curve.data.slice(-2);
    const isRepeat =
      previousStart !== null &&
      previousEnd !== null &&
      previousStart[0] === start[0] &&
      previousStart[1] === start[1] &&
      previousEnd[0] === end[0] &&
      previousEnd[1] === end[1];
    if (isRepeat) continue;

    push(start);
    push(end);
    previousStart = start;
    previousEnd = end;
  }

  const first = points[0];
  const last = points.at(-1);
  if (points.length > 2 && first && last && first[0] === last[0] && first[1] === last[1]) {
    points.pop();
  }
  return points;
}

/** The endpoint of a `bcurveTo`: the last two numbers of its control data. */
function curveEnd(drawable: Drawable | undefined, index: number): number[] {
  return opsOf(drawable)[index]?.data.slice(-2) ?? [];
}

/**
 * Component-wise comparison. The geometry is computed with trigonometry, so an
 * exact `toEqual` fails on 1e-15 noise while still catching a real sign error.
 */
function expectPoint(actual: number[] | undefined, expected: number[]): void {
  expect(actual).toBeDefined();
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    expect(actual?.[i]).toBeCloseTo(expected[i] as number, 6);
  }
}

/** A whole outline, vertex count included. */
function expectPath(actual: number[][], expected: number[][]): void {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    expectPoint(actual[i], expected[i] as number[]);
  }
}

describe('element to Rough.js primitive mapping', () => {
  it('maps each shape type to the primitive that draws it', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 60, y: 40 },
      { x: 120, y: 0 },
    ];

    expect(primitiveOf(render(base({ type: 'rectangle' })).drawn[0])).toBe('rectangle');
    expect(primitiveOf(render(base({ type: 'ellipse' })).drawn[0])).toBe('ellipse');
    expect(primitiveOf(render(base({ type: 'diamond' })).drawn[0])).toBe('polygon');
    expect(
      primitiveOf(render(base({ type: 'line', points } as Partial<DriplElement>)).drawn[0])
    ).toBe('linearPath');
    expect(
      primitiveOf(render(base({ type: 'freedraw', points } as Partial<DriplElement>)).drawn[0])
    ).toBe('linearPath');
  });

  it('draws the rectangle from the element origin', () => {
    expect(
      movePoints(render(base({ type: 'rectangle', width: 120, height: 80 })).drawn[0])
    ).toEqual([
      [0, 0],
      [120, 0],
      [120, 80],
      [0, 80],
    ]);
  });

  it('centres the ellipse on the box rather than on its origin', () => {
    // `ellipse(w/2, h/2, w, h)`. Passing `(0, 0, w, h)` would put the ellipse a
    // half-box up and to the left of its rectangle, so the first on-curve point
    // is the right edge at mid-height rather than the top-right corner.
    const moves = movePoints(render(base({ type: 'ellipse', width: 120, height: 80 })).drawn[0]);
    expect(moves[0]).toEqual([120, 40]);
    expect(moves).not.toContainEqual([120, 0]);
  });

  it('puts the diamond vertices on the box edge midpoints', () => {
    const moves = movePoints(render(base({ type: 'diamond', width: 120, height: 80 })).drawn[0]);
    expect(moves).toEqual([
      [60, 0],
      [120, 40],
      [60, 80],
      [0, 40],
    ]);
  });

  it('routes a line through its points in order', () => {
    const trace = render(
      base({
        type: 'line',
        points: [
          { x: 0, y: 0 },
          { x: 60, y: 40 },
          { x: 120, y: 0 },
        ],
      } as Partial<DriplElement>)
    );
    expect(movePoints(trace.drawn[0])).toEqual([
      [0, 0],
      [60, 40],
      [120, 0],
    ]);
  });

  it('renders nothing for a path element with fewer than two points', () => {
    // A line the user has started but not finished has one point; there is no
    // path to generate, and an empty drawable must not reach `rc.draw`.
    for (const points of [[], [{ x: 1, y: 1 }]]) {
      expect(render(base({ type: 'line', points } as Partial<DriplElement>)).drawn).toHaveLength(0);
    }
  });

  it('renders nothing for an element type it does not know', () => {
    expect(
      render(base({ type: 'sticker' } as unknown as Partial<DriplElement>)).drawn
    ).toHaveLength(0);
  });

  it('skips a deleted element without even opening a context scope', () => {
    const trace = render(base({ isDeleted: true }));
    expect(trace.drawn).toHaveLength(0);
    expect(trace.ctx.calls.save).toBe(0);
  });

  it('balances every save with a restore', () => {
    // An unbalanced scope leaks the global alpha or composite operation into
    // whatever the caller draws next.
    for (const element of [
      base(),
      base({ type: 'text', text: 'a\nb' } as Partial<DriplElement>),
      base({ type: 'image', src: 'a.png' } as Partial<DriplElement>),
      base({ type: 'frame', title: 'F' } as Partial<DriplElement>),
      base({ type: 'embed', url: 'https://x.test' } as Partial<DriplElement>),
    ]) {
      const trace = render(element);
      expect(trace.ctx.calls.save).toBe(trace.ctx.calls.restore);
    }
  });
});

describe('generateShape option mapping', () => {
  it('passes the element appearance straight through', () => {
    const options = optionsOf(
      render(
        base({
          strokeColor: '#abcdef',
          backgroundColor: '#fedcba',
          strokeWidth: 5,
          roughness: 0.4,
          fillStyle: 'cross-hatch',
          roundness: 12,
          seed: 999,
        })
      ).drawn[0]
    );

    expect(options.stroke).toBe('#abcdef');
    expect(options.fill).toBe('#fedcba');
    expect(options.strokeWidth).toBe(5);
    expect(options.roughness).toBe(0.4);
    expect(options.fillStyle).toBe('cross-hatch');
    expect(options.roundness).toBe(12);
    expect(options.seed).toBe(999);
  });

  it('derives the hachure gap from the stroke width, defaulting when unset', () => {
    expect(optionsOf(render(base({ strokeWidth: 3 })).drawn[0]).hachureGap).toBe(6);
    expect(
      optionsOf(
        render(base({ strokeWidth: undefined } as unknown as Partial<DriplElement>)).drawn[0]
      ).hachureGap
    ).toBe(4);
  });

  it('sets the fixed sketch constants the hand-drawn look depends on', () => {
    const options = optionsOf(render(base()).drawn[0]);
    expect(options.hachureAngle).toBe(45);
    expect(options.curveStepCount).toBe(9);
    expect(options.simplification).toBe(0.5);
  });

  it('maps each stroke style to its dash pattern, and leaves solid undashed', () => {
    expect(optionsOf(render(base({ strokeStyle: 'dashed' })).drawn[0]).strokeLineDash).toEqual([
      10, 5,
    ]);
    expect(optionsOf(render(base({ strokeStyle: 'dotted' })).drawn[0]).strokeLineDash).toEqual([
      2, 3,
    ]);
    expect(
      optionsOf(render(base({ strokeStyle: 'solid' })).drawn[0]).strokeLineDash
    ).toBeUndefined();
    // An unset style must behave as solid, not as a missing one.
    expect(
      optionsOf(
        render(base({ strokeStyle: undefined } as unknown as Partial<DriplElement>)).drawn[0]
      ).strokeLineDash
    ).toBeUndefined();
  });

  it('omits the fill entirely for a transparent background', () => {
    // Rough.js treats an absent `fill` differently from `fill: undefined`, and
    // a stray transparent fill changes which sketch sets get generated.
    expect(
      optionsOf(render(base({ backgroundColor: 'transparent' })).drawn[0]).fill
    ).toBeUndefined();
  });

  it('falls back to the legacy fillColor field when backgroundColor is absent', () => {
    const legacy = base({ backgroundColor: undefined } as unknown as Partial<DriplElement>);
    (legacy as unknown as Record<string, unknown>).fillColor = '#123456';
    expect(optionsOf(render(legacy).drawn[0]).fill).toBe('#123456');
  });

  it('defaults roughness to 1 and fillStyle to hachure', () => {
    const options = optionsOf(
      render(
        base({ roughness: undefined, fillStyle: undefined } as unknown as Partial<DriplElement>)
      ).drawn[0]
    );
    expect(options.roughness).toBe(1);
    expect(options.fillStyle).toBe('hachure');
  });

  it('derives a stable seed from the element id when none is set', () => {
    // Without this the sketch visibly reshuffles every time the bitmap is
    // regenerated, which a cache eviction or a theme change causes.
    const seedless = { id: 'stable', seed: undefined } as unknown as Partial<DriplElement>;
    const first = optionsOf(render(base(seedless)).drawn[0]).seed;
    const second = optionsOf(render(base(seedless)).drawn[0]).seed;
    expect(typeof first).toBe('number');
    expect(first).toBe(second);
  });
});

describe('arrow routing', () => {
  const straight = {
    ...base({ type: 'arrow' }),
    points: [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
    ],
  } as unknown as LinearElement;

  function withoutHeads(element: LinearElement): LinearElement {
    return { ...element, arrowHeads: { start: 'none', end: 'none' } };
  }

  it('uses a curve primitive for a two-point curved arrow', () => {
    const curved = withoutHeads({ ...straight, arrowStyle: 'curved' });
    expect(primitiveOf(render(curved).drawn[0])).toBe('curve');
  });

  it('routes a curved arrow through a control point offset perpendicular to it', () => {
    // `calculateCurvedPath(start, end, 0.5)`: the control point is the midpoint
    // displaced by `length * curvature * 0.25` along the perpendicular. For a
    // horizontal 120-long arrow that is 15 units straight down.
    const curved = withoutHeads({ ...straight, arrowStyle: 'curved' });
    const ops = opsOf(render(curved).drawn[0]);
    expect(ops[0]?.data).toEqual([0, 0]);
    expectPoint(curveEnd(render(curved).drawn[0], 1), [60, 15]);
    expectPoint(curveEnd(render(curved).drawn[0], 2), [120, 0]);
  });

  it('returns the endpoints unchanged for a zero-length curve', () => {
    const degenerate = withoutHeads({
      ...straight,
      arrowStyle: 'curved',
      points: [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ],
    });
    // A zero-length segment collapses to the single point, so the path carries
    // no arc-length to displace a control point along.
    expect(movePoints(render(degenerate).drawn[0])).toEqual([[5, 5]]);
  });

  it('bends an elbow arrow toward the longer axis', () => {
    // A wide gap routes through the start's y; a tall gap through the start's x.
    const wide = withoutHeads({
      ...straight,
      arrowStyle: 'elbow',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 10 },
      ],
    });
    const tall = withoutHeads({
      ...straight,
      arrowStyle: 'elbow',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 100 },
      ],
    });

    expect(movePoints(render(wide).drawn[0])).toEqual([
      [0, 0],
      [100, 0],
      [100, 10],
    ]);
    expect(movePoints(render(tall).drawn[0])).toEqual([
      [0, 0],
      [0, 100],
      [10, 100],
    ]);
  });

  it('falls back to a straight path for a curved or elbow arrow with three points', () => {
    // The curved and elbow branches require exactly two points; a multi-segment
    // polyline is a polyline.
    for (const arrowStyle of ['curved', 'elbow'] as const) {
      const threePoints = withoutHeads({
        ...straight,
        arrowStyle,
        points: [
          { x: 0, y: 0 },
          { x: 60, y: 40 },
          { x: 120, y: 0 },
        ],
      });
      expect(primitiveOf(render(threePoints).drawn[0])).toBe('linearPath');
    }
  });
});

describe('arrowheads', () => {
  function arrow(overrides: Partial<LinearElement>): LinearElement {
    return {
      ...base({ type: 'arrow' }),
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      ...overrides,
    } as unknown as LinearElement;
  }

  it('draws only the path when both ends are set to none', () => {
    expect(render(arrow({ arrowHeads: { start: 'none', end: 'none' } })).drawn).toHaveLength(1);
  });

  it('defaults to a triangle at the end and nothing at the start', () => {
    const trace = render(arrow({}));
    // Path plus one end head.
    expect(trace.drawn).toHaveLength(2);
    expect(primitiveOf(trace.drawn[1])).toBe('polygon');
  });

  it('draws two heads when both ends are set', () => {
    expect(
      render(arrow({ arrowHeads: { start: 'triangle', end: 'triangle' } })).drawn
    ).toHaveLength(3);
  });

  it('draws each supported head type with the primitive that suits it', () => {
    // `dot` is a circle and `bar` is a line; the rest are polygons.
    expect(primitiveOf(render(arrow({ arrowHeads: { end: 'dot' } })).drawn[1])).toBe('circle');
    expect(primitiveOf(render(arrow({ arrowHeads: { end: 'bar' } })).drawn[1])).toBe('line');
    expect(primitiveOf(render(arrow({ arrowHeads: { end: 'triangle' } })).drawn[1])).toBe(
      'polygon'
    );
    expect(primitiveOf(render(arrow({ arrowHeads: { end: 'diamond' } })).drawn[1])).toBe('polygon');
  });

  it('sizes and places a triangle head from the stroke width', () => {
    // `headLength = 10 + strokeWidth * 2` = 14 for a 2px stroke. For a
    // horizontal arrow the unit direction is (1, 0), so the perpendicular is
    // (0, 1) and the two rear corners sit `headLength` back and `0.4 * headLength`
    // either side of the shaft.
    const trace = render(arrow({ strokeWidth: 2, arrowHeads: { end: 'triangle' } }));
    expectPath(movePoints(trace.drawn[1]), [
      [100, 0],
      [86, 5.6],
      [86, -5.6],
    ]);
  });

  it('sizes a bar head from the stroke width', () => {
    // The bar is perpendicular through the tip, so its span is the full head
    // length: 12 for a 1px stroke, 28 for a 9px stroke.
    const span = (strokeWidth: number): number => {
      const trace = render(arrow({ strokeWidth, arrowHeads: { end: 'bar' } }));
      const y1 = opsOf(trace.drawn[1])[0]?.data[1] as number;
      const y2 = curveEnd(trace.drawn[1], 1)[1] as number;
      return Math.abs(y1 - y2);
    };
    expect(span(1)).toBeCloseTo(12, 6);
    expect(span(9)).toBeCloseTo(28, 6);
  });

  it('points the head back along the shaft, whichever way the shaft runs', () => {
    // A right-to-left arrow must get its head on the left of the tip, which is
    // the sign of the direction vector. Getting it wrong puts the head inside
    // the line.
    const leftward = render(
      arrow({
        points: [
          { x: 100, y: 0 },
          { x: 0, y: 0 },
        ],
        arrowHeads: { end: 'triangle' },
      })
    );
    expectPath(movePoints(leftward.drawn[1]), [
      [0, 0],
      [14, -5.6],
      [14, 5.6],
    ]);
  });

  it('draws a start head pointing away from the line', () => {
    const trace = render(arrow({ arrowHeads: { start: 'triangle', end: 'none' } }));
    // The start head's direction is reversed, so it sits to the right of the
    // first point rather than to its left.
    expectPath(movePoints(trace.drawn[1]), [
      [0, 0],
      [14, -5.6],
      [14, 5.6],
    ]);
  });

  it('still orients a head for a zero-length arrow, along +x', () => {
    // `atan2(0, 0)` is 0, so the direction degenerates to (1, 0) and a head is
    // drawn pointing right. That is also what makes `drawArrowhead`'s own
    // `length === 0` guard unreachable from here: cos and sin of a real angle
    // are never both zero.
    const trace = render(
      arrow({
        points: [
          { x: 5, y: 5 },
          { x: 5, y: 5 },
        ],
        arrowHeads: { end: 'triangle' },
      })
    );
    expect(trace.drawn).toHaveLength(2);
    expectPath(movePoints(trace.drawn[1]), [
      [5, 5],
      [-9, 10.6],
      [-9, -0.6],
    ]);
  });
});

describe('arrow label cutout', () => {
  const arrowElement = {
    ...base({ type: 'arrow', x: 100, y: 200 }),
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    labelId: 'label-1',
  } as unknown as LinearElement;

  it('punches the label box out of the arrow, positioned relative to the arrow', () => {
    const label = base({
      id: 'label-1',
      type: 'text',
      x: 130,
      y: 205,
      width: 40,
      height: 20,
    }) as unknown as DriplElement;

    const trace = render(arrowElement, [arrowElement, label]);

    expect(trace.ctx.composite).toBe('source-over');
    expect(trace.ctx.calls.fillRect).toEqual([{ x: 30, y: 5, width: 40, height: 20 }]);
  });

  it('erases with destination-out only for the duration of the cutout', () => {
    // The path is drawn after the cutout, so it must not inherit the erase mode
    // or the arrow disappears as well as its label.
    const label = base({ id: 'label-1', type: 'text', x: 130, y: 205 }) as unknown as DriplElement;
    const trace = render(arrowElement, [arrowElement, label]);
    expect(trace.ctx.calls.fillRect).toHaveLength(1);
    // One extra save/restore pair beyond the function's own scope.
    expect(trace.ctx.calls.restore).toBeGreaterThanOrEqual(2);
  });

  it('paints the cutout in the theme background colour', () => {
    const label = base({ id: 'label-1', type: 'text' }) as unknown as DriplElement;
    expect(render(arrowElement, [arrowElement, label], 'dark').ctx.fillStyle).toBe('#0f0f13');
    expect(render(arrowElement, [arrowElement, label], 'light').ctx.fillStyle).toBe('#f8f9fa');
  });

  it('punches nothing when the label is missing or is not text', () => {
    expect(render(arrowElement, [arrowElement]).ctx.calls.fillRect).toHaveLength(0);

    const nonText = base({ id: 'label-1', type: 'rectangle' }) as unknown as DriplElement;
    expect(render(arrowElement, [arrowElement, nonText]).ctx.calls.fillRect).toHaveLength(0);
  });

  it('punches nothing for an arrow with no label', () => {
    const plain = { ...arrowElement, labelId: undefined } as unknown as LinearElement;
    expect(render(plain, [plain]).ctx.calls.fillRect).toHaveLength(0);
  });
});

describe('text elements', () => {
  function text(overrides: Partial<DriplElement>) {
    return render(base({ type: 'text', ...overrides } as Partial<DriplElement>));
  }

  it('draws one fillText per line, at the line pitch', () => {
    const trace = text({
      text: 'one\ntwo\nthree',
      fontSize: 20,
      fontFamily: 'Inter',
      x: 5,
      y: 7,
      width: 200,
      height: 200,
    } as Partial<DriplElement>);

    expect(trace.ctx.calls.translate).toEqual([{ x: 5, y: 7 }]);
    expect(trace.ctx.calls.fillText).toEqual([
      { text: 'one', x: 0, y: 0 },
      { text: 'two', x: 0, y: 24 },
      { text: 'three', x: 0, y: 48 },
    ]);
    expect(trace.ctx.font).toBe('20px Inter');
    expect(trace.drawn).toHaveLength(0);
  });

  it('anchors the text horizontally by alignment, measured from the origin', () => {
    expect(text({ text: 'a', textAlign: 'left', width: 100 }).ctx.calls.fillText[0]?.x).toBe(0);
    expect(text({ text: 'a', textAlign: 'center', width: 100 }).ctx.calls.fillText[0]?.x).toBe(50);
    expect(text({ text: 'a', textAlign: 'right', width: 100 }).ctx.calls.fillText[0]?.x).toBe(100);
  });

  it('falls back to left for an unrecognised alignment', () => {
    const trace = text({ text: 'a', textAlign: 'justify', width: 100 } as Partial<DriplElement>);
    expect(trace.ctx.textAlign).toBe('left');
    expect(trace.ctx.calls.fillText[0]?.x).toBe(0);
  });

  it('offsets vertically for middle and bottom alignment', () => {
    // 2 lines at fontSize 20 occupies 48px of content.
    const middle = text({
      text: 'a\nb',
      fontSize: 20,
      width: 100,
      height: 148,
      verticalAlign: 'middle',
    } as Partial<DriplElement>);
    expect(middle.ctx.calls.fillText[0]?.y).toBe(50);

    const bottom = text({
      text: 'a\nb',
      fontSize: 20,
      width: 100,
      height: 148,
      verticalAlign: 'bottom',
    } as Partial<DriplElement>);
    expect(bottom.ctx.calls.fillText[0]?.y).toBe(100);
  });

  it('clamps vertical alignment so content never starts above the origin', () => {
    const cramped = text({
      text: 'a\nb\nc',
      fontSize: 20,
      width: 100,
      height: 10,
      verticalAlign: 'bottom',
    } as Partial<DriplElement>);
    expect(cramped.ctx.calls.fillText[0]?.y).toBe(0);

    const negativeMiddle = text({
      text: 'a\nb',
      fontSize: 20,
      width: 100,
      height: 10,
      verticalAlign: 'middle',
    } as Partial<DriplElement>);
    expect(negativeMiddle.ctx.calls.fillText[0]?.y).toBe(0);
  });

  it('picks the fill colour from the element, falling back per theme', () => {
    expect(text({ strokeColor: '#ff0000' }).ctx.fillStyle).toBe('#ff0000');
    expect(text({ strokeColor: undefined } as unknown as Partial<DriplElement>).ctx.fillStyle).toBe(
      '#000000'
    );
    expect(
      render(
        base({ type: 'text', strokeColor: undefined } as unknown as Partial<DriplElement>),
        [],
        'dark'
      ).ctx.fillStyle
    ).toBe('#ffffff');
  });

  it('defaults the font to 16px Inter and the baseline to top', () => {
    const trace = text({
      fontSize: undefined,
      fontFamily: undefined,
    } as unknown as Partial<DriplElement>);
    expect(trace.ctx.font).toBe('16px Inter');
    expect(trace.ctx.textBaseline).toBe('top');
  });

  it('applies the element opacity to the text', () => {
    expect(text({ opacity: 0.3 } as Partial<DriplElement>).ctx.calls.globalAlpha).toContain(0.3);
    expect(
      text({ opacity: undefined } as unknown as Partial<DriplElement>).ctx.calls.globalAlpha
    ).toContain(1);
  });
});

describe('image elements', () => {
  it('draws the decoded bitmap at the element origin when one is attached', () => {
    const decoded = { naturalWidth: 10 } as unknown as HTMLImageElement;
    const element = {
      ...base({ type: 'image', src: 'a.png', x: 11, y: 22, width: 33, height: 44 }),
      _imageLoaded: decoded,
    } as unknown as DriplElement;

    const trace = render(element);
    expect(trace.ctx.calls.translate).toEqual([{ x: 11, y: 22 }]);
    expect(trace.ctx.calls.drawImage).toEqual([[decoded, 0, 0, 33, 44]]);
  });

  it('draws nothing until the image has decoded', () => {
    const trace = render(base({ type: 'image', src: 'a.png' }) as unknown as DriplElement);
    expect(trace.ctx.calls.drawImage).toHaveLength(0);
    expect(trace.ctx.calls.translate).toHaveLength(0);
  });

  it('draws nothing for an image with no source', () => {
    const element = {
      ...base({ type: 'image' }),
      src: undefined,
      _imageLoaded: { naturalWidth: 1 },
    } as unknown as DriplElement;
    expect(render(element).ctx.calls.drawImage).toHaveLength(0);
  });
});

describe('frame elements', () => {
  function frame(overrides: Partial<DriplElement>) {
    return render(
      base({
        type: 'frame',
        x: 10,
        y: 20,
        width: 200,
        height: 120,
        ...overrides,
      } as Partial<DriplElement>)
    );
  }

  it('draws an outer border and a dashed inner padding rectangle', () => {
    const trace = frame({});
    expect(trace.ctx.calls.translate).toEqual([{ x: 10, y: 20 }]);
    expect(trace.ctx.calls.strokeRect).toEqual([
      { x: 0, y: 0, width: 200, height: 120 },
      { x: 20, y: 20, width: 160, height: 80 },
    ]);
    // The dash is set and then cleared, so nothing after the frame inherits it.
    expect(trace.ctx.calls.setLineDash).toEqual([[5, 5], []]);
  });

  it('honours an explicit padding', () => {
    expect(frame({ padding: 40 }).ctx.calls.strokeRect[1]).toEqual({
      x: 40,
      y: 40,
      width: 120,
      height: 40,
    });
  });

  it('draws the title above the frame', () => {
    expect(frame({ title: 'My frame' }).ctx.calls.fillText).toEqual([
      { text: 'My frame', x: 10, y: -10 },
    ]);
  });

  it('draws no title when there is none', () => {
    expect(frame({}).ctx.calls.fillText).toHaveLength(0);
  });
});

describe('embed elements', () => {
  function embed(overrides: Partial<DriplElement>) {
    return render(
      base({
        type: 'embed',
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        ...overrides,
      } as Partial<DriplElement>)
    );
  }

  it('draws a filled rectangle with a globe placeholder', () => {
    const trace = embed({ url: 'https://x.test' });
    expect(trace.ctx.calls.strokeRect).toEqual([{ x: 0, y: 0, width: 200, height: 100 }]);
    expect(trace.ctx.calls.fillRect).toEqual([{ x: 0, y: 0, width: 200, height: 100 }]);
    expect(trace.ctx.calls.fillText.some(t => t.text === '🌐')).toBe(true);
    expect(trace.ctx.calls.fillText.find(t => t.text !== '🌐')?.y).toBe(65);
  });

  it('labels the embed with its title, else its url, else a fallback', () => {
    expect(
      embed({ url: 'https://x.test', title: 'Docs' }).ctx.calls.fillText.some(
        t => t.text === 'Docs'
      )
    ).toBe(true);
    expect(
      embed({ url: 'https://x.test' }).ctx.calls.fillText.some(t => t.text === 'https://x.test')
    ).toBe(true);
    expect(embed({}).ctx.calls.fillText.some(t => t.text === 'Web Embed')).toBe(true);
  });

  it('truncates a label that cannot fit the box', () => {
    // The stub context reports width 10 for everything, which fits, so the
    // truncation branch needs a context that reports a real measurement.
    const element = base({
      type: 'embed',
      width: 60,
      height: 100,
      url: 'https://example.test/a/very/long/path',
    } as Partial<DriplElement>) as DriplElement;

    const labels: string[] = [];
    const ctx = {
      save: () => undefined,
      restore: () => undefined,
      translate: () => undefined,
      fillRect: () => undefined,
      strokeRect: () => undefined,
      measureText: (text: string) => ({ width: text.length * 6 }),
      fillText: (text: string) => void labels.push(text),
      font: '',
      fillStyle: '',
      strokeStyle: '',
      textAlign: '',
      textBaseline: '',
    } as unknown as CanvasRenderingContext2D;

    renderRoughElement(
      { draw: () => undefined } as unknown as Parameters<typeof renderRoughElement>[0],
      ctx,
      element,
      [],
      'light'
    );

    const label = labels.find(text => text !== '🌐');
    // `maxWidth = width - 20 = 40`; the stub reports 6px per char, so the label
    // overflows and is cut to 30 characters plus an ellipsis.
    expect(label).toBe(`${'https://example.test/a/very/long/path'.slice(0, 30)}...`);
  });

  it('restores the text alignment it changed', () => {
    // The globe is centred, so the embed has to hand the context back as it
    // found it or the next element inherits centre alignment.
    const trace = embed({ url: 'https://x.test' });
    expect(trace.ctx.textAlign).toBe('start');
    expect(trace.ctx.textBaseline).toBe('alphabetic');
  });
});

describe('shape cache interaction', () => {
  it('reuses the cached drawable for a repeat render of the same element', () => {
    const element = base({ id: 'cached' });
    expect(render(element).drawn[0]).toBe(render(element).drawn[0]);
  });

  it('regenerates rather than reading the cache when exporting', () => {
    // An export must render the committed state, not whatever was cached while
    // the user was mid-drag. Observable as a fresh object each time.
    const element = base({ id: 'exported' });
    expect(render(element, [], 'light', true).drawn[0]).not.toBe(
      render(element, [], 'light', true).drawn[0]
    );
  });

  it('does not populate the cache from an export', () => {
    // Otherwise the next live frame would read a drawable produced by the export
    // path, which bypasses the version contract entirely.
    const element = base({ id: 'export-then-live' });
    render(element, [], 'light', true);
    expect(render(element).drawn[0]).toBe(render(element).drawn[0]);
    expect(render(element).drawn[0]).not.toBe(render(element, [], 'light', true).drawn[0]);
  });

  it('keys the cache on element identity, not on the fields it carries', () => {
    const first = base({ id: 'same-id' });
    const second = base({ id: 'same-id' });
    expect(render(first).drawn[0]).not.toBe(render(second).drawn[0]);
  });
});
