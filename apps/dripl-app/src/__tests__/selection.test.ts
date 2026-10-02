import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { expandSelectionWithGroups, getSelectionBounds } from '@/lib/store/selection';

const rect = (id: string, extra: Partial<DriplElement> = {}): DriplElement =>
  ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version: 1,
    versionNonce: 1,
    ...extra,
  }) as DriplElement;

describe('expandSelectionWithGroups', () => {
  it('returns the input when nothing is grouped', () => {
    const scene = [rect('a'), rect('b')];
    expect(expandSelectionWithGroups(new Set(['a']), scene)).toEqual(new Set(['a']));
  });

  it('pulls in every element sharing a group', () => {
    const scene = [
      rect('a', { groupId: 'g1' }),
      rect('b', { groupId: 'g1' }),
      rect('c', { groupId: 'g2' }),
    ];
    expect(expandSelectionWithGroups(new Set(['a']), scene)).toEqual(new Set(['a', 'b']));
  });

  it('returns an empty set for empty input', () => {
    expect(expandSelectionWithGroups(new Set(), [rect('a')])).toEqual(new Set());
  });
});

describe('getSelectionBounds', () => {
  it('returns null for an empty selection', () => {
    expect(getSelectionBounds(new Set(), [rect('a')])).toBeNull();
  });

  it('unions bounds of the selected elements only', () => {
    const scene = [
      rect('a', { x: 0, y: 0, width: 10, height: 10 }),
      rect('b', { x: 20, y: 30, width: 10, height: 10 }),
      rect('c', { x: 100, y: 100, width: 10, height: 10 }),
    ];
    expect(getSelectionBounds(new Set(['a', 'b']), scene)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 30,
      maxY: 40,
    });
  });
});
