import type { DriplElement, Point } from '@dripl/common';

/**
 * Element style primitives — extracted verbatim from `interactiveScene.ts`.
 *
 * Every shape renderer reads stroke/fill/width/opacity/roughness through
 * these getters (with the same fallbacks and clamps), and every
 * hand-drawn pass goes through `strokeCurrentPath` (roughness-gated
 * multi-pass jitter). Single home, zero drift between shapes.
 */

export function getStrokeColor(element: DriplElement): string {
  return element.strokeColor ?? '#000000';
}

export function getFillColor(element: DriplElement): string {
  if ('fillColor' in element && typeof element.fillColor === 'string') {
    return element.fillColor;
  }
  return element.backgroundColor ?? 'transparent';
}

export function getStrokeWidth(element: DriplElement): number {
  return Math.max(0.5, element.strokeWidth ?? 2);
}

export function getOpacity(element: DriplElement): number {
  return Math.max(0, Math.min(1, element.opacity ?? 1));
}

export function getRoughness(element: DriplElement): number {
  const roughness =
    'roughness' in element && typeof element.roughness === 'number' ? element.roughness : 1;
  return Math.max(0, Math.min(2, roughness));
}

export function getPathPoints(element: DriplElement): Point[] {
  if (!('points' in element) || !Array.isArray(element.points)) {
    return [];
  }

  return element.points
    .filter(
      // `Number.isFinite`, not `typeof === 'number'`: `typeof NaN` is 'number',
      // so a type check alone lets a non-finite point through and emits NaN
      // path coordinates, which canvas silently drops mid-path. `PointSchema`
      // in `@dripl/common` is `z.number().finite()`, and this re-derivation of
      // point validity must agree with it.
      (point): point is Point =>
        Boolean(point) && Number.isFinite(point.x) && Number.isFinite(point.y)
    )
    .map(point => ({
      x: point.x + element.x,
      y: point.y + element.y,
    }));
}

export function applyStrokeAndFill(ctx: CanvasRenderingContext2D, element: DriplElement) {
  ctx.strokeStyle = getStrokeColor(element);
  ctx.fillStyle = getFillColor(element);
  ctx.lineWidth = getStrokeWidth(element);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

export function getRoughPasses(element: DriplElement): number {
  const roughness = getRoughness(element);
  if (roughness <= 0.1) return 1;
  return Math.min(5, 1 + Math.round(roughness * 2));
}

export function roughJitterOffset(pass: number, zoom: number): number {
  if (pass === 0) return 0;
  const amplitude = 0.7 / Math.max(zoom, 0.1);
  return ((pass % 2 === 0 ? 1 : -1) * amplitude * pass) / 2;
}

export function strokeCurrentPath(
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

export function rotateAroundElementCenter(ctx: CanvasRenderingContext2D, element: DriplElement) {
  const angle = element.angle ?? 0;
  if (!angle) return;
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  ctx.translate(centerX, centerY);
  ctx.rotate(angle);
  ctx.translate(-centerX, -centerY);
}
