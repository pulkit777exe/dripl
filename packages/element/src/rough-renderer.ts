import rough from 'roughjs';
import { logError } from '@dripl/common';
import type {
  DriplElement,
  LinearElement,
  ArrowheadType,
  FrameElement,
  EmbedElement,
  Point,
  TextElement,
} from '@dripl/common';
import { getFreedrawOutline } from './freedraw';
import { getShapeFromCache, setShapeInCache } from './shape-cache';
import { canvasFont } from './text';
import { applyDarkModeFilter } from './theme';
import { imageCache } from './image-cache';
import { arrowHeadLength } from '@dripl/math/intersection';
import type { RoughCanvas as _RoughCanvas } from 'roughjs/bin/canvas';
import type { Drawable as _Drawable } from 'roughjs/bin/core';
export type { RoughCanvas } from 'roughjs/bin/canvas';
export type { Drawable } from 'roughjs/bin/core';

// Arrow routing functions (inline to avoid circular deps)

function calculateCurvedPath(
  start: { x: number; y: number },
  end: { x: number; y: number },
  curvature: number = 0.5
): { x: number; y: number }[] {
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

function calculateElbowPath(
  start: { x: number; y: number },
  end: { x: number; y: number }
): { x: number; y: number }[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return [start, { x: end.x, y: start.y }, end];
  } else {
    return [start, { x: start.x, y: end.y }, end];
  }
}

function drawArrowhead(
  rc: _RoughCanvas,
  tip: { x: number; y: number },
  direction: { x: number; y: number },
  type: ArrowheadType,
  size: number,
  options: Record<string, unknown>
) {
  if (type === 'none') return;

  const { x: dx, y: dy } = direction;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return;
  const nx = dx / length;
  const ny = dy / length;
  const perpX = -ny;
  const perpY = nx;

  switch (type) {
    case 'triangle': {
      const x1 = tip.x - size * nx + size * 0.4 * perpX;
      const y1 = tip.y - size * ny + size * 0.4 * perpY;
      const x2 = tip.x - size * nx - size * 0.4 * perpX;
      const y2 = tip.y - size * ny - size * 0.4 * perpY;
      rc.draw(
        getGenerator().polygon(
          [
            [tip.x, tip.y],
            [x1, y1],
            [x2, y2],
          ],
          options
        )
      );
      break;
    }
    case 'dot': {
      const circle = getGenerator().circle(
        tip.x - size * 0.5 * nx,
        tip.y - size * 0.5 * ny,
        size * 0.6,
        {
          ...options,
          fill: options.stroke as string,
          fillStyle: 'solid',
        }
      );
      rc.draw(circle);
      break;
    }
    case 'bar': {
      const x1 = tip.x + perpX * size * 0.5;
      const y1 = tip.y + perpY * size * 0.5;
      const x2 = tip.x - perpX * size * 0.5;
      const y2 = tip.y - perpY * size * 0.5;
      const line = getGenerator().line(x1, y1, x2, y2, options);
      rc.draw(line);
      break;
    }
    case 'diamond': {
      const midX = tip.x - size * 0.5 * nx;
      const midY = tip.y - size * 0.5 * ny;
      const baseX = tip.x - size * nx;
      const baseY = tip.y - size * ny;
      rc.draw(
        getGenerator().polygon(
          [
            [tip.x, tip.y],
            [midX + perpX * size * 0.35, midY + perpY * size * 0.35],
            [baseX, baseY],
            [midX - perpX * size * 0.35, midY - perpY * size * 0.35],
          ],
          options
        )
      );
      break;
    }
  }
}

const elementLookupCache = new WeakMap<
  readonly DriplElement[],
  ReadonlyMap<string, DriplElement>
>();

function getElementById(
  elements: readonly DriplElement[] | undefined,
  id: string
): DriplElement | undefined {
  if (!elements) return undefined;
  let lookup = elementLookupCache.get(elements);
  if (!lookup) {
    lookup = new Map(elements.map(element => [element.id, element]));
    elementLookupCache.set(elements, lookup);
  }
  return lookup.get(id);
}

let generator: ReturnType<typeof rough.generator> | null = null;
function getGenerator() {
  if (!generator) generator = rough.generator();
  return generator;
}

/**
 * Deterministic fallback seed for elements that carry none.
 *
 * `seed` is optional in the element schema, so imported, legacy, or
 * hand-authored scenes can reach the renderer without one. Rough.js then picks a
 * random seed on every generation, which means an element's sketch visibly
 * changes each time its cached bitmap is regenerated (theme change, cache
 * eviction). Deriving the seed from the element id keeps those shapes stable
 * across renders and makes the rendered output deterministic.
 *
 * Deliberately not memoized: hashing a short id costs less than the string
 * hashing a Map lookup needs, and a cache here would retain every id ever
 * rendered for the life of the page.
 */
function stableSeedFor(elementId: string): number {
  // FNV-1a: small, fast, and stable across runs and platforms.
  let hash = 0x811c9dc5;
  for (let index = 0; index < elementId.length; index += 1) {
    hash ^= elementId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  // Keep it inside Rough.js's positive 32-bit seed range.
  return (hash >>> 0) % 2_147_483_647;
}

export function resolveElementSeed(element: DriplElement): number {
  return typeof element.seed === 'number' ? element.seed : stableSeedFor(element.id);
}

/**
 * Small-element roughness compensation, mirroring Excalidraw's
 * `adjustRoughness`: full roughness on a <20px shape distorts it beyond
 * recognition, so scale it down with size. Tuned to the same break-points
 * (20px / 50px) the upstream uses for its cartoonist/artist switch.
 */
export function adjustRoughnessForSize(element: DriplElement): number {
  const roughness = element.roughness ?? 1;
  const size = Math.max(Math.abs(element.width), Math.abs(element.height));
  if (size < 20) return roughness * 0.3;
  if (size < 50) return roughness * 0.6;
  return roughness;
}

/**
 * Rough.js options with Excalidraw parity (`generateRoughOptions` in
 * `packages/element/src/shape.ts`):
 *
 * - one seed per element (stable across regenerations),
 * - non-solid strokes disable multi-stroke and gain +0.5 width so dashes
 *   read at the same weight as solid strokes,
 * - `fillWeight = strokeWidth / 2`, `hachureGap = strokeWidth * 4` so fills
 *   do not change when only the stroke weight changes,
 * - dashed `[8, 8 + w]` / dotted `[1.5, 6 + w]` dash arrays,
 * - `preserveVertices` for low-roughness shapes so straight edges stay
 *   straight, `curveFitting` for ellipses.
 */
export function getRoughOptionsForElement(
  element: DriplElement,
  theme: 'light' | 'dark' = 'dark',
  continuousPath = false
): Record<string, unknown> {
  const strokeWidth = typeof element.strokeWidth === 'number' ? element.strokeWidth : 2;
  const strokeStyle = element.strokeStyle ?? 'solid';
  const nonSolid = strokeStyle !== 'solid';
  const seed = resolveElementSeed(element);
  const roughness = adjustRoughnessForSize(element);
  const roundness = element.roundness ?? 0;

  const options: Record<string, unknown> = {
    stroke: applyDarkModeFilter(element.strokeColor, theme),
    strokeWidth: nonSolid ? strokeWidth + 0.5 : strokeWidth,
    roughness,
    fillStyle: element.fillStyle ?? 'hachure',
    seed,
    hachureAngle: 45,
    hachureGap: strokeWidth * 4,
    fillWeight: strokeWidth / 2,
    curveStepCount: 9,
    simplification: 0.5,
    roundness,
    disableMultiStroke: nonSolid,
    preserveVertices: continuousPath || roughness < 1,
  };

  if (element.type === 'ellipse') {
    options.curveFitting = 1;
  }
  if (strokeStyle === 'dashed') {
    options.strokeLineDash = [8, 8 + strokeWidth];
  } else if (strokeStyle === 'dotted') {
    options.strokeLineDash = [1.5, 6 + strokeWidth];
  }

  const fillColor =
    element.backgroundColor ??
    ('fillColor' in element && typeof element.fillColor === 'string'
      ? element.fillColor
      : 'transparent');
  if (fillColor !== 'transparent') {
    options.fill = applyDarkModeFilter(fillColor, theme);
  }
  return options;
}

export function createRoughCanvas(canvas: HTMLCanvasElement): _RoughCanvas | null {
  try {
    return rough.canvas(canvas);
  } catch (e) {
    logError(
      JSON.stringify({ level: 'error', event: 'rough_canvas_init_failed', error: String(e) })
    );
    return null;
  }
}

function generateShape(
  element: DriplElement,
  theme: 'light' | 'dark' = 'dark'
): _Drawable | _Drawable[] {
  const width = element.width;
  const height = element.height;
  const options = getRoughOptionsForElement(element, theme);
  // The legacy 'path' schema variant carries line-like points but is not part
  // of the `DriplElement` union; render it as a straight polyline so stored
  // scenes never produce an empty drawable.
  const kind = (element.type as string) === 'path' ? 'line' : element.type;

  switch (kind) {
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
      const pathPoints: Point[] =
        'points' in element && Array.isArray(element.points) ? element.points : [];
      if (pathPoints.length > 1) {
        const pts = pathPoints.map(p => [p.x, p.y] as [number, number]);
        const linearEl = element as LinearElement;
        const arrowStyle = linearEl.arrowStyle ?? 'straight';
        const firstPt = pts[0];
        const secondPt = pts[1];

        // For curved arrows, use quadratic bezier with control point
        if (
          element.type === 'arrow' &&
          arrowStyle === 'curved' &&
          pts.length === 2 &&
          firstPt &&
          secondPt
        ) {
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
        if (
          element.type === 'arrow' &&
          arrowStyle === 'elbow' &&
          pts.length === 2 &&
          firstPt &&
          secondPt
        ) {
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
      // Freedraw bypasses Rough.js entirely (Excalidraw parity): the stroke
      // is a filled perfect-freehand outline, drawn in `renderRoughElement`
      // and cached as pixels like any other bitmap. Returning `[]` here keeps
      // the shape cache valid without generating a meaningless Drawable.
      return [];
    }

    case 'frame': {
      // Frame renders as a rectangle with title
      return getGenerator().rectangle(0, 0, width, height, options);
    }

    case 'embed': {
      // Embed renders as a rectangle placeholder
      return getGenerator().rectangle(0, 0, width, height, options);
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

  const { x, y, width, height } = element;

  // Handle text elements specially (they don't use Rough.js)
  if (element.type === 'text') {
    const textEl = element as TextElement;
    ctx.translate(x, y);
    const explicit = element.strokeColor || undefined;
    ctx.fillStyle =
      applyDarkModeFilter(explicit, theme) ?? (theme === 'dark' ? '#ffffff' : '#000000');
    // Unified with the interactive draft renderer (schema default): 20px /
    // 1.25 line-height, one shared family fallback (`./text`). The previous
    // 16px/1.2 here vs 20px/1.25 there made every text element reflow on
    // commit.
    const fontSize = textEl.fontSize || 20;
    ctx.font = canvasFont(fontSize, textEl.fontFamily);
    ctx.textBaseline = 'top';
    ctx.textAlign =
      textEl.textAlign === 'center' || textEl.textAlign === 'right' ? textEl.textAlign : 'left';

    const text = textEl.text || '';
    const lines = text.split('\n');
    const lineHeight = fontSize * 1.25;
    const totalHeight = lines.length * lineHeight;
    const startY =
      textEl.verticalAlign === 'middle'
        ? Math.max(0, (height - totalHeight) / 2)
        : textEl.verticalAlign === 'bottom'
          ? Math.max(0, height - totalHeight)
          : 0;
    const anchorX =
      textEl.textAlign === 'center' ? width / 2 : textEl.textAlign === 'right' ? width : 0;

    lines.forEach((line: string, index: number) => {
      ctx.fillText(line, anchorX, startY + index * lineHeight);
    });

    ctx.restore();
    return;
  }

  // Handle image elements specially. The static bitmap path draws images
  // directly (`drawImageElement`); this branch serves direct-render callers
  // (draft preview, export) through the same live `imageCache`.
  if (element.type === 'image') {
    const src = element.src;
    const cached = typeof src === 'string' && src ? imageCache.get(src) : undefined;
    if (cached?.loaded) {
      ctx.translate(x, y);
      ctx.drawImage(cached.image, 0, 0, width, height);
    }
    ctx.restore();
    return;
  }

  // Handle frame elements specially - draw border, padding, and title
  if (element.type === 'frame') {
    const frameEl = element as FrameElement;
    ctx.translate(x, y);

    // Draw outer rectangle
    ctx.strokeStyle = element.strokeColor || '#000000';
    ctx.lineWidth = element.strokeWidth || 2;
    ctx.strokeRect(0, 0, width, height);

    // Draw inner padding rectangle (dashed)
    const padding = frameEl.padding || 20;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(padding, padding, width - 2 * padding, height - 2 * padding);
    ctx.setLineDash([]);

    // Draw title above frame (same font as the interactive layer).
    if (frameEl.title) {
      ctx.fillStyle = element.strokeColor || '#000000';
      ctx.font = canvasFont(14, undefined);
      ctx.fillText(frameEl.title, 10, -10);
    }

    ctx.restore();
    return;
  }

  // Handle embed elements specially - render placeholder with URL
  if (element.type === 'embed') {
    const embedEl = element as EmbedElement;
    ctx.translate(x, y);

    // Draw outer rectangle
    ctx.strokeStyle = element.strokeColor || '#6B6860';
    ctx.lineWidth = element.strokeWidth || 1;
    ctx.strokeRect(0, 0, width, height);

    // Fill background
    ctx.fillStyle = element.backgroundColor || '#FAFAF7';
    ctx.fillRect(0, 0, width, height);

    // Draw globe icon placeholder
    ctx.fillStyle = '#6B6860';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🌐', width / 2, height / 2 - 15);

    // Draw URL or title
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#6B6860';
    const displayText = embedEl.title || embedEl.url || 'Web Embed';
    const maxWidth = width - 20;
    const textWidth = ctx.measureText(displayText).width;
    const truncatedText = textWidth > maxWidth ? displayText.slice(0, 30) + '...' : displayText;
    ctx.fillText(truncatedText, width / 2, height / 2 + 15);

    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
    return;
  }

  // Freedraw bypasses Rough.js: filled perfect-freehand outline, in local
  // coords (the bitmap context is already translated by the caller into the
  // element's frame; here we are in scene coords, so translate first).
  if (element.type === 'freedraw') {
    ctx.translate(x, y);
    if (element.angle) {
      const cx = element.width / 2;
      const cy = element.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate(element.angle);
      ctx.translate(-cx, -cy);
    }
    ctx.translate(-x, -y);
    const outline = getFreedrawOutline(element);
    if (outline.length > 0) {
      ctx.save();
      ctx.fillStyle = applyDarkModeFilter(element.strokeColor, theme) ?? '#000000';
      ctx.beginPath();
      const first = outline[0]!;
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < outline.length; i += 1) {
        const p = outline[i]!;
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    return;
  }

  // Export bypasses the cache so the latest committed state is rendered.
  let shape: ReturnType<typeof generateShape> | undefined = isExporting
    ? undefined
    : getShapeFromCache(element, theme);
  if (!shape) {
    shape = generateShape(element, theme);
    if (!isExporting) {
      setShapeInCache(element, shape, theme);
    }
  }

  ctx.translate(x, y);

  drawArrowLabelCutout(ctx, element, elements);

  if (Array.isArray(shape)) {
    shape.forEach(s => rc.draw(s));
  } else {
    rc.draw(shape);
  }

  // Render arrowheads for arrow elements
  if (
    element.type === 'arrow' &&
    (element as LinearElement).points &&
    (element as LinearElement).points.length > 1
  ) {
    drawArrowheads(rc, element, (element as LinearElement).points, theme);
  }

  ctx.restore();
}

/**
 * Generate a Rough.js Drawable for an element without touching the shape
 * cache. Used by the interactive draft layer so the in-progress preview is
 * pixel-identical to the committed bitmap (same generator, same options,
 * same seed) instead of a look-alike reimplementation.
 */
export function generateDrawableForElement(element: DriplElement): _Drawable | _Drawable[] {
  return generateShape(element);
}

/**
 * Unit direction of an arrowhead at each endpoint, in the caller's point
 * space. Straight and multi-point shafts use the last/first segment; curved
 * shafts use the bezier tangent at the endpoint (control point from
 * `calculateCurvedPath`); elbow shafts use the axis-aligned final/first
 * segment. A zero-length shaft falls back to +x, matching the historical
 * `atan2(0, 0) === 0` behavior so degenerate arrows keep their head.
 */
export interface ArrowEndpointGeometry {
  endTip: { x: number; y: number };
  endDir: { x: number; y: number };
  startTip: { x: number; y: number };
  startDir: { x: number; y: number };
}

function unitDirection(dx: number, dy: number): { x: number; y: number } {
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!(length > 0)) return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
}

export function arrowEndpointGeometry(
  points: Array<{ x: number; y: number }>,
  arrowStyle?: string
): ArrowEndpointGeometry | null {
  if (points.length < 2) return null;
  const start = points[0]!;
  const end = points[points.length - 1]!;

  if (arrowStyle === 'curved' && points.length === 2) {
    if (start.x === end.x && start.y === end.y) {
      return { endTip: end, endDir: { x: 1, y: 0 }, startTip: start, startDir: { x: 1, y: 0 } };
    }
    const control = calculateCurvedPath(start, end, 0.5)[1]!;
    return {
      endTip: end,
      endDir: unitDirection(end.x - control.x, end.y - control.y),
      startTip: start,
      startDir: unitDirection(start.x - control.x, start.y - control.y),
    };
  }

  if (arrowStyle === 'elbow' && points.length === 2) {
    const corner =
      Math.abs(end.x - start.x) > Math.abs(end.y - start.y)
        ? { x: end.x, y: start.y }
        : { x: start.x, y: end.y };
    return {
      endTip: end,
      endDir: unitDirection(end.x - corner.x, end.y - corner.y),
      startTip: start,
      startDir: unitDirection(start.x - corner.x, start.y - corner.y),
    };
  }

  const prev = points[points.length - 2]!;
  const next = points[1]!;
  return {
    endTip: end,
    endDir: unitDirection(end.x - prev.x, end.y - prev.y),
    startTip: start,
    startDir: unitDirection(start.x - next.x, start.y - next.y),
  };
}

/**
 * Shared arrowhead paint options: seeded like the body so the head never
 * twitches independently across bitmap regenerations (theme change, cache
 * eviction, cold load).
 */
function arrowHeadOptionsFor(
  element: DriplElement,
  theme: 'light' | 'dark'
): Record<string, unknown> {
  const stroke = applyDarkModeFilter(element.strokeColor, theme);
  const options: Record<string, unknown> = {
    stroke,
    strokeWidth: element.strokeWidth,
    fill: stroke,
    fillStyle: 'solid',
    seed: resolveElementSeed(element),
  };
  if (element.roughness !== undefined) {
    options.roughness = element.roughness;
  }
  return options;
}

/**
 * Punch the bound label's box out of an arrow shaft. Under
 * `destination-out` the fill color is irrelevant — it erases to transparent
 * on the per-element bitmap — so no theme branch belongs here.
 */
function drawArrowLabelCutout(
  ctx: CanvasRenderingContext2D,
  element: DriplElement,
  elements: readonly DriplElement[] | undefined
): void {
  if (element.type !== 'arrow' || !(element as LinearElement).labelId || !elements) return;
  const label = getElementById(elements, (element as LinearElement).labelId!);
  if (!label || label.type !== 'text') return;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillRect(label.x - element.x, label.y - element.y, label.width, label.height);
  ctx.restore();
}

/**
 * Paint both arrowheads from endpoint geometry. Shared by the cached bitmap
 * path and the draft path so heads agree everywhere.
 */
function drawArrowheads(
  rc: _RoughCanvas,
  element: DriplElement,
  points: Array<{ x: number; y: number }>,
  theme: 'light' | 'dark'
): void {
  const linearEl = element as LinearElement;
  const arrowHeads = linearEl.arrowHeads ?? { start: 'none', end: 'triangle' };
  if ((arrowHeads.end ?? 'none') === 'none' && (arrowHeads.start ?? 'none') === 'none') return;
  const geometry = arrowEndpointGeometry(points, linearEl.arrowStyle);
  if (!geometry) return;
  const options = arrowHeadOptionsFor(element, theme);
  const headLength = arrowHeadLength(element.strokeWidth);
  if (arrowHeads.end && arrowHeads.end !== 'none') {
    drawArrowhead(rc, geometry.endTip, geometry.endDir, arrowHeads.end, headLength, options);
  }
  if (arrowHeads.start && arrowHeads.start !== 'none') {
    drawArrowhead(rc, geometry.startTip, geometry.startDir, arrowHeads.start, headLength, options);
  }
}

/**
 * Draw a single in-progress (draft) element directly onto a scene-context
 * `ctx` — the `renderNewElementScene` equivalent. Handles rotation,
 * opacity, freedraw outlines (perfect-freehand fill) and arrowheads, using
 * the same options and seed as the static bitmap path.
 *
 * The caller owns the world transform; this function only applies the
 * element-local rotation around its center.
 */
export function renderDraftElement(
  rc: _RoughCanvas,
  ctx: CanvasRenderingContext2D,
  element: DriplElement,
  elements?: DriplElement[],
  theme: 'light' | 'dark' = 'dark'
): void {
  if (element.isDeleted) return;
  if (element.type === 'text' || element.type === 'image') {
    renderRoughElement(rc, ctx, element, undefined, theme, true);
    return;
  }
  if (element.type === 'freedraw') {
    renderRoughElement(rc, ctx, element, undefined, theme, true);
    return;
  }
  ctx.save();
  ctx.globalAlpha = element.opacity ?? 1;
  const angle = element.angle ?? 0;
  if (angle) {
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.translate(-cx, -cy);
  }
  ctx.translate(element.x, element.y);
  drawArrowLabelCutout(ctx, element, elements);
  const shape = generateShape(element, theme);
  if (Array.isArray(shape)) {
    shape.forEach(s => rc.draw(s));
  } else {
    rc.draw(shape);
  }
  ctx.restore();

  if (element.type === 'arrow') {
    ctx.save();
    ctx.globalAlpha = element.opacity ?? 1;
    if (angle) {
      const cx = element.x + element.width / 2;
      const cy = element.y + element.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.translate(-cx, -cy);
    }
    const points = (element as LinearElement).points ?? [];
    const world = points.map(p => ({ x: p.x + element.x, y: p.y + element.y }));
    ctx.translate(-element.x, -element.y);
    drawArrowheads(rc, element, world, theme);
    ctx.restore();
  }
}
