import type { DriplElement, Point } from '@dripl/common';
import { getElementBounds } from '@dripl/math';

export interface SceneViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

export interface MarqueeSelection {
  start: Point;
  end: Point;
  active: boolean;
}

export interface CollaboratorCursor {
  userId: string;
  displayName: string;
  color: string;
  x: number;
  y: number;
  updatedAt: number;
}

export interface RenderSceneOptions {
  ctx: CanvasRenderingContext2D;
  viewport: SceneViewport;
  canvasWidth: number;
  canvasHeight: number;
  elements: readonly DriplElement[];
  draftElement?: DriplElement | null;
  eraserPath?: readonly Point[];
  selectedIds?: ReadonlySet<string>;
  marqueeSelection?: MarqueeSelection | null;
  collaborators?: readonly CollaboratorCursor[];
  gridEnabled?: boolean;
  gridSize?: number;
  theme?: 'light' | 'dark';
  lockOwners?: ReadonlyMap<string, string>;
  localUserId?: string | null;
  renderCommittedElements?: boolean;
  dpr?: number;
  clearCanvas?: boolean;
}

interface TextMeasurement {
  width: number;
  lineWidths: number[];
  lineHeight: number;
}

const textMetricsCache = new Map<string, TextMeasurement>();
const imageCache = new Map<string, HTMLImageElement>();

const HANDLE_SIZE_PX = 8;
const MARQUEE_DASH = [6, 4];
const DEFAULT_GRID_SIZE = 20;
const MIN_GRID_ZOOM = 0.3;
const HIT_CULL_PADDING = 20;

function getStrokeColor(element: DriplElement): string {
  return element.strokeColor ?? '#000000';
}

function getFillColor(element: DriplElement): string {
  if ('fillColor' in element && typeof element.fillColor === 'string') {
    return element.fillColor;
  }
  return element.backgroundColor ?? 'transparent';
}

function getStrokeWidth(element: DriplElement): number {
  return Math.max(0.5, element.strokeWidth ?? 2);
}

function getOpacity(element: DriplElement): number {
  return Math.max(0, Math.min(1, element.opacity ?? 1));
}

function getRoughness(element: DriplElement): number {
  const roughness =
    'roughness' in element && typeof element.roughness === 'number' ? element.roughness : 1;
  return Math.max(0, Math.min(2, roughness));
}

function getPathPoints(element: DriplElement): Point[] {
  if (!('points' in element) || !Array.isArray(element.points)) {
    return [];
  }

  return element.points
    .filter(
      (point): point is Point =>
        Boolean(point) && typeof point.x === 'number' && typeof point.y === 'number'
    )
    .map(point => ({
      x: point.x + element.x,
      y: point.y + element.y,
    }));
}

function isElementVisible(
  element: DriplElement,
  viewport: SceneViewport,
  canvasWidth: number,
  canvasHeight: number
): boolean {
  const worldLeft = -viewport.x / viewport.zoom - HIT_CULL_PADDING;
  const worldTop = -viewport.y / viewport.zoom - HIT_CULL_PADDING;
  const worldRight = worldLeft + canvasWidth / viewport.zoom + HIT_CULL_PADDING * 2;
  const worldBottom = worldTop + canvasHeight / viewport.zoom + HIT_CULL_PADDING * 2;

  const bounds = getElementBounds(element);
  const elementRight = bounds.x + bounds.width;
  const elementBottom = bounds.y + bounds.height;

  return !(
    elementRight < worldLeft ||
    bounds.x > worldRight ||
    elementBottom < worldTop ||
    bounds.y > worldBottom
  );
}

function applyStrokeAndFill(ctx: CanvasRenderingContext2D, element: DriplElement) {
  ctx.strokeStyle = getStrokeColor(element);
  ctx.fillStyle = getFillColor(element);
  ctx.lineWidth = getStrokeWidth(element);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function getRoughPasses(element: DriplElement): number {
  const roughness = getRoughness(element);
  if (roughness <= 0.1) return 1;
  return Math.min(5, 1 + Math.round(roughness * 2));
}

function roughJitterOffset(pass: number, zoom: number): number {
  if (pass === 0) return 0;
  const amplitude = 0.7 / Math.max(zoom, 0.1);
  return ((pass % 2 === 0 ? 1 : -1) * amplitude * pass) / 2;
}

function strokeCurrentPath(
  ctx: CanvasRenderingContext2D,
  element: DriplElement,
  drawPath: (offsetX: number, offsetY: number) => void,
  zoom: number
): void {
  const passes = getRoughPasses(element);
  for (let pass = 0; pass < passes; pass += 1) {
    const offset = roughJitterOffset(pass, zoom);
    ctx.beginPath();
    drawPath(offset, -offset);
    ctx.stroke();
  }
}

function rotateAroundElementCenter(ctx: CanvasRenderingContext2D, element: DriplElement) {
  const angle = element.angle ?? 0;
  if (!angle) return;
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  ctx.translate(centerX, centerY);
  ctx.rotate(angle);
  ctx.translate(-centerX, -centerY);
}

function renderRectangle(ctx: CanvasRenderingContext2D, element: DriplElement, zoom: number) {
  const fillColor = getFillColor(element);
  const drawPath = (offsetX: number, offsetY: number) => {
    ctx.rect(element.x + offsetX, element.y + offsetY, element.width, element.height);
  };

  if (fillColor !== 'transparent') {
    ctx.beginPath();
    drawPath(0, 0);
    ctx.fill();
  }
  strokeCurrentPath(ctx, element, drawPath, zoom);
}

function renderEllipse(ctx: CanvasRenderingContext2D, element: DriplElement, zoom: number) {
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  const radiusX = Math.abs(element.width / 2);
  const radiusY = Math.abs(element.height / 2);
  const fillColor = getFillColor(element);

  const drawPath = (offsetX: number, offsetY: number) => {
    ctx.ellipse(centerX + offsetX, centerY + offsetY, radiusX, radiusY, 0, 0, Math.PI * 2);
  };

  if (fillColor !== 'transparent') {
    ctx.beginPath();
    drawPath(0, 0);
    ctx.fill();
  }
  strokeCurrentPath(ctx, element, drawPath, zoom);
}

function renderDiamond(ctx: CanvasRenderingContext2D, element: DriplElement, zoom: number) {
  const midX = element.x + element.width / 2;
  const midY = element.y + element.height / 2;
  const fillColor = getFillColor(element);

  const drawPath = (offsetX: number, offsetY: number) => {
    ctx.moveTo(midX + offsetX, element.y + offsetY);
    ctx.lineTo(element.x + element.width + offsetX, midY + offsetY);
    ctx.lineTo(midX + offsetX, element.y + element.height + offsetY);
    ctx.lineTo(element.x + offsetX, midY + offsetY);
    ctx.closePath();
  };

  if (fillColor !== 'transparent') {
    ctx.beginPath();
    drawPath(0, 0);
    ctx.fill();
  }
  strokeCurrentPath(ctx, element, drawPath, zoom);
}

function renderPathLike(ctx: CanvasRenderingContext2D, element: DriplElement, zoom: number) {
  const points = getPathPoints(element);
  if (points.length === 0) return;
  const fillColor = getFillColor(element);

  const drawPath = (offsetX: number, offsetY: number) => {
    const first = points[0];
    if (!first) return;
    ctx.moveTo(first.x + offsetX, first.y + offsetY);
    for (let i = 1; i < points.length; i += 1) {
      const point = points[i];
      if (!point) continue;
      ctx.lineTo(point.x + offsetX, point.y + offsetY);
    }
  };

  if (fillColor !== 'transparent' && points.length > 2 && element.type !== 'line') {
    ctx.beginPath();
    drawPath(0, 0);
    ctx.closePath();
    ctx.fill();
  }

  strokeCurrentPath(ctx, element, drawPath, zoom);

  if (element.type === 'arrow' && points.length > 1) {
    const end = points[points.length - 1];
    const prev = points[points.length - 2];
    if (!end || !prev) return;

    const angle = Math.atan2(end.y - prev.y, end.x - prev.x);
    const headLength = 12;
    const spread = (25 * Math.PI) / 180;

    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(
      end.x - headLength * Math.cos(angle - spread),
      end.y - headLength * Math.sin(angle - spread)
    );
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(
      end.x - headLength * Math.cos(angle + spread),
      end.y - headLength * Math.sin(angle + spread)
    );
    ctx.stroke();
  }
}

function renderText(ctx: CanvasRenderingContext2D, element: DriplElement) {
  const text = 'text' in element && typeof element.text === 'string' ? element.text : '';
  if (!text) return;
  const fontSize =
    'fontSize' in element && typeof element.fontSize === 'number' ? element.fontSize : 20;
  const fontFamily =
    'fontFamily' in element && typeof element.fontFamily === 'string'
      ? element.fontFamily
      : '"Comic Sans MS", "Chalkboard SE", "Marker Felt", "Comic Neue", cursive';
  const textAlign =
    'textAlign' in element &&
    (element.textAlign === 'left' ||
      element.textAlign === 'center' ||
      element.textAlign === 'right')
      ? element.textAlign
      : 'left';
  const lineHeight = fontSize * 1.25;
  const lines = text.split('\n');
  const cacheKey = `${text}|${fontFamily}|${fontSize}|${textAlign}`;
  let metrics = textMetricsCache.get(cacheKey);

  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textAlign = textAlign;
  ctx.textBaseline = 'top';
  ctx.fillStyle = getStrokeColor(element);

  if (!metrics) {
    const lineWidths = lines.map(line => ctx.measureText(line).width);
    metrics = {
      width: Math.max(0, ...lineWidths),
      lineWidths,
      lineHeight,
    };
    textMetricsCache.set(cacheKey, metrics);
  }

  const anchorX =
    textAlign === 'left'
      ? element.x
      : textAlign === 'center'
        ? element.x + element.width / 2
        : element.x + element.width;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    ctx.fillText(line, anchorX, element.y + i * metrics.lineHeight);
  }
}

function renderImage(ctx: CanvasRenderingContext2D, element: DriplElement) {
  if (!('src' in element) || typeof element.src !== 'string' || !element.src) {
    return;
  }
  let image = imageCache.get(element.src);
  if (!image) {
    image = new Image();
    image.src = element.src;
    imageCache.set(element.src, image);
  }
  if (image.complete && image.naturalWidth > 0) {
    ctx.drawImage(image, element.x, element.y, element.width, element.height);
    return;
  }

  ctx.fillStyle = 'rgba(127,127,127,0.2)';
  ctx.fillRect(element.x, element.y, element.width, element.height);
}

function renderElement(ctx: CanvasRenderingContext2D, element: DriplElement, zoom: number) {
  if (element.isDeleted) return;
  const type = element.type as string;
  ctx.save();
  ctx.globalAlpha = getOpacity(element);
  applyStrokeAndFill(ctx, element);
  rotateAroundElementCenter(ctx, element);

  if (type === 'line' || type === 'arrow' || type === 'freedraw' || type === 'path') {
    renderPathLike(ctx, element, zoom);
  } else if (type === 'rectangle') {
    renderRectangle(ctx, element, zoom);
  } else if (type === 'diamond') {
    renderDiamond(ctx, element, zoom);
  } else if (type === 'ellipse') {
    renderEllipse(ctx, element, zoom);
  } else if (type === 'text') {
    renderText(ctx, element);
  } else if (type === 'image') {
    renderImage(ctx, element);
  } else {
    renderRectangle(ctx, element, zoom);
  }

  ctx.restore();
}

function drawGridDots(
  ctx: CanvasRenderingContext2D,
  viewport: SceneViewport,
  canvasWidth: number,
  canvasHeight: number,
  theme: 'light' | 'dark',
  gridSize: number
) {
  if (viewport.zoom < MIN_GRID_ZOOM) return;

  const worldLeft = -viewport.x / viewport.zoom;
  const worldTop = -viewport.y / viewport.zoom;
  const worldRight = worldLeft + canvasWidth / viewport.zoom;
  const worldBottom = worldTop + canvasHeight / viewport.zoom;
  const startX = Math.floor(worldLeft / gridSize) * gridSize;
  const startY = Math.floor(worldTop / gridSize) * gridSize;
  const radius = Math.max(0.8 / viewport.zoom, 0.35);

  ctx.save();
  ctx.fillStyle = theme === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.16)';

  for (let x = startX; x <= worldRight; x += gridSize) {
    for (let y = startY; y <= worldBottom; y += gridSize) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function worldToScreen(point: Point, viewport: SceneViewport): Point {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  };
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  elements: readonly DriplElement[],
  selectedIds: ReadonlySet<string>,
  viewport: SceneViewport
) {
  if (selectedIds.size === 0) return;

  const selected = elements.filter(element => selectedIds.has(element.id));
  if (selected.length === 0) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  selected.forEach(element => {
    const bounds = getElementBounds(element);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  });

  const topLeft = worldToScreen({ x: minX, y: minY }, viewport);
  const bottomRight = worldToScreen({ x: maxX, y: maxY }, viewport);
  const width = bottomRight.x - topLeft.x;
  const height = bottomRight.y - topLeft.y;

  ctx.save();
  ctx.strokeStyle = '#6965db';
  ctx.lineWidth = 1.5;
  ctx.setLineDash(MARQUEE_DASH);
  ctx.strokeRect(topLeft.x, topLeft.y, width, height);
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#6965db';
  ctx.lineWidth = 1.2;

  const handleCoords: Point[] = [
    { x: topLeft.x, y: topLeft.y },
    { x: topLeft.x + width / 2, y: topLeft.y },
    { x: topLeft.x + width, y: topLeft.y },
    { x: topLeft.x + width, y: topLeft.y + height / 2 },
    { x: topLeft.x + width, y: topLeft.y + height },
    { x: topLeft.x + width / 2, y: topLeft.y + height },
    { x: topLeft.x, y: topLeft.y + height },
    { x: topLeft.x, y: topLeft.y + height / 2 },
  ];

  for (const handle of handleCoords) {
    ctx.beginPath();
    ctx.rect(
      handle.x - HANDLE_SIZE_PX / 2,
      handle.y - HANDLE_SIZE_PX / 2,
      HANDLE_SIZE_PX,
      HANDLE_SIZE_PX
    );
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function drawMarquee(
  ctx: CanvasRenderingContext2D,
  marqueeSelection: MarqueeSelection,
  viewport: SceneViewport
) {
  if (!marqueeSelection.active) return;
  const start = worldToScreen(marqueeSelection.start, viewport);
  const end = worldToScreen(marqueeSelection.end, viewport);
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  ctx.save();
  ctx.fillStyle = 'rgba(105,101,219,0.12)';
  ctx.strokeStyle = '#6965db';
  ctx.lineWidth = 1.2;
  ctx.setLineDash(MARQUEE_DASH);
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
}

function drawCollaborators(
  ctx: CanvasRenderingContext2D,
  collaborators: readonly CollaboratorCursor[],
  viewport: SceneViewport
) {
  const now = Date.now();
  collaborators.forEach(collaborator => {
    const screen = worldToScreen({ x: collaborator.x, y: collaborator.y }, viewport);
    const age = now - collaborator.updatedAt;
    const alpha = age <= 5000 ? 1 : Math.max(0, 1 - (age - 5000) / 5000);
    if (alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(screen.x, screen.y);
    ctx.fillStyle = collaborator.color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 16);
    ctx.lineTo(5, 12);
    ctx.lineTo(10, 20);
    ctx.lineTo(12, 19);
    ctx.lineTo(7, 11);
    ctx.lineTo(14, 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    const labelX = screen.x + 12;
    const labelY = screen.y + 12;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '12px sans-serif';
    const text = collaborator.displayName;
    const textWidth = ctx.measureText(text).width;
    const chipWidth = textWidth + 22;
    const chipHeight = 20;
    ctx.fillStyle = 'rgba(15,15,15,0.86)';
    ctx.beginPath();
    ctx.roundRect(labelX, labelY, chipWidth, chipHeight, 10);
    ctx.fill();
    ctx.fillStyle = collaborator.color;
    ctx.beginPath();
    ctx.arc(labelX + 9, labelY + chipHeight / 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, labelX + 15, labelY + chipHeight / 2);
    ctx.restore();
  });
}

function drawLockOverlays(
  ctx: CanvasRenderingContext2D,
  elements: readonly DriplElement[],
  lockOwners: ReadonlyMap<string, string>,
  localUserId: string | null
) {
  elements.forEach(element => {
    const owner = lockOwners.get(element.id);
    if (!owner || owner === localUserId) return;

    const bounds = getElementBounds(element);
    ctx.save();
    ctx.fillStyle = 'rgba(60, 60, 60, 0.13)';
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.fillStyle = 'rgba(40, 40, 40, 0.65)';
    const iconX = bounds.x + bounds.width - 16;
    const iconY = bounds.y + 4;
    ctx.beginPath();
    ctx.roundRect(iconX, iconY + 5, 10, 8, 2);
    ctx.fill();
    ctx.beginPath();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(40, 40, 40, 0.65)';
    ctx.arc(iconX + 5, iconY + 5, 3, Math.PI, 0);
    ctx.stroke();
    ctx.restore();
  });
}

export function clearTextMeasurementCache() {
  textMetricsCache.clear();
  imageCache.clear();
}

export function renderInteractiveScene({
  ctx,
  viewport,
  canvasWidth,
  canvasHeight,
  elements,
  draftElement,
  selectedIds = new Set<string>(),
  eraserPath = [],
  marqueeSelection,
  collaborators = [],
  gridEnabled = false,
  gridSize = DEFAULT_GRID_SIZE,
  theme = 'dark',
  lockOwners = new Map<string, string>(),
  localUserId = null,
  renderCommittedElements = true,
  dpr = 1,
  clearCanvas = true,
}: RenderSceneOptions): void {
  if (clearCanvas) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasWidth * dpr, canvasHeight * dpr);
    ctx.restore();
  }

  ctx.save();
  ctx.setTransform(
    viewport.zoom * dpr,
    0,
    0,
    viewport.zoom * dpr,
    viewport.x * dpr,
    viewport.y * dpr
  );

  if (gridEnabled) {
    drawGridDots(ctx, viewport, canvasWidth, canvasHeight, theme, gridSize);
  }

  if (renderCommittedElements) {
    for (const element of elements) {
      if (!isElementVisible(element, viewport, canvasWidth, canvasHeight)) {
        continue;
      }
      renderElement(ctx, element, viewport.zoom);
    }
  }

  if (draftElement && !draftElement.isDeleted) {
    renderElement(ctx, draftElement, viewport.zoom);
  }

  if (eraserPath.length > 1) {
    const first = eraserPath[0];
    if (first) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 76, 76, 0.35)';
      ctx.lineWidth = 20 / Math.max(viewport.zoom, 0.1);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < eraserPath.length; i += 1) {
        const point = eraserPath[i];
        if (!point) continue;
        ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  if (lockOwners.size > 0) {
    drawLockOverlays(ctx, elements, lockOwners, localUserId);
  }

  ctx.restore();
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (marqueeSelection?.active) {
    drawMarquee(ctx, marqueeSelection, viewport);
  }

  drawSelection(ctx, elements, selectedIds, viewport);

  if (collaborators.length > 0) {
    drawCollaborators(ctx, collaborators, viewport);
  }
  ctx.restore();
}
