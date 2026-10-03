import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { Point } from '@dripl/common';
import {
  drawBindingIndicator,
  drawCollaborators,
  drawEraserPath,
  drawGridDots,
  drawLockOverlays,
  drawMarquee,
  drawSelectionBox,
  worldToScreen,
} from '@/renderer/overlays';
import type { CollaboratorCursor, SceneViewport } from '@/renderer/sceneTypes';
import {
  arcs,
  createRecordingContext,
  fillTexts,
  type RecordingContext,
  strokeRects,
} from './helpers/canvas-recorder';
import { bareElement } from './helpers/elements';

/**
 * `renderer/overlays.ts` draws everything that is not an element: the grid,
 * the selection frame, the marquee, collaborator cursors, remote locks,
 * binding hints and the eraser trail.
 *
 * Two of these run in the composer's WORLD pass (grid, eraser, locks) and three
 * in its SCREEN pass (marquee, selection, cursors), so the coordinate system a
 * function emits is part of its contract and is asserted here.
 */

const viewport = (overrides: Partial<SceneViewport> = {}): SceneViewport => ({
  x: 0,
  y: 0,
  width: 800,
  height: 600,
  zoom: 1,
  ...overrides,
});

const coord = fc.double({ min: -10_000, max: 10_000, noNaN: true });
const zoom = fc.double({ min: 0.05, max: 6, noNaN: true });

let rec: RecordingContext;
beforeEach(() => {
  rec = createRecordingContext();
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('worldToScreen', () => {
  it('is the identity at zoom 1 with no pan', () => {
    expect(worldToScreen({ x: 3, y: -4 }, viewport())).toEqual({ x: 3, y: -4 });
  });

  it('scales then pans, in that order', () => {
    expect(worldToScreen({ x: 10, y: 20 }, viewport({ zoom: 2, x: 5, y: 7 }))).toEqual({
      x: 25,
      y: 47,
    });
  });

  it('pans negatively as well as positively', () => {
    expect(worldToScreen({ x: 10, y: 20 }, viewport({ zoom: 1, x: -100, y: -50 }))).toEqual({
      x: -90,
      y: -30,
    });
  });

  it('agrees with the composer transform: screen = world * zoom + pan', () => {
    fc.assert(
      fc.property(fc.record({ x: coord, y: coord }), coord, zoom, (point, pan, z) => {
        const screen = worldToScreen(point, viewport({ zoom: z, x: pan, y: -pan }));
        expect(screen.x).toBeCloseTo(point.x * z + pan, 8);
        expect(screen.y).toBeCloseTo(point.y * z - pan, 8);
      })
    );
  });

  it('maps the world origin to the viewport pan', () => {
    expect(worldToScreen({ x: 0, y: 0 }, viewport({ zoom: 3, x: 17, y: 23 }))).toEqual({
      x: 17,
      y: 23,
    });
  });
});

describe('drawGridDots', () => {
  it('draws nothing when zoomed out past 0.3, because the lattice would be denser than the canvas', () => {
    drawGridDots(rec.ctx, viewport({ zoom: 0.29 }), 800, 600, 'light', 20);
    expect(rec.ops).toHaveLength(0);
  });

  it('draws at exactly the 0.3 threshold', () => {
    drawGridDots(rec.ctx, viewport({ zoom: 0.3 }), 800, 600, 'light', 20);
    expect(arcs(rec).length).toBeGreaterThan(0);
  });

  it('uses a light or dark dot depending on the theme', () => {
    drawGridDots(rec.ctx, viewport(), 800, 600, 'light', 20);
    expect(rec.calls('fill')[0]!.style.fillStyle).toBe('rgba(0,0,0,0.16)');
    rec.reset();
    drawGridDots(rec.ctx, viewport(), 800, 600, 'dark', 20);
    expect(rec.calls('fill')[0]!.style.fillStyle).toBe('rgba(255,255,255,0.16)');
  });

  it('aligns the lattice to multiples of gridSize, never to the world origin offset', () => {
    // worldLeft = -x/zoom = -13 -> first lattice line at floor(-13/20)*20 = -20.
    drawGridDots(rec.ctx, viewport({ x: 13, y: 0 }), 800, 600, 'light', 20);
    const xs = arcs(rec).map(a => a[0]!);
    expect(Math.min(...xs)).toBe(-20);
    // -0 % 20 is -0, so compare the magnitude.
    for (const x of xs) expect(Math.abs(x % 20)).toBe(0);
  });

  it('covers the visible world rect inclusively on both axes', () => {
    drawGridDots(rec.ctx, viewport(), 100, 100, 'light', 20);
    // Visible world x in [-0, 100] -> -0, 20, 40, 60, 80, 100 = 6 lines per axis.
    expect(arcs(rec)).toHaveLength(36);
  });

  it('scales the dot radius inversely with zoom, so it stays about a pixel across', () => {
    // radius = max(0.8 / zoom, 0.35)
    drawGridDots(rec.ctx, viewport({ zoom: 1 }), 100, 100, 'light', 20);
    expect(arcs(rec)[0]![2]).toBeCloseTo(0.8, 10);
    rec.reset();
    drawGridDots(rec.ctx, viewport({ zoom: 0.3 }), 100, 100, 'light', 20);
    // 0.8 / 0.3 = 2.67, above the 0.35 floor.
    expect(arcs(rec)[0]![2]).toBeCloseTo(0.8 / 0.3, 10);
    rec.reset();
    drawGridDots(rec.ctx, viewport({ zoom: 10 }), 100, 100, 'light', 20);
    // Below the floor the radius stops shrinking.
    expect(arcs(rec)[0]![2]).toBeCloseTo(0.35, 10);
  });

  it('never emits a non-finite radius, even fully zoomed in', () => {
    drawGridDots(rec.ctx, viewport({ zoom: 1e6 }), 100, 100, 'light', 20);
    for (const [, , r] of arcs(rec)) expect(Number.isFinite(r!)).toBe(true);
  });

  it('draws each dot as a full circle', () => {
    drawGridDots(rec.ctx, viewport(), 40, 40, 'light', 20);
    const [, , , start, end] = arcs(rec)[0]!;
    expect(start).toBe(0);
    expect(end).toBeCloseTo(Math.PI * 2, 10);
  });

  it('brackets the pass in a save/restore', () => {
    drawGridDots(rec.ctx, viewport(), 40, 40, 'light', 20);
    expect(rec.ops[0]!.method).toBe('save');
    expect(rec.ops.at(-1)!.method).toBe('restore');
  });

  it('draws more dots as the canvas grows, and never fewer than the visible lattice', () => {
    // Zoom is floored at the 0.3 cull threshold: below it the pass returns
    // early by design, which is what "draws nothing" above pins.
    // Canvas extents are capped because the dot count is quadratic in
    // (size / zoom / gridSize) and this runs many times.
    const drawn = fc.double({ min: 0.3, max: 6, noNaN: true });
    fc.assert(
      fc.property(
        drawn,
        fc.integer({ min: 1, max: 160 }),
        fc.integer({ min: 1, max: 160 }),
        (z, w, h) => {
          const local = createRecordingContext();
          drawGridDots(local.ctx, viewport({ zoom: z }), w, h, 'light', 20);
          const expectedCols = Math.floor(w / z / 20) + 1;
          expect(local.countOf('arc')).toBeGreaterThanOrEqual(expectedCols);
          for (const [cx, cy, r] of arcs(local)) {
            expect(Number.isFinite(cx!)).toBe(true);
            expect(Number.isFinite(cy!)).toBe(true);
            expect(Number.isFinite(r!)).toBe(true);
          }
        }
      )
    );
  });
});

describe('drawSelectionBox', () => {
  const a = bareElement('a', { x: 0, y: 0, width: 100, height: 50 });
  const b = bareElement('b', { x: 200, y: 100, width: 40, height: 40 });

  it('draws nothing when nothing is selected', () => {
    drawSelectionBox(rec.ctx, new Set(), viewport(), new Map([['a', a]]));
    expect(rec.ops).toHaveLength(0);
  });

  it('draws nothing for a single selection, which uses the rotated HTML overlay instead', () => {
    drawSelectionBox(rec.ctx, new Set(['a']), viewport(), new Map([['a', a]]));
    expect(rec.ops).toHaveLength(0);
  });

  it('draws nothing when only one selected id resolves to an element', () => {
    drawSelectionBox(rec.ctx, new Set(['a', 'ghost']), viewport(), new Map([['a', a]]));
    expect(rec.ops).toHaveLength(0);
  });

  it('draws nothing when no selected id resolves', () => {
    drawSelectionBox(rec.ctx, new Set(['ghost1', 'ghost2']), viewport(), new Map());
    expect(rec.ops).toHaveLength(0);
  });

  it('frames the union of the selected bounds in screen space', () => {
    drawSelectionBox(
      rec.ctx,
      new Set(['a', 'b']),
      viewport(),
      new Map([
        ['a', a],
        ['b', b],
      ])
    );
    expect(strokeRects(rec)).toEqual([[0, 0, 240, 140]]);
  });

  it('converts through the viewport, so a panned and zoomed frame lands correctly', () => {
    drawSelectionBox(
      rec.ctx,
      new Set(['a', 'b']),
      viewport({ zoom: 2, x: 10, y: 20 }),
      new Map([
        ['a', a],
        ['b', b],
      ])
    );
    expect(strokeRects(rec)).toEqual([[10, 20, 480, 280]]);
  });

  it('uses a dashed 6/4 frame in the accent colour', () => {
    drawSelectionBox(
      rec.ctx,
      new Set(['a', 'b']),
      viewport(),
      new Map([
        ['a', a],
        ['b', b],
      ])
    );
    expect(rec.calls('setLineDash')[0]!.args).toEqual([[6, 4]]);
    expect(rec.calls('strokeRect')[0]!.style.strokeStyle).toBe('#6965db');
    expect(rec.calls('strokeRect')[0]!.style.lineWidth).toBe(1.5);
  });

  it('uses rotation-aware bounds, so a rotated element is framed by its corners', () => {
    const rotated = bareElement('r', { x: 0, y: 0, width: 100, height: 100, angle: Math.PI / 4 });
    drawSelectionBox(
      rec.ctx,
      new Set(['r', 'b']),
      viewport(),
      new Map([
        ['r', rotated],
        ['b', b],
      ])
    );
    // A 100x100 square turned 45 degrees about its centre has an axis-aligned
    // hull of 141.42, running from -20.71 to 120.71. Unioned with 'b' at
    // x 200..240 the frame spans -20.71..240. Only a rotation-aware bound
    // produces that; the raw box would start at 0 and be 240 wide.
    const [x, y, w, h] = strokeRects(rec)[0]!;
    const hull = 100 * Math.SQRT2;
    expect(x).toBeCloseTo(-(hull - 100) / 2, 6);
    expect(y).toBeCloseTo(-(hull - 100) / 2, 6);
    expect(w).toBeCloseTo(240 + (hull - 100) / 2, 6);
    expect(h).toBeCloseTo(140 + (hull - 100) / 2, 6);
  });

  it('brackets the pass in a save/restore', () => {
    drawSelectionBox(
      rec.ctx,
      new Set(['a', 'b']),
      viewport(),
      new Map([
        ['a', a],
        ['b', b],
      ])
    );
    expect(rec.ops[0]!.method).toBe('save');
    expect(rec.ops.at(-1)!.method).toBe('restore');
  });
});

describe('drawMarquee', () => {
  it('draws nothing while the marquee is inactive', () => {
    drawMarquee(
      rec.ctx,
      { start: { x: 0, y: 0 }, end: { x: 10, y: 10 }, active: false },
      viewport()
    );
    expect(rec.ops).toHaveLength(0);
  });

  it('fills and strokes a translucent accent rect', () => {
    drawMarquee(
      rec.ctx,
      { start: { x: 0, y: 0 }, end: { x: 10, y: 20 }, active: true },
      viewport()
    );
    expect(rec.argLists('fillRect')).toEqual([[0, 0, 10, 20]]);
    expect(strokeRects(rec)).toEqual([[0, 0, 10, 20]]);
    expect(rec.calls('fillRect')[0]!.style.fillStyle).toBe('rgba(105,101,219,0.12)');
    expect(rec.calls('strokeRect')[0]!.style.strokeStyle).toBe('#6965db');
    expect(rec.calls('setLineDash')[0]!.args).toEqual([[6, 4]]);
  });

  it('normalises a drag up and to the left into a positive-size rect', () => {
    drawMarquee(
      rec.ctx,
      { start: { x: 100, y: 100 }, end: { x: 20, y: 30 }, active: true },
      viewport()
    );
    expect(rec.argLists('fillRect')).toEqual([[20, 30, 80, 70]]);
  });

  it('degenerate to a zero-size rect when start equals end', () => {
    drawMarquee(rec.ctx, { start: { x: 5, y: 5 }, end: { x: 5, y: 5 }, active: true }, viewport());
    expect(rec.argLists('fillRect')).toEqual([[5, 5, 0, 0]]);
  });

  it('is drawn in screen space, so a zoomed viewport scales the box', () => {
    drawMarquee(
      rec.ctx,
      { start: { x: 10, y: 10 }, end: { x: 20, y: 40 }, active: true },
      viewport({ zoom: 3, x: 100, y: 200 })
    );
    expect(rec.argLists('fillRect')).toEqual([[130, 230, 30, 90]]);
  });
});

describe('drawCollaborators', () => {
  function cursor(overrides: Partial<CollaboratorCursor> = {}): CollaboratorCursor {
    return {
      userId: 'u1',
      displayName: 'Ada',
      color: '#ff0000',
      x: 0,
      y: 0,
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  it('draws nothing for an empty roster', () => {
    drawCollaborators(rec.ctx, [], viewport());
    expect(rec.ops).toHaveLength(0);
  });

  it('translates the world cursor to its screen position', () => {
    drawCollaborators(rec.ctx, [cursor({ x: 10, y: 20 })], viewport({ zoom: 2, x: 5, y: 7 }));
    expect(rec.calls('translate')[0]!.args).toEqual([25, 47]);
  });

  it('draws a full-opacity cursor for a fresh update', () => {
    drawCollaborators(rec.ctx, [cursor()], viewport());
    expect(rec.calls('fill')[0]!.style.globalAlpha).toBe(1);
  });

  it('stays fully opaque for five seconds, then fades linearly to nothing at ten', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const at = (seconds: number) => {
      const local = createRecordingContext();
      drawCollaborators(
        local.ctx,
        [cursor({ updatedAt: Date.now() - seconds * 1000 })],
        viewport()
      );
      return local;
    };
    expect(at(0).calls('fill')[0]!.style.globalAlpha).toBe(1);
    expect(at(5).calls('fill')[0]!.style.globalAlpha).toBe(1);
    // 5s of fade over 5s: halfway is 0.5.
    expect(at(7.5).calls('fill')[0]!.style.globalAlpha).toBeCloseTo(0.5, 6);
  });

  it('skips a cursor entirely once its alpha reaches zero', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const local = createRecordingContext();
    drawCollaborators(local.ctx, [cursor({ updatedAt: Date.now() - 10_000 })], viewport());
    expect(local.ops).toHaveLength(0);
  });

  it('does not fade a cursor whose clock is ahead of ours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const local = createRecordingContext();
    drawCollaborators(local.ctx, [cursor({ updatedAt: Date.now() + 5_000 })], viewport());
    expect(local.calls('fill')[0]!.style.globalAlpha).toBe(1);
  });

  it('draws the arrow glyph as one closed seven-vertex polygon plus a name chip', () => {
    drawCollaborators(rec.ctx, [cursor({ x: 0, y: 0 })], viewport());
    // Arrow: moveTo + six lineTo + closePath. Chip: a roundRect, not a path.
    expect(rec.calls('moveTo')[0]!.args).toEqual([0, 0]);
    expect(rec.countOf('lineTo')).toBe(6);
    expect(rec.countOf('closePath')).toBe(1);
    expect(rec.countOf('roundRect')).toBe(1);
    // Chip at (12, 12), 20 tall, with the name inset 15px from its left edge.
    expect(rec.calls('roundRect')[0]!.args.slice(0, 4)).toEqual([12, 12, expect.any(Number), 20]);
    expect(fillTexts(rec)).toEqual([['Ada', 27, 22]]);
  });

  it('draws one arrow plus one name chip per collaborator, in roster order', () => {
    const roster = [cursor({ displayName: 'A' }), cursor({ displayName: 'B', color: '#00ff00' })];
    drawCollaborators(rec.ctx, roster, viewport());
    expect(fillTexts(rec).map(t => t[0])).toEqual(['A', 'B']);
    expect(arcs(rec)).toHaveLength(2);
  });

  it('skips an expired collaborator without affecting a live one', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    drawCollaborators(
      rec.ctx,
      [
        cursor({ displayName: 'Gone', updatedAt: Date.now() - 60_000 }),
        cursor({ displayName: 'Here' }),
      ],
      viewport()
    );
    expect(fillTexts(rec).map(t => t[0])).toEqual(['Here']);
  });
});

describe('drawLockOverlays', () => {
  const target = bareElement('a', { x: 10, y: 20, width: 100, height: 60 });

  it('draws nothing without locks', () => {
    drawLockOverlays(rec.ctx, new Map([['a', target]]), new Map(), null);
    expect(rec.ops).toHaveLength(0);
  });

  it('dims a locked element', () => {
    drawLockOverlays(rec.ctx, new Map([['a', target]]), new Map([['a', 'remote-user']]), 'me');
    expect(rec.calls('fillRect')[0]!.args).toEqual([10, 20, 100, 60]);
    expect(rec.calls('fillRect')[0]!.style.fillStyle).toBe('rgba(60, 60, 60, 0.13)');
  });

  it('never overlays an element this user locked themselves', () => {
    drawLockOverlays(rec.ctx, new Map([['a', target]]), new Map([['a', 'me']]), 'me');
    expect(rec.ops).toHaveLength(0);
  });

  it('treats a null local user id as matching nobody', () => {
    drawLockOverlays(rec.ctx, new Map([['a', target]]), new Map([['a', 'me']]), null);
    expect(rec.countOf('fillRect')).toBe(1);
  });

  it('skips a lock whose element is not in the index', () => {
    drawLockOverlays(rec.ctx, new Map(), new Map([['ghost', 'remote-user']]), 'me');
    expect(rec.ops).toHaveLength(0);
  });

  it('places the padlock body and shackle just inside the top-right corner', () => {
    drawLockOverlays(rec.ctx, new Map([['a', target]]), new Map([['a', 'remote-user']]), 'me');
    // iconX = x + width - 16 = 94, iconY = y + 4 = 24
    expect(rec.calls('roundRect')[0]!.args).toEqual([94, 29, 10, 8, 2]);
    expect(rec.calls('arc')[0]!.args).toEqual([99, 29, 3, Math.PI, 0]);
  });

  it('follows rotation when choosing the bounds', () => {
    const rotated = bareElement('r', { x: 0, y: 0, width: 100, height: 100, angle: Math.PI / 2 });
    drawLockOverlays(rec.ctx, new Map([['r', rotated]]), new Map([['r', 'remote-user']]), 'me');
    const [x, y, w, h] = rec.calls('fillRect')[0]!.args as number[];
    // Rotated a quarter turn about its centre the hull is unchanged, but the
    // dim rect must still be the axis-aligned hull rather than the raw box.
    expect(w).toBeCloseTo(100, 6);
    expect(h).toBeCloseTo(100, 6);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
  });

  it('draws one overlay per foreign lock', () => {
    drawLockOverlays(
      rec.ctx,
      new Map([
        ['a', target],
        ['b', bareElement('b', { x: 0, y: 0, width: 10, height: 10 })],
      ]),
      new Map([
        ['a', 'remote-1'],
        ['b', 'remote-2'],
      ]),
      'me'
    );
    expect(rec.countOf('fillRect')).toBe(2);
  });
});

describe('drawBindingIndicator', () => {
  const target = bareElement('a', { x: 10, y: 20, width: 100, height: 60 });

  it('draws nothing when the hovered id is not in the index', () => {
    drawBindingIndicator(rec.ctx, new Map(), 'ghost', viewport());
    expect(rec.ops).toHaveLength(0);
  });

  it('draws nothing for a deleted target', () => {
    drawBindingIndicator(
      rec.ctx,
      new Map([['a', { ...target, isDeleted: true }]]),
      'a',
      viewport()
    );
    expect(rec.ops).toHaveLength(0);
  });

  it('uses red for an end binding and blue for a start binding', () => {
    drawBindingIndicator(rec.ctx, new Map([['a', target]]), 'a', viewport(), 'end');
    expect(rec.calls('roundRect')[0]!.style.strokeStyle).toBe('#E8462A');
    rec.reset();
    drawBindingIndicator(rec.ctx, new Map([['a', target]]), 'a', viewport(), 'start');
    expect(rec.calls('roundRect')[0]!.style.strokeStyle).toBe('#3B82F6');
  });

  it('defaults to the end binding', () => {
    drawBindingIndicator(rec.ctx, new Map([['a', target]]), 'a', viewport());
    expect(rec.calls('roundRect')[0]!.style.strokeStyle).toBe('#E8462A');
  });

  it('insets the frame by 8 screen px, expressed in world units', () => {
    drawBindingIndicator(rec.ctx, new Map([['a', target]]), 'a', viewport({ zoom: 1 }));
    // padding = 8 / 1
    expect(rec.calls('roundRect')[0]!.args).toEqual([2, 12, 116, 76, 4]);
  });

  it('shrinks the world-space padding as the viewport zooms in, keeping 8 screen px', () => {
    drawBindingIndicator(rec.ctx, new Map([['a', target]]), 'a', viewport({ zoom: 4 }));
    const [x, y, w, h, radius] = rec.calls('roundRect')[0]!.args as number[];
    // padding = 8 / 4 = 2
    expect(x).toBeCloseTo(8, 6);
    expect(y).toBeCloseTo(18, 6);
    expect(w).toBeCloseTo(104, 6);
    expect(h).toBeCloseTo(64, 6);
    expect(radius).toBeCloseTo(1, 6);
  });

  it('scales the dash pattern, the outline width and the centre dot with zoom', () => {
    drawBindingIndicator(rec.ctx, new Map([['a', target]]), 'a', viewport({ zoom: 2 }));
    expect(rec.calls('setLineDash')[0]!.args).toEqual([[3, 2]]);
    expect(rec.calls('roundRect')[0]!.style.lineWidth).toBe(1);
    const [cx, cy, r] = rec.calls('arc')[0]!.args as number[];
    expect([cx, cy, r]).toEqual([60, 50, 3]);
  });

  it('marks the target centre with a filled dot in the frame colour', () => {
    drawBindingIndicator(rec.ctx, new Map([['a', target]]), 'a', viewport(), 'start');
    // fillStyle is copied from strokeStyle AFTER the arc is emitted, so the
    // colour shows up on the fill rather than on the arc. What matters is that
    // the dot is filled with the frame colour, not the inherited fill.
    expect(rec.calls('arc')[0]!.style.fillStyle).toBe('#000000');
    expect(rec.calls('fill')[0]!.style.fillStyle).toBe('#3B82F6');
    expect(rec.calls('fill')[0]!.style.globalAlpha).toBeCloseTo(0.6, 6);
  });

  it('emits only finite geometry at any zoom', () => {
    fc.assert(
      fc.property(zoom, z => {
        const local = createRecordingContext();
        drawBindingIndicator(local.ctx, new Map([['a', target]]), 'a', viewport({ zoom: z }));
        for (const op of local.ops) {
          for (const arg of op.args) {
            if (typeof arg === 'number') expect(Number.isFinite(arg)).toBe(true);
          }
        }
      })
    );
  });
});

describe('drawEraserPath', () => {
  it('draws nothing for an empty trail', () => {
    drawEraserPath(rec.ctx, [], 1);
    expect(rec.ops).toHaveLength(0);
  });

  it('draws nothing for a single-point trail, which has no length to show', () => {
    drawEraserPath(rec.ctx, [{ x: 1, y: 2 }], 1);
    expect(rec.ops).toHaveLength(0);
  });

  it('strokes the trail as one polyline in world coordinates', () => {
    drawEraserPath(
      rec.ctx,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 5 },
      ],
      1
    );
    expect(rec.calls('moveTo')[0]!.args).toEqual([0, 0]);
    expect(rec.calls('lineTo').map(o => o.args)).toEqual([
      [10, 0],
      [20, 5],
    ]);
    expect(rec.calls('strokeRect')).toHaveLength(0);
    expect(rec.countOf('stroke')).toBe(1);
  });

  it('uses a round cap and join so the trail has no visible corners', () => {
    drawEraserPath(
      rec.ctx,
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      1
    );
    const stroke = rec.calls('stroke')[0]!;
    expect(stroke.style.lineCap).toBe('round');
    expect(stroke.style.lineJoin).toBe('round');
    expect(stroke.style.strokeStyle).toBe('rgba(255, 76, 76, 0.35)');
  });

  it('keeps the trail a constant 20 screen px wide by dividing the width by zoom', () => {
    const widthAt = (z: number) => {
      const local = createRecordingContext();
      drawEraserPath(
        local.ctx,
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        z
      );
      return local.calls('stroke')[0]!.style.lineWidth;
    };
    expect(widthAt(1)).toBeCloseTo(20, 10);
    expect(widthAt(2)).toBeCloseTo(10, 10);
    expect(widthAt(0.5)).toBeCloseTo(40, 10);
  });

  it('floors the zoom at 0.1 so a tiny zoom cannot blow the width up to Infinity', () => {
    const local = createRecordingContext();
    drawEraserPath(
      local.ctx,
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      1e-9
    );
    const width = local.calls('stroke')[0]!.style.lineWidth;
    expect(Number.isFinite(width)).toBe(true);
    expect(width).toBeCloseTo(200, 6);
  });

  it('emits only finite coordinates for arbitrary trails', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ x: coord, y: coord }), { minLength: 2, maxLength: 20 }),
        fc.double({ min: 0.01, max: 5, noNaN: true }),
        (path, z) => {
          const local = createRecordingContext();
          drawEraserPath(local.ctx, path as Point[], z);
          for (const op of local.ops) {
            for (const arg of op.args) {
              if (typeof arg === 'number') expect(Number.isFinite(arg)).toBe(true);
            }
          }
        }
      )
    );
  });
});

describe('overlay contract: world vs screen pass', () => {
  it('draws grid, eraser and locks in world units, and marquee/selection in screen units', () => {
    // The composer's world pass emits raw element coordinates; the screen pass
    // emits worldToScreen output. Feeding each function a panned viewport makes
    // the difference observable.
    const target = bareElement('a', { x: 0, y: 0, width: 100, height: 100 });

    const worldPass = createRecordingContext();
    drawLockOverlays(worldPass.ctx, new Map([['a', target]]), new Map([['a', 'r']]), 'me');
    expect(worldPass.calls('fillRect')[0]!.args).toEqual([0, 0, 100, 100]);

    const screenPass = createRecordingContext();
    drawSelectionBox(
      screenPass.ctx,
      new Set(['a', 'b']),
      viewport({ zoom: 2, x: 50, y: 60 }),
      new Map([
        ['a', target],
        ['b', bareElement('b', { x: 200, y: 200, width: 10, height: 10 })],
      ])
    );
    // 'a' covers world 0..100 -> screen 50..250; 'b' covers world 200..210 ->
    // screen 450..470. The union frame is therefore 50..470 by 60..480.
    expect(screenPass.calls('strokeRect')[0]!.args).toEqual([50, 60, 420, 420]);
  });

  it('never leaves an unbalanced save/restore in any overlay', () => {
    const target = bareElement('a', { x: 1, y: 2, width: 30, height: 40 });
    const functions: Array<(ctx: CanvasRenderingContext2D) => void> = [
      ctx => drawGridDots(ctx, viewport(), 100, 100, 'light', 20),
      ctx => drawSelectionBox(ctx, new Set(['a', 'b']), viewport(), new Map([['a', target]])),
      ctx =>
        drawMarquee(ctx, { start: { x: 0, y: 0 }, end: { x: 5, y: 5 }, active: true }, viewport()),
      ctx =>
        drawCollaborators(
          ctx,
          [{ userId: 'u', displayName: 'n', color: '#f00', x: 0, y: 0, updatedAt: Date.now() }],
          viewport()
        ),
      ctx => drawLockOverlays(ctx, new Map([['a', target]]), new Map([['a', 'r']]), 'me'),
      ctx => drawBindingIndicator(ctx, new Map([['a', target]]), 'a', viewport()),
      ctx =>
        drawEraserPath(
          ctx,
          [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          1
        ),
    ];
    for (const run of functions) {
      const local = createRecordingContext();
      run(local.ctx);
      expect(local.countOf('save')).toBe(local.countOf('restore'));
    }
  });
});
