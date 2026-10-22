import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { linear } from './helpers/elements';
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

  it('does not select a hollow shape from a marquee inside its interior', () => {
    // Regression: bounds-only selection selected a transparent rectangle when
    // the marquee never touched its outline. Excalidraw treats the outline as
    // the hit target when there is no fill.
    const hollow = [
      rect('hollow', 0, 0, { width: 100, height: 100, backgroundColor: 'transparent' }),
    ];
    const interior: MarqueeRect = { minX: 20, minY: 20, maxX: 40, maxY: 40 };
    expect(matchMarqueeElements(hollow, interior, 'intersecting')).toEqual(new Set());
  });

  it('selects a hollow shape when the marquee crosses its outline', () => {
    const hollow = [
      rect('hollow', 0, 0, { width: 100, height: 100, backgroundColor: 'transparent' }),
    ];
    const crossing: MarqueeRect = { minX: -10, minY: 50, maxX: 50, maxY: 60 };
    expect(matchMarqueeElements(hollow, crossing, 'intersecting')).toEqual(new Set(['hollow']));
  });

  it('selects a filled shape from a marquee inside its interior', () => {
    const filled = [rect('filled', 0, 0, { width: 100, height: 100, backgroundColor: '#ffffff' })];
    const interior: MarqueeRect = { minX: 20, minY: 20, maxX: 40, maxY: 40 };
    expect(matchMarqueeElements(filled, interior, 'intersecting')).toEqual(new Set(['filled']));
  });

  it('selects a hollow shape when the marquee contains the whole outline', () => {
    const hollow = [
      rect('hollow', 0, 0, { width: 100, height: 100, backgroundColor: 'transparent' }),
    ];
    const around: MarqueeRect = { minX: -10, minY: -10, maxX: 110, maxY: 110 };
    expect(matchMarqueeElements(hollow, around, 'intersecting')).toEqual(new Set(['hollow']));
  });

  it('does not select an arrow from a marquee inside its bounding box but off the path', () => {
    const arrow = linear('arrow', 'arrow', [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ]);
    const corner: MarqueeRect = { minX: 0, minY: 80, maxX: 20, maxY: 100 };
    expect(matchMarqueeElements([arrow], corner, 'intersecting')).toEqual(new Set());
  });

  it('selects an arrow when the marquee crosses the path', () => {
    const arrow = linear('arrow', 'arrow', [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ]);
    const crossing: MarqueeRect = { minX: 40, minY: 40, maxX: 60, maxY: 60 };
    expect(matchMarqueeElements([arrow], crossing, 'intersecting')).toEqual(new Set(['arrow']));
  });
});
