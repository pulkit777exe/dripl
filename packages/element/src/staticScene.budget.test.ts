import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { createMockCanvasContext } from '@dripl/test-utils';

import {
  renderStaticScene,
  resetElementBitmapCacheForTest,
  DEFAULT_MAX_NEW_BITMAPS_PER_FRAME,
  type StaticSceneFrameStats,
} from './staticScene';

function rect(id: string): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 70,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
  } as DriplElement;
}

// jsdom has no canvas backend. The stub is wrapped in a proxy so any method
// Rough.js reaches for is a no-op, rather than this test breaking whenever
// Rough.js draws a new primitive.
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

function tolerantCanvasElement(): HTMLCanvasElement {
  return {
    getContext: () => tolerantContext(),
    width: 800,
    height: 600,
    style: {},
  } as unknown as HTMLCanvasElement;
}

function renderFrame(
  elements: DriplElement[],
  maxNewBitmapsPerFrame: number
): StaticSceneFrameStats {
  let captured: StaticSceneFrameStats | null = null;
  renderStaticScene(
    tolerantCanvasElement(),
    elements,
    { x: 0, y: 0, width: 800, height: 600, zoom: 1 },
    {
      gridEnabled: false,
      gridSize: 20,
      zoom: 1,
      theme: 'light',
      dpr: 1,
      elements,
      maxNewBitmapsPerFrame,
      onFrameStats: stats => {
        captured = stats;
      },
    }
  );
  expect(captured).not.toBeNull();
  return captured as unknown as StaticSceneFrameStats;
}

describe('per-frame bitmap allocation budget', () => {
  beforeEach(() => {
    resetElementBitmapCacheForTest();
  });

  beforeAll(() => {
    class StubOffscreenCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext(): CanvasRenderingContext2D {
        return tolerantContext();
      }
    }
    vi.stubGlobal('OffscreenCanvas', StubOffscreenCanvas);
  });

  it('allocates at most the budget in a single frame', () => {
    const elements = Array.from({ length: 40 }, (_, index) => rect(`e${index}`));
    const stats = renderFrame(elements, 5);

    expect(stats.bitmapsGenerated).toBe(5);
    expect(stats.bitmapsDeferred).toBe(35);
  });

  it('still draws every candidate when the budget is exhausted', () => {
    // Deferred elements are drawn directly rather than skipped, so the frame is
    // complete. Dropping them would blank the scene.
    const elements = Array.from({ length: 12 }, (_, index) => rect(`e${index}`));
    const stats = renderFrame(elements, 3);

    expect(stats.candidates).toBe(12);
    expect(stats.elementsDrawn).toBe(12);
    expect(stats.elementsSkipped).toBe(0);
    expect(stats.bitmapsGenerated + stats.bitmapsDeferred).toBe(12);
  });

  it('converges over successive frames until nothing is deferred', () => {
    const elements = Array.from({ length: 9 }, (_, index) => rect(`e${index}`));

    const first = renderFrame(elements, 4);
    expect(first.bitmapsGenerated).toBe(4);
    expect(first.bitmapsDeferred).toBe(5);

    // A later frame re-draws everything; the already-cached ones are blits.
    const second = renderFrame(elements, 4);
    expect(second.bitmapsReused).toBe(4);
    expect(second.bitmapsGenerated).toBe(4);
    expect(second.bitmapsDeferred).toBe(1);

    const third = renderFrame(elements, 4);
    expect(third.bitmapsDeferred).toBe(0);
    expect(third.bitmapsGenerated).toBe(1);
    expect(third.bitmapsReused).toBe(8);
  });

  it('defaults to a budget when none is supplied', () => {
    const elements = Array.from({ length: DEFAULT_MAX_NEW_BITMAPS_PER_FRAME + 10 }, (_, index) =>
      rect(`d${index}`)
    );
    const stats = renderFrame(elements, Number.POSITIVE_INFINITY);
    // Called explicitly with an unbounded budget, so nothing is deferred; this
    // documents that an unbounded budget still completes rather than stalling.
    expect(stats.bitmapsDeferred).toBe(0);
    expect(stats.elementsDrawn).toBe(elements.length);
  });
});
