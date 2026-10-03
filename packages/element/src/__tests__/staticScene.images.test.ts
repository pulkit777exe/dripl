import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';

import {
  renderStaticScene,
  resetElementBitmapCacheForTest,
  type StaticSceneFrameStats,
  type StaticSceneViewport,
} from '../staticScene';
import { imageCache } from '../image-cache';

class ControlledImage {
  static instances: ControlledImage[] = [];

  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  width = 0;
  height = 0;
  private _src = '';

  constructor() {
    ControlledImage.instances.push(this);
  }

  set src(value: string) {
    this._src = value;
  }

  get src(): string {
    return this._src;
  }

  succeed(width = 400, height = 300): void {
    this.width = width;
    this.height = height;
    this.onload?.();
  }

  fail(): void {
    this.onerror?.();
  }
}

interface Recorded {
  drawImage: { image: unknown; x: number; y: number; width: number; height: number }[];
  fillRect: { x: number; y: number; width: number; height: number; style: unknown }[];
  rotate: number[];
  translate: { x: number; y: number }[];
  globalAlpha: number[];
}

function recordingHost(): { canvas: HTMLCanvasElement; recorded: Recorded } {
  const recorded: Recorded = {
    drawImage: [],
    fillRect: [],
    rotate: [],
    translate: [],
    globalAlpha: [],
  };
  const state = { alpha: 1 };
  const ctx = {
    save: () => undefined,
    restore: () => undefined,
    setTransform: () => undefined,
    clearRect: () => undefined,
    scale: () => undefined,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    measureText: () => ({ width: 10 }),
    drawImage: (image: unknown, x: number, y: number, width: number, height: number) =>
      recorded.drawImage.push({ image, x, y, width, height }),
    fillRect: (x: number, y: number, width: number, height: number) =>
      recorded.fillRect.push({ x, y, width, height, style: ctx.fillStyle }),
    rotate: (angle: number) => recorded.rotate.push(angle),
    translate: (x: number, y: number) => recorded.translate.push({ x, y }),
  };
  Object.defineProperty(ctx, 'globalAlpha', {
    get: () => state.alpha,
    set: (value: number) => {
      state.alpha = value;
      recorded.globalAlpha.push(value);
    },
  });

  return {
    canvas: {
      getContext: () => ctx,
      width: 800,
      height: 600,
      style: {},
    } as unknown as HTMLCanvasElement,
    recorded,
  };
}

const VIEWPORT: StaticSceneViewport = { x: 0, y: 0, width: 800, height: 600, zoom: 1 };

function image(overrides: Partial<DriplElement> = {}): DriplElement {
  return {
    id: 'img-1',
    type: 'image',
    x: 10,
    y: 20,
    width: 120,
    height: 90,
    src: 'photo.png',
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

function renderFrame(
  elements: DriplElement[],
  onAssetLoad?: () => void
): { stats: StaticSceneFrameStats; recorded: Recorded } {
  const { canvas, recorded } = recordingHost();
  let stats: StaticSceneFrameStats | null = null;
  renderStaticScene(canvas, elements, VIEWPORT, {
    gridEnabled: false,
    gridSize: 20,
    zoom: 1,
    theme: 'light',
    dpr: 1,
    ...(onAssetLoad ? { onAssetLoad } : {}),
    onFrameStats: s => {
      stats = s;
    },
  });
  return { stats: stats as unknown as StaticSceneFrameStats, recorded };
}

async function drain(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

beforeEach(() => {
  ControlledImage.instances = [];
  imageCache.clear();
  resetElementBitmapCacheForTest();
  vi.stubGlobal('Image', ControlledImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  imageCache.clear();
});

describe('image element draw path', () => {
  it('blits the decoded bitmap stretched to the element box', async () => {
    const pending = imageCache.load('photo.png');
    ControlledImage.instances.at(-1)?.succeed(400, 300);
    await pending;

    const { stats, recorded } = renderFrame([image()]);

    expect(stats.candidates).toBe(1);
    expect(recorded.drawImage).toHaveLength(1);
    expect(recorded.drawImage[0]).toMatchObject({ x: 10, y: 20, width: 120, height: 90 });
  });

  it('allocates no per-element bitmap, because the decoded image is reused', async () => {
    const pending = imageCache.load('photo.png');
    ControlledImage.instances.at(-1)?.succeed();
    await pending;
    const { stats } = renderFrame([image()]);
    // The per-element offscreen canvas is the largest single allocation in a
    // cold frame, so an image element must not create one.
    expect(stats.bitmapsGenerated).toBe(0);
    expect(stats.elementsDrawn).toBe(1);
  });

  it('draws nothing at all for an image with no source', () => {
    const noSource = image({ src: undefined } as unknown as Partial<DriplElement>);
    const { recorded } = renderFrame([noSource]);
    expect(recorded.drawImage).toHaveLength(0);
    expect(recorded.fillRect).toHaveLength(0);
    expect(ControlledImage.instances).toHaveLength(0);
  });

  it('shows a themed placeholder and starts one load while decoding', async () => {
    let assetLoadCallbacks = 0;
    const { recorded } = renderFrame([image()], () => {
      assetLoadCallbacks += 1;
    });

    expect(ControlledImage.instances).toHaveLength(1);
    expect(recorded.fillRect).toHaveLength(1);
    expect(recorded.fillRect[0]).toMatchObject({ x: 10, y: 20, width: 120, height: 90 });
    expect(assetLoadCallbacks).toBe(0);

    ControlledImage.instances[0]?.succeed();
    await drain();
    expect(assetLoadCallbacks).toBe(1);
  });

  it('does not start a second request on the next frame', async () => {
    // The placeholder path is the one that retries, because it only runs when
    // there is no cached entry. Once the entry exists the loop must stop, or a
    // slow image costs a new `Image` per frame forever.
    renderFrame([image()]);
    expect(ControlledImage.instances).toHaveLength(1);

    ControlledImage.instances[0]?.succeed();
    await drain();

    renderFrame([image()]);
    renderFrame([image()]);
    expect(ControlledImage.instances).toHaveLength(1);
  });

  it('stops requesting once the load has failed terminally', async () => {
    renderFrame([image()]);
    ControlledImage.instances[0]?.fail();
    await drain();

    const { recorded } = renderFrame([image()]);
    // The error tint, not the pending placeholder.
    expect(recorded.fillRect).toHaveLength(1);
    expect(recorded.fillRect[0]?.style).toBe('rgba(255,0,0,0.1)');
    expect(ControlledImage.instances).toHaveLength(1);
  });

  it('uses a dark-theme error tint in dark mode', async () => {
    renderFrame([image()]);
    ControlledImage.instances[0]?.fail();
    await drain();

    const { canvas, recorded } = recordingHost();
    renderStaticScene(canvas, [image()], VIEWPORT, {
      gridEnabled: false,
      gridSize: 20,
      zoom: 1,
      theme: 'dark',
      dpr: 1,
    });
    expect(recorded.fillRect[0]?.style).toBe('rgba(255,100,100,0.15)');
  });

  it('applies opacity and rotation before blitting', async () => {
    const pending = imageCache.load('photo.png');
    ControlledImage.instances.at(-1)?.succeed();
    await pending;

    const { recorded } = renderFrame([image({ opacity: 0.4, angle: Math.PI / 3 })]);

    expect(recorded.globalAlpha).toContain(0.4);
    expect(recorded.rotate).toContain(Math.PI / 3);
    // The rotation is about the element's own centre.
    expect(recorded.translate).toContainEqual({ x: 70, y: 65 });
    expect(recorded.translate).toContainEqual({ x: -70, y: -65 });
  });

  it('defaults opacity to 1 when the element carries none', async () => {
    const pending = imageCache.load('photo.png');
    ControlledImage.instances.at(-1)?.succeed();
    await pending;
    const noOpacity = image({ opacity: undefined } as unknown as Partial<DriplElement>);
    const { recorded } = renderFrame([noOpacity]);
    expect(recorded.globalAlpha).toContain(1);
  });
});
