import rough from 'roughjs';
import type { DriplElement, LinearElement } from '@dripl/common';
import { getShapeFromCache, setShapeInCache, pruneShapeCache } from './shape-cache';
import type { RoughCanvas as _RoughCanvas } from 'roughjs/bin/canvas';
import type { Drawable as _Drawable } from 'roughjs/bin/core';
export type { RoughCanvas } from 'roughjs/bin/canvas';
export type { Drawable } from 'roughjs/bin/core';

// Arrow routing functions (inline to avoid circular deps)

function calculateCurvedPath(start: { x: number; y: number }, end: { x: number; y: number }, curvature: number = 0.5): { x: number; y: number }[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return [start, end];
  const offsetX = (-dy / length) * length * curvature * 0.25;
  const offsetY = (dx / length) * length * curvature * 0.25;
  return [start, { x: midX + offsetX, y: midY + offsetY }, end];
}

function calculateElbowPath(start: { x: number; y: number }, end: { x: number; y: number }): { x: number; y: number }[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return [start, { x: end.x, y: start.y }, end];
  } else {
    return [start, { x: start.x, y: end.y }, end];
  }
}

let generator: ReturnType<typeof rough.generator> | null = null;
function getGenerator() {
  if (!generator) generator = rough.generator();
  return generator;
}

let offscreenCanvas: HTMLCanvasElement | null = null;
let offscreenContext: CanvasRenderingContext2D | null = null;
let offscreenRoughCanvas: _RoughCanvas | null = null;
let cacheOperationCount = 0;

export function createRoughCanvas(canvas: HTMLCanvasElement): _RoughCanvas | null {
  try {
    if (!offscreenCanvas) {
      offscreenCanvas = document.createElement('canvas');
      offscreenContext = offscreenCanvas.getContext('2d');
      offscreenRoughCanvas = rough.canvas(offscreenCanvas);
    }

    if (
      (offscreenCanvas && canvas.width !== offscreenCanvas.width) ||
      canvas.height !== offscreenCanvas.height
    ) {
      offscreenCanvas.width = canvas.width;
      offscreenCanvas.height = canvas.height;
    }

    return rough.canvas(canvas);
  } catch (e) {
    console.error('Failed to create Rough canvas', e);
    return null;
  }
}

function generateShape(element: DriplElement): _Drawable | _Drawable[] {
  const {
    width,
    height,
    strokeColor,
    backgroundColor,
    strokeWidth,
    roughness = 1,
    strokeStyle = 'solid',
    fillStyle = 'hachure',
    seed,
    roundness = 0,
  } = element as any;

  const options: Record<string, unknown> = {
    stroke: strokeColor,
    strokeWidth,
    roughness,
    fillStyle,
    seed,
    hachureAngle: 45,
    hachureGap: strokeWidth * 2,
    curveStepCount: 9,
    simplification: 0.5,
    roundness,
  };

  const fillColor = backgroundColor ?? 'transparent';
  if (fillColor !== 'transparent') {
    options.fill = fillColor;
  }
  if (strokeStyle === 'dashed') {
    options.strokeLineDash = [10, 5];
  } else if (strokeStyle === 'dotted') {
    options.strokeLineDash = [2, 3];
  }

  switch (element.type) {
    case 'rectangle':
      return getGenerator().rectangle(0, 0, width, height, options);

    case 'ellipse':
      return getGenerator().ellipse(width / 2, height / 2, width, height, options);

    case 'diamond': {
      const topX = width / 2;
      const topY = 0;
      const rightX = width;
      const rightY = height / 2;
      const bottomX = width / 2;
      const bottomY = height;
      const leftX = 0;
      const leftY = height / 2;
      return getGenerator().polygon(
        [
          [topX, topY],
          [rightX, rightY],
          [bottomX, bottomY],
          [leftX, leftY],
        ],
        options
      );
    }

    case 'line':
    case 'arrow': {
      if ('points' in element && element.points.length > 1) {
        const pts = element.points.map((p: any) => [p.x, p.y] as [number, number]);
        const linearEl = element as LinearElement;
        const arrowStyle = linearEl.arrowStyle ?? 'straight';
        const firstPt = pts[0];
        const secondPt = pts[1];
        
        // For curved arrows, use quadratic bezier with control point
        if (element.type === 'arrow' && arrowStyle === 'curved' && pts.length === 2 && firstPt && secondPt) {
          const start = { x: firstPt[0], y: firstPt[1] };
          const end = { x: secondPt[0], y: secondPt[1] };
          const curvedPoints = calculateCurvedPath(start, end, 0.5);
          // Convert to roughjs curve format
          return getGenerator().curve(
            curvedPoints.map(p => [p.x, p.y] as [number, number]),
            options
          );
        }
        
        // For elbow arrows, generate rounded corner path
        if (element.type === 'arrow' && arrowStyle === 'elbow' && pts.length === 2 && firstPt && secondPt) {
          const start = { x: firstPt[0], y: firstPt[1] };
          const end = { x: secondPt[0], y: secondPt[1] };
          const elbowPoints = calculateElbowPath(start, end);
          // For now, render as linear path through elbow points
          // TODO: Add rounded corners with quadratic bezier curves
          return getGenerator().linearPath(
            elbowPoints.map(p => [p.x, p.y] as [number, number]),
            options
          );
        }
        
        // Default: straight line
        return getGenerator().linearPath(pts, options);
      }
      return [];
    }
    case 'freedraw': {
      if ('points' in element && element.points.length > 1) {
        const pts = element.points.map((p: any) => [p.x, p.y] as [number, number]);
        return getGenerator().linearPath(pts, options);
      }
      return [];
    }

    default:
      return [];
  }
}

export function renderRoughElement(
  rc: _RoughCanvas,
  ctx: CanvasRenderingContext2D,
  element: DriplElement,
  elements?: DriplElement[],
  theme: 'light' | 'dark' = 'dark',
  isExporting: boolean = false
): void {
  if (element.isDeleted) return;

  ctx.save();
  ctx.globalAlpha = element.opacity ?? 1;

  const { x, y, width, height, angle = 0 } = element;

  if (angle !== 0) {
    const cx = x + width / 2;
    const cy = y + height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.translate(-cx, -cy);
  }

  // Handle text elements specially (they don't use Rough.js)
  if (element.type === 'text') {
    const textEl = element as any;
    ctx.translate(x, y);
    ctx.fillStyle = element.strokeColor || (theme === 'dark' ? '#ffffff' : '#000000');
    ctx.font = `${textEl.fontSize || 16}px ${textEl.fontFamily || 'Inter'}`;
    ctx.textBaseline = 'top';

    const text = textEl.text || '';
    const lines = text.split('\n');
    const lineHeight = (textEl.fontSize || 16) * 1.2;

    lines.forEach((line: string, index: number) => {
      ctx.fillText(line, 0, index * lineHeight);
    });

    ctx.restore();
    return;
  }

  // Handle image elements specially
  if (element.type === 'image') {
    const imgEl = element as any;
    if (imgEl.src && imgEl._imageLoaded) {
      ctx.translate(x, y);
      ctx.drawImage(imgEl._imageLoaded, 0, 0, width, height);
    }
    ctx.restore();
    return;
  }

  // isExporting bypasses the cache to guarantee latest state on export (TODO #32)
  let shape: ReturnType<typeof generateShape> | undefined = isExporting
    ? undefined
    : getShapeFromCache(element as any, theme);
  if (!shape) {
    shape = generateShape(element);
    if (!isExporting) {
      setShapeInCache(element as any, shape, theme);
      cacheOperationCount++;
      if (cacheOperationCount % 1000 === 0) {
        pruneShapeCache();
      }
    }
  }

  ctx.translate(x, y);

  if (element.type === 'arrow' && (element as any).labelId && elements) {
    const label = elements.find(el => el.id === (element as any).labelId);

    if (label && label.type === 'text') {
      const labelBounds = {
        x: label.x - x,
        y: label.y - y,
        width: label.width,
        height: label.height,
      };

      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = theme === 'dark' ? '#0f0f13' : '#f8f9fa';
      ctx.fillRect(labelBounds.x, labelBounds.y, labelBounds.width, labelBounds.height);
      ctx.restore();
    }
  }

  if (Array.isArray(shape)) {
    shape.forEach(s => rc.draw(s));
  } else {
    rc.draw(shape);
  }

  // Render arrowheads for arrow elements
  if (element.type === 'arrow' && (element as any).points && (element as any).points.length > 1) {
    const points = (element as any).points;
    const linearEl = element as LinearElement;
    const arrowHeads = linearEl.arrowHeads ?? { start: false, end: true };
    
    const arrowHeadOptions: Record<string, unknown> = {
      stroke: element.strokeColor,
      strokeWidth: element.strokeWidth,
      fill: element.strokeColor,
      fillStyle: 'solid',
    };
    if (element.roughness !== undefined) {
      arrowHeadOptions.roughness = element.roughness;
    }

    // Render end arrowhead
    if (arrowHeads.end) {
      const endPoint = points[points.length - 1];
      const prevPoint = points[points.length - 2];
      if (endPoint && prevPoint) {
        const angle = Math.atan2(endPoint.y - prevPoint.y, endPoint.x - prevPoint.x);
        const headLength = 10 + (element.strokeWidth || 2) * 2;
        const headAngle = Math.PI / 6;

        const x1 = endPoint.x - headLength * Math.cos(angle - headAngle);
        const y1 = endPoint.y - headLength * Math.sin(angle - headAngle);
        const x2 = endPoint.x - headLength * Math.cos(angle + headAngle);
        const y2 = endPoint.y - headLength * Math.sin(angle + headAngle);

        const arrowHead = getGenerator().polygon(
          [
            [endPoint.x, endPoint.y],
            [x1, y1],
            [x2, y2],
          ],
          arrowHeadOptions
        );
        rc.draw(arrowHead);
      }
    }

    // Render start arrowhead
    if (arrowHeads.start) {
      const startPoint = points[0];
      const nextPoint = points[1];
      if (startPoint && nextPoint) {
        const angle = Math.atan2(nextPoint.y - startPoint.y, nextPoint.x - startPoint.x);
        const headLength = 10 + (element.strokeWidth || 2) * 2;
        const headAngle = Math.PI / 6;

        // Start arrowhead points in opposite direction
        const x1 = startPoint.x + headLength * Math.cos(angle - headAngle);
        const y1 = startPoint.y + headLength * Math.sin(angle - headAngle);
        const x2 = startPoint.x + headLength * Math.cos(angle + headAngle);
        const y2 = startPoint.y + headLength * Math.sin(angle + headAngle);

        const arrowHead = getGenerator().polygon(
          [
            [startPoint.x, startPoint.y],
            [x1, y1],
            [x2, y2],
          ],
          arrowHeadOptions
        );
        rc.draw(arrowHead);
      }
    }
  }

  ctx.restore();
}

export function renderRoughElements(
  rc: _RoughCanvas,
  ctx: CanvasRenderingContext2D,
  elements: DriplElement[],
  theme: 'light' | 'dark' = 'dark'
): void {
  // Get the actual canvas dimensions from the context
  const canvas = ctx.canvas;

  if (offscreenCanvas && offscreenContext && offscreenRoughCanvas) {
    // Ensure offscreen canvas matches actual canvas size
    if (offscreenCanvas.width !== canvas.width || offscreenCanvas.height !== canvas.height) {
      offscreenCanvas.width = canvas.width;
      offscreenCanvas.height = canvas.height;
    }

    offscreenContext.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);

    for (const el of elements) {
      renderRoughElement(offscreenRoughCanvas, offscreenContext, el, elements, theme);
    }

    ctx.drawImage(offscreenCanvas, 0, 0);
  } else {
    for (const el of elements) {
      renderRoughElement(rc, ctx, el, elements, theme);
    }
  }
}
