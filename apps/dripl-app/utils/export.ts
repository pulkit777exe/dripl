import { v4 as uuidv4 } from 'uuid';
import { ElementSchema, MAX_SCENE_ELEMENTS, type DriplElement } from '@dripl/common';
import { getElementBounds } from '@dripl/math/intersection';
import { renderInteractiveScene } from '@/renderer/interactiveScene';
import { getDefaultFontFamily } from '@/utils/fontPreferences';
import { createCanvas } from './canvas-helpers';

const EXCALIDRAW_SCHEMA_VERSION = 2;
const MAX_IMPORT_ELEMENTS = MAX_SCENE_ELEMENTS;

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePoints(value: unknown, minimum: number): Array<{ x: number; y: number }> | null {
  if (!Array.isArray(value) || value.length < minimum || value.length > 20_000) return null;
  const points: Array<{ x: number; y: number }> = [];
  for (const point of value) {
    const x = Array.isArray(point) ? point[0] : isJsonRecord(point) ? point.x : undefined;
    const y = Array.isArray(point) ? point[1] : isJsonRecord(point) ? point.y : undefined;
    const px = finiteNumber(x, Number.NaN);
    const py = finiteNumber(y, Number.NaN);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    points.push({ x: px, y: py });
  }
  return points;
}

function isSafeImageSource(value: string): boolean {
  if (value.startsWith('/')) return !value.startsWith('//');
  if (value.startsWith('data:')) return /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(value);
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function normalizeBinding(value: unknown): JsonRecord | undefined {
  if (!isJsonRecord(value) || typeof value.elementId !== 'string') return undefined;
  const rawFixedPoint = value.fixedPoint;
  const fixedPoint = Array.isArray(rawFixedPoint)
    ? { x: finiteNumber(rawFixedPoint[0], 0), y: finiteNumber(rawFixedPoint[1], 0) }
    : isJsonRecord(rawFixedPoint)
      ? { x: finiteNumber(rawFixedPoint.x, 0), y: finiteNumber(rawFixedPoint.y, 0) }
      : { x: 0, y: 0 };
  return {
    elementId: value.elementId,
    fixedPoint,
    mode: value.mode === 'orbit' ? 'orbit' : 'inside',
  };
}

function normalizeImportedElement(value: unknown, files: JsonRecord): DriplElement | null {
  if (!isJsonRecord(value)) return null;
  const rawType = typeof value.type === 'string' ? value.type : 'rectangle';
  const type = rawType === 'embeddable' ? 'embed' : rawType === 'magicframe' ? 'frame' : rawType;
  if (
    ![
      'rectangle',
      'ellipse',
      'diamond',
      'line',
      'arrow',
      'freedraw',
      'text',
      'image',
      'frame',
      'embed',
      'path',
    ].includes(type)
  ) {
    return null;
  }

  const id = typeof value.id === 'string' && value.id.length > 0 ? value.id : uuidv4();
  const x = finiteNumber(value.x, 0);
  const y = finiteNumber(value.y, 0);
  const width = Math.max(
    0,
    finiteNumber(value.width, type === 'line' || type === 'arrow' ? 1 : 100)
  );
  const height = Math.max(
    0,
    finiteNumber(value.height, type === 'line' || type === 'arrow' ? 1 : 100)
  );
  const points = normalizePoints(value.points, type === 'freedraw' || type === 'path' ? 1 : 2);
  const normalized: JsonRecord = {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: finiteNumber(value.angle, 0),
    strokeColor: typeof value.strokeColor === 'string' ? value.strokeColor : '#1e1e1e',
    backgroundColor:
      typeof value.backgroundColor === 'string' ? value.backgroundColor : 'transparent',
    fillColor:
      typeof value.fillColor === 'string'
        ? value.fillColor
        : typeof value.backgroundColor === 'string'
          ? value.backgroundColor
          : 'transparent',
    strokeWidth: finiteNumber(value.strokeWidth, 2),
    strokeStyle:
      value.strokeStyle === 'dashed' || value.strokeStyle === 'dotted'
        ? value.strokeStyle
        : 'solid',
    roughness: finiteNumber(value.roughness, 1),
    opacity: finiteNumber(value.opacity, 1),
    locked: value.locked === true,
    isDeleted: value.isDeleted === true,
    version: Number.isInteger(value.version) && (value.version as number) >= 0 ? value.version : 1,
    versionNonce:
      Number.isInteger(value.versionNonce) && (value.versionNonce as number) >= 0
        ? value.versionNonce
        : 0,
    updatedAt: Date.now(),
  };

  if (typeof value.fractionalIndex === 'string') normalized.fractionalIndex = value.fractionalIndex;
  else if (typeof value.index === 'string') normalized.fractionalIndex = value.index;
  if (typeof value.groupId === 'string') normalized.groupId = value.groupId;
  else if (Array.isArray(value.groupIds) && typeof value.groupIds[0] === 'string')
    normalized.groupId = value.groupIds[0];
  if (typeof value.frameId === 'string') normalized.containerId = value.frameId;
  if (Array.isArray(value.boundElements)) {
    const boundElements = value.boundElements.flatMap(bound => {
      if (!isJsonRecord(bound) || typeof bound.id !== 'string') return [];
      if (bound.type !== 'arrow' && bound.type !== 'text') return [];
      return [{ id: bound.id, type: bound.type }];
    });
    if (boundElements.length > 0) normalized.boundElements = boundElements;
  }
  if (typeof value.seed === 'number') normalized.seed = value.seed;

  if (type === 'line' || type === 'arrow' || type === 'freedraw' || type === 'path') {
    if (!points) return null;
    normalized.points = points;
  }
  if (type === 'arrow' || type === 'line') {
    if (
      value.arrowStyle === 'curved' ||
      value.arrowStyle === 'elbow' ||
      value.arrowStyle === 'straight'
    ) {
      normalized.arrowStyle = value.arrowStyle;
    } else if (value.elbowed === true) {
      normalized.arrowStyle = 'elbow';
    }
    if (isJsonRecord(value.arrowHeads)) normalized.arrowHeads = value.arrowHeads;
    else if (typeof value.startArrowhead === 'string' || typeof value.endArrowhead === 'string') {
      normalized.arrowHeads = {
        ...(typeof value.startArrowhead === 'string' ? { start: value.startArrowhead } : {}),
        ...(typeof value.endArrowhead === 'string' ? { end: value.endArrowhead } : {}),
      };
    }
    const startBinding = normalizeBinding(value.startBinding);
    const endBinding = normalizeBinding(value.endBinding);
    if (startBinding) normalized.startBinding = startBinding;
    if (endBinding) normalized.endBinding = endBinding;
  }
  if (type === 'text') {
    normalized.text = typeof value.text === 'string' ? value.text : '';
    normalized.originalText =
      typeof value.originalText === 'string' ? value.originalText : normalized.text;
    normalized.fontSize = Math.max(1, finiteNumber(value.fontSize, 20));
    normalized.fontFamily = typeof value.fontFamily === 'string' ? value.fontFamily : 'Caveat';
    normalized.textAlign =
      value.textAlign === 'center' || value.textAlign === 'right' ? value.textAlign : 'left';
    normalized.verticalAlign =
      value.verticalAlign === 'top' || value.verticalAlign === 'bottom'
        ? value.verticalAlign
        : 'middle';
    if (typeof value.containerId === 'string') normalized.containerId = value.containerId;
  }
  if (type === 'image') {
    const fileId = typeof value.fileId === 'string' ? value.fileId : null;
    const file = fileId && isJsonRecord(files[fileId]) ? files[fileId] : null;
    const src =
      typeof value.src === 'string'
        ? value.src
        : typeof value.dataUrl === 'string'
          ? value.dataUrl
          : typeof value.dataURL === 'string'
            ? value.dataURL
            : file && typeof file.dataURL === 'string'
              ? file.dataURL
              : file && typeof file.dataUrl === 'string'
                ? file.dataUrl
                : undefined;
    if (src && isSafeImageSource(src)) {
      normalized.src = src;
      if (!normalized.dataUrl && src.startsWith('data:')) normalized.dataUrl = src;
    } else {
      return null;
    }
  }
  if (type === 'embed') {
    const url =
      typeof value.url === 'string' ? value.url : typeof value.link === 'string' ? value.link : '';
    if (!url || !isSafeHttpUrl(url)) return null;
    normalized.url = url;
    if (typeof value.title === 'string') normalized.title = value.title;
  }
  if (type === 'frame' && typeof value.name === 'string') normalized.title = value.name;

  const parsed = ElementSchema.safeParse(normalized);
  return parsed.success ? (parsed.data as DriplElement) : null;
}

function remapElementReferences(element: DriplElement, ids: Map<string, string>): DriplElement {
  const next = { ...element } as DriplElement & {
    startBinding?: { elementId: string };
    endBinding?: { elementId: string };
  };
  const remap = (id: unknown): unknown => (typeof id === 'string' ? (ids.get(id) ?? id) : id);
  next.groupId = remap(next.groupId) as string | undefined;
  next.labelId = remap(next.labelId) as string | undefined;
  next.containerId = remap(next.containerId) as string | undefined;
  next.boundElementId = remap(next.boundElementId) as string | undefined;
  if (next.startBinding)
    next.startBinding = {
      ...next.startBinding,
      elementId: String(remap(next.startBinding.elementId)),
    };
  if (next.endBinding)
    next.endBinding = { ...next.endBinding, elementId: String(remap(next.endBinding.elementId)) };
  if (next.boundElements) {
    next.boundElements = next.boundElements.map(bound => ({
      ...bound,
      id: String(remap(bound.id)),
    }));
  }
  return next;
}

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

function safeSvgUrl(value: string): string {
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (/^https:\/\//i.test(value)) return value;
  if (/^data:image\/(?:png|jpeg|jpg|gif|webp);base64,/i.test(value)) return value;
  return '';
}

function safeSvgPaint(value: string, fallback: string): string {
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

function toExcalidrawBinding(value: unknown, includeFixedPoint = false): JsonRecord | null {
  if (!isJsonRecord(value) || typeof value.elementId !== 'string') return null;
  const binding: JsonRecord = {
    elementId: value.elementId,
    focus: typeof value.focus === 'number' ? value.focus : 0,
    gap: typeof value.gap === 'number' ? value.gap : 1,
  };
  if (includeFixedPoint && isJsonRecord(value.fixedPoint)) {
    binding.fixedPoint = [finiteNumber(value.fixedPoint.x, 0), finiteNumber(value.fixedPoint.y, 0)];
  } else if (includeFixedPoint && Array.isArray(value.fixedPoint) && value.fixedPoint.length >= 2) {
    binding.fixedPoint = [
      finiteNumber(value.fixedPoint[0], 0),
      finiteNumber(value.fixedPoint[1], 0),
    ];
  }
  return binding;
}

function toExcalidrawArrowhead(value: unknown): string | null {
  if (value === 'none' || value === null || value === undefined) return null;
  if (value === 'triangle') return 'arrow';
  if (value === 'bar' || value === 'dot' || value === 'diamond') return value;
  return null;
}

function toExcalidrawElement(element: DriplElement): JsonRecord {
  const source = element as unknown as JsonRecord;
  /* eslint-disable @typescript-eslint/no-unused-vars -- rotation/flips/zIndex
     are destructured out to exclude them from the Excalidraw export below */
  const {
    fractionalIndex,
    groupId,
    containerId,
    rotation,
    flipHorizontal,
    flipVertical,
    zIndex,
    points,
    arrowHeads,
    arrowStyle,
    startBinding,
    endBinding,
    ...base
  } = source;
  /* eslint-enable @typescript-eslint/no-unused-vars */
  const exported: JsonRecord = {
    ...base,
    id: element.id,
    type: element.type === 'embed' ? 'embeddable' : element.type,
    index: typeof fractionalIndex === 'string' ? fractionalIndex : null,
    groupIds: typeof groupId === 'string' && groupId ? [groupId] : [],
    frameId: typeof containerId === 'string' && containerId ? containerId : null,
    boundElements: Array.isArray(element.boundElements)
      ? element.boundElements.map(bound => ({ id: bound.id, type: bound.type }))
      : null,
    link: typeof source.link === 'string' && isSafeHttpUrl(source.link) ? source.link : null,
    roundness: null,
    updated: typeof source.updated === 'number' ? source.updated : Date.now(),
  };

  if (element.type === 'line' || element.type === 'arrow') {
    exported.points = Array.isArray(points)
      ? points.map(point => {
          const record = isJsonRecord(point) ? point : {};
          return [finiteNumber(record.x, 0), finiteNumber(record.y, 0)];
        })
      : [];
    exported.startBinding = toExcalidrawBinding(startBinding, arrowStyle === 'elbow');
    exported.endBinding = toExcalidrawBinding(endBinding, arrowStyle === 'elbow');
    const heads = isJsonRecord(arrowHeads) ? arrowHeads : {};
    exported.startArrowhead = toExcalidrawArrowhead(heads.start);
    exported.endArrowhead = toExcalidrawArrowhead(heads.end);
    exported.lastCommittedPoint = null;
    if (element.type === 'arrow') {
      exported.elbowed = arrowStyle === 'elbow';
      exported.fixedSegments = null;
      exported.startIsSpecial = null;
      exported.endIsSpecial = null;
    }
  }

  if (element.type === 'text') {
    exported.containerId = typeof containerId === 'string' && containerId ? containerId : null;
    exported.originalText =
      typeof source.originalText === 'string' ? source.originalText : element.text;
    exported.autoResize = true;
    exported.lineHeight = finiteNumber(source.lineHeight, 1.25);
  }

  if (element.type === 'image') {
    // Excalidraw references binary files by their stable element/file id, not
    // by the data URL or transport URL itself. The files map below carries
    // embedded data URLs; remote sources remain a safe link rather than a
    // fabricated inline file.
    exported.fileId = element.id;
    exported.status = 'saved';
    exported.scale = [1, 1];
    exported.crop = null;
  }

  if (element.type === 'embed') {
    const embedUrl = typeof source.url === 'string' ? source.url : source.link;
    if (typeof embedUrl === 'string' && isSafeHttpUrl(embedUrl)) {
      exported.link = embedUrl;
    }
  }

  if (element.type === 'frame') {
    exported.name = typeof source.title === 'string' ? source.title : null;
  }

  return exported;
}

export function exportToJson(elements: DriplElement[]): Blob {
  return new Blob([JSON.stringify(elements, null, 2)], {
    type: 'application/json',
  });
}

/** Export a native, editable Excalidraw scene document. */
export function exportToExcalidraw(
  elements: DriplElement[],
  appState: Record<string, unknown> = {}
): Blob {
  const document = {
    type: 'excalidraw',
    version: EXCALIDRAW_SCHEMA_VERSION,
    source: 'dripl',
    elements: elements.map(toExcalidrawElement),
    appState,
    files: Object.fromEntries(
      elements.flatMap(element => {
        const src =
          element.type === 'image' && typeof (element as { src?: unknown }).src === 'string'
            ? (element as { src: string }).src
            : '';
        if (!src.startsWith('data:')) return [];
        return [
          [
            element.id,
            {
              mimeType: src.startsWith('data:image/png')
                ? 'image/png'
                : src.startsWith('data:image/jpeg')
                  ? 'image/jpeg'
                  : src.startsWith('data:image/gif')
                    ? 'image/gif'
                    : 'image/webp',
              id: element.id,
              dataURL: src,
              created: Date.now(),
            },
          ],
        ];
      })
    ),
  };
  return new Blob([JSON.stringify(document, null, 2)], {
    type: 'application/json',
  });
}

export function exportCanvas(
  format: 'png' | 'svg' | 'json' | 'excalidraw',
  elements: DriplElement[],
  options?: {
    scale?: number;
    background?: string;
    padding?: number;
    customWidth?: number;
    customHeight?: number;
    appState?: Record<string, unknown>;
  }
): Promise<Blob> | Blob {
  if (format === 'png') {
    return exportToPng(elements, options);
  }
  if (format === 'svg') {
    return exportToSvg(elements, options);
  }
  if (format === 'excalidraw') {
    return exportToExcalidraw(elements, options?.appState);
  }
  return exportToJson(elements);
}

export function importFromJson(
  raw: string,
  currentElements: DriplElement[],
  mode: 'merge' | 'replace' = 'merge'
): DriplElement[] {
  if (raw.length > 5_000_000) throw new Error('Scene file is too large');
  const parsed = JSON.parse(raw) as unknown;
  const sourceElements = Array.isArray(parsed)
    ? parsed
    : isJsonRecord(parsed) && Array.isArray(parsed.elements)
      ? parsed.elements
      : [];
  const files = isJsonRecord(parsed) && isJsonRecord(parsed.files) ? parsed.files : {};
  const seenImportIds = new Set<string>();
  const normalized = sourceElements
    .slice(0, MAX_IMPORT_ELEMENTS)
    .map(element => normalizeImportedElement(element, files))
    .filter((element): element is DriplElement => {
      if (!element || seenImportIds.has(element.id)) return false;
      seenImportIds.add(element.id);
      return true;
    });

  if (normalized.length === 0) {
    throw new Error('No valid elements found in the selected file');
  }

  if (mode === 'replace') {
    return normalized;
  }

  const ids = new Map<string, string>();
  const merged = normalized.map(element => {
    const id = uuidv4();
    ids.set(element.id, id);
    return remapElementReferences({ ...element, id, updated: Date.now() }, ids);
  });

  // Resolve references after all IDs are known. This keeps arrows, labels,
  // groups, and bound shapes connected when a file is merged into a scene.
  const fullyRemapped = merged.map(element => remapElementReferences(element, ids));
  if (currentElements.length + fullyRemapped.length > MAX_IMPORT_ELEMENTS) {
    throw new Error('Merged scene would exceed the supported element limit');
  }
  return [...currentElements, ...fullyRemapped];
}

export { downloadBlob } from './canvas-helpers';
