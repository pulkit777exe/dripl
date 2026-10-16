import type { ArrowheadType, DriplElement, LinearElement, Point } from '@dripl/common';
import { imageCache } from '@dripl/element/image-cache';
import { canvasFont, canvasFontFamily } from '@dripl/element/text';
import {
  createRoughCanvas,
  renderDraftElement,
  arrowEndpointGeometry,
  type RoughCanvas,
} from '@dripl/element/rough-renderer';
import { arrowHeadLength } from '@dripl/math/intersection';
import { getArrowheadPoints, getDirectionVector } from '@/utils/arrow-routing';
import {
  applyStrokeAndFill,
  getFillColor,
  getOpacity,
  getPathPoints,
  getStrokeColor,
  rotateAroundElementCenter,
  strokeCurrentPath,
} from './elementStyles';

/**
 * Element renderers — the interactive (draft) layer.
 *
 * Excalidraw parity note (`renderNewElementScene`): the in-progress element is
 * drawn with the SAME Rough.js generator, options and seed as the committed
 * bitmap, not with a look-alike. `renderDraftElement` in
 * `@dripl/element/rough-renderer` owns that path; the per-shape canvas code
 * below is the headless fallback (unit tests, SSR, or a context without a
 * canvas), kept so the dispatcher still draws something deterministic when
 * Rough.js cannot bind to a canvas.
 */

const roughCanvasByTarget = new WeakMap<object, RoughCanvas>();

function roughForContext(ctx: CanvasRenderingContext2D): RoughCanvas | null {
  const canvas = (ctx as unknown as { canvas?: object | null }).canvas;
  if (!canvas) return null;
  const cached = roughCanvasByTarget.get(canvas);
  if (cached) return cached;
  try {
    const rc = createRoughCanvas(canvas as HTMLCanvasElement);
    if (!rc) return null;
    roughCanvasByTarget.set(canvas, rc);
    return rc;
  } catch {
    return null;
  }
}

/** Rough.js draft when a canvas is available, legacy canvas path otherwise. */
function drawShapeDraft(
  ctx: CanvasRenderingContext2D,
  element: DriplElement,
  theme: 'light' | 'dark',
  legacy: () => void
): void {
  const rc = roughForContext(ctx);
  if (!rc) {
    legacy();
    return;
  }
  try {
    renderDraftElement(rc, ctx, element, undefined, theme);
  } catch {
    legacy();
  }
}

interface TextMeasurement {
  width: number;
  lineWidths: number[];
  lineHeight: number;
}

const textMetricsCache = new Map<string, TextMeasurement>();
const MAX_TEXT_CACHE_SIZE = 500;

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

  const drawSmoothFreedrawPath = (offsetX: number, offsetY: number) => {
    const first = points[0];
    if (!first) return;

    if (points.length === 1) {
      ctx.moveTo(first.x + offsetX, first.y + offsetY);
      ctx.lineTo(first.x + offsetX + 0.01, first.y + offsetY + 0.01);
      return;
    }

    if (points.length === 2) {
      const second = points[1];
      if (!second) return;
      ctx.moveTo(first.x + offsetX, first.y + offsetY);
      ctx.lineTo(second.x + offsetX, second.y + offsetY);
      return;
    }

    ctx.moveTo(first.x + offsetX, first.y + offsetY);
    for (let i = 1; i < points.length - 1; i += 1) {
      const current = points[i];
      const next = points[i + 1];
      if (!current || !next) continue;

      const midX = (current.x + next.x) / 2;
      const midY = (current.y + next.y) / 2;
      ctx.quadraticCurveTo(
        current.x + offsetX,
        current.y + offsetY,
        midX + offsetX,
        midY + offsetY
      );
    }

    const last = points[points.length - 1];
    if (last) {
      ctx.lineTo(last.x + offsetX, last.y + offsetY);
    }
  };

  const drawCurvedArrowPath = (offsetX: number, offsetY: number) => {
    if (points.length < 2) return;
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last) return;

    ctx.moveTo(first.x + offsetX, first.y + offsetY);

    // Calculate control point for quadratic bezier
    const midX = (first.x + last.x) / 2;
    const midY = (first.y + last.y) / 2;
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    // A zero-length chord has no direction to bow away from, and normalising by
    // it is 0/0. `calculateAngle` below already falls back to the straight
    // direction for that case; do the same here so the shaft and its arrowhead
    // agree, instead of the shaft emitting NaN coordinates — which canvas drops
    // silently, making the whole arrow disappear with no error anywhere.
    if (length === 0) {
      ctx.lineTo(last.x + offsetX, last.y + offsetY);
      return;
    }

    // Perpendicular offset for curvature. Factor matches the shared
    // `calculateCurvedPath(start, end, 0.5)` the Rough.js path uses
    // (length * curvature * 0.25) so the fallback draws the same bow.
    const offsetX2 = (-dy / length) * length * 0.5 * 0.25;
    const offsetY2 = (dx / length) * length * 0.5 * 0.25;
    const controlX = midX + offsetX2;
    const controlY = midY + offsetY2;

    ctx.quadraticCurveTo(
      controlX + offsetX,
      controlY + offsetY,
      last.x + offsetX,
      last.y + offsetY
    );
  };

  const drawElbowArrowPath = (offsetX: number, offsetY: number) => {
    if (points.length < 2) return;
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last) return;

    // Calculate elbow path (horizontal then vertical or vice versa)
    const dx = last.x - first.x;
    const dy = last.y - first.y;

    ctx.moveTo(first.x + offsetX, first.y + offsetY);

    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal then vertical
      ctx.lineTo(last.x + offsetX, first.y + offsetY);
      ctx.lineTo(last.x + offsetX, last.y + offsetY);
    } else {
      // Vertical then horizontal
      ctx.lineTo(first.x + offsetX, last.y + offsetY);
      ctx.lineTo(last.x + offsetX, last.y + offsetY);
    }
  };

  const drawPath = (offsetX: number, offsetY: number) => {
    const first = points[0];
    if (!first) return;

    if (element.type === 'freedraw') {
      drawSmoothFreedrawPath(offsetX, offsetY);
      return;
    }

    // Handle arrow styles
    if (element.type === 'arrow' && 'arrowStyle' in element) {
      const arrowElement = element as LinearElement;
      if (arrowElement.arrowStyle === 'curved') {
        drawCurvedArrowPath(offsetX, offsetY);
        return;
      }
      if (arrowElement.arrowStyle === 'elbow') {
        drawElbowArrowPath(offsetX, offsetY);
        return;
      }
    }

    // Default: straight line
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
    const arrowElement = element as LinearElement;
    const arrowHeads = arrowElement.arrowHeads ?? {
      start: 'none' as ArrowheadType,
      end: 'triangle' as ArrowheadType,
    };
    const headLength = arrowHeadLength(element.strokeWidth);
    const arrowStyle = arrowElement.arrowStyle;

    // Endpoint directions from the shared geometry helper — the same tangents
    // the Rough.js path uses, so heads sit identically in both layers.
    // (Falls back to segment direction if the helper ever declines.)
    const endpointGeometry = arrowEndpointGeometry(points, arrowStyle);
    const endAngle = (from: Point, to: Point): number =>
      endpointGeometry
        ? Math.atan2(endpointGeometry.endDir.y, endpointGeometry.endDir.x)
        : Math.atan2(to.y - from.y, to.x - from.x);
    const startAngle = (from: Point, to: Point): number =>
      endpointGeometry
        ? Math.atan2(endpointGeometry.startDir.y, endpointGeometry.startDir.x)
        : Math.atan2(from.y - to.y, from.x - to.x);

    // Helper to render arrowhead based on type
    const renderArrowhead = (tip: Point, angle: number, type: ArrowheadType) => {
      if (type === 'none') return;

      const direction = getDirectionVector(
        { x: tip.x - Math.cos(angle), y: tip.y - Math.sin(angle) },
        tip
      );

      const arrowPoints = getArrowheadPoints(tip, direction, type, headLength);

      if (type === 'dot') {
        // Render as filled circle
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, headLength * 0.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (type === 'bar') {
        // Render as perpendicular line
        if (arrowPoints.length >= 2) {
          const p0 = arrowPoints[0];
          const p1 = arrowPoints[1];
          if (p0 && p1) {
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();
          }
        }
      } else if (type === 'triangle' || type === 'diamond') {
        // Render as filled polygon
        const firstPoint = arrowPoints[0];
        if (firstPoint) {
          ctx.beginPath();
          ctx.moveTo(firstPoint.x, firstPoint.y);
          for (let i = 1; i < arrowPoints.length; i++) {
            const point = arrowPoints[i];
            if (point) {
              ctx.lineTo(point.x, point.y);
            }
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
    };

    // Render end arrowhead
    const endArrowheadType = arrowHeads.end ?? 'triangle';
    if (endArrowheadType !== 'none') {
      const end = points[points.length - 1];
      const prev = points[points.length - 2];
      if (!end || !prev) return;

      const angle = endAngle(prev, end);
      renderArrowhead(end, angle, endArrowheadType);
    }

    // Render start arrowhead (pointing outward, away from the shaft)
    const startArrowheadType = arrowHeads.start ?? 'none';
    if (startArrowheadType !== 'none') {
      const start = points[0];
      const next = points[1];
      if (!start || !next) return;

      const angle = startAngle(start, next);
      renderArrowhead(start, angle, startArrowheadType);
    }
  }
}

function renderText(ctx: CanvasRenderingContext2D, element: DriplElement) {
  const text = 'text' in element && typeof element.text === 'string' ? element.text : '';
  if (!text) return;
  const fontSize =
    'fontSize' in element && typeof element.fontSize === 'number' ? element.fontSize : 20;
  const fontFamily =
    'fontFamily' in element && typeof element.fontFamily === 'string' && element.fontFamily
      ? element.fontFamily
      : canvasFontFamily(undefined);
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
    if (textMetricsCache.size >= MAX_TEXT_CACHE_SIZE) {
      const firstKey = textMetricsCache.keys().next().value;
      if (firstKey !== undefined) textMetricsCache.delete(firstKey);
    }
    textMetricsCache.set(cacheKey, metrics);
  }

  const verticalAlign =
    'verticalAlign' in element &&
    (element.verticalAlign === 'top' ||
      element.verticalAlign === 'middle' ||
      element.verticalAlign === 'bottom')
      ? element.verticalAlign
      : 'top';
  const totalHeight = lines.length * metrics.lineHeight;
  const startY =
    verticalAlign === 'middle'
      ? Math.max(0, (element.height - totalHeight) / 2)
      : verticalAlign === 'bottom'
        ? Math.max(0, element.height - totalHeight)
        : 0;
  const anchorX =
    textAlign === 'left'
      ? element.x
      : textAlign === 'center'
        ? element.x + element.width / 2
        : element.x + element.width;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    ctx.fillText(line, anchorX, element.y + startY + i * metrics.lineHeight);
  }
}

function renderImage(
  ctx: CanvasRenderingContext2D,
  element: DriplElement,
  theme: 'light' | 'dark' = 'dark'
) {
  if (!('src' in element) || typeof element.src !== 'string' || !element.src) {
    return;
  }
  const cached = imageCache.get(element.src);
  if (cached?.loaded) {
    ctx.drawImage(cached.image, element.x, element.y, element.width, element.height);
    return;
  }

  if (cached?.error) {
    ctx.fillStyle = theme === 'dark' ? 'rgba(255,100,100,0.15)' : 'rgba(255,0,0,0.1)';
    ctx.fillRect(element.x, element.y, element.width, element.height);
    return;
  }

  // Start loading if not already in progress. The static layer repaints via
  // onAssetLoad; this layer repaints via the asset-load event the
  // InteractiveCanvas subscribes to — otherwise a committed image that
  // finishes loading never repaints here.
  if (!cached) {
    const notify = (): void => {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('dripl:asset-load'));
    };
    void imageCache
      .load(element.src)
      .catch(() => undefined)
      .then(notify);
  }

  ctx.fillStyle = 'rgba(127,127,127,0.2)';
  ctx.fillRect(element.x, element.y, element.width, element.height);
}

function renderFrame(ctx: CanvasRenderingContext2D, element: DriplElement) {
  const frameEl = element as DriplElement & { padding?: number; title?: string };
  const padding = frameEl.padding || 20;

  // Draw outer rectangle
  ctx.strokeStyle = element.strokeColor || '#000000';
  ctx.lineWidth = element.strokeWidth || 2;
  ctx.strokeRect(element.x, element.y, element.width, element.height);

  // Draw inner padding rectangle (dashed)
  ctx.setLineDash([5, 5]);
  ctx.strokeRect(
    element.x + padding,
    element.y + padding,
    element.width - 2 * padding,
    element.height - 2 * padding
  );
  ctx.setLineDash([]);

  // Draw title above frame
  if (frameEl.title) {
    ctx.fillStyle = element.strokeColor || '#000000';
    ctx.font = canvasFont(14, undefined);
    ctx.fillText(frameEl.title, element.x + 10, element.y - 10);
  }
}

function renderEmbed(ctx: CanvasRenderingContext2D, element: DriplElement) {
  const embedEl = element as DriplElement & {
    url?: string;
    title?: string;
    cachedPreview?: string;
  };

  // Draw outer rectangle
  ctx.strokeStyle = element.strokeColor || '#6B6860';
  ctx.lineWidth = element.strokeWidth || 1;
  ctx.strokeRect(element.x, element.y, element.width, element.height);

  // Fill background
  ctx.fillStyle = element.backgroundColor || '#FAFAF7';
  ctx.fillRect(element.x, element.y, element.width, element.height);

  // Draw globe icon placeholder
  ctx.fillStyle = '#6B6860';
  ctx.font = '24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🌐', element.x + element.width / 2, element.y + element.height / 2 - 15);

  // Draw URL or title
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#6B6860';
  const displayText = embedEl.title || embedEl.url || 'Web Embed';
  const maxWidth = element.width - 20;
  const textWidth = ctx.measureText(displayText).width;
  const truncatedText = textWidth > maxWidth ? displayText.slice(0, 30) + '...' : displayText;
  ctx.fillText(truncatedText, element.x + element.width / 2, element.y + element.height / 2 + 15);

  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

export function renderElement(
  ctx: CanvasRenderingContext2D,
  element: DriplElement,
  zoom: number,
  theme: 'light' | 'dark' = 'dark'
) {
  if (element.isDeleted) return;
  const type = element.type as string;
  // Draft preview with Excalidraw parity: the same Rough.js generator, options
  // and seed as the committed bitmap (`renderNewElementScene`). Without a
  // canvas (unit tests, SSR) the legacy canvas path below stands in.
  if (
    type === 'line' ||
    type === 'arrow' ||
    type === 'freedraw' ||
    type === 'path' ||
    type === 'rectangle' ||
    type === 'diamond' ||
    type === 'ellipse'
  ) {
    drawShapeDraft(ctx, element, theme, () => renderLegacyShape(ctx, element, zoom, theme));
    return;
  }
  renderLegacyShape(ctx, element, zoom, theme);
}

function renderLegacyShape(
  ctx: CanvasRenderingContext2D,
  element: DriplElement,
  zoom: number,
  theme: 'light' | 'dark' = 'dark'
) {
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
    renderImage(ctx, element, theme);
  } else if (type === 'frame') {
    renderFrame(ctx, element);
  } else if (type === 'embed') {
    renderEmbed(ctx, element);
  } else {
    renderRectangle(ctx, element, zoom);
  }

  ctx.restore();
}

export function clearTextMeasurementCache() {
  textMetricsCache.clear();
  // Note: imageCache is now shared via @dripl/element/image-cache
  // Don't clear it here as other renderers may still need it
}
