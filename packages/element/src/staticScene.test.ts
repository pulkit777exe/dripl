import { describe, expect, it } from 'vitest';

import { computeElementCanvasSize } from './staticScene';

// Mirrors ELEMENT_CANVAS_AREA_LIMIT / ELEMENT_CANVAS_AXIS_LIMIT, and matches
// Excalidraw's `cappedElementCanvasSize` (renderer/renderElement.ts:160-199 at
// v0.18.1, commit a2ec2889babf7d2295469c6d90ebe77fae57df84).
const AREA_LIMIT = 16_777_216;
const AXIS_LIMIT = 32_767;
const PADDING = 10;

describe('computeElementCanvasSize', () => {
  it('leaves an ordinary element uncapped', () => {
    const size = computeElementCanvasSize(200, 160, 1, PADDING);
    expect(size).toEqual({ width: 220, height: 180, scale: 1 });
  });

  it('applies device pixel ratio', () => {
    const size = computeElementCanvasSize(100, 50, 2, PADDING);
    expect(size).toEqual({ width: 240, height: 140, scale: 1 });
  });

  it('treats a zero or negative dpr as 1 instead of collapsing the bitmap', () => {
    expect(computeElementCanvasSize(100, 50, 0, PADDING)).toEqual({
      width: 120,
      height: 70,
      scale: 1,
    });
  });

  it('never returns a zero-sized canvas for a degenerate element', () => {
    const size = computeElementCanvasSize(0, 0, 1, PADDING);
    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });

  it('caps a single axis beyond the browser per-axis limit', () => {
    // 40,000 world px at dpr 1 would ask for a 40,020 px surface.
    const size = computeElementCanvasSize(40_000, 100, 1, PADDING);
    expect(size.width).toBeLessThanOrEqual(AXIS_LIMIT);
    expect(size.height).toBeLessThanOrEqual(AXIS_LIMIT);
    expect(size.scale).toBeLessThan(1);
  });

  it('caps total area for a large square element', () => {
    // 8,000 x 8,000 is 64M pixels without a cap: over 4x the area limit.
    const size = computeElementCanvasSize(8_000, 8_000, 1, PADDING);
    expect(size.width * size.height).toBeLessThanOrEqual(AREA_LIMIT);
    expect(size.width).toBeLessThanOrEqual(AXIS_LIMIT);
    expect(size.height).toBeLessThanOrEqual(AXIS_LIMIT);
  });

  it('keeps a pathologically large element inside both limits', () => {
    // ~1.6 billion pixels if uncapped. This must not throw and must stay
    // allocatable.
    const size = computeElementCanvasSize(40_000, 40_000, 1, PADDING);
    expect(size.width * size.height).toBeLessThanOrEqual(AREA_LIMIT);
    expect(Number.isFinite(size.scale)).toBe(true);
    expect(size.scale).toBeGreaterThan(0);
  });

  it('preserves aspect ratio when downscaling', () => {
    const wide = computeElementCanvasSize(20_000, 1_000, 1, PADDING);
    const sourceRatio = (20_000 + PADDING * 2) / (1_000 + PADDING * 2);
    const resultRatio = wide.width / wide.height;
    expect(resultRatio).toBeCloseTo(sourceRatio, 1);
  });

  it('does not cap an element that is large only because of a high dpr', () => {
    // 2,000 world px at dpr 2 is 4,040 px per axis: legal, and under the area
    // limit, so it must pass through untouched.
    const size = computeElementCanvasSize(2_000, 2_000, 2, PADDING);
    expect(size.scale).toBe(1);
    expect(size.width).toBe(4_040);
  });
});
