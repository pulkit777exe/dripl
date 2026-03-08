import type { DriplElement } from "@dripl/common";
import { createRoughCanvas, renderRoughElement, type RoughCanvas } from "./rough-renderer";

export interface Viewport {
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
  theme: "light" | "dark";
  dpr: number;
}

// ─── Element canvas cache ────────────────────────────────────────────────────
// Each cached entry stores:
//   canvas     – the offscreen canvas with the rendered element
//   versionKey – a hash of the properties that affect rendering.
//                If the key changes the canvas is regenerated.
interface CacheEntry {
  canvas: HTMLCanvasElement;
  versionKey: string;
}

const elementCanvasCache = new Map<string, CacheEntry>();

/**
 * Build a cheap version key from every property that visually affects an element.
 * When any of these change the element must be re-rendered into a fresh offscreen canvas.
 */
function makeVersionKey(el: DriplElement): string {
  // Include all properties that affect visual rendering
  const keyParts = [
    el.type,
    el.width,
    el.height,
    el.x,
    el.y,
    el.angle,
    el.strokeColor,
    el.backgroundColor,
    el.strokeWidth,
    el.strokeStyle,
    el.fillStyle,
    el.roughness,
    el.opacity,
    el.seed,
    // text-specific
    (el as any).text,
    (el as any).fontSize,
    (el as any).fontFamily,
    (el as any).textAlign,
    // image-specific – include only the first 32 chars of src to avoid a
    // very long key while still detecting changes
    (el as any).src?.slice(0, 32) ?? "",
    // points – serialise compactly
    (el as any).points ? JSON.stringify((el as any).points) : "",
    // arrow-specific
    (el as any).startArrowhead,
    (el as any).endArrowhead,
    // frame-specific
    (el as any).padding,
  ];

  return keyParts.filter(part => part !== undefined && part !== null).join("|");
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function renderStaticScene(
  canvas: HTMLCanvasElement,
  elements: DriplElement[],
  viewport: Viewport,
  config: StaticSceneConfig,
): void {
  const ctx = canvas.getContext("2d");
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

    // Viewport culling — skip elements fully outside the visible area.
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
  viewport: Viewport,
  config: StaticSceneConfig,
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
  // Resulting transform: pixel = (world - pan) * zoom * dpr
  ctx.scale(dpr, dpr);
  ctx.scale(config.zoom, config.zoom);
  ctx.translate(-viewport.x / config.zoom, -viewport.y / config.zoom);
}

// ─── Grid ────────────────────────────────────────────────────────────────────

function drawGrid(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  config: StaticSceneConfig,
): void {
  const { gridSize } = config;
  const zoom = config.zoom;

  // World-space visible area
  const worldLeft = viewport.x / zoom;
  const worldTop = viewport.y / zoom;
  const worldRight = worldLeft + viewport.width / zoom;
  const worldBottom = worldTop + viewport.height / zoom;

  ctx.save();
  ctx.strokeStyle =
    config.theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)";
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

// ─── Viewport culling ─────────────────────────────────────────────────────────

function isElementVisible(el: DriplElement, viewport: Viewport, zoom: number): boolean {
  const padding = 20; // a little slack for stroke width / shadows
  const worldLeft = viewport.x / zoom - padding;
  const worldTop = viewport.y / zoom - padding;
  const worldRight = worldLeft + viewport.width / zoom + padding * 2;
  const worldBottom = worldTop + viewport.height / zoom + padding * 2;

  // For point-based elements use their bounding box
  const elLeft = el.x;
  const elTop = el.y;
  const elRight = el.x + el.width;
  const elBottom = el.y + el.height;

  return !(elRight < worldLeft || elLeft > worldRight || elBottom < worldTop || elTop > worldBottom);
}

// ─── Per-element rendering ────────────────────────────────────────────────────

function drawElement(
  ctx: CanvasRenderingContext2D,
  element: DriplElement,
  viewport: Viewport,
  config: StaticSceneConfig,
): void {
  // Image elements are drawn directly — no offscreen canvas needed.
  if (element.type === "image") {
    drawImageElement(ctx, element, config);
    return;
  }

  // For everything else, get (or generate) the offscreen element canvas.
  const offscreen = getOrCreateElementCanvas(element, config);
  if (!offscreen) return;

  // Opacity — apply before drawing so it composites correctly.
  const opacity = typeof element.opacity === "number" ? element.opacity : 1;

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
    offscreen.height / dpr,
  );

  ctx.restore();
}

// ─── Offscreen element canvas (with cache) ────────────────────────────────────

const PADDING = 10;

function getOrCreateElementCanvas(
  element: DriplElement,
  config: StaticSceneConfig,
): HTMLCanvasElement | null {
  const key = makeVersionKey(element);
  const cached = elementCanvasCache.get(element.id);

  if (cached && cached.versionKey === key) {
    return cached.canvas;
  }

  // Generate a fresh offscreen canvas for this element.
  const canvas = generateElementCanvas(element, config);
  if (!canvas) return null;

  elementCanvasCache.set(element.id, { canvas, versionKey: key });
  return canvas;
}

function generateElementCanvas(
  element: DriplElement,
  config: StaticSceneConfig,
): HTMLCanvasElement | null {
  const dpr = window.devicePixelRatio || 1;

  // Guard against zero-size elements (e.g. a line being drawn)
  const rawW = Math.max(element.width, 1);
  const rawH = Math.max(element.height, 1);

  const canvas = document.createElement("canvas");
  // Add padding on each side so strokes / rough jitter don't get clipped.
  canvas.width = Math.ceil((rawW + PADDING * 2) * dpr);
  canvas.height = Math.ceil((rawH + PADDING * 2) * dpr);

  const ctx = canvas.getContext("2d");
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

// Cache decoded HTMLImageElement objects so we don't re-decode on every frame.
const imageCache = new Map<string, HTMLImageElement>();

function drawImageElement(
  ctx: CanvasRenderingContext2D,
  element: DriplElement,
  config: StaticSceneConfig,
): void {
  const src: string | undefined = (element as any).src;
  if (!src) return;

  const opacity = typeof element.opacity === "number" ? element.opacity : 1;

  ctx.save();
  ctx.globalAlpha = opacity;

  if (element.angle) {
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(element.angle);
    ctx.translate(-cx, -cy);
  }

  let img = imageCache.get(src.slice(0, 64));
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, element.x, element.y, element.width, element.height);
  } else if (!img) {
    // Start loading; render a placeholder rect until it arrives.
    img = new Image();
    img.onload = () => {
      // The next render call will find the fully decoded image in the cache.
      imageCache.set(src.slice(0, 64), img!);
    };
    img.src = src;
    imageCache.set(src.slice(0, 64), img);

    // Placeholder
    ctx.fillStyle =
      config.theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
    ctx.fillRect(element.x, element.y, element.width, element.height);
  }
  // If img exists but isn't complete yet, the placeholder was already drawn
  // on the previous frame — just skip this frame silently.

  ctx.restore();
}