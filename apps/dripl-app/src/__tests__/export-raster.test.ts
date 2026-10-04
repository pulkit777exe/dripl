import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { clearTextMeasurementCache, renderInteractiveScene } from '@/renderer/interactiveScene';
import type { RenderSceneOptions } from '@/renderer/sceneTypes';
import { exportToPng, generateThumbnail } from '@/utils/export/raster';
import {
  createRecordingContext,
  fillTexts,
  type RecordingContext,
} from './helpers/canvas-recorder';
import { linear, rectangle } from './helpers/elements';

/**
 * `utils/export/raster.ts` — the raster half of "export this canvas".
 *
 * What is actually under test is the geometry: how a scene's world bounds become
 * a canvas size, a scale and a viewport origin. That is the part that decides
 * whether the user gets their drawing or a cropped/blank image, and none of it is
 * visible in the returned Blob. So `renderInteractiveScene` is captured rather
 * than run for most tests, and the one test that runs it for real exists because
 * the renderer culls against the viewport — which makes it the only place a wrong
 * viewport origin shows up as *missing content* rather than as a wrong number.
 */

const stubs = vi.hoisted(() => ({
  /** Options passed to `renderInteractiveScene`, one entry per call. */
  calls: [] as Array<Record<string, unknown>>,
  /** 'capture' records the options; 'render' delegates to the real renderer. */
  mode: 'capture' as 'capture' | 'render',
}));

vi.mock('@/renderer/interactiveScene', async importOriginal => {
  const actual = await importOriginal<typeof import('@/renderer/interactiveScene')>();
  return {
    ...actual,
    renderInteractiveScene: (options: Record<string, unknown>) => {
      stubs.calls.push(options);
      if (stubs.mode === 'capture') return;
      return (actual.renderInteractiveScene as unknown as (o: Record<string, unknown>) => unknown)(
        options
      );
    },
  };
});

interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

interface RenderOptions {
  canvasWidth: number;
  canvasHeight: number;
  viewport: Viewport;
  elements: DriplElement[];
  selectedIds: Set<string>;
  collaborators: unknown[];
  gridEnabled: boolean;
  renderCommittedElements: boolean;
  dpr: number;
  clearCanvas: boolean;
}

let rec: RecordingContext;
let canvases: HTMLCanvasElement[];
let toBlob: ReturnType<typeof vi.spyOn>;
let toDataURL: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stubs.calls = [];
  stubs.mode = 'capture';
  clearTextMeasurementCache();
  rec = createRecordingContext({ textWidths: { Hello: 50 }, defaultCharWidth: 4 });
  canvases = [];

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement
  ) {
    canvases.push(this);
    return rec.ctx;
  });
  toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((callback: BlobCallback, type?: string) => {
      callback(new Blob(['png-bytes'], { type: type ?? 'image/png' }));
    });
  toDataURL = vi
    .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
    .mockReturnValue('data:image/jpeg;base64,DATURL');
});

afterEach(() => {
  clearTextMeasurementCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The single options object the last export handed to the renderer. */
function rendered(): RenderOptions {
  expect(stubs.calls).toHaveLength(1);
  return stubs.calls[0] as unknown as RenderOptions;
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/**
 * Screen-space margins around the scene, left/right and top/bottom. Both are
 * measured from the viewport origin rather than from `padding`, so the assertion
 * holds for the fitted branch as well as the fixed-scale one.
 */
function margins(options: RenderOptions) {
  const xs = options.elements.map(element => element.x);
  const ys = options.elements.map(element => element.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs.map((x, i) => x + options.elements[i]!.width));
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys.map((y, i) => y + options.elements[i]!.height));
  const { viewport } = options;
  return {
    left: viewport.x + minX * viewport.zoom,
    right: viewport.width - (viewport.x + maxX * viewport.zoom),
    top: viewport.y + minY * viewport.zoom,
    bottom: viewport.height - (viewport.y + maxY * viewport.zoom),
  };
}

const SCENE: DriplElement[] = [
  rectangle('a', { x: 10, y: 20, width: 100, height: 60, strokeWidth: 0 }),
  rectangle('b', { x: -30, y: 5, width: 40, height: 40, strokeWidth: 0 }),
];

describe('exportToPng', () => {
  it('sizes the canvas from the scene bounds at the requested scale, padding included', async () => {
    // Regression: `getSceneBounds` minus one end, or dropping the default scale
    // of 2, silently resizes every export. The blob itself says nothing about
    // this, so the assertion is on the canvas the export drew into.
    await exportToPng(SCENE);

    // bounds: x [-30, 110], y [5, 80] → 140 x 75; padding 16 each side.
    expect(canvases[0]!.width).toBe(344);
    expect(canvases[0]!.height).toBe(214);
    expect(rendered().viewport).toEqual({
      x: 92,
      y: 22,
      width: 344,
      height: 214,
      zoom: 2,
    });
  });

  it('honours an explicit scale instead of fitting', async () => {
    // Regression: clamping to a fit scale (or ignoring `options.scale`) exports
    // at the wrong size — small drawings become unreadably small or huge.
    await exportToPng(SCENE, { scale: 0.5 });

    expect(canvases[0]!.width).toBe(86);
    expect(canvases[0]!.height).toBe(54);
    expect(rendered().viewport.zoom).toBe(0.5);
  });

  it('keeps the scene inside the canvas: content is centred and nothing is cropped', async () => {
    // Regression: a flipped sign on `-minX * scale`, or the padding applied at
    // the wrong scale, puts the drawing outside the exported bitmap. This is the
    // assertion that fails when the viewport origin moves, not when the numbers
    // change.
    await exportToPng(SCENE);

    const edges = margins(rendered());
    expect(edges.left).toBeGreaterThan(0);
    expect(edges.right).toBeGreaterThan(0);
    expect(edges.top).toBeGreaterThan(0);
    expect(edges.bottom).toBeGreaterThan(0);
    // 16px of padding at zoom 2 on every side.
    expect(edges.left).toBeCloseTo(32, 9);
    expect(edges.right).toBeCloseTo(32, 9);
  });

  it('fits content to a requested size, centring it with equal margins', async () => {
    // Regression: the custom-dimension branch has its own viewport origin (it
    // centres instead of padding). Using the padding origin here would leave all
    // the slack on one side and clip the far edge of a wide scene.
    await exportToPng(SCENE, { customWidth: 400, customHeight: 400 });

    const options = rendered();
    expect(canvases[0]!.width).toBe(400);
    expect(canvases[0]!.height).toBe(400);
    expect(options.viewport.zoom).toBeGreaterThan(0);

    const edges = margins(options);
    expect(edges.left).toBeCloseTo(edges.right, 9);
    expect(edges.top).toBeCloseTo(edges.bottom, 9);
    expect(edges.left).toBeGreaterThanOrEqual(0);
  });

  it('caps a requested size at 8192px so a huge request cannot allocate a huge bitmap', async () => {
    // Regression: 20000 x 20000 at 4 bytes a pixel is a ~1.6 GB allocation; the
    // cap is what stops a bad dialog value from hanging the tab.
    await exportToPng(SCENE, { customWidth: 20_000, customHeight: 20_000 });

    expect(canvases[0]!.width).toBe(8192);
    expect(canvases[0]!.height).toBe(8192);
  });

  it('ignores a custom size that is zero, negative or non-finite', async () => {
    // Regression: without the `Number.isFinite(...) && > 0` guard these become a
    // canvas of width NaN/Infinity/0, and the export is a blank image or a
    // thrown allocation rather than the auto-sized one the caller asked for.
    for (const options of [
      { customWidth: 0, customHeight: 0 },
      { customWidth: -100, customHeight: -1 },
      { customWidth: Number.NaN, customHeight: Number.NaN },
      { customWidth: Number.POSITIVE_INFINITY },
    ]) {
      stubs.calls = [];
      await exportToPng(SCENE, options);
      expect(canvases.at(-1)!.width).toBe(344);
      expect(canvases.at(-1)!.height).toBe(214);
      expect(rendered().viewport.zoom).toBe(2);
    }
  });

  it('keeps a bitmap of positive size when the requested box is smaller than the padding', async () => {
    // Regression: with a custom size, the fit scale is `(width - 2 * padding) /
    // content`, which is negative for a box narrower than 32px. The `0.01` floor
    // is what keeps the export from allocating a canvas with a negative
    // dimension — i.e. from throwing or producing an unopenable file.
    await exportToPng(SCENE, { customWidth: 10, customHeight: 10 });

    expect(rendered().viewport.zoom).toBe(0.01);
    expect(canvases[0]!.width).toBeGreaterThan(0);
    expect(canvases[0]!.height).toBeGreaterThan(0);
  });

  it('paints the requested background across the whole canvas', async () => {
    // Regression: a hard-coded white fill leaks the caller's background choice
    // (transparent exports are how a user gets a PNG for a dark slide), and a
    // fill that misses the new size leaves an unpainted band.
    await exportToPng(SCENE, { background: 'rgba(0,0,0,0)' });

    const fill = rec.argLists('fillRect')[0]!;
    expect(fill).toEqual([0, 0, 344, 214]);
    expect(rec.style().fillStyle).toBe('rgba(0,0,0,0)');
  });

  it('hands the renderer every scene element and a viewport that keeps them on screen', async () => {
    // Regression: the renderer culls against the viewport, so an export that
    // passes the wrong `elements` (a filtered subset, a different array) or the
    // wrong size produces a correctly-sized but empty image. `clearCanvas: false`
    // is asserted because a stray `true` would erase the background fill.
    await exportToPng(SCENE);

    const options = rendered();
    expect(options.elements).toHaveLength(2);
    expect(options.elements.map(element => element.id)).toEqual(['a', 'b']);
    expect(options.canvasWidth).toBe(344);
    expect(options.canvasHeight).toBe(214);
    expect(options.clearCanvas).toBe(false);
    expect(options.renderCommittedElements).toBe(true);
    expect(options.dpr).toBe(1);
    expect(options.gridEnabled).toBe(false);
    // An export never shows selection or collaborator chrome.
    expect(options.selectedIds.size).toBe(0);
    expect(options.collaborators).toEqual([]);
  });

  it('actually draws the scene, so a wrong viewport cannot pass unnoticed', async () => {
    // The counterpart to the captured-options tests: with the real renderer, a
    // viewport origin error culls every element and the export is an empty
    // canvas. Regression: a sign slip in the viewport maths yields a correctly
    // sized but blank export, which no assertion on `viewport.x` alone would
    // flag as user-visible.
    stubs.mode = 'render';
    const scene = [
      ...SCENE,
      linear(
        'edge',
        'arrow',
        [
          { x: -30, y: 5 },
          { x: 110, y: 80 },
        ],
        { strokeWidth: 0 }
      ),
    ];

    await exportToPng(scene);

    const options = rendered();
    expect(rec.countOf('moveTo')).toBeGreaterThan(0);

    // Negative control: the identical scene with the viewport moved out of the
    // way draws nothing at all, so the count above cannot be vacuous.
    rec.reset();
    renderInteractiveScene({
      ...options,
      viewport: { ...options.viewport, x: 100_000 },
    } as unknown as RenderSceneOptions);
    expect(rec.countOf('moveTo')).toBe(0);
  });

  it('renders text through the export path using real font metrics', async () => {
    // Regression: a text element measured at zero width (a font that has not
    // loaded yet, or a metrics cache keyed on the wrong font) still calls
    // `fillText`, but the exported bitmap loses the label — silent data loss
    // that only surfaces on someone else's machine. The width table stands in
    // for real metrics.
    stubs.mode = 'render';
    const scene = [
      {
        ...rectangle('label', { x: 0, y: 0, width: 100, height: 40, strokeWidth: 0 }),
        type: 'text',
        text: 'Hello',
        originalText: 'Hello',
        fontSize: 20,
        fontFamily: 'Caveat',
      },
    ] as unknown as DriplElement[];

    await exportToPng(scene);

    expect(rec.argLists('measureText')).toContainEqual(['Hello']);
    expect(fillTexts(rec).map(([text]) => text)).toEqual(['Hello']);
  });

  it('returns a PNG blob', async () => {
    // Regression: `toBlob(cb)` with the type argument dropped yields whatever
    // the browser defaults to, and callers that branch on `blob.type` (the
    // download dialog's filename) get the wrong extension.
    const blob = await exportToPng(SCENE);

    expect(blob.type).toBe('image/png');
    expect(toBlob).toHaveBeenCalledTimes(1);
  });

  it('rejects rather than resolving a null blob', async () => {
    // Regression: resolving `null` hands a caller a value typed `Blob` that is
    // null at runtime; `FileCanvasRoute` already has to defend against exactly
    // this from the thumbnail path.
    toBlob.mockImplementation((callback: BlobCallback) => callback(null));

    await expect(exportToPng(SCENE)).rejects.toThrow(/PNG export failed/);
  });

  it('rejects with a named error when the 2D context is unavailable', async () => {
    // Regression: a null context used to be dereferenced, producing
    // "cannot read properties of null" — an error that says nothing about the
    // real cause (too many live canvases, or a memory-limited browser).
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    await expect(exportToPng(SCENE)).rejects.toThrow(
      /Unable to initialize canvas context for export/
    );
    expect(stubs.calls).toHaveLength(0);
  });

  it('exports an empty scene at a finite size instead of dividing by zero', async () => {
    // Regression: an empty scene has degenerate bounds. Anything that lets a
    // zero or negative scale through — the `Math.max(1, ...)` on the content
    // size, the `Math.max(0.01, ...)` on the fit scale — yields a bitmap of
    // size 0 (or `NaN` dimensions) for the first thing a user ever exports.
    await exportToPng([]);

    const { viewport, canvasWidth, canvasHeight } = rendered();
    expect(canvasWidth).toBe(66);
    expect(canvasHeight).toBe(66);
    for (const value of [viewport.x, viewport.y, viewport.zoom, viewport.width]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(canvases[0]!.width).toBeGreaterThan(0);
    expect(canvases[0]!.height).toBeGreaterThan(0);
  });

  it('is deterministic: the same scene always yields the same bitmap geometry', async () => {
    // Regression: anything order- or identity-dependent in the sizing maths (a
    // Map keyed by object identity, a cache keyed on `version`, a random seed)
    // makes "export twice, get the same file" false, and the difference is only
    // visible by diffing two PNGs.
    const first = await exportToPng(SCENE);
    const firstOptions = rendered();
    stubs.calls = [];
    const second = await exportToPng([...SCENE].map(element => ({ ...element })));

    expect(stubs.calls[0]).toEqual(firstOptions);
    expect(canvases[1]!.width).toBe(canvases[0]!.width);
    expect(canvases[1]!.height).toBe(canvases[0]!.height);
    expect(await readBlob(second)).toBe(await readBlob(first));
  });

  it('sizes from the scene bounds, not from the order the elements arrive in', async () => {
    // Regression: accumulating bounds by mutation (`minX = element.x` on the
    // first element) would make the exported bitmap depend on scene order —
    // and scene order is a fractional index the user can change by dragging.
    await exportToPng(SCENE);
    const forward = rendered();
    const forwardSize = [canvases[0]!.width, canvases[0]!.height];

    stubs.calls = [];
    await exportToPng([...SCENE].reverse());

    expect(rendered().viewport).toEqual(forward.viewport);
    expect([canvases[1]!.width, canvases[1]!.height]).toEqual(forwardSize);
  });
});

describe('generateThumbnail', () => {
  it('fits the scene inside the requested box and never enlarges it', async () => {
    // Regression: the `Math.min(..., 1)` term is what stops a one-line drawing
    // being blown up to 400x300 of mostly whitespace; dropping it inflates every
    // small file's preview.
    await generateThumbnail(SCENE, { width: 400, height: 300 });

    const options = rendered();
    const bounds = { width: 140, height: 75 };
    expect(options.viewport.zoom).toBe(
      Math.min((400 - 32) / bounds.width, (300 - 32) / bounds.height, 1)
    );
    expect(options.viewport.zoom).toBe(1);
    expect(canvases[0]!.width).toBe(172);
    expect(canvases[0]!.height).toBe(107);
  });

  it('defaults to a 400x300 box', async () => {
    // Regression: the default feeds every file's `preview` column in the file
    // browser, so a wrong default is a visible layout bug rather than a
    // throwaway one. A scene wider than the default box is what makes the
    // default observable at all.
    const wide = [rectangle('wide', { ...SCENE[0]!, x: 0, y: 0, width: 1000, height: 100 })];

    await generateThumbnail(wide);

    const options = rendered();
    // scale = min(368/1000, 268/100, 1) = 0.368
    expect(options.viewport.width).toBe(380);
    expect(options.viewport.height).toBe(49);
    expect(options.canvasWidth).toBe(380);
    expect(options.canvasHeight).toBe(49);
  });

  it('returns a JPEG data URL, which is what the preview column stores', async () => {
    // Regression: returning a Blob (or a PNG) here would put `[object Blob]` in
    // every file row, since the caller assigns the result straight to `preview`.
    const url = await generateThumbnail(SCENE);

    expect(url).toMatch(/^data:image\/jpeg;base64,/);
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.8);
  });

  it('keeps the scene inside the thumbnail with padding on all four sides', async () => {
    // Regression: the thumbnail viewport origin is computed separately from the
    // PNG export's; losing its `-minX * scale` term crops the top-left corner
    // off every non-origin scene.
    await generateThumbnail(SCENE, { width: 400, height: 600 });

    const edges = margins(rendered());
    expect(edges.left).toBeCloseTo(16, 9);
    expect(edges.right).toBeCloseTo(16, 9);
    expect(edges.top).toBeCloseTo(16, 9);
    expect(edges.bottom).toBeCloseTo(16, 9);
  });

  it('returns an empty string when the 2D context is unavailable', async () => {
    // Regression: this is the *thumbnail* half of the pair, and its callers
    // (`FileCanvasRoute`) treat a falsy result as "no preview" and carry on. If
    // it threw instead, opening a file list would fail outright whenever the
    // browser refuses one canvas context.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    await expect(generateThumbnail(SCENE)).resolves.toBe('');
    expect(stubs.calls).toHaveLength(0);
  });

  it('thumbnails an empty scene at a finite size', async () => {
    // Regression: a scene of only deleted or off-canvas elements has degenerate
    // bounds; `scaleY` is a division by `bounds.height`, so a zero there is
    // Infinity and the caller stores a data URL of nothing.
    await generateThumbnail([]);

    const { viewport, canvasWidth, canvasHeight } = rendered();
    expect(Number.isFinite(viewport.zoom)).toBe(true);
    expect(Number.isFinite(canvasWidth)).toBe(true);
    expect(Number.isFinite(canvasHeight)).toBe(true);
    expect(canvasWidth).toBeGreaterThan(0);
    expect(canvasHeight).toBeGreaterThan(0);
  });
});

describe('raster export on a canvas with convertToBlob', () => {
  /** Minimal `OffscreenCanvas`: jsdom has none, so the export falls back to `toBlob`. */
  class FakeOffscreenCanvas {
    readonly width: number;
    readonly height: number;
    readonly blobRequests: Array<{ type?: string; quality?: number }> = [];

    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }

    getContext(): CanvasRenderingContext2D {
      return rec.ctx;
    }

    async convertToBlob(options?: { type?: string; quality?: number }): Promise<Blob> {
      this.blobRequests.push({ type: options?.type, quality: options?.quality });
      return new Blob(['offscreen'], { type: options?.type ?? 'image/png' });
    }
  }

  let created: FakeOffscreenCanvas[];

  beforeEach(() => {
    created = [];
    vi.stubGlobal('OffscreenCanvas', function (width: number, height: number) {
      const canvas = new FakeOffscreenCanvas(width, height);
      created.push(canvas);
      return canvas;
    });
  });

  it('exports the PNG through convertToBlob, not through toBlob', async () => {
    // Regression: `'convertToBlob' in canvas` is the whole OffscreenCanvas
    // detection. Without it the export calls `toBlob`, which does not exist on
    // an OffscreenCanvas — a TypeError in every browser that has one.
    const blob = await exportToPng(SCENE);

    expect(created[0]!.width).toBe(344);
    expect(created[0]!.blobRequests).toEqual([{ type: 'image/png', quality: undefined }]);
    expect(blob.type).toBe('image/png');
    expect(toBlob).not.toHaveBeenCalled();
  });

  it('reads the thumbnail blob back into a JPEG data URL', async () => {
    // Regression: the OffscreenCanvas branch returns the *blob* where the
    // HTMLCanvasElement branch returns a data URL. A caller that stores the
    // result in a `preview` column would then write `[object Blob]`.
    const url = await generateThumbnail(SCENE);

    expect(created[0]!.blobRequests).toEqual([{ type: 'image/jpeg', quality: 0.8 }]);
    expect(url).toMatch(/^data:image\/jpeg;base64,/);
    expect(toDataURL).not.toHaveBeenCalled();
  });
});
