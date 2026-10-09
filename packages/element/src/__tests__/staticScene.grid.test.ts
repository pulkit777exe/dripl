import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockCanvasContext } from '@dripl/test-utils';

import {
  renderStaticScene,
  resetElementBitmapCacheForTest,
  type StaticSceneViewport,
} from '../staticScene';

/**
 * Grid coarsening under zoom-out.
 *
 * `drawGrid` strokes one path per visible grid line. Zooming out compresses
 * cells — at `gridSize` 20 and zoom 0.1 a cell is 2 CSS px and an 800px-wide
 * canvas strokes ~700 segments that merge into a grey wash. The step grows so
 * neighbouring lines stay at least 10 CSS px apart (mirroring Excalidraw's
 * `strokeGrid`, which drops regular lines past the same density), keeping a
 * coarser grid visible instead of popping it out. The step stays a multiple
 * of `gridSize`, so alignment never shifts — at normal zoom the factor is 1
 * and the output is byte-identical to the uncoarsened grid.
 *
 * `moveTo` is called exactly once per grid line and by nothing else in an
 * empty scene, so its call log is the line enumeration.
 */
function renderGrid(
  ctx: CanvasRenderingContext2D,
  options: { zoom: number; gridSize: number }
): Array<readonly [number, number]> {
  const moveTo = vi.spyOn(ctx, 'moveTo');
  const viewport: StaticSceneViewport = { x: 0, y: 0, width: 800, height: 600, zoom: options.zoom };
  renderStaticScene(
    {
      getContext: () => ctx,
      width: 800,
      height: 600,
      style: {},
    } as unknown as HTMLCanvasElement,
    [],
    viewport,
    {
      gridEnabled: true,
      gridSize: options.gridSize,
      zoom: options.zoom,
      theme: 'light',
      dpr: 1,
    }
  );
  // `worldLeft` is `-pan / zoom`, which is `-0` for a zero pan. `-0` draws
  // identically to `+0` but trips `Object.is`-based matchers, so normalize.
  const norm = (v: number): number => v + 0;
  return moveTo.mock.calls.map(args => [norm(args[0]), norm(args[1])] as const);
}

beforeEach(() => {
  resetElementBitmapCacheForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('grid coarsening', () => {
  it('draws every grid line at normal zoom', () => {
    const ctx = createMockCanvasContext();

    // 800px / 20px cells: verticals at 0..800 (41), horizontals at 0..600 (31).
    const lines = renderGrid(ctx, { zoom: 1, gridSize: 20 });

    expect(lines).toHaveLength(72);
    expect(lines[0]).toEqual([0, 0]);
    expect(lines[40]).toEqual([800, 0]);
    expect(lines[41]).toEqual([0, 0]);
  });

  it('coarsens the step when cells compress past 10 CSS px', () => {
    const ctx = createMockCanvasContext();

    // Zoom 0.1 compresses 20px cells to 2px, so the step grows 5x to 100:
    // verticals at 0..8000 (81), horizontals at 0..6000 (61). Uncoarsened
    // this frame strokes ~702 segments.
    const lines = renderGrid(ctx, { zoom: 0.1, gridSize: 20 });

    expect(lines).toHaveLength(142);
    // The second vertical sits one coarse step over, not one cell over.
    expect(lines[1]?.[0]).toBe(100);
    expect(lines[80]?.[0]).toBe(8000);
  });

  it('keeps coarsened lines on the grid alignment', () => {
    const ctx = createMockCanvasContext();

    const lines = renderGrid(ctx, { zoom: 0.1, gridSize: 20 });
    const verticals = lines.slice(0, 81);

    for (const [x] of verticals) {
      expect(x % 100).toBe(0);
    }
  });

  it('leaves the zoomed-in grid untouched', () => {
    const ctx = createMockCanvasContext();

    // Zoom 2 widens cells to 40px: no coarsening. World 400x300 at step 20:
    // verticals at 0..400 (21), horizontals at 0..300 (16).
    const lines = renderGrid(ctx, { zoom: 2, gridSize: 20 });

    expect(lines).toHaveLength(37);
    expect(lines[1]?.[0]).toBe(20);
  });

  it('draws nothing for degenerate grid input instead of hanging', () => {
    const ctx = createMockCanvasContext();

    const lines = renderGrid(ctx, { zoom: 1, gridSize: 0 });

    expect(lines).toHaveLength(0);
  });
});
