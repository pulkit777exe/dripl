import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { ElementSchema, type DriplElement } from '@dripl/common';
import { getElementBounds } from '@dripl/math';
import { renderInteractiveScene } from '@/renderer/interactiveScene';

const ElementsSchema = z.array(ElementSchema);

interface SceneBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

function getSceneBounds(elements: readonly DriplElement[]): SceneBounds {
  if (elements.length === 0) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  elements.forEach(element => {
    const bounds = getElementBounds(element);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  });

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function exportToPng(
  elements: DriplElement[],
  options: {
    scale?: number;
    background?: string;
    padding?: number;
  } = {}
): Promise<Blob> {
  const scale = options.scale ?? 2;
  const background = options.background ?? '#ffffff';
  const padding = options.padding ?? 16;
  const bounds = getSceneBounds(elements);

  const width = Math.ceil((bounds.width + padding * 2) * scale);
  const height = Math.ceil((bounds.height + padding * 2) * scale);

  let canvas: OffscreenCanvas | HTMLCanvasElement;
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;

  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height);
    ctx = canvas.getContext('2d');
  } else {
    const fallback = document.createElement('canvas');
    fallback.width = width;
    fallback.height = height;
    canvas = fallback;
    ctx = fallback.getContext('2d');
  }

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
      x: -bounds.minX * scale + padding * scale,
      y: -bounds.minY * scale + padding * scale,
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

export function exportToSvg(elements: DriplElement[], options: { padding?: number } = {}): Blob {
  const padding = options.padding ?? 16;
  const bounds = getSceneBounds(elements);
  const width = bounds.width + padding * 2;
  const height = bounds.height + padding * 2;
  const originX = bounds.minX - padding;
  const originY = bounds.minY - padding;

  const body = elements
    .map(element => {
      const type = element.type as string;
      const stroke = element.strokeColor ?? '#000000';
      const fill =
        'fillColor' in element && typeof element.fillColor === 'string'
          ? element.fillColor
          : (element.backgroundColor ?? 'transparent');
      const opacity = element.opacity ?? 1;
      const strokeWidth = element.strokeWidth ?? 2;

      if (type === 'rectangle') {
        return `<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" stroke="${stroke}" fill="${fill}" stroke-width="${strokeWidth}" opacity="${opacity}" />`;
      }
      if (type === 'ellipse') {
        return `<ellipse cx="${element.x + element.width / 2}" cy="${element.y + element.height / 2}" rx="${element.width / 2}" ry="${element.height / 2}" stroke="${stroke}" fill="${fill}" stroke-width="${strokeWidth}" opacity="${opacity}" />`;
      }
      if (type === 'diamond') {
        const midX = element.x + element.width / 2;
        const midY = element.y + element.height / 2;
        const points = [
          `${midX},${element.y}`,
          `${element.x + element.width},${midY}`,
          `${midX},${element.y + element.height}`,
          `${element.x},${midY}`,
        ].join(' ');
        return `<polygon points="${points}" stroke="${stroke}" fill="${fill}" stroke-width="${strokeWidth}" opacity="${opacity}" />`;
      }
      if (type === 'text' && 'text' in element) {
        const fontSize = element.fontSize || 20;
        const fontFamily =
          element.fontFamily ||
          '"Comic Sans MS", "Chalkboard SE", "Marker Felt", "Comic Neue", cursive';
        const textAlign = 'textAlign' in element && element.textAlign ? element.textAlign : 'left';
        const anchor = textAlign === 'center' ? 'middle' : textAlign === 'right' ? 'end' : 'start';
        const anchorX =
          textAlign === 'left'
            ? element.x
            : textAlign === 'center'
              ? element.x + element.width / 2
              : element.x + element.width;
        const lineHeight = fontSize * 1.25;
        const lines = (element.text || '').split('\n');
        const tspans = lines
          .map(
            (line: string, index: number) =>
              `<tspan x="${anchorX}" y="${element.y + fontSize + index * lineHeight}">${escapeXml(line)}</tspan>`
          )
          .join('');
        return `<text fill="${stroke}" font-size="${fontSize}" font-family="${fontFamily}" text-anchor="${anchor}" opacity="${opacity}">${tspans}</text>`;
      }
      if (
        (type === 'line' || type === 'arrow' || type === 'freedraw' || type === 'path') &&
        'points' in element &&
        Array.isArray(element.points) &&
        element.points.length > 0
      ) {
        const pathData = element.points
          .map((point, index) => {
            const x = point.x + element.x;
            const y = point.y + element.y;
            return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
          })
          .join(' ');
        return `<path d="${pathData}" stroke="${stroke}" fill="${
          type === 'line' ? 'none' : fill
        }" stroke-width="${strokeWidth}" opacity="${opacity}" />`;
      }
      if (type === 'image' && 'src' in element && element.src) {
        return `<image x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" href="${element.src}" opacity="${opacity}" />`;
      }
      return '';
    })
    .filter(Boolean)
    .join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${originX} ${originY} ${width} ${height}" width="${width}" height="${height}">${body}</svg>`;

  return new Blob([svg], { type: 'image/svg+xml' });
}

export function exportToJson(elements: DriplElement[]): Blob {
  return new Blob([JSON.stringify(elements, null, 2)], {
    type: 'application/json',
  });
}

export function exportCanvas(
  format: 'png' | 'svg' | 'json',
  elements: DriplElement[],
  options?: {
    scale?: number;
    background?: string;
    padding?: number;
  }
): Promise<Blob> | Blob {
  if (format === 'png') {
    return exportToPng(elements, options);
  }
  if (format === 'svg') {
    return exportToSvg(elements, options);
  }
  return exportToJson(elements);
}

export function importFromJson(
  raw: string,
  currentElements: DriplElement[],
  mode: 'merge' | 'replace' = 'merge'
): DriplElement[] {
  const parsed = JSON.parse(raw) as unknown;
  const next = ElementsSchema.parse(parsed).map(element => ({
    ...element,
    id: uuidv4(),
    updated: Date.now(),
  })) as DriplElement[];

  if (mode === 'replace') {
    return next;
  }
  return [...currentElements, ...next];
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
