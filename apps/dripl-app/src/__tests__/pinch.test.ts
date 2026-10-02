import { describe, expect, it } from 'vitest';
import { pinchDistance, pinchMidpoint, pinchZoomTransform } from '@/lib/canvas/pinch';

describe('pinchDistance', () => {
  it('measures finger separation floored at 1px', () => {
    expect(pinchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(pinchDistance({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(1);
  });
});

describe('pinchMidpoint', () => {
  it('averages the two touch points', () => {
    expect(pinchMidpoint({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
  });
});

describe('pinchZoomTransform', () => {
  const start = {
    mid: { x: 100, y: 100 },
    zoom: 1,
    pan: { x: 0, y: 0 },
    distance: 100,
  };

  it('zooms around the gesture midpoint, keeping the world anchor fixed', () => {
    const out = pinchZoomTransform(start, { x: 100, y: 100 }, 200);
    expect(out.zoom).toBe(2);
    // World point under the start mid was (100, 100); it stays put.
    expect(out.panX + 100 * out.zoom).toBeCloseTo(100, 9);
    expect(out.panY + 100 * out.zoom).toBeCloseTo(100, 9);
  });

  it('pans with the midpoint at constant zoom', () => {
    const out = pinchZoomTransform(start, { x: 120, y: 90 }, 100);
    expect(out.zoom).toBe(1);
    expect(out.panX).toBe(20);
    expect(out.panY).toBe(-10);
  });

  it('clamps zoom to [0.1, 20]', () => {
    expect(pinchZoomTransform(start, { x: 0, y: 0 }, 10_000).zoom).toBe(20);
    expect(pinchZoomTransform(start, { x: 0, y: 0 }, 0.001).zoom).toBe(0.1);
  });
});
