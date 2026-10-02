import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { findNearestShape } from '@/lib/draw/find-shape';

const rect = (id: string, x: number): DriplElement =>
  ({
    id,
    type: 'rectangle',
    x,
    y: 0,
    width: 100,
    height: 80,
    version: 1,
    versionNonce: 1,
  }) as DriplElement;

describe('findNearestShape', () => {
  it('returns the nearest shape within the threshold', () => {
    const near = rect('near', 0);
    const far = rect('far', 500);
    const hit = findNearestShape({ x: 50, y: 40 }, [far, near], 'arrow-1');
    expect(hit?.element.id).toBe('near');
    expect(hit?.binding.elementId).toBe('near');
    expect(hit?.binding.mode).toBe('orbit');
  });

  it('returns null beyond the snap threshold', () => {
    expect(findNearestShape({ x: 1000, y: 1000 }, [rect('a', 0)], 'arrow-1')).toBeNull();
  });

  it('skips the excluded id and linear elements', () => {
    const self = rect('self', 0);
    const line = { ...rect('line', 0), type: 'line' } as DriplElement;
    const other = rect('other', 0);
    const hit = findNearestShape({ x: 50, y: 40 }, [self, line, other], 'self');
    expect(hit?.element.id).toBe('other');
  });
});
