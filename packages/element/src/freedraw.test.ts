import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { getFreedrawOutline } from './freedraw';
import { adjustRoughnessForSize, getRoughOptionsForElement } from './rough-renderer';

function freedraw(
  points: Array<{ x: number; y: number }>,
  overrides: Record<string, unknown> = {}
): DriplElement {
  return {
    id: 'f1',
    type: 'freedraw',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    points,
    ...overrides,
  } as unknown as DriplElement;
}

describe('getFreedrawOutline', () => {
  it('returns no outline for an empty stroke', () => {
    expect(getFreedrawOutline(freedraw([]))).toEqual([]);
  });

  it('renders a tap as a closed dot polygon so clicks stay visible', () => {
    const outline = getFreedrawOutline(freedraw([{ x: 10, y: 10 }]));
    expect(outline.length).toBeGreaterThanOrEqual(8);
    for (const p of outline) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    const cx = outline.reduce((sum, p) => sum + p.x, 0) / outline.length;
    const cy = outline.reduce((sum, p) => sum + p.y, 0) / outline.length;
    expect(cx).toBeCloseTo(10, 6);
    expect(cy).toBeCloseTo(10, 6);
  });

  it('produces a closed pressure-aware outline wider than the centreline', () => {
    const outline = getFreedrawOutline(
      freedraw([
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 40, y: 0 },
        { x: 60, y: 0 },
      ])
    );
    // perfect-freehand returns a closed ring around the stroke.
    expect(outline.length).toBeGreaterThan(4);
    const ys = outline.map(p => p.y);
    // strokeWidth 2 * SIZE_FACTOR 4.25 = 8.5 nominal width: the outline must
    // extend several px either side of the y=0 centreline.
    expect(Math.min(...ys)).toBeLessThan(-2);
    expect(Math.max(...ys)).toBeGreaterThan(2);
  });

  it('honours stored pressure values when their length matches the points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 40, y: 0 },
    ];
    const light = getFreedrawOutline(freedraw(points, { pressureValues: [0.1, 0.1, 0.1] }));
    const heavy = getFreedrawOutline(freedraw(points, { pressureValues: [1, 1, 1] }));
    const span = (poly: Array<{ x: number; y: number }>): number => {
      const ys = poly.map(p => p.y);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(span(heavy)).toBeGreaterThan(span(light));
  });

  it('offsets the outline by the element origin', () => {
    const outline = getFreedrawOutline(
      freedraw(
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 40, y: 0 },
        ],
        { x: 100, y: 50 }
      )
    );
    const xs = outline.map(p => p.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(95);
    expect(Math.max(...xs)).toBeLessThanOrEqual(145);
  });

  it('emits only finite coordinates', () => {
    const outline = getFreedrawOutline(
      freedraw(
        Array.from({ length: 20 }, (_, i) => ({ x: i * 3, y: (i % 2) * 5 })),
        { pressureValues: Array.from({ length: 20 }, (_, i) => (i % 5) / 5) }
      )
    );
    for (const p of outline) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

describe('adjustRoughnessForSize', () => {
  const el = (width: number, height: number, roughness = 1): DriplElement =>
    ({ id: 'e', width, height, roughness }) as DriplElement;

  it('leaves normal-size roughness untouched', () => {
    expect(adjustRoughnessForSize(el(120, 80))).toBe(1);
  });

  it('dampens roughness for small elements so they stay recognisable', () => {
    expect(adjustRoughnessForSize(el(30, 30))).toBeCloseTo(0.6, 10);
    expect(adjustRoughnessForSize(el(10, 10))).toBeCloseTo(0.3, 10);
  });
});

describe('getRoughOptionsForElement', () => {
  const el = (overrides: Record<string, unknown> = {}): DriplElement =>
    ({
      id: 'e',
      type: 'rectangle',
      width: 120,
      height: 80,
      strokeColor: '#1e1e1e',
      strokeWidth: 2,
      roughness: 1,
      ...overrides,
    }) as unknown as DriplElement;

  it('preserves vertices for low-roughness shapes', () => {
    expect(getRoughOptionsForElement(el({ roughness: 0 })).preserveVertices).toBe(true);
    expect(getRoughOptionsForElement(el({ roughness: 1.5 })).preserveVertices).toBe(false);
  });

  it('uses curve fitting for ellipses', () => {
    expect(getRoughOptionsForElement(el({ type: 'ellipse' })).curveFitting).toBe(1);
    expect('curveFitting' in getRoughOptionsForElement(el({ type: 'rectangle' }))).toBe(false);
  });
});
