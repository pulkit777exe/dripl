import type { DriplElement } from '@dripl/common';
import { createRoughCanvas, renderRoughElement } from './rough-renderer';
import { imageCache } from './image-cache';

export interface StaticSceneViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

export interface StaticSceneConfig {
  gridEnabled: boolean;
  gridSize: number;
  zoom: number;
  theme: 'light' | 'dark';
  dpr: number;
}

// ─── Element canvas cache ────────────────────────────────────────────────────
// Each cached entry stores:
//   canvas  – the offscreen canvas with the rendered element
//   version – element.version at the time of rendering.
//             If element.version changes, the entry is regenerated in O(1).
interface CacheEntry {
  canvas: HTMLCanvasElement;
  version: number;
}

const elementCanvasCache = new Map<string, CacheEntry>();

/**
 * Return the element's version number for cache invalidation.
 * Falls back to 0 for legacy elements that don't have a version yet.
 * O(1) — no serialization required (TODO #31).
 */
function getElementVersion(el: DriplElement): number {
  return (el as any).version ?? 0;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function renderStaticScene(
  canvas: HTMLCanvasElement,
  elements: DriplElement[],
  viewport: StaticSceneViewport,
  config: StaticSceneConfig
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 1. Size + clear the canvas, establish the camera transform.
  bootstrapCanvas(ctx, canvas, viewport, config);

  // 2. Optional grid (drawn in world-space, behind elements).
  if (config.gridEnabled) {
    drawGrid(ctx, viewport, config);
  }

  // 3. Draw each visible element.
  for (const element of elements) {
    if ((element as any).isDeleted) continue;

    // StaticSceneViewport culling — skip elements fully outside the visible area.
    if (!isElementVisible(element, viewport, config.zoom)) continue;

    drawElement(ctx, element, viewport, config);
  }
}

export function invalidateElementCache(elementId: string): void {
  elementCanvasCache.delete(elementId);
}

export function clearStaticSceneCache(): void {
  elementCanvasCache.clear();
}

// ─── Canvas bootstrap ────────────────────────────────────────────────────────

function bootstrapCanvas(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  viewport: StaticSceneViewport,
  config: StaticSceneConfig
): void {
  const { dpr } = config;
  const bufferW = Math.round(viewport.width * dpr);
  const bufferH = Math.round(viewport.height * dpr);

  // Only resize the backing store when dimensions change (prevents flicker).
  if (canvas.width !== bufferW || canvas.height !== bufferH) {
    canvas.width = bufferW;
    canvas.height = bufferH;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
  }

  // Reset ALL transforms before doing anything else.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, bufferW, bufferH);

  // Camera transform stack (applied in reverse order because it's a matrix):
  //   1. Scale by DPR   → crisp pixels on hi-DPI screens
  //   2. Scale by zoom  → world-space zoom
  //   3. Translate by   → pan / scroll
  //
  // Resulting transform: pixel = world * zoom * dpr + pan * dpr
  ctx.scale(dpr, dpr);
  ctx.scale(config.zoom, config.zoom);
  ctx.translate(viewport.x / config.zoom, viewport.y / config.zoom);
}

// ─── Grid ────────────────────────────────────────────────────────────────────

function drawGrid(
  ctx: CanvasRenderingContext2D,
  viewport: StaticSceneViewport,
  config: StaticSceneConfig
): void {
  const { gridSize } = config;
  const zoom = config.zoom;

  // World-space visible area
  const worldLeft = -viewport.x / zoom;
  const worldTop = -viewport.y / zoom;
  const worldRight = worldLeft + viewport.width / zoom;
  const worldBottom = worldTop + viewport.height / zoom;

  ctx.save();
  ctx.strokeStyle = config.theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
  // Keep lines 1 CSS pixel wide regardless of zoom
  ctx.lineWidth = 1 / zoom;

  // Snap start to grid
  const startX = Math.floor(worldLeft / gridSize) * gridSize;
  const startY = Math.floor(worldTop / gridSize) * gridSize;

  ctx.beginPath();
  for (let wx = startX; wx <= worldRight; wx += gridSize) {
    ctx.moveTo(wx, worldTop);
    ctx.lineTo(wx, worldBottom);
  }
  for (let wy = startY; wy <= worldBottom; wy += gridSize) {
    ctx.moveTo(worldLeft, wy);
    ctx.lineTo(worldRight, wy);
  }
  ctx.stroke();
  ctx.restore();
}

// ─── StaticSceneViewport culling ─────────────────────────────────────────────────────────

function isElementVisible(el: DriplElement, viewport: StaticSceneViewport, zoom: number): boolean {
  const padding = 20; // a little slack for stroke width / shadows
  const worldLeft = -viewport.x / zoom - padding;
  const worldTop = -viewport.y / zoom - padding;
  const worldRight = worldLeft + viewport.width / zoom + padding * 2;
  const worldBottom = worldTop + viewport.height / zoom + padding * 2;

  // For point-based elements use their bounding box
  const elLeft = el.x;
  const elTop = el.y;
  const elRight = el.x + el.width;
  const elBottom = el.y + el.height;

  return !(
    elRight < worldLeft ||
    elLeft > worldRight ||
    elBottom < worldTop ||
    elTop > worldBottom
  );
}

// ─── Per-element rendering ────────────────────────────────────────────────────

function drawElement(
  ctx: CanvasRenderingContext2D,
  element: DriplElement,
  _viewport: StaticSceneViewport,
  config: StaticSceneConfig
): void {
  // Image elements are drawn directly — no offscreen canvas needed.
  if (element.type === 'image') {
    drawImageElement(ctx, element, config);
    return;
  }

  // For everything else, get (or generate) the offscreen element canvas.
  const offscreen = getOrCreateElementCanvas(element, config);
  if (!offscreen) return;

  // Opacity — apply before drawing so it composites correctly.
  const opacity = typeof element.opacity === 'number' ? element.opacity : 1;

  ctx.save();
  ctx.globalAlpha = opacity;

  // Rotation around the element's centre point.
  if (element.angle) {
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(element.angle);
    ctx.translate(-cx, -cy);
  }

  const PADDING = 10; // must match generateElementCanvas
  const dpr = window.devicePixelRatio || 1;

  ctx.drawImage(
    offscreen,
    element.x - PADDING,
    element.y - PADDING,
    offscreen.width / dpr,
    offscreen.height / dpr
  );

  ctx.restore();
}

// ─── Offscreen element canvas (with cache) ────────────────────────────────────

const PADDING = 10;

function getOrCreateElementCanvas(
  element: DriplElement,
  config: StaticSceneConfig
): HTMLCanvasElement | null {
  const version = getElementVersion(element);
  const cached = elementCanvasCache.get(element.id);

  // O(1) version-number comparison instead of O(n) string serialization (TODO #31)
  if (cached && cached.version === version) {
    return cached.canvas;
  }

  // Generate a fresh offscreen canvas for this element.
  const canvas = generateElementCanvas(element, config);
  if (!canvas) return null;

  elementCanvasCache.set(element.id, { canvas, version });
  return canvas;
}

function generateElementCanvas(
  element: DriplElement,
  config: StaticSceneConfig
): HTMLCanvasElement | null {
  const dpr = window.devicePixelRatio || 1;

  // Guard against zero-size elements (e.g. a line being drawn)
  const rawW = Math.max(element.width, 1);
  const rawH = Math.max(element.height, 1);

  const canvas = document.createElement('canvas');
  // Add padding on each side so strokes / rough jitter don't get clipped.
  canvas.width = Math.ceil((rawW + PADDING * 2) * dpr);
  canvas.height = Math.ceil((rawH + PADDING * 2) * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Scale for hi-DPI, then translate so (0,0) in drawing coords == top-left
  // of the element's bounding box (offset by PADDING).
  ctx.scale(dpr, dpr);
  ctx.translate(PADDING, PADDING);

  const rc = createRoughCanvas(canvas);
  if (rc) {
    // renderRoughElement draws relative to element.x / element.y.
    // We translate so those become local offscreen coords.
    ctx.translate(-element.x, -element.y);
    renderRoughElement(rc, ctx, element, [], config.theme);
  }

  return canvas;
}

// ─── Image elements ───────────────────────────────────────────────────────────

function drawImageElement(
  ctx: CanvasRenderingContext2D,
  element: DriplElement,
  config: StaticSceneConfig
): void {
  const src: string | undefined = (element as any).src;
  if (!src) return;

  const opacity = typeof element.opacity === 'number' ? element.opacity : 1;

  ctx.save();
  ctx.globalAlpha = opacity;

  if (element.angle) {
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(element.angle);
    ctx.translate(-cx, -cy);
  }

  const cached = imageCache.get(src);
  if (cached?.loaded) {
    ctx.drawImage(cached.image, element.x, element.y, element.width, element.height);
  } else if (cached?.error) {
    ctx.fillStyle = config.theme === 'dark' ? 'rgba(255,100,100,0.15)' : 'rgba(255,0,0,0.1)';
    ctx.fillRect(element.x, element.y, element.width, element.height);
  } else {
    if (!cached) {
      imageCache.load(src);
    }
    ctx.fillStyle = config.theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    ctx.fillRect(element.x, element.y, element.width, element.height);
  }

  ctx.restore();
}
