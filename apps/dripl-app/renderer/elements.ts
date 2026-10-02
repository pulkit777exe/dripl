import type { ArrowheadType, DriplElement, LinearElement, Point } from '@dripl/common';
import { getDefaultFontFamily } from '@/utils/fontPreferences';
import { imageCache } from '@dripl/element/image-cache';
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
 * Element renderers — extracted verbatim from `interactiveScene.ts`.
 *
 * One function per shape plus the `renderElement` dispatcher (unknown
 * types fall back to rectangle, deleted elements are skipped). The text
 * measurement cache lives here with the only renderer that uses it;
 * `clearTextMeasurementCache` stays public via `interactiveScene.ts`.
 */

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

    // Calculate control point for quadratic bezier
    const midX = (first.x + last.x) / 2;
    const midY = (first.y + last.y) / 2;
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    // Perpendicular offset for curvature
    const offsetX2 = (-dy / length) * length * 0.25;
    const offsetY2 = (dx / length) * length * 0.25;
    const controlX = midX + offsetX2;
    const controlY = midY + offsetY2;

    ctx.moveTo(first.x + offsetX, first.y + offsetY);
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
    const headLength = 12;
    const arrowStyle = arrowElement.arrowStyle;

    // Helper to calculate angle for arrowhead
    const calculateAngle = (from: Point, to: Point, style?: string): number => {
      if (style === 'curved') {
        // Approximate tangent at endpoint for quadratic bezier
        const first = points[0];
        if (first) {
          const midX = (first.x + to.x) / 2;
          const midY = (first.y + to.y) / 2;
          const dx = to.x - first.x;
          const dy = to.y - first.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          if (length === 0) return Math.atan2(to.y - from.y, to.x - from.x);
          const ctrlX = midX + (-dy / length) * length * 0.25;
          const ctrlY = midY + (dx / length) * length * 0.25;
          return Math.atan2(to.y - ctrlY, to.x - ctrlX);
        }
        return Math.atan2(to.y - from.y, to.x - from.x);
      }
      return Math.atan2(to.y - from.y, to.x - from.x);
    };

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

      const angle = calculateAngle(prev, end, arrowStyle);
      renderArrowhead(end, angle, endArrowheadType);
    }

    // Render start arrowhead
    const startArrowheadType = arrowHeads.start ?? 'none';
    if (startArrowheadType !== 'none') {
      const start = points[0];
      const next = points[1];
      if (!start || !next) return;

      // Start arrowhead angle is opposite direction (pointing inward)
      const angle = Math.atan2(start.y - next.y, start.x - next.x);
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
      : getDefaultFontFamily();
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

function renderImage(ctx: CanvasRenderingContext2D, element: DriplElement) {
  if (!('src' in element) || typeof element.src !== 'string' || !element.src) {
    return;
  }
  const cached = imageCache.get(element.src);
  if (cached?.loaded) {
    ctx.drawImage(cached.image, element.x, element.y, element.width, element.height);
    return;
  }

  // Start loading if not already in progress
  if (!cached) {
    imageCache.load(element.src).catch(() => {});
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
    ctx.font = `14px ${getDefaultFontFamily()}, cursive`;
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

export function renderElement(ctx: CanvasRenderingContext2D, element: DriplElement, zoom: number) {
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
