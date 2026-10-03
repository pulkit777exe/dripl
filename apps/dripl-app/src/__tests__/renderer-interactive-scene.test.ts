import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { DriplElement, Point } from '@dripl/common';
import { renderInteractiveScene } from '@/renderer/interactiveScene';
import type { RenderSceneOptions, SceneViewport } from '@/renderer/sceneTypes';
import {
  createRecordingContext,
  type RecordedOp,
  type RecordingContext,
} from './helpers/canvas-recorder';
import { bareElement, linear } from './helpers/elements';

/**
 * `renderer/interactiveScene.ts` is the composer: it owns canvas clearing, the
 * world/screen transform split, viewport culling, and the draw ORDER of every
 * other renderer module. The order is the part nothing else pins, so most of
 * these tests are about sequence rather than membership.
 *
 * The recorder tags every op with the index of the last `setTransform`, which
 * is what makes "clear pass", "world pass" and "screen pass" separately
 * observable: 1 = clear, 2 = world, 3 = screen.
 */

const viewport = (overrides: Partial<SceneViewport> = {}): SceneViewport => ({
  x: 0,
  y: 0,
  width: 800,
  height: 600,
  zoom: 1,
  ...overrides,
});

function inPass(rec: RecordingContext, pass: number): RecordedOp[] {
  return rec.ops.filter(op => op.phase === pass);
}

function signature(rec: RecordingContext): string[] {
  return rec.ops.map(op => `${op.method}(${op.args.join(',')})`);
}

/**
 * A rectangle with roughness 0.
 *
 * The default roughness is 1, which makes `strokeCurrentPath` draw three offset
 * copies. Tests here care about WHICH elements were drawn, not how many passes
 * each one needed, so the extra passes are pinned away.
 */
function solid(id: string, overrides: Record<string, unknown> = {}): DriplElement {
  return bareElement(id, { roughness: 0, ...overrides });
}

let rec: RecordingContext;
beforeEach(() => {
  rec = createRecordingContext({ defaultCharWidth: 5 });
});

/** Render with the given options into the shared recorder. */
function render(options: Partial<RenderSceneOptions> = {}): RecordingContext {
  renderInteractiveScene({
    ctx: rec.ctx,
    viewport: viewport(),
    canvasWidth: 800,
    canvasHeight: 600,
    elements: [],
    ...options,
  });
  return rec;
}

/** Number of committed elements drawn, by counting `ctx.rect` bodies. */
const bodiesDrawn = (r: RecordingContext): number => r.countOf('rect');

describe('clear pass', () => {
  it('clears the whole dpr-scaled surface under an identity transform first', () => {
    render({ canvasWidth: 300, canvasHeight: 200, dpr: 2 });
    expect(rec.calls('setTransform')[0]!.args).toEqual([1, 0, 0, 1, 0, 0]);
    expect(rec.calls('clearRect')[0]!.args).toEqual([0, 0, 600, 400]);
  });

  it('leaves the canvas alone when asked not to clear, which is how export draws over its own background', () => {
    render({ clearCanvas: false });
    expect(rec.countOf('clearRect')).toBe(0);
  });

  it('restores the drawing state around the clear', () => {
    render();
    expect(signature(rec).slice(0, 4)).toEqual([
      'save()',
      'setTransform(1,0,0,1,0,0)',
      'clearRect(0,0,800,600)',
      'restore()',
    ]);
  });

  it('runs the clear in its own transform phase, before anything is drawn', () => {
    render({ elements: [solid('a')] });
    expect(rec.ops.find(op => op.method === 'clearRect')!.phase).toBe(1);
    expect(rec.ops.find(op => op.method === 'rect')!.phase).toBe(2);
  });
});

describe('transform split', () => {
  it('enters a world transform of zoom*dpr with the pan scaled by dpr', () => {
    render({ dpr: 2, viewport: viewport({ zoom: 3, x: 40, y: 60 }) });
    expect(rec.calls('setTransform')[1]!.args).toEqual([6, 0, 0, 6, 80, 120]);
  });

  it('enters a screen transform of dpr with no pan for the overlay pass', () => {
    render({ dpr: 2 });
    expect(rec.calls('setTransform')[2]!.args).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('uses exactly three transforms per frame: identity, world, screen', () => {
    render();
    expect(rec.calls('setTransform').map(op => op.args)).toEqual([
      [1, 0, 0, 1, 0, 0],
      [1, 0, 0, 1, 0, 0],
      [1, 0, 0, 1, 0, 0],
    ]);
  });

  it('leaves save/restore balanced across the whole frame', () => {
    render({
      elements: [solid('a'), solid('b', { x: 300, y: 300 })],
      selectedIds: new Set(['a', 'b']),
      gridEnabled: true,
      eraserPath: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      marqueeSelection: { start: { x: 0, y: 0 }, end: { x: 10, y: 10 }, active: true },
      lockOwners: new Map([['a', 'remote']]),
      collaborators: [
        { userId: 'u', displayName: 'n', color: '#f00', x: 1, y: 1, updatedAt: Date.now() },
      ],
      localUserId: 'me',
    });
    expect(rec.countOf('save')).toBe(rec.countOf('restore'));
  });
});

describe('draw order', () => {
  it('runs clear, then the world pass, then the screen pass, in that phase order', () => {
    render({
      gridEnabled: true,
      elements: [solid('a', { x: 0, y: 0, width: 50, height: 50 })],
      draftElement: solid('draft', { x: 100, y: 100, width: 10, height: 10 }),
      eraserPath: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
      lockOwners: new Map([['a', 'remote']]),
      localUserId: 'me',
      marqueeSelection: { start: { x: 0, y: 0 }, end: { x: 5, y: 5 }, active: true },
      selectedIds: new Set(['a', 'b', 'draft']),
      collaborators: [
        { userId: 'u', displayName: 'n', color: '#f00', x: 1, y: 1, updatedAt: Date.now() },
      ],
    });

    // Phases are assigned by setTransform, so they are monotonic in the log.
    // Phase 0 covers the save that opens the clear pass, before its transform.
    const phases = rec.ops.map(op => op.phase);
    expect(phases).toEqual([...phases].sort((a, b) => a - b));
    expect(new Set(phases)).toEqual(new Set([0, 1, 2, 3]));

    const world = inPass(rec, 2).map(op => op.method);
    const screen = inPass(rec, 3).map(op => op.method);
    const first = (ops: string[], name: string) => ops.indexOf(name);

    // World pass: grid dots before element bodies.
    expect(first(world, 'arc')).toBeLessThan(first(world, 'rect'));
    // ...and it opens with save + world transform and closes by handing off.
    // The save that opens the world pass is still in the clear pass's phase;
    // phase 2 begins at the world setTransform itself.
    expect(world.slice(0, 1)).toEqual(['setTransform']);
    expect(world.slice(-2)).toEqual(['restore', 'save']);

    // Screen pass: marquee fill, then the selection frame, then cursor chips.
    expect(screen.slice(0, 2)).toEqual(['setTransform', 'save']);
    expect(first(screen, 'fillRect')).toBeLessThan(first(screen, 'strokeRect'));
    expect(first(screen, 'strokeRect')).toBeLessThan(first(screen, 'roundRect'));
    expect(screen.at(-1)).toBe('restore');
  });

  it('puts the eraser trail after the elements and before the locks', () => {
    render({
      elements: [solid('a', { x: 0, y: 0, width: 50, height: 50 })],
      eraserPath: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
      lockOwners: new Map([['a', 'remote']]),
      localUserId: 'me',
    });
    const world = inPass(rec, 2);
    const eraserIndex = world.findIndex(op => op.style.strokeStyle === 'rgba(255, 76, 76, 0.35)');
    const lockIndex = world.findIndex(op => op.style.fillStyle === 'rgba(60, 60, 60, 0.13)');
    const elementIndex = world.findIndex(op => op.method === 'rect');
    expect(elementIndex).toBeGreaterThanOrEqual(0);
    expect(eraserIndex).toBeGreaterThan(elementIndex);
    expect(lockIndex).toBeGreaterThan(eraserIndex);
  });

  it('draws the draft element after the committed ones', () => {
    render({
      elements: [solid('committed', { x: 0, y: 0, width: 10, height: 10 })],
      draftElement: solid('draft', { x: 500, y: 500, width: 10, height: 10 }),
    });
    const bodies = inPass(rec, 2)
      .filter(op => op.method === 'rect')
      .map(op => op.args[0]);
    expect(bodies).toEqual([0, 500]);
  });

  it('never draws a deleted draft element', () => {
    render({ draftElement: solid('draft', { x: 500, y: 500, isDeleted: true }) });
    expect(bodiesDrawn(rec)).toBe(0);
  });

  it('skips a deleted committed element without disturbing the others', () => {
    render({
      elements: [solid('gone', { x: 0, y: 0, isDeleted: true }), solid('kept', { x: 300, y: 300 })],
    });
    const bodies = inPass(rec, 2)
      .filter(op => op.method === 'rect')
      .map(op => op.args[0]);
    expect(bodies).toEqual([300]);
  });
});

describe('viewport culling', () => {
  // Viewport 800x600 at zoom 1 with no pan -> world 0..800 x 0..600 visible.
  const at = (x: number, y: number) => solid(`e${x}_${y}`, { x, y, width: 10, height: 10 });

  it('draws an element inside the visible world rect', () => {
    render({ elements: [at(100, 100)] });
    expect(bodiesDrawn(rec)).toBe(1);
  });

  it('drops an element entirely outside the visible world rect', () => {
    render({ elements: [at(5000, 5000)] });
    expect(bodiesDrawn(rec)).toBe(0);
  });

  it('drops an element beyond the 20px cull margin past the right and bottom edges', () => {
    // The padded visible window is -20..820 x -20..620, so 830/630 is outside it
    // while 810/610 would still be drawn.
    render({ elements: [at(810, 610)] });
    expect(bodiesDrawn(rec)).toBe(1);
    rec.reset();
    render({ elements: [at(830, 630)] });
    expect(bodiesDrawn(rec)).toBe(0);
  });

  it('keeps an element straddling the right edge, because it is partly visible', () => {
    render({ elements: [at(795, 300)] });
    expect(bodiesDrawn(rec)).toBe(1);
  });

  it('follows the pan: a positive viewport.x reveals negative world coordinates', () => {
    // The world window is [-viewport.x / zoom, -viewport.x / zoom + w / zoom],
    // so panning right (positive x) shows the world to the LEFT of the origin.
    render({ elements: [at(-100, 100)], viewport: viewport({ x: 100, y: 0 }) });
    expect(bodiesDrawn(rec)).toBe(1);
    rec.reset();
    render({ elements: [at(-100, 100)], viewport: viewport({ x: 0, y: 0 }) });
    expect(bodiesDrawn(rec)).toBe(0);
    rec.reset();
    render({ elements: [at(-100, 100)], viewport: viewport({ x: -200, y: 0 }) });
    expect(bodiesDrawn(rec)).toBe(0);
  });

  it('follows the zoom: zooming in narrows the visible world window', () => {
    const element = at(700, 100);
    render({ elements: [element], viewport: viewport({ zoom: 1 }) });
    expect(bodiesDrawn(rec)).toBe(1);
    rec.reset();
    render({ elements: [element], viewport: viewport({ zoom: 4 }) });
    // At zoom 4 the visible world width is 800/4 = 200, so x=700 is off-screen.
    expect(bodiesDrawn(rec)).toBe(0);
  });

  it('keeps a 20px margin beyond the viewport so a shape cannot pop in at the edge', () => {
    // Element right edge at exactly worldLeft + 20 is still drawn.
    render({ elements: [at(-30, 100)] });
    expect(bodiesDrawn(rec)).toBe(1);
    rec.reset();
    render({ elements: [at(-31, 100)] });
    expect(bodiesDrawn(rec)).toBe(0);
  });

  it('never culls the draft element, which is by definition under the cursor', () => {
    render({ draftElement: at(9000, 9000), renderCommittedElements: false });
    expect(bodiesDrawn(rec)).toBe(1);
  });

  it('culls on element bounds, so a rotated element is judged by its hull', () => {
    // A 10x10 square rotated a half turn about its centre still spans -5..5,
    // well inside the viewport, so it is drawn.
    render({ elements: [solid('r', { x: 5, y: 5, width: 10, height: 10, angle: Math.PI })] });
    expect(bodiesDrawn(rec)).toBe(1);
    // Rotated a quarter turn its hull is 14.14 wide, still inside.
    rec.reset();
    render({ elements: [solid('r', { x: 5, y: 5, width: 10, height: 10, angle: Math.PI / 4 })] });
    expect(bodiesDrawn(rec)).toBe(1);
  });

  it('culls an off-screen element only when its whole hull is off-screen', () => {
    // Hull reaches x=795 after the half turn, inside the 800px viewport.
    render({
      elements: [solid('r', { x: 790, y: 300, width: 10, height: 10, angle: Math.PI / 2 })],
    });
    expect(bodiesDrawn(rec)).toBe(1);
    rec.reset();
    render({
      elements: [solid('r', { x: 850, y: 300, width: 10, height: 10, angle: Math.PI / 2 })],
    });
    expect(bodiesDrawn(rec)).toBe(0);
  });
});

describe('renderCommittedElements', () => {
  it('skips the committed pass when false, but still draws the draft', () => {
    render({
      renderCommittedElements: false,
      elements: [solid('a', { x: 0, y: 0 })],
      draftElement: solid('draft', { x: 400, y: 400 }),
    });
    const bodies = inPass(rec, 2)
      .filter(op => op.method === 'rect')
      .map(op => op.args[0]);
    expect(bodies).toEqual([400]);
  });

  it('draws the committed pass by default', () => {
    render({ elements: [solid('a', { x: 0, y: 0 })] });
    expect(bodiesDrawn(rec)).toBe(1);
  });

  it('does not look anything up for a frame with no overlays at all', () => {
    render({ elements: [solid('a')], selectedIds: new Set(), lockOwners: new Map() });
    const screenOps = inPass(rec, 3).filter(
      op => op.method !== 'setTransform' && op.method !== 'restore'
    );
    expect(screenOps).toHaveLength(0);
  });
});

describe('overlay index contract', () => {
  it('frames a selected element that was culled out of the element pass', () => {
    // The overlay index is built from the wanted ids, not from the visible
    // elements, so a selection outside the viewport still gets a frame.
    const offscreen = solid('far', { x: 5000, y: 5000, width: 100, height: 100 });
    const near = solid('near', { x: 0, y: 0, width: 10, height: 10 });
    render({
      renderCommittedElements: false,
      elements: [offscreen, near],
      selectedIds: new Set(['far', 'near']),
    });
    expect(rec.countOf('strokeRect')).toBe(1);
    expect(rec.calls('strokeRect')[0]!.args).toEqual([0, 0, 5100, 5100]);
  });

  it('resolves locked elements even when they are not in the element pass', () => {
    render({
      renderCommittedElements: false,
      elements: [solid('a', { x: 7, y: 9, width: 30, height: 40 })],
      lockOwners: new Map([['a', 'remote']]),
      localUserId: 'me',
    });
    expect(rec.calls('fillRect')[0]!.args).toEqual([7, 9, 30, 40]);
  });

  it('resolves a hovered binding target that is not in the element pass', () => {
    render({
      renderCommittedElements: false,
      elements: [solid('a', { x: 0, y: 0, width: 100, height: 100 })],
      hoveredBindingId: 'a',
    });
    expect(rec.countOf('roundRect')).toBe(1);
    expect(rec.countOf('arc')).toBe(1);
  });

  it('draws nothing for a binding hover whose id is not in the scene', () => {
    render({ elements: [solid('a')], hoveredBindingId: 'ghost' });
    expect(rec.countOf('roundRect')).toBe(0);
  });

  it('draws both binding indicators when both endpoints are hovered', () => {
    render({
      elements: [solid('a', { x: 0, y: 0, width: 100, height: 100 })],
      hoveredBindingId: 'a',
      startPointBindingId: 'a',
    });
    expect(rec.countOf('roundRect')).toBe(2);
    expect(rec.calls('roundRect').map(op => op.style.strokeStyle)).toEqual(['#E8462A', '#3B82F6']);
  });

  it('treats undefined binding ids as absent rather than looking up "undefined"', () => {
    render({
      elements: [solid('a')],
      hoveredBindingId: undefined,
      startPointBindingId: undefined,
    });
    expect(rec.countOf('roundRect')).toBe(0);
  });

  it('ignores a selected id that resolves to nothing', () => {
    render({
      elements: [solid('a', { x: 0, y: 0, width: 10, height: 10 })],
      selectedIds: new Set(['a', 'ghost']),
    });
    // One resolvable element is not enough for a multi-selection frame.
    expect(rec.countOf('strokeRect')).toBe(0);
  });

  it('treats a null binding id as absent', () => {
    render({
      elements: [solid('a')],
      hoveredBindingId: null,
      startPointBindingId: null,
    });
    expect(rec.countOf('roundRect')).toBe(0);
  });
});

describe('defaults', () => {
  it('renders a bare scene as a clear plus two empty transform passes', () => {
    render();
    expect(signature(rec)).toEqual([
      'save()',
      'setTransform(1,0,0,1,0,0)',
      'clearRect(0,0,800,600)',
      'restore()',
      'save()',
      'setTransform(1,0,0,1,0,0)',
      'restore()',
      'save()',
      'setTransform(1,0,0,1,0,0)',
      'restore()',
    ]);
  });

  it('uses a grid size of 20 when none is given', () => {
    render({ gridEnabled: true, canvasWidth: 100, canvasHeight: 100 });
    const xs = rec.calls('arc').map(op => Number(op.args[0]));
    expect(xs).toContain(0);
    expect(xs).toContain(20);
    expect(Math.max(...xs)).toBe(100);
  });

  it('uses a dark theme when none is given', () => {
    render({ gridEnabled: true, canvasWidth: 40, canvasHeight: 40 });
    expect(rec.calls('fill')[0]!.style.fillStyle).toBe('rgba(255,255,255,0.16)');
  });

  it('never draws locks when the map is empty', () => {
    render({ elements: [solid('a')], lockOwners: new Map() });
    expect(rec.ops.some(op => op.style.fillStyle === 'rgba(60, 60, 60, 0.13)')).toBe(false);
  });

  it('never draws a marquee that is not active', () => {
    render({ marqueeSelection: { start: { x: 0, y: 0 }, end: { x: 5, y: 5 }, active: false } });
    expect(inPass(rec, 3).some(op => op.method === 'fillRect')).toBe(false);
  });

  it('never draws collaborators for an empty roster', () => {
    render({ collaborators: [] });
    expect(inPass(rec, 3).some(op => op.method === 'roundRect')).toBe(false);
  });

  it('never draws a selection frame for a single selected element', () => {
    render({ elements: [solid('a')], selectedIds: new Set(['a']) });
    expect(rec.countOf('strokeRect')).toBe(0);
  });
});

describe('frame-level invariants', () => {
  it('emits only finite numbers for arbitrary scenes and viewports', () => {
    const coord = fc.double({ min: -3000, max: 3000, noNaN: true });
    fc.assert(
      fc.property(
        fc.record({ x: coord, y: coord }),
        fc.double({ min: 0.31, max: 4, noNaN: true }),
        fc.array(
          fc.record({
            x: coord,
            y: coord,
            width: fc.double({ min: 0, max: 2000, noNaN: true }),
            height: fc.double({ min: 0, max: 2000, noNaN: true }),
          }),
          { minLength: 0, maxLength: 6 }
        ),
        (pan, zoom, shapes) => {
          const local = createRecordingContext();
          const elements: DriplElement[] = shapes.map((s, i) => solid(`e${i}`, s));
          renderInteractiveScene({
            ctx: local.ctx,
            viewport: viewport({ zoom, x: pan.x, y: pan.y }),
            canvasWidth: 400,
            canvasHeight: 300,
            elements,
            selectedIds: new Set(elements.slice(0, 2).map(e => e.id)),
            // The grid is left off here because it is O((w/zoom/gridSize)^2)
            // drawing calls and has its own finiteness property in
            // renderer-overlays; a second one only buys a slower suite.
            eraserPath: [
              { x: 0, y: 0 },
              { x: 10, y: 10 },
            ],
            dpr: 2,
          });
          for (const op of local.ops) {
            for (const arg of op.args) {
              if (typeof arg === 'number') expect(Number.isFinite(arg)).toBe(true);
            }
          }
          expect(local.countOf('save')).toBe(local.countOf('restore'));
        }
      ),
      { numRuns: 80 }
    );
  });

  /**
   * The ops a single element contributes to the world pass.
   *
   * A frame's log has a fixed shape:
   *   0..3  save, identity setTransform, clearRect, restore      (clear pass)
   *   4..5  save, world setTransform                             (world pass)
   *   6..n  one save/restore block per drawn element             <- the part
   *   n..   restore, save, screen setTransform, restore          (screen pass)
   * Stripping the fixed 6 ops at the front and 4 at the back leaves exactly
   * the element's own drawing, which must be identical whether or not siblings
   * exist.
   */
  const FRAME_HEAD = 6;
  const FRAME_TAIL = 4;

  function contributionOf(element: DriplElement): string[] {
    const local = createRecordingContext();
    renderInteractiveScene({
      ctx: local.ctx,
      viewport: viewport(),
      canvasWidth: 800,
      canvasHeight: 600,
      elements: [element],
    });
    return signature(local).slice(FRAME_HEAD, -FRAME_TAIL);
  }

  it('renders element N identically whether or not earlier elements were drawn', () => {
    const elements: DriplElement[] = [
      solid('a', { x: 0, y: 0, width: 20, height: 20, angle: 0.3 }),
      linear('b', 'arrow', [
        { x: 50, y: 50 },
        { x: 90, y: 70 },
      ]),
      solid('c', { x: 100, y: 0, width: 30, height: 40, opacity: 0.3 }),
    ];
    const whole = createRecordingContext();
    renderInteractiveScene({
      ctx: whole.ctx,
      viewport: viewport(),
      canvasWidth: 800,
      canvasHeight: 600,
      elements,
    });

    const expected = elements.flatMap(contributionOf);
    expect(signature(whole).slice(FRAME_HEAD, FRAME_HEAD + expected.length)).toEqual(expected);
    // ...and nothing extra: the whole frame is exactly the three contributions
    // between the fixed prologue and epilogue.
    expect(signature(whole)).toHaveLength(FRAME_HEAD + expected.length + FRAME_TAIL);
  });

  it('never draws an element twice, whatever the selection and lock state', () => {
    const elements = [solid('a'), solid('b', { x: 100, y: 100 })];
    render({
      elements,
      selectedIds: new Set(['a', 'b']),
      lockOwners: new Map([
        ['a', 'remote'],
        ['b', 'remote-2'],
      ]),
      localUserId: 'me',
      renderCommittedElements: true,
    });
    // Two committed bodies; the lock dim uses fillRect and the selection frame
    // uses strokeRect, so neither can be mistaken for a body.
    expect(bodiesDrawn(rec)).toBe(2);
    expect(rec.countOf('strokeRect')).toBe(1);
  });

  it('keeps the eraser path out of the screen pass', () => {
    render({
      eraserPath: [
        { x: 0, y: 0 },
        { x: 9, y: 9 },
      ],
    });
    const eraserOp = rec.ops.find(op => op.style.strokeStyle === 'rgba(255, 76, 76, 0.35)')!;
    expect(eraserOp.phase).toBe(2);
  });

  it('keeps grid dots in the world pass', () => {
    render({ gridEnabled: true });
    expect(rec.calls('arc').every(op => op.phase === 2)).toBe(true);
  });

  it('keeps the selection frame and marquee in the screen pass', () => {
    render({
      elements: [solid('a', { x: 0, y: 0 }), solid('b', { x: 50, y: 50 })],
      selectedIds: new Set(['a', 'b']),
      marqueeSelection: { start: { x: 0, y: 0 }, end: { x: 5, y: 5 }, active: true },
    });
    expect(rec.calls('strokeRect')[0]!.phase).toBe(3);
    expect(rec.calls('fillRect')[0]!.phase).toBe(3);
  });

  it('never culls or skips a draft element that has neither isDeleted nor is off-screen', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 800, noNaN: true }),
        fc.double({ min: 0, max: 600, noNaN: true }),
        (x, y) => {
          const local = createRecordingContext();
          renderInteractiveScene({
            ctx: local.ctx,
            viewport: viewport(),
            canvasWidth: 800,
            canvasHeight: 600,
            elements: [],
            draftElement: solid('draft', { x, y }),
          });
          expect(local.countOf('rect')).toBe(1);
        }
      )
    );
  });
});

describe('sceneTypes', () => {
  it('accepts a fully-specified viewport, which is what callers construct', () => {
    const v: SceneViewport = { x: 1, y: 2, width: 3, height: 4, zoom: 5 };
    expect(v.zoom).toBe(5);
  });

  it('accepts the eraser path as readonly points, matching a frozen state array', () => {
    const path: readonly Point[] = Object.freeze([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
    render({ eraserPath: path });
    expect(rec.countOf('stroke')).toBe(1);
  });
});
