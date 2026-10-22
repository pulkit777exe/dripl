import type { DriplElement, Point } from '@dripl/common';
import { canvasFontFamily } from '@dripl/element/text';
import { getFreedrawOutline } from '@dripl/element/freedraw';
import { applyDarkModeFilter } from '@dripl/element/theme';
import { arrowHeadLength } from '@dripl/math/intersection';
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
  options: {
    padding?: number;
    customWidth?: number;
    customHeight?: number;
    /** Final display background; omitted keeps the SVG transparent. */
    background?: string;
    theme?: 'light' | 'dark';
  } = {}
): Blob {
  const padding = options.padding ?? 16;
  // Transparent background reads as light; pass 'dark' for dark slides so
  // the achromatic extremes remap exactly like the canvas renderer.
  const theme = options.theme ?? 'light';
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

  const defs: string[] = [];

  // Frame clipping: members (groupId `frame-<id>`, assigned by
  // applyFrameGrouping) are clipped to their frame, mirroring the static
  // bitmap pass. Regular groups use bare ids and never match.
  const clipDefs: string[] = [];
  const clipIdByGroup = new Map<string, string>();
  for (const element of elements) {
    if (element.type !== 'frame' || element.isDeleted) continue;
    const dims = [element.x, element.y, element.width, element.height];
    if (!dims.every(Number.isFinite)) continue;
    const clipId = `dripl-clip-${element.id}`;
    clipIdByGroup.set(`frame-${element.id}`, clipId);
    clipDefs.push(
      `<clipPath id="${escapeXml(clipId)}"><rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" /></clipPath>`
    );
  }
  const clipAttr = (element: DriplElement): string => {
    if (element.type === 'frame' || typeof element.groupId !== 'string') return '';
    const clipId = clipIdByGroup.get(element.groupId);
    return clipId ? ` clip-path="url(#${escapeXml(clipId)})"` : '';
  };

  /** Rotation wrapper: canvas angles are radians about the element center. */
  const rotateWrap = (element: DriplElement, inner: string): string => {
    const angle = element.angle ?? 0;
    if (!angle) return inner;
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    return `<g transform="rotate(${(angle * 180) / Math.PI} ${cx} ${cy})">${inner}</g>`;
  };

  /** Dash pattern matching the Rough.js strokeLineDash for the style. */
  const dashAttr = (element: DriplElement, strokeWidth: number): string => {
    if (element.strokeStyle === 'dashed') return ` stroke-dasharray="8 ${8 + strokeWidth}"`;
    if (element.strokeStyle === 'dotted') return ` stroke-dasharray="1.5 ${6 + strokeWidth}"`;
    return '';
  };

  /** Arrowhead marker definitions, one per headed end (userSpaceOnUse). */
  const headMarker = (
    element: DriplElement,
    end: 'start' | 'end',
    type: string,
    color: string,
    strokeWidth: number
  ): string => {
    const h = arrowHeadLength(strokeWidth);
    const id = escapeXml(`dripl-ah-${element.id}-${end}`);
    const orient = end === 'start' ? 'auto-start-reverse' : 'auto';
    let content = '';
    if (type === 'triangle') {
      content = `<path d="M 0 ${h / 2} L ${h} ${h / 2 + h * 0.4} L ${h} ${h / 2 - h * 0.4} z" fill="${color}" />`;
    } else if (type === 'diamond') {
      content = `<polygon points="0,${h / 2} ${h * 0.5},${h / 2 + h * 0.35} ${h},${h / 2} ${h * 0.5},${h / 2 - h * 0.35}" fill="${color}" />`;
    } else if (type === 'dot') {
      content = `<circle cx="${h * 0.3}" cy="${h / 2}" r="${h * 0.3}" fill="${color}" />`;
    } else if (type === 'bar') {
      const w = Math.max(strokeWidth, 1);
      return `<marker id="${id}" markerUnits="userSpaceOnUse" markerWidth="${w + 2}" markerHeight="${h}" refX="${(w + 2) / 2}" refY="${h / 2}" orient="${orient}"><path d="M ${(w + 2) / 2} 0 L ${(w + 2) / 2} ${h}" stroke="${color}" stroke-width="${w}" /></marker>`;
    } else {
      return '';
    }
    defs.push(
      `<marker id="${id}" markerUnits="userSpaceOnUse" markerWidth="${h}" markerHeight="${h}" refX="${type === 'dot' ? h * 0.6 : 0}" refY="${h / 2}" orient="${orient}">${content}</marker>`
    );
    return `marker-${end}="url(#${id})"`;
  };

  const worldPoints = (element: DriplElement): Point[] => {
    const points =
      'points' in element && Array.isArray(element.points) ? (element.points as Point[]) : [];
    return points
      .filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
      .map(p => ({ x: p.x + element.x, y: p.y + element.y }));
  };

  /** Centerline path data, honouring curved/elbow arrow routing. */
  const linearPathData = (element: DriplElement, world: Point[]): string => {
    const style =
      element.type === 'arrow' && 'arrowStyle' in element && typeof element.arrowStyle === 'string'
        ? element.arrowStyle
        : 'straight';
    if (style === 'curved' && world.length === 2) {
      const [s, e] = [world[0]!, world[world.length - 1]!];
      const dx = e.x - s.x;
      const dy = e.y - s.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length === 0) return `M ${s.x} ${s.y} L ${e.x} ${e.y}`;
      const mx = (s.x + e.x) / 2;
      const my = (s.y + e.y) / 2;
      const cx = mx + (-dy / length) * length * 0.5 * 0.25;
      const cy = my + (dx / length) * length * 0.5 * 0.25;
      return `M ${s.x} ${s.y} Q ${cx} ${cy} ${e.x} ${e.y}`;
    }
    if (style === 'elbow' && world.length === 2) {
      const [s, e] = [world[0]!, world[world.length - 1]!];
      const corner =
        Math.abs(e.x - s.x) > Math.abs(e.y - s.y) ? { x: e.x, y: s.y } : { x: s.x, y: e.y };
      return `M ${s.x} ${s.y} L ${corner.x} ${corner.y} L ${e.x} ${e.y}`;
    }
    return world.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  };

  const body = elements
    .map(element => {
      const type = element.type as string;
      const stroke = escapeXml(
        applyDarkModeFilter(safeSvgPaint(element.strokeColor ?? '#000000', '#000000'), theme) ??
          '#000000'
      );
      const fill = escapeXml(
        applyDarkModeFilter(
          safeSvgPaint(
            'fillColor' in element && typeof element.fillColor === 'string'
              ? element.fillColor
              : (element.backgroundColor ?? 'transparent'),
            'transparent'
          ),
          theme
        ) ?? 'transparent'
      );
      const opacity = element.opacity ?? 1;
      const strokeWidth = element.strokeWidth ?? 2;

      if (type === 'rectangle') {
        return rotateWrap(
          element,
          `<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" stroke="${stroke}" fill="${fill}" stroke-width="${strokeWidth}"${dashAttr(element, strokeWidth)}${clipAttr(element)} opacity="${opacity}" />`
        );
      }
      if (type === 'ellipse') {
        return rotateWrap(
          element,
          `<ellipse cx="${element.x + element.width / 2}" cy="${element.y + element.height / 2}" rx="${element.width / 2}" ry="${element.height / 2}" stroke="${stroke}" fill="${fill}" stroke-width="${strokeWidth}"${dashAttr(element, strokeWidth)}${clipAttr(element)} opacity="${opacity}" />`
        );
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
        return rotateWrap(
          element,
          `<polygon points="${points}" stroke="${stroke}" fill="${fill}" stroke-width="${strokeWidth}"${dashAttr(element, strokeWidth)}${clipAttr(element)} opacity="${opacity}" />`
        );
      }
      if (type === 'freedraw') {
        // The stroke is a filled variable-width outline, not a centerline —
        // the same perfect-freehand polygon the canvas fills.
        const outline = getFreedrawOutline(element);
        if (outline.length === 0) return '';
        const points = outline.map(p => `${p.x},${p.y}`).join(' ');
        return rotateWrap(
          element,
          `<polygon points="${points}" fill="${stroke}"${clipAttr(element)} opacity="${opacity}" />`
        );
      }
      if (type === 'text' && 'text' in element) {
        const fontSize = element.fontSize || 20;
        const fontFamily = escapeXml(canvasFontFamily(element.fontFamily));
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
        // Same box-anchored layout as the canvas renderers: verticalAlign
        // offsets against the stored box, which is sized from these metrics.
        const totalHeight = lines.length * lineHeight;
        const verticalAlign =
          'verticalAlign' in element &&
          (element.verticalAlign === 'middle' || element.verticalAlign === 'bottom')
            ? element.verticalAlign
            : 'top';
        const startY =
          verticalAlign === 'middle'
            ? Math.max(0, (element.height - totalHeight) / 2)
            : verticalAlign === 'bottom'
              ? Math.max(0, element.height - totalHeight)
              : 0;
        const tspans = lines
          .map(
            (line: string, index: number) =>
              `<tspan x="${anchorX}" y="${element.y + startY + fontSize + index * lineHeight}">${escapeXml(line)}</tspan>`
          )
          .join('');
        return rotateWrap(
          element,
          `<text fill="${stroke}" font-size="${fontSize}" font-family="${fontFamily}" text-anchor="${anchor}"${clipAttr(element)} opacity="${opacity}">${tspans}</text>`
        );
      }
      if (
        (type === 'line' || type === 'arrow' || type === 'path') &&
        'points' in element &&
        Array.isArray(element.points) &&
        element.points.length > 0
      ) {
        const world = worldPoints(element);
        if (world.length === 0) return '';
        const pathData = linearPathData(element, world);
        let markers = '';
        if (type === 'arrow') {
          const heads =
            'arrowHeads' in element && element.arrowHeads && typeof element.arrowHeads === 'object'
              ? (element.arrowHeads as { start?: string; end?: string })
              : {};
          const endType = heads.end ?? 'triangle';
          const startType = heads.start ?? 'none';
          const parts: string[] = [];
          if (endType !== 'none') {
            const marker = headMarker(element, 'end', endType, stroke, strokeWidth);
            if (marker) parts.push(marker);
          }
          if (startType !== 'none') {
            const marker = headMarker(element, 'start', startType, stroke, strokeWidth);
            if (marker) parts.push(marker);
          }
          if (parts.length > 0) markers = ` ${parts.join(' ')}`;
        }
        return rotateWrap(
          element,
          `<path d="${pathData}" stroke="${stroke}" fill="${
            type === 'line' ? 'none' : fill
          }" stroke-width="${strokeWidth}"${dashAttr(element, strokeWidth)}${markers}${clipAttr(element)} opacity="${opacity}" />`
        );
      }
      if (type === 'image' && 'src' in element && element.src) {
        const href = escapeXml(safeSvgUrl(element.src));
        return href
          ? rotateWrap(
              element,
              `<image x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" href="${href}"${clipAttr(element)} opacity="${opacity}" />`
            )
          : '';
      }
      // A frame is a real editor tool (`ExtraToolsDropdown`, shortcut F) and a
      // valid scene type, and `rough-renderer.ts` draws it as a plain rectangle.
      // Falling through to `return ''` dropped it, so a user who drew a frame and
      // exported to SVG got a file with a hole where it was. Emitted the same way
      // the renderer draws it rather than invented from scratch.
      if (type === 'frame') {
        const padding =
          'padding' in element && typeof element.padding === 'number' ? element.padding : 20;
        const title = 'title' in element && typeof element.title === 'string' ? element.title : '';
        const inner = `<rect x="${element.x + padding}" y="${element.y + padding}" width="${element.width - padding * 2}" height="${element.height - padding * 2}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-dasharray="5 5" opacity="${opacity}" />`;
        const label = title
          ? `<text x="${element.x + 10}" y="${element.y - 10}" fill="${stroke}" font-size="14" font-family="${escapeXml(canvasFontFamily(undefined))}" opacity="${opacity}">${escapeXml(title)}</text>`
          : '';
        return rotateWrap(
          element,
          `<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="0" stroke="${stroke}" fill="${fill}" stroke-width="${strokeWidth}" opacity="${opacity}" />${inner}${label}`
        );
      }
      // An embed is an iframe, which a static SVG cannot express. It does carry a
      // `cachedPreview` image, though, so when the client captured one the export
      // shows what the user was looking at instead of nothing. With no preview
      // there is nothing faithful to emit and it is still dropped -- an iframe in
      // an SVG would be neither valid nor safe.
      if (type === 'embed') {
        const preview =
          'cachedPreview' in element && typeof element.cachedPreview === 'string'
            ? element.cachedPreview
            : undefined;
        const href = preview ? escapeXml(safeSvgUrl(preview)) : '';
        return href
          ? rotateWrap(
              element,
              `<image x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" href="${href}"${clipAttr(element)} opacity="${opacity}" />`
            )
          : '';
      }
      return '';
    })
    .filter(Boolean)
    .join('');

  const viewWidth = bounds.width + padding * 2;
  const viewHeight = bounds.height + padding * 2;
  const allDefs = [...clipDefs, ...defs];
  const defsBlock = allDefs.length > 0 ? `<defs>${allDefs.join('')}</defs>` : '';
  // The background rect comes after defs and before the scene, so it cannot
  // cover any element. It is emitted only when the caller resolved one; an SVG
  // without the option stays transparent, which is what clipboard/slides want.
  const background = options.background;
  const backgroundBlock = background
    ? `<rect x="${originX}" y="${originY}" width="${viewWidth}" height="${viewHeight}" fill="${escapeXml(
        safeSvgPaint(background, '#ffffff')
      )}" />`
    : '';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${originX} ${originY} ${viewWidth} ${viewHeight}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet">${defsBlock}${backgroundBlock}${body}</svg>`;

  return new Blob([svg], { type: 'image/svg+xml' });
}
