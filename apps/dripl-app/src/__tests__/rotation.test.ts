import { describe, expect, it } from 'vitest';
import { computeRotationAngle } from '@/lib/canvas/rotation';

const box = { x: 0, y: 0, width: 100, height: 80 };

describe('computeRotationAngle', () => {
  it('maps pointer-straight-up to angle 0', () => {
    expect(computeRotationAngle(box, 50, -100)).toBeCloseTo(0, 10);
  });

  it('maps pointer-right to +PI/2', () => {
    expect(computeRotationAngle(box, 200, 40)).toBeCloseTo(Math.PI / 2, 10);
  });

  it('maps pointer-down to PI', () => {
    expect(computeRotationAngle(box, 50, 200)).toBeCloseTo(Math.PI, 10);
  });

  it('maps pointer-left to 3PI/2 (raw atan2 range, congruent to -PI/2)', () => {
    expect(computeRotationAngle(box, -100, 40)).toBeCloseTo((3 * Math.PI) / 2, 10);
  });
});
