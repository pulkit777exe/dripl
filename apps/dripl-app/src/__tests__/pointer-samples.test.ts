import { describe, expect, it } from 'vitest';
import {
  capPointerSamples,
  MAX_PENDING_POINTER_SAMPLES,
  MAX_POINTER_SAMPLES_PER_FRAME,
} from '@/lib/canvas/pointer-samples';

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

describe('capPointerSamples', () => {
  it('passes through inputs at or under the cap by reference', () => {
    const samples = range(MAX_POINTER_SAMPLES_PER_FRAME);
    expect(capPointerSamples(samples, -1)).toBe(samples);
  });

  it('decimates evenly to exactly the cap, preserving the latest', () => {
    const samples = range(200);
    const out = capPointerSamples(samples, 999);
    expect(out).toHaveLength(MAX_POINTER_SAMPLES_PER_FRAME);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(999);
    // Even spacing: consecutive outputs differ by ~3 input steps.
    for (let i = 1; i < out.length - 1; i++) {
      expect(out[i]! - out[i - 1]!).toBeGreaterThanOrEqual(2);
      expect(out[i]! - out[i - 1]!).toBeLessThanOrEqual(4);
    }
  });

  it('keeps the pending-queue bound above the per-frame cap', () => {
    expect(MAX_PENDING_POINTER_SAMPLES).toBeGreaterThan(MAX_POINTER_SAMPLES_PER_FRAME);
  });
});
