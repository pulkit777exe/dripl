import { describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';
import type { Drawable } from 'roughjs/bin/core';

import { renderRoughElement } from '../rough-renderer';

/**
 * An arrow's **arrowhead** was redrawn with fresh randomness on every bitmap
 * regeneration, while its body stayed stable.
 *
 * `resolveElementSeed` (rough-renderer.ts:180) exists precisely to prevent that:
 * its own doc comment says an element without a seed gets "a random seed on
 * every generation, which means an element's sketch visibly [changes] ...
 * eviction". The body is given that seed at line 215. The `arrowHeadOptions`
 * object built at line 503 was not — it carries stroke, strokeWidth, fill,
 * fillStyle and roughness, but no `seed` — so `getGenerator().polygon(...)`
 * inside `drawArrowhead` fell back to `Math.random()`.
 *
 * The consequence is user-visible: zooming far enough to evict a bitmap, a theme
 * change, or any cold load re-rolls every arrowhead's jitter while the line
 * stays put, so arrows visibly twitch for no reason the user did.
 *
 * Roughness is left at its default here on purpose. At `roughness: 0` Rough emits
 * exact geometry and never draws a random offset at all, which would make every
 * assertion below pass whether or not the seed is threaded through.
 *
 * The comparison target is the Drawable's `sets` — the path operations Rough
 * actually generated — rather than a recorded canvas trace. Rough defers all
 * drawing until a Drawable is rendered, so a stub that only collects drawables
 * records nothing; and reading `sets` compares the real geometry without needing
 * a rasteriser at all.
 */

interface Geometry {
  shape: string;
  sets: unknown;
}

const context = {
  // Every method `renderRoughElement` touches. The geometry under test lives in
  // the Drawables, not in what the context does with them, so these are inert
  // sinks — a canvas would be needed only to rasterise, not to compare.
  save: () => undefined,
  restore: () => undefined,
  translate: () => undefined,
  rotate: () => undefined,
  scale: () => undefined,
  setTransform: () => undefined,
  setLineDash: () => undefined,
  fillRect: () => undefined,
  strokeRect: () => undefined,
  drawImage: () => undefined,
  fillText: () => undefined,
  measureText: () => ({ width: 0 }),
  globalAlpha: 1,
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  font: '',
  textAlign: 'left',
  textBaseline: 'alphabetic',
  globalCompositeOperation: 'source-over',
} as unknown as CanvasRenderingContext2D;

function arrow(overrides: Partial<DriplElement> = {}): DriplElement {
  return {
    id: 'arrow-1',
    type: 'arrow',
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    points: [
      { x: 0, y: 0 },
      { x: 50, y: 20 },
      { x: 100, y: 40 },
    ],
    arrowHeads: { start: 'none', end: 'triangle' },
    ...overrides,
  } as DriplElement;
}

/** Geometry of every drawable the render produced, body and arrowhead alike. */
function render(element: DriplElement): Geometry[] {
  const drawn: Drawable[] = [];
  const rc = {
    draw: (drawable: Drawable) => {
      drawn.push(drawable);
    },
  } as unknown as Parameters<typeof renderRoughElement>[0];

  renderRoughElement(rc, context, element, [], 'light');

  return drawn.map(d => ({ shape: d.shape, sets: JSON.parse(JSON.stringify(d.sets)) }));
}

describe('arrowhead determinism', () => {
  it('does not reach for Math.random when rendering an arrow', () => {
    // The direct statement of the bug. Every other part of the element is
    // seeded, so a single call here means some path was handed an unseeded
    // generator. Measured at 72 calls per arrow before the fix.
    const random = vi.spyOn(Math, 'random');

    render(arrow());

    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it('produces identical geometry across two renders of the same arrow', () => {
    // The behavioural guarantee, independent of Rough's internals: this is what
    // a user sees if the arrowhead is re-rolled.
    expect(render(arrow())).toEqual(render(arrow()));
  });

  it('keeps geometry stable across a version bump, which is what eviction causes', () => {
    const first = render(arrow({ version: 1 }));
    const second = render(arrow({ version: 2 }));
    expect(second).toEqual(first);
  });

  it('still varies geometry between different arrows', () => {
    // Guards against "fix" being a single constant seed: two arrows must not be
    // twins, or every arrow in every scene would look identical.
    expect(render(arrow({ id: 'arrow-a' }))).not.toEqual(render(arrow({ id: 'arrow-b' })));
  });

  it('honours an explicit seed and derives a stable one when absent', () => {
    const explicit = render(arrow({ seed: 12345 }));
    expect(render(arrow({ seed: 12345 }))).toEqual(explicit);
    expect(render(arrow({ seed: 99999 }))).not.toEqual(explicit);

    // No seed on the element at all — the base factory simply never sets one.
    // `stableSeedFor(id)` must still make it stable, which is the property that
    // already held for the body.
    const unseeded = render(arrow());
    expect(render(arrow())).toEqual(unseeded);
  });

  it('emits more than one drawable, so the arrowhead is actually covered', () => {
    // If the arrowhead ever stopped being drawn, every assertion above would
    // silently pass while testing only the line. Pin that both shapes are there.
    const shapes = render(arrow()).map(g => g.shape);
    expect(shapes.length).toBeGreaterThanOrEqual(2);
    expect(shapes).toContain('linearPath');
    expect(shapes).toContain('polygon');
  });
});
