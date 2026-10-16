import { getStroke } from 'perfect-freehand';
import type { DriplElement, Point } from '@dripl/common';

/**
 * Freedraw outline geometry — shared by the static (cached bitmap) and
 * interactive (draft preview) renderers so a stroke looks identical while
 * being drawn and after commit.
 *
 * Mirrors Excalidraw's variable-width freedraw path
 * (`packages/element/src/shape.ts`): `perfect-freehand`'s `getStroke` with
 * `size = strokeWidth * 4.25`, `thinning 0.6`, `smoothing 0.5`, easeOutSine
 * easing and `last: true`. Dripl stores per-sample `pressureValues` (0-1);
 * when they are absent or length-mismatched we fall back to simulated
 * pressure, which is Excalidraw's `simulatePressure` behaviour.
 */

const SIZE_FACTOR = 4.25;
const THINNING = 0.6;
const SMOOTHING = 0.5;
const STREAMLINE = 0.5;
const MIN_OUTLINE_POINTS = 2;

function easeOutSine(t: number): number {
  return Math.sin((t * Math.PI) / 2);
}

function toWorldPoints(element: DriplElement): Point[] {
  if (!('points' in element) || !Array.isArray(element.points)) return [];
  const pts = element.points as Point[];
  return pts
    .filter(p => Boolean(p) && Number.isFinite(p?.x) && Number.isFinite(p?.y))
    .map(p => ({ x: p.x + element.x, y: p.y + element.y }));
}

function inputForStroke(
  world: Point[],
  element: DriplElement
): number[][] | { points: number[][]; simulatePressure: true } {
  const pressures =
    'pressureValues' in element && Array.isArray(element.pressureValues)
      ? (element.pressureValues as number[])
      : undefined;
  if (pressures && pressures.length === world.length && world.length > 0) {
    return world.map((p, i) => [p.x, p.y, pressures[i] ?? 0.5]);
  }
  return { points: world.map(p => [p.x, p.y]), simulatePressure: true as const };
}

/**
 * Outline polygon for a freedraw element in world coordinates.
 * Returns an empty array for empty input, and a small dot polygon for a
 * single point so taps remain visible.
 */
export function getFreedrawOutline(element: DriplElement): Point[] {
  const world = toWorldPoints(element);
  if (world.length === 0) return [];
  const strokeWidth =
    typeof element.strokeWidth === 'number' && element.strokeWidth > 0 ? element.strokeWidth : 2;

  if (world.length === 1) {
    const only = world[0]!;
    const r = Math.max(1, (strokeWidth * SIZE_FACTOR) / 4);
    const outline: Point[] = [];
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      outline.push({ x: only.x + Math.cos(a) * r, y: only.y + Math.sin(a) * r });
    }
    return outline;
  }

  const input = inputForStroke(world, element);
  const options = {
    size: strokeWidth * SIZE_FACTOR,
    thinning: THINNING,
    smoothing: SMOOTHING,
    streamline: STREAMLINE,
    easing: easeOutSine,
    last: true,
    ...(Array.isArray(input) ? { simulatePressure: false } : { simulatePressure: true }),
  };
  const strokeInput = Array.isArray(input) ? input : input.points;
  const outline = getStroke(strokeInput, options) as unknown as Array<[number, number]>;
  if (!outline || outline.length < MIN_OUTLINE_POINTS) return world;
  return outline.map(([x, y]) => ({ x, y }));
}
