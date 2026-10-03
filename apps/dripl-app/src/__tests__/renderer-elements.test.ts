import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { DriplElement, Point } from '@dripl/common';
import { clearTextMeasurementCache, renderElement } from '@/renderer/elements';
import { getArrowheadPoints, getDirectionVector } from '@/utils/arrow-routing';
import { getDefaultFontFamily } from '@/utils/fontPreferences';
import {
  arcs,
  createRecordingContext,
  ellipses,
  fillTexts,
  lineTos,
  moveTos,
  rects,
  type RecordingContext,
  translates,
} from './helpers/canvas-recorder';
import { bareElement, linear } from './helpers/elements';

/**
 * `renderer/elements.ts` is the whole element draw pass: a dispatcher, one
 * renderer per shape, the arrowhead geometry and the text metrics cache.
 *
 * `imageCache` is replaced per test because the real one reaches for `Image`,
 * which jsdom does not implement. Everything else is exercised against the
 * recording context.
 */

const imageCacheState = vi.hoisted(() => ({
  entries: new Map<string, { loaded: boolean; image: unknown }>(),
  load: vi.fn<(src: string) => Promise<unknown>>(),
}));

vi.mock('@dripl/element/image-cache', () => ({
  imageCache: {
    get: (src: string) => imageCacheState.entries.get(src),
    load: (src: string) => imageCacheState.load(src),
  },
}));

const ZOOM = 1;

/** Roughness 0 collapses the hand-drawn pass to one stroke, so counts are exact. */
function clean(element: DriplElement): DriplElement {
  return { ...element, roughness: 0 } as DriplElement;
}

let rec: RecordingContext;
beforeEach(() => {
  rec = createRecordingContext({
    textWidths: { Hello: 50, World: 60, 'line one': 80, 'line two': 40, '': 0 },
    defaultCharWidth: 0,
  });
  clearTextMeasurementCache();
  imageCacheState.entries.clear();
  imageCacheState.load.mockReset();
  imageCacheState.load.mockResolvedValue(undefined);
});

afterEach(() => {
  clearTextMeasurementCache();
});

describe('renderElement: lifecycle', () => {
  it('draws a deleted element not at all, not even a save/restore', () => {
    renderElement(rec.ctx, rectangleDeleted(), ZOOM);
    expect(rec.ops).toHaveLength(0);
  });

  it('brackets every non-deleted element in a balanced save/restore', () => {
    renderElement(rec.ctx, bareElement('a'), ZOOM);
    expect(rec.ops[0]!.method).toBe('save');
    expect(rec.ops.at(-1)!.method).toBe('restore');
    expect(rec.countOf('save')).toBe(1);
    expect(rec.countOf('restore')).toBe(1);
  });

  it('restores the drawing state it borrowed, leaving opacity and transform untouched', () => {
    rec.ctx.globalAlpha = 0.42;
    renderElement(rec.ctx, bareElement('a', { opacity: 0.1, angle: 1 }), ZOOM);
    // Everything the renderer set inside save() is gone again.
    expect(rec.style().globalAlpha).toBe(0.42);
    expect(translates(rec)).toHaveLength(2);
  });

  it('applies the clamped element opacity to the context', () => {
    renderElement(rec.ctx, bareElement('a', { opacity: 4 }), ZOOM);
    const first = rec.ops.find(op => op.method === 'stroke')!;
    expect(first.style.globalAlpha).toBe(1);
  });
});

describe('renderElement: dispatcher', () => {
  const cases: Array<[string, () => DriplElement, (r: RecordingContext) => void]> = [
    ['rectangle', () => clean(bareElement('a', { type: 'rectangle' })), r => rects(r).length],
    ['diamond', () => clean(bareElement('a', { type: 'diamond' })), r => lineTos(r).length],
    ['ellipse', () => clean(bareElement('a', { type: 'ellipse' })), r => ellipses(r).length],
    [
      'line',
      () =>
        clean(
          linear('a', 'line', [
            { x: 0, y: 0 },
            { x: 9, y: 9 },
          ])
        ),
      r => lineTos(r).length,
    ],
    [
      'freedraw',
      () =>
        clean(
          linear('a', 'freedraw', [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
          ])
        ),
      r => lineTos(r).length,
    ],
    [
      'text',
      () =>
        clean({ ...bareElement('a'), type: 'text', text: 'Hello', fontSize: 20, fontFamily: 'X' }),
      r => fillTexts(r).length,
    ],
    ['frame', () => clean(bareElement('a', { type: 'frame' })), r => r.countOf('strokeRect')],
    [
      'embed',
      () => clean(bareElement('a', { type: 'embed', url: 'https://x.dev' })),
      r => r.countOf('strokeRect'),
    ],
    [
      'image',
      () => clean(bareElement('a', { type: 'image', src: 'https://x.dev/a.png' })),
      r => r.countOf('fillRect'),
    ],
  ];

  it.each(cases)('routes %s to its own renderer', (_name, make, countDraws) => {
    renderElement(rec.ctx, make(), ZOOM);
    expect(countDraws(rec)).toBeGreaterThan(0);
  });

  it('falls back to the rectangle renderer for an unknown type', () => {
    renderElement(
      rec.ctx,
      clean(bareElement('a', { type: 'sticker', x: 3, y: 4, width: 5, height: 6 })),
      ZOOM
    );
    expect(rects(rec)).toEqual([[3, 4, 5, 6]]);
  });

  it('gives an unknown type exactly the same draw list as a rectangle', () => {
    const shape = { x: 11, y: 12, width: 13, height: 14 } as const;
    renderElement(rec.ctx, clean(bareElement('a', { ...shape })), ZOOM);
    const asRectangle = rec.ops.map(op => `${op.method}(${op.args.join(',')})`);
    rec.reset();
    renderElement(rec.ctx, clean(bareElement('a', { ...shape, type: 'sticker' })), ZOOM);
    expect(rec.ops.map(op => `${op.method}(${op.args.join(',')})`)).toEqual(asRectangle);
  });

  it('routes the legacy "path" type through the path-like renderer', () => {
    renderElement(
      rec.ctx,
      clean(
        linear(
          'a',
          'line',
          [
            { x: 0, y: 0 },
            { x: 4, y: 4 },
          ],
          { type: 'path' }
        )
      ),
      ZOOM
    );
    expect(lineTos(rec)).toEqual([[4, 4]]);
  });
});

function rectangleDeleted(): DriplElement {
  return bareElement('a', { isDeleted: true });
}

describe('renderRectangle', () => {
  it('fills at the element origin with no offset on the first (un-jittered) pass', () => {
    renderElement(
      rec.ctx,
      clean(bareElement('a', { x: 7, y: 8, width: 9, height: 10, fillColor: '#ff0000' })),
      ZOOM
    );
    const fill = rec.calls('fill')[0]!;
    expect(rects(rec)[0]).toEqual([7, 8, 9, 10]);
    expect(fill.style.fillStyle).toBe('#ff0000');
  });

  it('does not fill a transparent rectangle, but still strokes it', () => {
    renderElement(rec.ctx, clean(bareElement('a', { fillColor: 'transparent' })), ZOOM);
    expect(rec.countOf('fill')).toBe(0);
    expect(rec.countOf('stroke')).toBe(1);
  });

  it('passes negative width/height straight to ctx.rect rather than normalising', () => {
    // Normalisation happens in the tools; a flipped element must still draw.
    renderElement(rec.ctx, clean(bareElement('a', { x: 10, y: 10, width: -4, height: -6 })), ZOOM);
    expect(rects(rec)).toEqual([[10, 10, -4, -6]]);
  });

  it('draws one stroke per rough pass, each re-offset', () => {
    renderElement(rec.ctx, bareElement('a', { roughness: 1 }), ZOOM);
    expect(rects(rec)).toHaveLength(3);
    const [first, second, third] = rects(rec);
    // roughJitterOffset: 0, -0.35, +0.70 at zoom 1 (0.7/zoom * pass / 2, sign by parity).
    expect(first![0]).toBe(0);
    expect(second![0]).toBeCloseTo(-0.35, 10);
    expect(third![0]).toBeCloseTo(0.7, 10);
    expect(third![1]).toBeCloseTo(-0.7, 10);
  });
});

describe('renderEllipse', () => {
  it('uses the element centre with absolute radii, sweeping a full turn', () => {
    renderElement(
      rec.ctx,
      clean(bareElement('a', { type: 'ellipse', x: 0, y: 0, width: 40, height: 20 })),
      ZOOM
    );
    const [cx, cy, rx, ry, rotation, start, end] = ellipses(rec)[0]!;
    expect([cx, cy, rx, ry]).toEqual([20, 10, 20, 10]);
    expect(rotation).toBe(0);
    expect(start).toBe(0);
    expect(end).toBeCloseTo(Math.PI * 2, 12);
  });

  it('takes absolute radii, so a flipped ellipse is not mirrored twice', () => {
    renderElement(
      rec.ctx,
      clean(bareElement('a', { type: 'ellipse', x: 0, y: 0, width: -40, height: 20 })),
      ZOOM
    );
    expect(ellipses(rec)[0]!.slice(0, 4)).toEqual([-20, 10, 20, 10]);
  });
});

describe('renderDiamond', () => {
  it('walks the four edge midpoints of the element box and closes the path', () => {
    renderElement(
      rec.ctx,
      clean(bareElement('a', { type: 'diamond', x: 0, y: 0, width: 100, height: 60 })),
      ZOOM
    );
    expect(moveTos(rec)).toEqual([[50, 0]]);
    expect(lineTos(rec)).toEqual([
      [100, 30],
      [50, 60],
      [0, 30],
    ]);
    expect(rec.countOf('closePath')).toBe(1);
  });

  it('orders the vertices top, right, bottom, left', () => {
    renderElement(
      rec.ctx,
      clean(bareElement('a', { type: 'diamond', x: 0, y: 0, width: 100, height: 60 })),
      ZOOM
    );
    const vertices = [moveTos(rec)[0]!, ...lineTos(rec)];
    expect(vertices).toEqual([
      [50, 0],
      [100, 30],
      [50, 60],
      [0, 30],
    ]);
  });
});

describe('renderPathLike: straight lines', () => {
  it('moveTo the first point then lineTo each remaining point, in stored order', () => {
    renderElement(
      rec.ctx,
      clean({
        id: 'a',
        type: 'line',
        x: 100,
        y: 100,
        width: 8,
        height: 3,
        points: [
          { x: 0, y: 0 },
          { x: 2, y: 2 },
          { x: 8, y: 0 },
        ],
      } as DriplElement),
      ZOOM
    );
    expect(moveTos(rec)).toEqual([[100, 100]]);
    expect(lineTos(rec)).toEqual([
      [102, 102],
      [108, 100],
    ]);
  });

  it('translates relative points by the element origin', () => {
    const element = linear(
      'a',
      'line',
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      { x: 50, y: 60 }
    );
    renderElement(rec.ctx, clean(element), ZOOM);
    expect(moveTos(rec)).toEqual([[50, 60]]);
    expect(lineTos(rec)).toEqual([[60, 70]]);
  });

  it('draws nothing for an element with no points', () => {
    renderElement(rec.ctx, clean(bareElement('a', { type: 'line', points: [] })), ZOOM);
    expect(rec.countOf('stroke')).toBe(0);
    expect(rec.countOf('lineTo')).toBe(0);
  });
});

describe('renderPathLike: fill rules', () => {
  function closedTri(overrides: Record<string, unknown> = {}): DriplElement {
    return linear(
      'a',
      'line',
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
      overrides as never
    );
  }

  it('fills a closed three-point path when it has a fill colour', () => {
    renderElement(rec.ctx, clean(closedTri({ type: 'freedraw', fillColor: '#00ff00' })), ZOOM);
    expect(rec.countOf('fill')).toBe(1);
  });

  it('never fills a line, whatever the fill colour', () => {
    renderElement(rec.ctx, clean(closedTri({ fillColor: '#00ff00' })), ZOOM);
    expect(rec.countOf('fill')).toBe(0);
  });

  it('does not fill a two-point path, because closing a segment encloses no area', () => {
    renderElement(
      rec.ctx,
      clean(
        linear(
          'a',
          'freedraw',
          [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
          ],
          { fillColor: '#00ff00' } as never
        )
      ),
      ZOOM
    );
    expect(rec.countOf('fill')).toBe(0);
  });

  it('does not fill a transparent closed path', () => {
    renderElement(rec.ctx, clean(closedTri({ type: 'freedraw', fillColor: 'transparent' })), ZOOM);
    expect(rec.countOf('fill')).toBe(0);
  });
});

describe('renderPathLike: freedraw smoothing', () => {
  it('draws a degenerate dot as a 0.01-long segment so a tap still marks the canvas', () => {
    renderElement(rec.ctx, clean(linear('a', 'freedraw', [{ x: 0, y: 0 }])), ZOOM);
    expect(moveTos(rec)).toEqual([[0, 0]]);
    expect(lineTos(rec)).toEqual([[0.01, 0.01]]);
  });

  it('draws a two-point stroke as a plain segment', () => {
    renderElement(
      rec.ctx,
      clean(
        linear('a', 'freedraw', [
          { x: 0, y: 0 },
          { x: 7, y: 0 },
        ])
      ),
      ZOOM
    );
    expect(rec.calls('quadraticCurveTo')).toHaveLength(0);
    expect(lineTos(rec)).toEqual([[7, 0]]);
  });

  it('smooths interior points as quadratics anchored at segment midpoints', () => {
    // points (0,0) (10,0) (20,0): one interior point, control (10,0), end (15,0).
    renderElement(
      rec.ctx,
      clean(
        linear('a', 'freedraw', [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 0 },
        ])
      ),
      ZOOM
    );
    expect(rec.calls('quadraticCurveTo')[0]!.args).toEqual([10, 0, 15, 0]);
    expect(lineTos(rec)).toEqual([[20, 0]]);
  });

  it('iterates only to the second-to-last point, so each midpoint is used once', () => {
    renderElement(
      rec.ctx,
      clean(
        linear('a', 'freedraw', [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 0 },
          { x: 30, y: 0 },
        ])
      ),
      ZOOM
    );
    // Two interior points -> two quadratics.
    expect(rec.countOf('quadraticCurveTo')).toBe(2);
    expect(rec.calls('quadraticCurveTo')[0]!.args).toEqual([10, 0, 15, 0]);
    expect(rec.calls('quadraticCurveTo')[1]!.args).toEqual([20, 0, 25, 0]);
  });

  it('always ends on the final point', () => {
    const points: Point[] = Array.from({ length: 8 }, (_, i) => ({ x: i * 3, y: (i % 3) * 4 }));
    renderElement(rec.ctx, clean(linear('a', 'freedraw', points)), ZOOM);
    const last = points.at(-1)!;
    expect(lineTos(rec).at(-1)).toEqual([last.x, last.y]);
  });
});

describe('renderPathLike: arrow styles', () => {
  const arrow = (overrides: Record<string, unknown> = {}) =>
    linear(
      'a',
      'arrow',
      [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
      ],
      {
        arrowStyle: 'straight',
        arrowHeads: { start: 'none', end: 'none' },
        ...overrides,
      } as never
    ) as DriplElement;

  it('draws a straight arrow as a single segment', () => {
    renderElement(rec.ctx, clean(arrow()), ZOOM);
    expect(lineTos(rec)).toEqual([[40, 0]]);
    expect(rec.countOf('quadraticCurveTo')).toBe(0);
  });

  it('curves with a control point a quarter chord-length to the left of the midpoint', () => {
    // first (0,0) last (40,0): midpoint (20,0), dx=40 dy=0, length=40.
    // control = (20 + (-0/40)*40*0.25, 0 + (40/40)*40*0.25) = (20, 10).
    renderElement(rec.ctx, clean(arrow({ arrowStyle: 'curved' })), ZOOM);
    expect(rec.calls('quadraticCurveTo')[0]!.args).toEqual([20, 10, 40, 0]);
    expect(lineTos(rec)).toEqual([]);
  });

  it('curves to the opposite side when the arrow points left', () => {
    // first (40,0) last (0,0): dx=-40, dy=0 -> control (20, -10).
    renderElement(
      rec.ctx,
      clean(
        linear(
          'a',
          'arrow',
          [
            { x: 40, y: 0 },
            { x: 0, y: 0 },
          ],
          { arrowStyle: 'curved', arrowHeads: { start: 'none', end: 'none' } } as never
        )
      ),
      ZOOM
    );
    expect(rec.calls('quadraticCurveTo')[0]!.args).toEqual([20, -10, 0, 0]);
  });

  it('elbows horizontally first when the chord is wider than it is tall', () => {
    renderElement(rec.ctx, clean(arrow({ arrowStyle: 'elbow' })), ZOOM);
    expect(lineTos(rec)).toEqual([
      [40, 0],
      [40, 0],
    ]);
  });

  it('elbows vertically first when the chord is taller than it is wide', () => {
    renderElement(
      rec.ctx,
      clean(
        linear(
          'a',
          'arrow',
          [
            { x: 0, y: 0 },
            { x: 10, y: 100 },
          ],
          { arrowStyle: 'elbow', arrowHeads: { start: 'none', end: 'none' } } as never
        )
      ),
      ZOOM
    );
    expect(lineTos(rec)).toEqual([
      [0, 100],
      [10, 100],
    ]);
  });

  it('breaks a tie in |dx| vs |dy| toward the vertical-first elbow', () => {
    renderElement(
      rec.ctx,
      clean(
        linear(
          'a',
          'arrow',
          [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
          { arrowStyle: 'elbow', arrowHeads: { start: 'none', end: 'none' } } as never
        )
      ),
      ZOOM
    );
    expect(lineTos(rec)).toEqual([
      [0, 10],
      [10, 10],
    ]);
  });

  it('treats an unknown arrowStyle as straight rather than drawing nothing', () => {
    renderElement(rec.ctx, clean(arrow({ arrowStyle: 'zigzag' })), ZOOM);
    expect(lineTos(rec)).toEqual([[40, 0]]);
    expect(rec.countOf('quadraticCurveTo')).toBe(0);
  });
});

describe('renderPathLike: curved arrow with coincident endpoints', () => {
  it('falls back to a straight segment instead of emitting NaN control coordinates', () => {
    // A curved arrow whose endpoints coincide makes the chord length zero, so
    // `-dy / length` is 0/0. NaN coordinates are silently ignored by canvas,
    // which would make the arrow vanish with no error anywhere. The arrowhead
    // angle already falls back to the straight direction for the same reason,
    // so the shaft has to agree with it.
    renderElement(
      rec.ctx,
      clean(
        linear(
          'a',
          'arrow',
          [
            { x: 5, y: 5 },
            { x: 5, y: 5 },
          ],
          {
            arrowStyle: 'curved',
            arrowHeads: { start: 'none', end: 'none' },
          } as never
        )
      ),
      ZOOM
    );
    expect(rec.calls('quadraticCurveTo')).toHaveLength(0);
    expect(moveTos(rec)).toEqual([[5, 5]]);
    expect(lineTos(rec)).toEqual([[5, 5]]);
    for (const op of rec.ops) {
      for (const arg of op.args) {
        if (typeof arg === 'number') expect(Number.isFinite(arg)).toBe(true);
      }
    }
  });

  it('still draws the arrowhead for a zero-length curved arrow', () => {
    renderElement(
      rec.ctx,
      clean(
        linear(
          'a',
          'arrow',
          [
            { x: 5, y: 5 },
            { x: 5, y: 5 },
          ],
          {
            arrowStyle: 'curved',
            arrowHeads: { start: 'none', end: 'triangle' },
          } as never
        )
      ),
      ZOOM
    );
    expect(rec.countOf('fill')).toBe(1);
  });
});

describe('renderPathLike: arrowheads', () => {
  const arrow = (overrides: Record<string, unknown>) =>
    linear(
      'a',
      'arrow',
      [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
      ],
      {
        arrowStyle: 'straight',
        arrowHeads: { start: 'none', end: 'triangle' },
        ...overrides,
      } as never
    ) as DriplElement;

  it('draws an end triangle by default when arrowHeads is absent', () => {
    renderElement(rec.ctx, clean(arrow({ arrowHeads: undefined })), ZOOM);
    // default { start: 'none', end: 'triangle' } -> exactly one filled polygon
    const fills = rec.calls('fill');
    expect(fills).toHaveLength(1);
    expect(moveTos(rec).at(-1)).toEqual([40, 0]);
  });

  it('draws nothing extra when both heads are "none"', () => {
    renderElement(rec.ctx, clean(arrow({ arrowHeads: { start: 'none', end: 'none' } })), ZOOM);
    expect(rec.countOf('fill')).toBe(0);
    expect(rec.countOf('arc')).toBe(0);
  });

  it('positions the end head on the final point and the start head on the first', () => {
    renderElement(
      rec.ctx,
      clean(arrow({ arrowHeads: { start: 'triangle', end: 'triangle' } })),
      ZOOM
    );
    const tips = [...moveTos(rec)];
    expect(tips).toContainEqual([0, 0]);
    expect(tips).toContainEqual([40, 0]);
  });

  it('renders a dot head as a filled circle centred on the tip with radius 4.8', () => {
    renderElement(rec.ctx, clean(arrow({ arrowHeads: { start: 'none', end: 'dot' } })), ZOOM);
    const [cx, cy, r, start, end] = arcs(rec)[0]!;
    expect([cx, cy]).toEqual([40, 0]);
    expect(r).toBeCloseTo(4.8, 10);
    expect(start).toBe(0);
    expect(end).toBeCloseTo(Math.PI * 2, 10);
  });

  it('renders a bar head as a single stroked segment perpendicular to the shaft', () => {
    // Shaft (0,0)->(40,0), so the bar sits at the tip (40,0), spanning y -6..+6.
    renderElement(rec.ctx, clean(arrow({ arrowHeads: { start: 'none', end: 'bar' } })), ZOOM);
    expect(lineTos(rec)).toEqual([
      [40, 0],
      [40, -6],
    ]);
    // One stroke for the shaft, one for the bar, and no fill for either.
    expect(rec.countOf('stroke')).toBe(2);
    expect(rec.countOf('fill')).toBe(0);
  });

  it('builds each head type with its own closed-path construction', () => {
    const sequence = (end: string) => {
      rec.reset();
      renderElement(rec.ctx, clean(arrow({ arrowHeads: { start: 'none', end } })), ZOOM);
      return rec.ops.map(op => op.method);
    };

    const shaft = ['save', 'beginPath', 'moveTo', 'lineTo', 'stroke'];
    expect(sequence('triangle')).toEqual([
      ...shaft,
      'beginPath',
      'moveTo',
      'lineTo',
      'lineTo',
      'closePath',
      'fill',
      'stroke',
      'restore',
    ]);
    // Same construction, one more vertex: a diamond head is a four-sided polygon.
    expect(sequence('diamond')).toEqual([
      ...shaft,
      'beginPath',
      'moveTo',
      'lineTo',
      'lineTo',
      'lineTo',
      'closePath',
      'fill',
      'stroke',
      'restore',
    ]);
    expect(sequence('bar')).toEqual([
      ...shaft,
      'beginPath',
      'moveTo',
      'lineTo',
      'stroke',
      'restore',
    ]);
    expect(sequence('dot')).toEqual([...shaft, 'beginPath', 'arc', 'fill', 'restore']);
  });

  it('emits the same points getArrowheadPoints produces for the end head', () => {
    const element = arrow({ arrowHeads: { start: 'none', end: 'triangle' } });
    const tip: Point = { x: 40, y: 0 };
    const angle = Math.atan2(0 - 0, 40 - 0);
    const direction = getDirectionVector(
      { x: tip.x - Math.cos(angle), y: tip.y - Math.sin(angle) },
      tip
    );
    const expected = getArrowheadPoints(tip, direction, 'triangle', 12);
    renderElement(rec.ctx, clean(element), ZOOM);
    const drawn = [...moveTos(rec).slice(-1), ...lineTos(rec).slice(-(expected.length - 1))];
    expect(drawn).toEqual(expected.map(p => [p.x, p.y]));
  });

  it('skips the end head entirely when the path has fewer than two points', () => {
    renderElement(
      rec.ctx,
      clean(linear('a', 'arrow', [{ x: 0, y: 0 }], { arrowStyle: 'straight' } as never)),
      ZOOM
    );
    expect(rec.countOf('fill')).toBe(0);
  });
});

describe('renderText', () => {
  function text(overrides: Record<string, unknown> = {}): DriplElement {
    return {
      ...bareElement('a', { type: 'text', x: 10, y: 20, width: 200, height: 40 }),
      type: 'text',
      text: 'Hello',
      fontSize: 20,
      fontFamily: 'Inter',
      strokeColor: '#ff00ff',
      ...overrides,
    } as DriplElement;
  }

  it('draws nothing for empty text', () => {
    renderElement(rec.ctx, text({ text: '' }), ZOOM);
    expect(rec.countOf('fillText')).toBe(0);
    expect(rec.countOf('stroke')).toBe(0);
  });

  it('sets the context font, alignment, baseline and a stroke-derived fill colour', () => {
    renderElement(rec.ctx, text(), ZOOM);
    const fill = rec.calls('fillText')[0]!;
    expect(fill.style.font).toBe('20px Inter');
    // The default textAlign is the literal string 'left', not the canvas
    // 'start' alias, and the baseline is pinned to the top so y is the glyph top.
    expect(fill.style.textAlign).toBe('left');
    expect(fill.style.textBaseline).toBe('top');
    expect(fill.style.fillStyle).toBe('#ff00ff');
  });

  it('fills text with the stroke colour, because a text element has no separate fill', () => {
    renderElement(rec.ctx, text({ fillColor: '#00ff00' }), ZOOM);
    expect(rec.calls('fillText')[0]!.style.fillStyle).toBe('#ff00ff');
  });

  it('draws each line of a multi-line string at a lineHeight of 1.25x the font size', () => {
    renderElement(rec.ctx, text({ text: 'line one\nline two' }), ZOOM);
    expect(fillTexts(rec)).toEqual([
      ['line one', 10, 20],
      ['line two', 10, 45],
    ]);
  });

  it('anchors left-aligned text at x and right-aligned text at x + width', () => {
    renderElement(rec.ctx, text({ textAlign: 'left' }), ZOOM);
    expect(fillTexts(rec)[0]![1]).toBe(10);
    rec.reset();
    renderElement(rec.ctx, text({ textAlign: 'right' }), ZOOM);
    expect(fillTexts(rec)[0]![1]).toBe(210);
  });

  it('anchors centre-aligned text at the horizontal midpoint', () => {
    renderElement(rec.ctx, text({ textAlign: 'center', width: 200 }), ZOOM);
    expect(fillTexts(rec)[0]![1]).toBe(110);
  });

  it('centres vertically when verticalAlign is middle, never starting above the box', () => {
    // totalHeight = 1 * 25; box height 10 -> (10 - 25) / 2 = -7.5, clamped to 0.
    renderElement(rec.ctx, text({ verticalAlign: 'middle', height: 10 }), ZOOM);
    expect(fillTexts(rec)[0]![2]).toBe(20);
  });

  it('pushes bottom-aligned text to the base of the box', () => {
    renderElement(rec.ctx, text({ verticalAlign: 'bottom', height: 100 }), ZOOM);
    expect(fillTexts(rec)[0]![2]).toBe(95);
  });

  it('never starts bottom-aligned text above its own top edge', () => {
    renderElement(rec.ctx, text({ verticalAlign: 'bottom', height: 5 }), ZOOM);
    expect(fillTexts(rec)[0]![2]).toBe(20);
  });

  it('falls back to the default font family when the element has none', () => {
    renderElement(rec.ctx, text({ fontFamily: '' }), ZOOM);
    expect(rec.calls('fillText')[0]!.style.font).toBe(`20px ${getDefaultFontFamily()}`);
  });

  it('falls back to the default font family when the element has no fontFamily field', () => {
    const element = text();
    delete (element as { fontFamily?: string }).fontFamily;
    renderElement(rec.ctx, element, ZOOM);
    expect(rec.calls('fillText')[0]!.style.font).toBe(`20px ${getDefaultFontFamily()}`);
  });

  it('measures the widest line to decide nothing but to keep metrics for later', () => {
    renderElement(rec.ctx, text({ text: 'line one\nline two' }), ZOOM);
    expect(rec.argLists('measureText')).toEqual([['line one'], ['line two']]);
  });

  it('caches measurements per text/font/size/align and reuses them across renders', () => {
    renderElement(rec.ctx, text(), ZOOM);
    expect(rec.countOf('measureText')).toBe(1);
    rec.reset();
    renderElement(rec.ctx, text(), ZOOM);
    expect(rec.countOf('measureText')).toBe(0);
    expect(fillTexts(rec)).toEqual([['Hello', 10, 20]]);
  });

  it('keys the cache on every input that changes the measurement', () => {
    renderElement(rec.ctx, text(), ZOOM);
    for (const change of [{ fontSize: 21 }, { fontFamily: 'Other' }, { textAlign: 'center' }]) {
      rec.reset();
      renderElement(rec.ctx, text(change), ZOOM);
      expect(rec.countOf('measureText')).toBe(1);
    }
  });

  it('stops measuring once the cache is cleared', () => {
    renderElement(rec.ctx, text(), ZOOM);
    clearTextMeasurementCache();
    rec.reset();
    renderElement(rec.ctx, text(), ZOOM);
    expect(rec.countOf('measureText')).toBe(1);
  });

  it('bounds the cache at 500 entries, evicting in insertion order', () => {
    const render = (value: string) => renderElement(rec.ctx, text({ text: value }), ZOOM);

    // Fill the cache to exactly its limit; nothing has been evicted yet.
    for (let i = 0; i < 500; i += 1) render(`line ${i}`);
    rec.reset();
    render('line 0');
    expect(rec.countOf('measureText')).toBe(0);

    // One more distinct entry tips it over, and the OLDEST entry is the one lost.
    rec.reset();
    render('one too many');
    expect(rec.countOf('measureText')).toBe(1);
    rec.reset();
    render('line 0');
    expect(rec.countOf('measureText')).toBe(1);

    // The most recent entry survived.
    rec.reset();
    render('one too many');
    expect(rec.countOf('measureText')).toBe(0);
    clearTextMeasurementCache();
  });
});

describe('renderImage', () => {
  it('draws the cached bitmap at the element rect once loaded', () => {
    const image = { width: 10, height: 10 };
    imageCacheState.entries.set('https://x.dev/a.png', { loaded: true, image });
    renderElement(
      rec.ctx,
      bareElement('a', {
        type: 'image',
        x: 5,
        y: 6,
        width: 7,
        height: 8,
        src: 'https://x.dev/a.png',
      }),
      ZOOM
    );
    expect(rec.calls('drawImage')[0]!.args).toEqual([image, 5, 6, 7, 8]);
    expect(rec.countOf('fillRect')).toBe(0);
    expect(imageCacheState.load).not.toHaveBeenCalled();
  });

  it('draws a grey placeholder and starts a load when nothing is cached', () => {
    renderElement(
      rec.ctx,
      bareElement('a', {
        type: 'image',
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        src: 'https://x.dev/b.png',
      }),
      ZOOM
    );
    const fillRect = rec.calls('fillRect')[0]!;
    expect(fillRect.args).toEqual([1, 2, 3, 4]);
    expect(fillRect.style.fillStyle).toBe('rgba(127,127,127,0.2)');
    expect(imageCacheState.load).toHaveBeenCalledWith('https://x.dev/b.png');
  });

  it('draws the placeholder again while a load is in flight, without restarting it', () => {
    imageCacheState.entries.set('https://x.dev/c.png', { loaded: false, image: null });
    renderElement(rec.ctx, bareElement('a', { type: 'image', src: 'https://x.dev/c.png' }), ZOOM);
    expect(rec.countOf('fillRect')).toBe(1);
    expect(imageCacheState.load).not.toHaveBeenCalled();
  });

  it('gives a rejected image load a handler, so a broken url cannot become an unhandled rejection', () => {
    // A real Promise subclass, so `this` stays a genuine Promise: recording
    // whether `catch` was called proves renderImage handles the rejection
    // itself. If it ever stopped, this fails.
    class LoadSpy extends Promise<unknown> {
      catchAttached = false;
      override catch<TResult = never>(
        onRejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null | undefined
      ): Promise<unknown | TResult> {
        this.catchAttached = true;
        return super.catch(onRejected);
      }
    }
    const rejecting = new LoadSpy((_resolve, reject) => reject(new Error('boom')));
    imageCacheState.load.mockReturnValue(rejecting);

    expect(() =>
      renderElement(rec.ctx, bareElement('a', { type: 'image', src: 'https://x.dev/d.png' }), ZOOM)
    ).not.toThrow();
    expect(rejecting.catchAttached).toBe(true);
    return expect(rejecting.catch(() => 'handled')).resolves.toBe('handled');
  });

  it('draws nothing at all without a usable src', () => {
    for (const src of [undefined, '', 42]) {
      rec.reset();
      renderElement(rec.ctx, bareElement('a', { type: 'image', src } as never), ZOOM);
      expect(rec.countOf('fillRect')).toBe(0);
      expect(rec.countOf('drawImage')).toBe(0);
    }
    expect(imageCacheState.load).not.toHaveBeenCalled();
  });
});

describe('renderFrame', () => {
  it('strokes an outer rect and a dashed inner rect inset by the default padding of 20', () => {
    renderElement(
      rec.ctx,
      clean(bareElement('a', { type: 'frame', x: 0, y: 0, width: 200, height: 100 })),
      ZOOM
    );
    expect(rec.countOf('strokeRect')).toBe(2);
    const dashOp = rec.calls('setLineDash');
    expect(dashOp[0]!.args).toEqual([[5, 5]]);
    expect(dashOp[1]!.args).toEqual([[]]);
  });

  it('honours an explicit padding', () => {
    renderElement(
      rec.ctx,
      clean(bareElement('a', { type: 'frame', x: 0, y: 0, width: 200, height: 100, padding: 10 })),
      ZOOM
    );
    expect(rec.calls('strokeRect')[1]!.args).toEqual([10, 10, 180, 80]);
  });

  it('defaults the frame stroke to black at 2px', () => {
    renderElement(
      rec.ctx,
      clean(bareElement('a', { type: 'frame', x: 0, y: 0, width: 10, height: 10 })),
      ZOOM
    );
    const stroke = rec.calls('strokeRect')[0]!;
    expect(stroke.style.strokeStyle).toBe('#000000');
    expect(stroke.style.lineWidth).toBe(2);
  });

  it('draws the title 10px in from the left and 10px above the top edge', () => {
    renderElement(
      rec.ctx,
      clean(
        bareElement('a', { type: 'frame', x: 30, y: 40, width: 100, height: 100, title: 'Frame' })
      ),
      ZOOM
    );
    expect(fillTexts(rec)).toEqual([['Frame', 40, 30]]);
    expect(rec.calls('fillText')[0]!.style.font).toBe(`14px ${getDefaultFontFamily()}, cursive`);
  });

  it('omits the title text when there is none', () => {
    renderElement(
      rec.ctx,
      clean(bareElement('a', { type: 'frame', x: 0, y: 0, width: 10, height: 10 })),
      ZOOM
    );
    expect(rec.countOf('fillText')).toBe(0);
  });
});

describe('renderEmbed', () => {
  function embed(overrides: Record<string, unknown> = {}): DriplElement {
    return bareElement('a', {
      type: 'embed',
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      url: 'https://a.dev/x',
      ...overrides,
    });
  }

  it('strokes an outer rect and paints the background', () => {
    renderElement(rec.ctx, clean(embed()), ZOOM);
    expect(rec.calls('strokeRect')[0]!.args).toEqual([0, 0, 200, 100]);
    const fill = rec.calls('fillRect')[0]!;
    expect(fill.args).toEqual([0, 0, 200, 100]);
    expect(fill.style.fillStyle).toBe('#FAFAF7');
  });

  it('uses its own stroke defaults, which differ from a frame', () => {
    renderElement(rec.ctx, clean(embed()), ZOOM);
    const stroke = rec.calls('strokeRect')[0]!;
    expect(stroke.style.strokeStyle).toBe('#6B6860');
    expect(stroke.style.lineWidth).toBe(1);
  });

  it('draws a globe glyph above centre and the label below it', () => {
    renderElement(rec.ctx, clean(embed()), ZOOM);
    expect(fillTexts(rec)).toEqual([
      ['🌐', 100, 35],
      ['https://a.dev/x', 100, 65],
    ]);
  });

  it('prefers the title over the url for the label', () => {
    renderElement(rec.ctx, clean(embed({ title: 'Docs' })), ZOOM);
    expect(fillTexts(rec).at(-1)![0]).toBe('Docs');
  });

  it('falls back to a generic label when there is neither title nor url', () => {
    renderElement(rec.ctx, clean(embed({ url: undefined })), ZOOM);
    expect(fillTexts(rec).at(-1)![0]).toBe('Web Embed');
  });

  it('truncates a label that is wider than the box', () => {
    // 60 chars at 10px each = 600px against a 100px box (maxWidth = width - 20).
    rec = createRecordingContext({ defaultCharWidth: 10 });
    renderElement(rec.ctx, clean(embed({ url: 'x'.repeat(60), width: 100 })), ZOOM);
    expect(fillTexts(rec).at(-1)![0]).toBe(`${'x'.repeat(30)}...`);
  });

  it('leaves a fitting label untruncated', () => {
    rec = createRecordingContext({ defaultCharWidth: 1 });
    renderElement(rec.ctx, clean(embed({ url: 'short', width: 200 })), ZOOM);
    expect(fillTexts(rec).at(-1)![0]).toBe('short');
  });

  it('resets the text alignment and baseline it changed, inside the render save', () => {
    rec.ctx.textAlign = 'right';
    rec.ctx.textBaseline = 'top';
    renderElement(rec.ctx, clean(embed()), ZOOM);
    expect(rec.style().textAlign).toBe('right');
    expect(rec.style().textBaseline).toBe('top');
  });
});

describe('draw-list order', () => {
  /** Every drawing op for one element, as a comparable signature. */
  function signature(ctx: RecordingContext): string[] {
    return ctx.ops.map(op => `${op.method}(${op.args.join(',')})`);
  }

  it('is stable under element reordering: same per-element lists, scene order', () => {
    const scene = [
      clean(bareElement('a', { type: 'rectangle', x: 0, y: 0, width: 10, height: 10 })),
      clean(bareElement('b', { type: 'diamond', x: 20, y: 0, width: 10, height: 10 })),
      clean(bareElement('c', { type: 'ellipse', x: 40, y: 0, width: 10, height: 10 })),
      clean(
        linear('d', 'arrow', [
          { x: 0, y: 60 },
          { x: 30, y: 60 },
        ])
      ),
      clean({
        ...bareElement('e', { type: 'text', x: 0, y: 80, width: 100, height: 20 }),
        text: 'Hello',
        fontSize: 10,
        fontFamily: 'I',
      } as DriplElement),
    ];

    const drawAll = (order: DriplElement[]) => {
      // The text metrics cache is module-global, so each scene is measured from
      // cold; otherwise the whole-scene run would omit a `measureText` that the
      // per-element runs (done later) would still perform.
      clearTextMeasurementCache();
      const local = createRecordingContext({ textWidths: { Hello: 20 } });
      for (const element of order) renderElement(local.ctx, element, ZOOM);
      return signature(local);
    };

    // Each element's own contribution, measured alone.
    const perElement = scene.map(element => drawAll([element]));
    const forward = drawAll(scene);

    // Rendering the whole scene is exactly the concatenation of the parts.
    expect(forward).toEqual(perElement.flat());

    // Reordering permutes the concatenated blocks without changing any block.
    // All 5! orderings, exhaustively.
    const orderings: number[][] = [];
    const permute = (rest: number[], prefix: number[]): void => {
      if (rest.length === 0) {
        orderings.push(prefix);
        return;
      }
      rest.forEach((value, index) =>
        permute([...rest.slice(0, index), ...rest.slice(index + 1)], [...prefix, value])
      );
    };
    permute(
      scene.map((_, i) => i),
      []
    );

    for (const order of orderings) {
      const reordered = drawAll(order.map(i => scene[i]!));
      expect(reordered).toEqual(order.flatMap(i => perElement[i]!));
    }
    expect(orderings).toHaveLength(120);
  });

  it('renders element N identically whether or not elements 0..N-1 were drawn first', () => {
    const elements = [
      clean(bareElement('a', { strokeColor: '#ff0000', opacity: 0.5, angle: 0.4 })),
      clean(bareElement('b', { type: 'diamond', x: 20, y: 0, width: 10, height: 10 })),
      clean(bareElement('c', { strokeColor: '#0000ff', lineWidth: 9 })),
    ];
    const shared = createRecordingContext();
    for (const element of elements) renderElement(shared.ctx, element, ZOOM);

    // Slice the shared log at each element's save/restore boundary and compare
    // with a private render. Any style, transform or path leaking from one
    // element into the next shows up as a mismatch here.
    let cursor = 0;
    for (const element of elements) {
      const privateRun = createRecordingContext();
      renderElement(privateRun.ctx, element, ZOOM);
      const block = shared.ops.slice(cursor, cursor + privateRun.ops.length);
      cursor += privateRun.ops.length;
      expect(block.map(op => `${op.method}(${op.args.join(',')})`)).toEqual(
        privateRun.ops.map(op => `${op.method}(${op.args.join(',')})`)
      );
    }
    expect(cursor).toBe(shared.ops.length);
  });
});

describe('numeric robustness', () => {
  it('emits only finite coordinates for arbitrary well-formed elements', () => {
    fc.assert(
      fc.property(
        fc.record({
          x: fc.double({ min: -5000, max: 5000, noNaN: true }),
          y: fc.double({ min: -5000, max: 5000, noNaN: true }),
          width: fc.double({ min: 0, max: 5000, noNaN: true }),
          height: fc.double({ min: 0, max: 5000, noNaN: true }),
        }),
        ({ x, y, width, height }) => {
          const types: DriplElement['type'][] = [
            'rectangle',
            'diamond',
            'ellipse',
            'line',
            'arrow',
            'freedraw',
            'frame',
            'embed',
            'image',
          ];
          for (const type of types) {
            const local = createRecordingContext();
            const element = bareElement('a', {
              type,
              x,
              y,
              width,
              height,
              fillColor: '#123456',
              url: 'https://a.dev',
              src: 'https://a.dev/a.png',
              points: [
                { x: 0, y: 0 },
                { x: width / 2, y: height / 2 },
              ],
              arrowStyle: 'curved',
              arrowHeads: { start: 'triangle', end: 'triangle' },
            } as never);
            renderElement(local.ctx, clean(element), ZOOM);
            for (const op of local.ops) {
              for (const arg of op.args) {
                if (typeof arg === 'number') {
                  expect(Number.isFinite(arg)).toBe(true);
                }
              }
            }
          }
        }
      ),
      { numRuns: 60 }
    );
  });
});
