import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { matchMarqueeElements, normalizeMarquee, type MarqueeRect } from '@/lib/canvas/marquee';

const rect = (id: string, x: number, y: number, extra: Partial<DriplElement> = {}): DriplElement =>
  ({
    id,
    type: 'rectangle',
    x,
    y,
    width: 10,
    height: 10,
    version: 1,
    versionNonce: 1,
    ...extra,
  }) as DriplElement;

const box: MarqueeRect = { minX: 0, minY: 0, maxX: 30, maxY: 30 };

describe('normalizeMarquee', () => {
  it('orders inverted drag spans', () => {
    expect(normalizeMarquee({ x: 30, y: 30 }, { x: 0, y: 0 })).toEqual(box);
    expect(normalizeMarquee({ x: 0, y: 0 }, { x: 30, y: 30 })).toEqual(box);
  });
});

describe('matchMarqueeElements', () => {
  const scene = [rect('inside', 5, 5), rect('straddling', 25, 25), rect('outside', 100, 100)];

  it('matches intersecting elements in intersecting mode', () => {
    expect(matchMarqueeElements(scene, box, 'intersecting')).toEqual(
      new Set(['inside', 'straddling'])
    );
  });

  it('requires full containment in contained mode', () => {
    expect(matchMarqueeElements(scene, box, 'contained')).toEqual(new Set(['inside']));
  });

  it('honors the spatial-index candidate filter', () => {
    expect(matchMarqueeElements(scene, box, 'intersecting', new Set(['outside']))).toEqual(
      new Set()
    );
  });

  it('treats edge-touch as non-intersecting (strict inequalities)', () => {
    const touching = [rect('edge', 30, 0)];
    expect(matchMarqueeElements(touching, box, 'intersecting')).toEqual(new Set());
  });

  it('skips deleted elements', () => {
    const ghosts = [rect('ghost', 5, 5, { isDeleted: true })];
    expect(matchMarqueeElements(ghosts, box, 'intersecting')).toEqual(new Set());
  });
});
