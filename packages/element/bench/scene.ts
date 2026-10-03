import type { DriplElement } from '@dripl/common';

/**
 * Deterministic synthetic scenes for the render-path harness.
 *
 * Two properties matter more than realism here:
 *
 * 1. **Determinism.** Every element carries an explicit `seed`, because
 *    Rough.js draws a random one when it is absent, and a randomized sketch
 *    changes the number of path operations a generation emits. A benchmark whose
 *    element count varies run to run cannot detect a regression.
 * 2. **A type mix, not a wall of rectangles.** `docs/performance-benchmark.md`
 *    records every browser phase against uniform rectangles and flags real
 *    scenes with text, arrows and bindings as unmeasured. The mix here is
 *    deliberately weighted toward shapes (what the existing evidence covers)
 *    while keeping enough of the other types that a per-type cost is visible.
 */

export type SceneMix = 'rectangles' | 'mixed';

/** Grid geometry matching the shape of the existing browser capture. */
const CELL_W = 140;
const CELL_H = 100;

function base(index: number, overrides: Partial<DriplElement>): DriplElement {
  return {
    id: `el-${index}`,
    type: 'rectangle',
    x: (index % 100) * CELL_W,
    y: Math.floor(index / 100) * CELL_H,
    width: 100,
    height: 70,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    fillStyle: 'hachure',
    version: 1,
    versionNonce: index + 1,
    // Explicit, so Rough.js is reproducible across runs.
    seed: index + 1,
    ...overrides,
  } as DriplElement;
}

/**
 * `count` elements on a grid, `CELL_W` x `CELL_H` apart.
 *
 * `mixed` cycles through the types the static renderer rasterizes into a
 * per-element bitmap. Text is included because it skips Rough.js entirely and
 * therefore reports the cheap end of the range; images are excluded because
 * they are drawn directly and never touch the bitmap cache at all.
 */
export function makeScene(count: number, mix: SceneMix = 'mixed'): DriplElement[] {
  return Array.from({ length: count }, (_, index) => {
    const column = index % 100;
    const row = Math.floor(index / 100);
    const x = column * CELL_W;
    const y = row * CELL_H;

    if (mix === 'rectangles') {
      return base(index, { x, y });
    }

    switch (index % 10) {
      case 0:
      case 1:
      case 2:
      case 3:
      case 4:
      case 5:
        return base(index, { x, y, backgroundColor: '#dbe4ff', fillStyle: 'hachure' });
      case 6:
        return base(index, { x, y, type: 'ellipse', backgroundColor: '#ffe4d6' });
      case 7:
        return base(index, { x, y, type: 'diamond', backgroundColor: '#e2f7d0' });
      case 8:
        return base(index, {
          x,
          y,
          type: 'arrow',
          width: 120,
          height: 40,
          points: [
            { x: 0, y: 0 },
            { x: 60, y: 30 },
            { x: 120, y: 5 },
          ],
        } as Partial<DriplElement>);
      default:
        return base(index, {
          x,
          y,
          type: 'text',
          width: 110,
          height: 40,
          text: `label ${index}`,
          fontSize: 14,
          fontFamily: 'Inter',
        } as Partial<DriplElement>);
    }
  });
}

/**
 * A copy of `element` with a bumped version and a nudged `x`.
 *
 * The real store produces this through `mutateElement`, which also bumps a nonce
 * and a timestamp from `Math.random()` / `Date.now()`. The harness constructs it
 * directly so that a "one element moved" scenario is reproducible; the cache
 * keys on `version`, which is the only field that matters here.
 */
export function withVersion(element: DriplElement, version: number, dx: number): DriplElement {
  return { ...element, version, x: element.x + dx } as DriplElement;
}
