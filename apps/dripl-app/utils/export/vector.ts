import type { DriplElement } from '@dripl/common';
import { getDefaultFontFamily } from '@/utils/fontPreferences';
import { getSceneBounds } from './bounds';

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function safeSvgUrl(value: string): string {
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (/^https:\/\//i.test(value)) return value;
  if (/^data:image\/(?:png|jpeg|jpg|gif|webp);base64,/i.test(value)) return value;
  return '';
}

export function safeSvgPaint(value: string, fallback: string): string {
  const normalized = value.trim();
  if (
    /^(?:#[0-9a-f]{3,8}|transparent|none|rgb[a]?\([^)]{1,80}\)|hsl[a]?\([^)]{1,80}\))$/i.test(
      normalized
    )
  ) {
    return normalized;
  }
  return fallback;
}

export function exportToSvg(
  elements: DriplElement[],
  options: { padding?: number; customWidth?: number; customHeight?: number } = {}
): Blob {
  const padding = options.padding ?? 16;
  const bounds = getSceneBounds(elements);
  const requestedWidth =
    Number.isFinite(options.customWidth) && (options.customWidth ?? 0) > 0
      ? Math.min(8192, Math.ceil(options.customWidth!))
      : undefined;
  const requestedHeight =
    Number.isFinite(options.customHeight) && (options.customHeight ?? 0) > 0
      ? Math.min(8192, Math.ceil(options.customHeight!))
      : undefined;
  const width = requestedWidth ?? bounds.width + padding * 2;
  const height = requestedHeight ?? bounds.height + padding * 2;
  const originX = bounds.minX - padding;
  const originY = bounds.minY - padding;

  const body = elements
    .map(element => {
      const type = element.type as string;
      const stroke = escapeXml(safeSvgPaint(element.strokeColor ?? '#000000', '#000000'));
      const fill = escapeXml(
        safeSvgPaint(
          'fillColor' in element && typeof element.fillColor === 'string'
            ? element.fillColor
            : (element.backgroundColor ?? 'transparent'),
          'transparent'
        )
      );
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
        const fontFamily = escapeXml(element.fontFamily || getDefaultFontFamily());
        const textAlign = 'textAlign' in element && element.textAlign ? element.textAlign : 'left';
        let anchor: string;
        switch (textAlign) {
          case 'center':
            anchor = 'middle';
            break;
          case 'right':
            anchor = 'end';
            break;
          default:
            anchor = 'start';
        }
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
        const href = escapeXml(safeSvgUrl(element.src));
        return href
          ? `<image x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" href="${href}" opacity="${opacity}" />`
          : '';
      }
      return '';
    })
    .filter(Boolean)
    .join('');

  const viewWidth = bounds.width + padding * 2;
  const viewHeight = bounds.height + padding * 2;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${originX} ${originY} ${viewWidth} ${viewHeight}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet">${body}</svg>`;

  return new Blob([svg], { type: 'image/svg+xml' });
}
