import type { DriplElement } from '@dripl/common';
import { renderStaticScene } from '@dripl/element/staticScene';
import { imageCache } from '@dripl/element/image-cache';
import { getSceneBounds } from './bounds';

/**
 * Images decode asynchronously; the static renderer paints a placeholder for
 * anything not yet decoded. Preloading first means exports contain the real
 * bitmaps instead of grey boxes. Never rejects — errors are cached as error
 * states and rendered as error tints.
 */
async function preloadExportImages(elements: DriplElement[]): Promise<void> {
  const srcs = new Set<string>();
  for (const element of elements) {
    if (element.type === 'image' && typeof element.src === 'string' && element.src) {
      srcs.add(element.src);
    }
  }
  await Promise.all(
    [...srcs].map(src =>
      imageCache.load(src).then(
        () => undefined,
        () => undefined
      )
    )
  );
}

/**
 * Export canvas: always a real HTMLCanvasElement. `renderStaticScene` needs
 * one (it sizes via `.style` and binds Rough.js to it), and the committed
 * bitmap path is what makes exported pixels identical to on-screen pixels —
 * the previous `renderInteractiveScene` route drew through the draft path
 * (no label cutout, different image handling).
 */
function createExportCanvas(
  width: number,
  height: number
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return { canvas, ctx: canvas.getContext('2d') };
}

export async function exportToPng(
  elements: DriplElement[],
  options: {
    scale?: number;
    background?: string;
    padding?: number;
    customWidth?: number;
    customHeight?: number;
    appState?: Record<string, unknown>;
    theme?: 'light' | 'dark';
  } = {}
): Promise<Blob> {
  const requestedScale = options.scale ?? 2;
  const theme = options.theme ?? 'light';
  const background = options.background ?? '#ffffff';
  const padding = options.padding ?? 16;
  const bounds = getSceneBounds(elements);
  const customWidth =
    Number.isFinite(options.customWidth) && (options.customWidth ?? 0) > 0
      ? Math.min(8192, Math.ceil(options.customWidth!))
      : undefined;
  const customHeight =
    Number.isFinite(options.customHeight) && (options.customHeight ?? 0) > 0
      ? Math.min(8192, Math.ceil(options.customHeight!))
      : undefined;
  const contentWidth = Math.max(1, bounds.width);
  const contentHeight = Math.max(1, bounds.height);
  const fitScale = Math.min(
    (customWidth ? customWidth - padding * 2 : contentWidth + padding * 2) / contentWidth,
    (customHeight ? customHeight - padding * 2 : contentHeight + padding * 2) / contentHeight
  );
  const scale = customWidth || customHeight ? Math.max(0.01, fitScale) : requestedScale;
  const width = customWidth ?? Math.ceil((contentWidth + padding * 2) * scale);
  const height = customHeight ?? Math.ceil((contentHeight + padding * 2) * scale);

  const { canvas, ctx } = createExportCanvas(width, height);

  if (!ctx) {
    throw new Error('Unable to initialize canvas context for export');
  }

  await preloadExportImages(elements);

  const panX =
    customWidth || customHeight
      ? (width - contentWidth * scale) / 2 - bounds.minX * scale
      : -bounds.minX * scale + padding * scale;
  const panY =
    customWidth || customHeight
      ? (height - contentHeight * scale) / 2 - bounds.minY * scale
      : -bounds.minY * scale + padding * scale;

  renderStaticScene(
    canvas,
    elements,
    { x: panX, y: panY, width, height, zoom: scale },
    {
      gridEnabled: false,
      gridSize: 20,
      zoom: scale,
      theme,
      dpr: 1,
      elements,
    }
  );

  // The static renderer clears first, so the background goes underneath via
  // destination-over rather than being painted over by the clear.
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('PNG export failed'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

export async function generateThumbnail(
  elements: DriplElement[],
  options: { width?: number; height?: number } = {}
): Promise<string> {
  const width = options.width ?? 400;
  const height = options.height ?? 300;
  const bounds = getSceneBounds(elements);
  const padding = 16;

  const scaleX = (width - padding * 2) / bounds.width;
  const scaleY = (height - padding * 2) / bounds.height;
  const scale = Math.min(scaleX, scaleY, 1);

  const canvasWidth = Math.ceil((bounds.width + padding * 2) * scale);
  const canvasHeight = Math.ceil((bounds.height + padding * 2) * scale);

  const { canvas, ctx } = createExportCanvas(canvasWidth, canvasHeight);

  if (!ctx) {
    return '';
  }

  await preloadExportImages(elements);

  renderStaticScene(
    canvas,
    elements,
    {
      x: -bounds.minX * scale + padding * scale,
      y: -bounds.minY * scale + padding * scale,
      width: canvasWidth,
      height: canvasHeight,
      zoom: scale,
    },
    {
      gridEnabled: false,
      gridSize: 20,
      zoom: scale,
      theme: 'light',
      dpr: 1,
      elements,
    }
  );

  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.restore();

  return new Promise<string>(resolve => {
    resolve(canvas.toDataURL('image/jpeg', 0.8));
  });
}
