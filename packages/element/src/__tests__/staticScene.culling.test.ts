import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { DriplElement } from '@dripl/common';
import { createMockCanvasContext } from '@dripl/test-utils';

import {
  collectDependencyIdsForTest,
  dependenciesUnchangedForTest,
  renderStaticScene,
  resetElementBitmapCacheForTest,
  type StaticSceneFrameStats,
  type StaticSceneViewport,
} from '../staticScene';

const coord = (min: number, max: number) => fc.double({ min, max, noNaN: true });

/**
 * World coordinates, bounded away from the denormal range: a coordinate of
 * 5e-324 is annihilated by adding a size delta, so the origin maths would
 * report an IEEE-754 artefact rather than a defect.
 */
const position = (min: number, max: number) => fc.double({ min, max, noNaN: true });

/**
 * jsdom has no canvas backend, so the offscreen element canvas cannot be
 * allocated and every candidate reports `failed`. That is convenient here: the
 * culling decision is made before any of it, and `stats.candidates` is the
 * exact count of elements that survived.
 */
function tolerantContext(): CanvasRenderingContext2D {
  const base = createMockCanvasContext() as unknown as Record<string, unknown>;
  return new Proxy(base, {
    get(target, property) {
      if (property in target) return target[property as string];
      if (typeof property === 'string' && property.startsWith('measure')) {
        return () => ({ width: 0 });
      }
      return () => undefined;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function hostCanvas(): HTMLCanvasElement {
  return {
    getContext: () => tolerantContext(),
    width: 800,
    height: 600,
    style: {},
  } as unknown as HTMLCanvasElement;
}

const VIEWPORT: StaticSceneViewport = { x: 0, y: 0, width: 800, height: 600, zoom: 1 };

function renderFrame(
  elements: DriplElement[],
  viewport: StaticSceneViewport = VIEWPORT,
  overrides: Partial<Parameters<typeof renderStaticScene>[3]> = {}
): StaticSceneFrameStats {
  let captured: StaticSceneFrameStats | null = null;
  renderStaticScene(hostCanvas(), elements, viewport, {
    gridEnabled: false,
    gridSize: 20,
    zoom: viewport.zoom,
    theme: 'light',
    dpr: 1,
    ...overrides,
    onFrameStats: stats => {
      captured = stats;
    },
  });
  expect(captured).not.toBeNull();
  return captured as unknown as StaticSceneFrameStats;
}

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

beforeEach(() => {
  resetElementBitmapCacheForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('viewport culling', () => {
  it('always draws an element that is comfortably inside the viewport', () => {
    fc.assert(
      fc.property(
        position(-10_000, 10_000),
        position(-10_000, 10_000),
        coord(10, 300),
        coord(10, 300),
        coord(-Math.PI, Math.PI),
        fc.constantFrom(0.25, 0.5, 1, 2, 4),
        (_x, _y, width, height, angle, zoom) => {
          const viewport: StaticSceneViewport = { x: 0, y: 0, width: 800, height: 600, zoom };
          // The element's top-left corner sits inside the viewport in world
          // units, with room for the 20px culling pad and its own rotation
          // growth on the order of (w+h)/2.
          const worldLeft = -viewport.x / zoom;
          const worldTop = -viewport.y / zoom;
          const element = rect({ x: worldLeft + 60, y: worldTop + 60, width, height, angle });

          const stats = renderFrame([element], viewport);
          expect(stats.candidates).toBe(1);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('always culls an element that is far outside the viewport', () => {
    fc.assert(
      fc.property(
        coord(10, 300),
        coord(10, 300),
        coord(-Math.PI, Math.PI),
        fc.constantFrom(0.25, 1, 4),
        fc.constantFrom(0, 1, 2, 3),
        (width, height, angle, zoom, corner) => {
          const viewport: StaticSceneViewport = { x: 0, y: 0, width: 800, height: 600, zoom };
          const worldWidth = viewport.width / zoom;
          const worldHeight = viewport.height / zoom;
          // Park the element's *nearest* corner well beyond the padded viewport
          // on both axes, in one of the four diagonal directions.
          const margin = 5_000;
          const nearLeft = corner === 0 || corner === 2;
          const nearTop = corner === 0 || corner === 1;
          const placed = rect({
            x: nearLeft ? -margin - width : worldWidth + margin,
            y: nearTop ? -margin - height : worldHeight + margin,
            width,
            height,
            angle,
          });

          const stats = renderFrame([placed], viewport);
          expect(stats.candidates).toBe(0);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('keeps an element that straddles a viewport edge', () => {
    fc.assert(
      fc.property(coord(0, 560), coord(1, 400), coord(1, 400), (y, width, height) => {
        // Half of the box hangs past the right edge, and the rest of it sits
        // inside the padded viewport rather than beyond the 20px pad.
        const element = rect({ x: 780, y, width, height });
        const stats = renderFrame([element], { x: 0, y: 0, width: 800, height: 600, zoom: 1 });
        expect(stats.candidates).toBe(1);
      }),
      { numRuns: 200 }
    );
  });

  it('gives the culler 20 world pixels of slack on every side', () => {
    // The pad exists so a stroke or a rotated overhang is not clipped at the
    // very edge of the frame. An element whose right edge is 19px past the
    // viewport's right must still be drawn.
    const viewport: StaticSceneViewport = { x: 0, y: 0, width: 800, height: 600, zoom: 1 };
    const insidePad = rect({ x: 780, y: 100, width: 60, height: 60 });
    expect(renderFrame([insidePad], viewport).candidates).toBe(1);

    const outsidePad = rect({ x: 7000, y: 100, width: 60, height: 60 });
    expect(renderFrame([outsidePad], viewport).candidates).toBe(0);
  });

  it('follows the pan, so panning away hides what it left behind', () => {
    const element = rect({ x: 100, y: 100, width: 60, height: 60 });
    const centred: StaticSceneViewport = { x: 0, y: 0, width: 800, height: 600, zoom: 1 };
    expect(renderFrame([element], centred).candidates).toBe(1);

    // Panning right by 5000 CSS px moves the world origin to -5000, so the
    // element at world x=100 is far off the left of the frame.
    const panned: StaticSceneViewport = { x: 5000, y: 0, width: 800, height: 600, zoom: 1 };
    expect(renderFrame([element], panned).candidates).toBe(0);
  });

  it('skips deleted elements without counting them as candidates', () => {
    const stats = renderFrame([rect({ id: 'live' }), rect({ id: 'gone', isDeleted: true })]);
    expect(stats.candidates).toBe(1);
  });

  it('trusts a caller-supplied candidate list instead of culling again', () => {
    // The spatial index has already applied culling, and re-deriving the same
    // bounds here would be the O(scene) work this path exists to avoid. So an
    // off-screen element the caller supplies IS drawn — the contract is
    // "the caller's list wins", not "the culler double-checks".
    const far = rect({ id: 'far', x: 99_999, y: 99_999 });
    const stats = renderFrame([far], VIEWPORT, { visibleElements: [far] });
    expect(stats.candidates).toBe(1);
  });

  it('still drops deleted elements from a caller-supplied candidate list', () => {
    const far = rect({ id: 'far', x: 99_999, y: 99_999 });
    const gone = rect({ id: 'gone', x: 99_999, y: 99_999, isDeleted: true });
    const stats = renderFrame([far, gone], VIEWPORT, { visibleElements: [far, gone] });
    expect(stats.candidates).toBe(1);
  });

  it('returns without drawing anything when the canvas has no 2D context', () => {
    const canvas = { getContext: () => null, width: 0, height: 0, style: {} };
    let called = false;
    expect(() =>
      renderStaticScene(canvas as unknown as HTMLCanvasElement, [rect()], VIEWPORT, {
        gridEnabled: true,
        gridSize: 20,
        zoom: 1,
        theme: 'light',
        dpr: 1,
        onFrameStats: () => {
          called = true;
        },
      })
    ).not.toThrow();
    expect(called).toBe(false);
  });
});

describe('dependency cardinality', () => {
  // `dependencyVersions` records into a Map, so a repeated id collapses to one
  // entry, while `dependenciesUnchanged` compares that Map's size against the
  // length of the *array* `collectDependencyIds` returns. Any repetition makes
  // the two disagree, and the owner's bitmap is then regenerated on every
  // frame forever.
  const owner = {
    id: 'shape',
    type: 'rectangle',
    version: 1,
    boundElements: [{ id: 't1' }, { id: 't1' }],
  } as unknown as DriplElement;
  const scene = [owner, { id: 't1', type: 'text', version: 5 } as DriplElement];

  it('does not repeat an id when several fields name the same dependency', () => {
    expect(new Set(collectDependencyIdsForTest(owner)).size).toBe(
      collectDependencyIdsForTest(owner).length
    );
  });

  it('reuses the bitmap when a dependency id appears twice in the owner', () => {
    const recorded = new Map([['t1', 5]]);
    expect(dependenciesUnchangedForTest(recorded, owner, scene)).toBe(true);
  });

  it('still detects a real dependency change behind a repeated id', () => {
    const bumped = [owner, { id: 't1', type: 'text', version: 6 } as DriplElement];
    expect(dependenciesUnchangedForTest(new Map([['t1', 5]]), owner, bumped)).toBe(false);
  });
});

describe('grid rendering', () => {
  it('draws one line per grid step across the visible world area', () => {
    // Exact count: `worldRight - worldLeft` is `viewport.width / zoom`, snapped
    // outwards by `floor(worldLeft / gridSize)`, so an 800x600 viewport at zoom 1
    // with a 20 grid has 41 vertical and 31 horizontal lines.
    const calls: { op: string; x: number; y: number }[] = [];
    const ctx = new Proxy(createMockCanvasContext() as unknown as Record<string, unknown>, {
      get(target, property) {
        if (property === 'moveTo' || property === 'lineTo') {
          return (x: number, y: number) => calls.push({ op: property, x, y });
        }
        if (property in target) return target[property as string];
        return () => undefined;
      },
    }) as unknown as CanvasRenderingContext2D;

    renderStaticScene(
      { getContext: () => ctx, width: 800, height: 600, style: {} } as unknown as HTMLCanvasElement,
      [],
      VIEWPORT,
      { gridEnabled: true, gridSize: 20, zoom: 1, theme: 'light', dpr: 1 }
    );

    // Each line is a moveTo immediately followed by its lineTo. A vertical line
    // runs from worldTop to worldBottom; a horizontal one spans the full width.
    const lines: { from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
    for (let i = 0; i + 1 < calls.length; i += 2) {
      if (calls[i]?.op === 'moveTo' && calls[i + 1]?.op === 'lineTo') {
        lines.push({ from: calls[i]!, to: calls[i + 1]! });
      }
    }

    const vertical = lines.filter(l => l.from.x === l.to.x);
    const horizontal = lines.filter(l => l.from.y === l.to.y);

    expect(vertical.length).toBe(41);
    expect(horizontal.length).toBe(31);

    const xs = vertical.map(l => l.from.x);
    // `-viewport.x / zoom` is `-0` when the pan is zero, so compare magnitudes
    // rather than insisting on `+0`.
    expect(Math.min(...xs)).toBeCloseTo(0, 9);
    expect(Math.max(...xs)).toBeCloseTo(800, 9);
    for (let i = 1; i < xs.length; i += 1) {
      expect(xs[i]! - xs[i - 1]!).toBeCloseTo(20, 9);
    }
    // Every line spans the full visible world area on the other axis.
    for (const line of vertical) {
      expect(line.from.y).toBeCloseTo(0, 9);
      expect(line.to.y).toBeCloseTo(600, 9);
    }
    for (const line of horizontal) {
      expect(line.from.x).toBeCloseTo(0, 9);
      expect(line.to.x).toBeCloseTo(800, 9);
    }
  });

  it('keeps grid lines one CSS pixel wide whatever the zoom', () => {
    const seen: number[] = [];
    const ctx = new Proxy(createMockCanvasContext() as unknown as Record<string, unknown>, {
      get(base, property) {
        if (property === 'lineWidth') {
          return seen.length;
        }
        if (property in base) return base[property as string];
        return () => undefined;
      },
      set(_target, property, value) {
        if (property === 'lineWidth') seen.push(value as number);
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;

    renderStaticScene(
      { getContext: () => ctx, width: 800, height: 600, style: {} } as unknown as HTMLCanvasElement,
      [],
      { x: 0, y: 0, width: 800, height: 600, zoom: 4 },
      { gridEnabled: true, gridSize: 20, zoom: 4, theme: 'dark', dpr: 2 }
    );

    expect(seen).toContain(1 / 4);
  });

  it('draws no grid when the grid is disabled', () => {
    let moves = 0;
    const ctx = new Proxy(createMockCanvasContext() as unknown as Record<string, unknown>, {
      get(base, property) {
        if (property === 'moveTo') {
          return () => {
            moves += 1;
          };
        }
        if (property in base) return base[property as string];
        return () => undefined;
      },
    }) as unknown as CanvasRenderingContext2D;

    renderStaticScene(
      { getContext: () => ctx, width: 800, height: 600, style: {} } as unknown as HTMLCanvasElement,
      [],
      VIEWPORT,
      { gridEnabled: false, gridSize: 20, zoom: 1, theme: 'light', dpr: 1 }
    );

    expect(moves).toBe(0);
  });
});

describe('frame stats honesty', () => {
  it('reports only the timing phases that actually ran', () => {
    // Attribution is opt-in via `onFrameStats` and each phase is accumulated
    // only where work happened. Emitting a zero for a phase that did not run
    // would read as a measurement, and `directMs` in particular is the number
    // someone compares against the 16.7ms budget when a frame is slow.
    let captured: StaticSceneFrameStats | null = null;
    renderStaticScene(hostCanvas(), [rect()], VIEWPORT, {
      gridEnabled: false,
      gridSize: 20,
      zoom: 1,
      theme: 'light',
      dpr: 1,
      onFrameStats: stats => {
        captured = stats;
      },
    });
    const stats = captured as unknown as StaticSceneFrameStats;
    expect(stats.setupMs).toBeTypeOf('number');
    // Every candidate failed to produce a bitmap, so no generate, blit, or
    // direct-draw phase ran.
    expect(stats.generateMs).toBeUndefined();
    expect(stats.blitMs).toBeUndefined();
    expect(stats.directMs).toBeUndefined();
  });

  it('counts a candidate whose bitmap cannot be generated as skipped, not drawn', () => {
    // jsdom cannot allocate a 2D context for the per-element canvas, so every
    // candidate lands here. Blanking the element and reporting it as drawn
    // would be a frame-time lie.
    const stats = renderFrame([rect({ id: 'a' }), rect({ id: 'b' })]);
    expect(stats.candidates).toBe(2);
    expect(stats.elementsSkipped).toBe(2);
    expect(stats.elementsDrawn).toBe(0);
  });
});
