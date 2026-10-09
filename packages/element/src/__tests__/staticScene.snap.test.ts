import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockCanvasContext } from '@dripl/test-utils';

import {
  renderStaticScene,
  resetElementBitmapCacheForTest,
  snapPanToDevicePixels,
  type StaticSceneViewport,
} from '../staticScene';

/**
 * Whole-device-pixel pans.
 *
 * A fractional pan blits every cached element bitmap at a fractional device
 * offset, resampling it; as the fraction drifts under a pan, elements pulse
 * between crisp and soft. `snapPanToDevicePixels` (mirroring Excalidraw's
 * `snapScrollToDevicePixels`) rounds the pan to the `1 / dpr` grid so the
 * device offset is whole, and `bootstrapCanvas` draws at the snapped pan.
 * Hit-testing and DOM overlays keep the real pan — the difference stays under
 * half a device pixel.
 */
function hostCanvasWith(ctx: CanvasRenderingContext2D): HTMLCanvasElement {
  return {
    getContext: () => ctx,
    width: 800,
    height: 600,
    style: {},
  } as unknown as HTMLCanvasElement;
}

function renderAtPan(
  ctx: CanvasRenderingContext2D,
  pan: { x: number; y: number },
  options: { dpr: number; zoom: number }
): void {
  const viewport: StaticSceneViewport = {
    x: pan.x,
    y: pan.y,
    width: 800,
    height: 600,
    zoom: options.zoom,
  };
  renderStaticScene(hostCanvasWith(ctx), [], viewport, {
    gridEnabled: false,
    gridSize: 20,
    zoom: options.zoom,
    theme: 'light',
    dpr: options.dpr,
  });
}

beforeEach(() => {
  resetElementBitmapCacheForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('snapPanToDevicePixels', () => {
  it('rounds a fractional pan to the 1/dpr grid', () => {
    // dpr 2: halves are whole device pixels, tenths are not.
    expect(snapPanToDevicePixels(10.3, 2)).toBe(10.5);
    expect(snapPanToDevicePixels(-4.1, 2)).toBe(-4);
    // dpr 1: only integers survive.
    expect(snapPanToDevicePixels(3.6, 1)).toBe(4);
    expect(snapPanToDevicePixels(-3.6, 1)).toBe(-4);
  });

  it('leaves an already-whole pan untouched', () => {
    expect(snapPanToDevicePixels(10.5, 2)).toBe(10.5);
    expect(snapPanToDevicePixels(-7, 1)).toBe(-7);
    expect(snapPanToDevicePixels(0, 2)).toBe(0);
  });

  it('passes the pan through when there is no positive dpr to snap to', () => {
    for (const dpr of [0, -1, -2, Number.NaN]) {
      expect(snapPanToDevicePixels(10.3, dpr)).toBe(10.3);
    }
  });
});

describe('static scene camera snap', () => {
  it('translates by the snapped pan, so the device offset is whole', () => {
    const ctx = createMockCanvasContext();
    const translate = vi.spyOn(ctx, 'translate');

    // Pan (10.3, -4.1) at dpr 2 snaps to (10.5, -4); at zoom 1 the translate
    // divides by zoom without changing the values.
    renderAtPan(ctx, { x: 10.3, y: -4.1 }, { dpr: 2, zoom: 1 });

    expect(translate).toHaveBeenCalledWith(10.5, -4);
  });

  it('keeps the snap outside the zoom division', () => {
    const ctx = createMockCanvasContext();
    const translate = vi.spyOn(ctx, 'translate');

    // Snapped first ((10.3, -4.1) → (10.5, -4) at dpr 2), then divided by the
    // zoom: (5.25, -2). Snapping the quotient instead would round to a
    // different grid and the device offset would stay fractional.
    renderAtPan(ctx, { x: 10.3, y: -4.1 }, { dpr: 2, zoom: 2 });

    expect(translate).toHaveBeenCalledWith(5.25, -2);
  });

  it('translates whole pans exactly as before', () => {
    const ctx = createMockCanvasContext();
    const translate = vi.spyOn(ctx, 'translate');

    // A pan that is already on the grid must reach the context unchanged, so
    // still scenes render bit-identically with and without the snap.
    renderAtPan(ctx, { x: 120, y: -40 }, { dpr: 2, zoom: 1 });

    expect(translate).toHaveBeenCalledWith(120, -40);
  });
});
