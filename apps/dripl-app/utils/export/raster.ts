import type { DriplElement } from '@dripl/common';
import { renderInteractiveScene } from '@/renderer/interactiveScene';
import { createCanvas } from '../canvas-helpers';
import { getSceneBounds } from './bounds';

export async function exportToPng(
  elements: DriplElement[],
  options: {
    scale?: number;
    background?: string;
    padding?: number;
    customWidth?: number;
    customHeight?: number;
    appState?: Record<string, unknown>;
  } = {}
): Promise<Blob> {
  const requestedScale = options.scale ?? 2;
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

  const { canvas, ctx } = createCanvas(width, height);

  if (!ctx) {
    throw new Error('Unable to initialize canvas context for export');
  }

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  renderInteractiveScene({
    ctx: ctx as CanvasRenderingContext2D,
    canvasWidth: width,
    canvasHeight: height,
    viewport: {
      x:
        customWidth || customHeight
          ? (width - contentWidth * scale) / 2 - bounds.minX * scale
          : -bounds.minX * scale + padding * scale,
      y:
        customWidth || customHeight
          ? (height - contentHeight * scale) / 2 - bounds.minY * scale
          : -bounds.minY * scale + padding * scale,
      width,
      height,
      zoom: scale,
    },
    elements,
    selectedIds: new Set<string>(),
    collaborators: [],
    gridEnabled: false,
    renderCommittedElements: true,
    dpr: 1,
    clearCanvas: false,
  });

  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/png' });
  }

  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(blob => {
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

  const { canvas, ctx } = createCanvas(canvasWidth, canvasHeight);

  if (!ctx) {
    return '';
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  renderInteractiveScene({
    ctx: ctx as CanvasRenderingContext2D,
    canvasWidth,
    canvasHeight,
    viewport: {
      x: -bounds.minX * scale + padding * scale,
      y: -bounds.minY * scale + padding * scale,
      width: canvasWidth,
      height: canvasHeight,
      zoom: scale,
    },
    elements,
    selectedIds: new Set<string>(),
    collaborators: [],
    gridEnabled: false,
    renderCommittedElements: true,
    dpr: 1,
    clearCanvas: false,
  });

  if ('convertToBlob' in canvas) {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    return new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }

  return new Promise<string>(resolve => {
    resolve((canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.8));
  });
}
