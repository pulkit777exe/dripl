import { describe, expect, it } from 'vitest';
import { getDistance, perpendicularDistance, simplifyRdp, snapAngle } from '@/lib/draw/simplify';

describe('getDistance', () => {
  it('measures Euclidean distance', () => {
    expect(getDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('snapAngle', () => {
  it('snaps to the nearest 15° step preserving radius', () => {
    const out = snapAngle({ x: 0, y: 0 }, { x: 10, y: 1 });
    expect(out.x).toBeCloseTo(10, 0);
    expect(out.y).toBeCloseTo(0, 0);
  });

  it('returns the endpoint when distance is zero', () => {
    const end = { x: 5, y: 5 };
    expect(snapAngle({ x: 5, y: 5 }, end)).toBe(end);
  });

  it('snaps a 40° drag to 45°', () => {
    const rad = (40 * Math.PI) / 180;
    const out = snapAngle({ x: 0, y: 0 }, { x: Math.cos(rad) * 10, y: Math.sin(rad) * 10 });
    expect(Math.atan2(out.y, out.x)).toBeCloseTo(Math.PI / 4, 8);
  });
});

describe('perpendicularDistance', () => {
  it('falls back to point distance for degenerate segments', () => {
    expect(perpendicularDistance({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });

  it('measures height from the segment line', () => {
    expect(perpendicularDistance({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
  });
});

describe('simplifyRdp', () => {
  it('passes through short inputs', () => {
    expect(simplifyRdp([], 1)).toEqual([]);
    expect(simplifyRdp([{ x: 0, y: 0 }], 1)).toEqual([{ x: 0, y: 0 }]);
  });

  it('collapses collinear runs to endpoints', () => {
    const line = [0, 1, 2, 3, 4].map(x => ({ x, y: 2 * x }));
    expect(simplifyRdp(line, 0.8)).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 8 },
    ]);
  });

  it('keeps deviations above epsilon', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 0 },
    ];
    expect(simplifyRdp(points, 0.8)).toEqual(points);
  });

  it('recurses on both sides of the split', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 2, y: 4 },
      { x: 4, y: 0 },
      { x: 6, y: 4 },
      { x: 8, y: 0 },
    ];
    const out = simplifyRdp(points, 0.8);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 8, y: 0 });
    expect(out.length).toBeGreaterThan(2);
  });
});
