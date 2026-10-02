import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import {
  buildBoundArrowsByShape,
  updateBoundArrows,
  updateBoundLabels,
} from '@/lib/canvas/binding-sync';

const rect = (id: string, extra: Partial<DriplElement> = {}): DriplElement =>
  ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    version: 1,
    versionNonce: 1,
    ...extra,
  }) as DriplElement;

const arrow = (id: string, extra: Partial<DriplElement> = {}): DriplElement =>
  ({
    id,
    type: 'arrow',
    x: 100,
    y: 0,
    width: 60,
    height: 10,
    version: 1,
    versionNonce: 1,
    points: [
      { x: 0, y: 5 },
      { x: 60, y: 5 },
    ],
    ...extra,
  }) as DriplElement;

describe('buildBoundArrowsByShape', () => {
  it('indexes arrows bound to a shape, ignoring text bindings', () => {
    const shape = rect('shape', {
      boundElements: [
        { id: 'arrow-1', type: 'arrow' },
        { id: 'label-1', type: 'text' },
      ],
    });
    const index = buildBoundArrowsByShape([shape, arrow('arrow-1')]);
    expect(index.get('shape')).toEqual(new Set(['arrow-1']));
  });

  it('returns an empty index when nothing is bound', () => {
    expect(buildBoundArrowsByShape([rect('a'), arrow('b')]).size).toBe(0);
  });
});

describe('updateBoundArrows', () => {
  it('is a no-op when no moved id has bound arrows', () => {
    const shape = rect('shape');
    const byId = new Map([
      ['shape', shape],
      ['arrow-1', arrow('arrow-1')],
    ]);
    const updates = new Map<string, Partial<DriplElement>>();
    updateBoundArrows(new Set(['unrelated']), byId, new Map(), updates);
    expect(updates.size).toBe(0);
  });

  it('recomputes the bound endpoint when its target moves', () => {
    const shape = rect('shape', { x: 10, y: 10 });
    const bound = arrow('arrow-1', {
      startBinding: { elementId: 'shape', fixedPoint: { x: 0.5, y: 0 }, mode: 'inside' },
    });
    const byId = new Map([
      ['shape', shape],
      ['arrow-1', bound],
    ]);
    const index = new Map([['shape', new Set(['arrow-1'])]]);
    const updates = new Map<string, Partial<DriplElement>>();
    updateBoundArrows(new Set(['shape']), byId, index, updates);
    const updated = updates.get('arrow-1');
    expect(updated).toBeDefined();
    const points = (updated as DriplElement & { points: Array<{ x: number; y: number }> }).points;
    // Start endpoint re-anchored relative to the arrow origin; end untouched.
    expect(points[0]).not.toEqual({ x: 0, y: 5 });
    expect(points[1]).toEqual({ x: 60, y: 5 });
  });

  it('skips arrows whose binding target did not move', () => {
    const shape = rect('shape');
    const other = rect('other');
    const bound = arrow('arrow-1', {
      startBinding: { elementId: 'other', fixedPoint: { x: 0.5, y: 0 }, mode: 'inside' },
    });
    const byId = new Map([
      ['shape', shape],
      ['other', other],
      ['arrow-1', bound],
    ]);
    const index = new Map([['other', new Set(['arrow-1'])]]);
    const updates = new Map<string, Partial<DriplElement>>();
    updateBoundArrows(new Set(['shape']), byId, index, updates);
    expect(updates.size).toBe(0);
  });
});

describe('updateBoundLabels', () => {
  it('tracks arrow labels via bound text entries', () => {
    const label = {
      id: 'label-1',
      type: 'text',
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      text: 'hi',
      fontSize: 20,
    } as unknown as DriplElement;
    const owner = arrow('owner', {
      boundElements: [{ id: 'label-1', type: 'text' }],
    });
    const byId = new Map([
      ['owner', owner],
      ['label-1', label],
    ]);
    const updates = new Map<string, Partial<DriplElement>>();
    updateBoundLabels(new Set(['owner']), byId, updates);
    const updated = updates.get('label-1') as unknown as { x: number; y: number };
    expect(updated).toBeDefined();
    // Arrow midpoint (130,5), label 40×20 centered on it → (110,-5).
    expect(updated.x).toBeCloseTo(110, 10);
    expect(updated.y).toBeCloseTo(-5, 10);
  });

  it('is a no-op for owners without labels', () => {
    const byId = new Map([['owner', rect('owner')]]);
    const updates = new Map<string, Partial<DriplElement>>();
    updateBoundLabels(new Set(['owner']), byId, updates);
    expect(updates.size).toBe(0);
  });
});
