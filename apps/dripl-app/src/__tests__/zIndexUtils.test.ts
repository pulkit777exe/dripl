import { describe, it, expect } from 'vitest';
import {
  sortElementsByZIndex,
  sortElementsByZIndexDescending,
  bringToFront,
  sendToBack,
  bringForward,
  sendBackward,
  getZIndexRange,
  normalizeZIndices,
} from '../../utils/zIndexUtils';
import type { DriplElement } from '@dripl/common';

function rect(id: string, fractionalIndex: string): DriplElement {
  return {
    type: 'rectangle',
    id,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    fractionalIndex,
  } as DriplElement;
}

describe('zIndexUtils', () => {
  const elements = [
    rect('a', 'a0'),
    rect('b', 'a1'),
    rect('c', 'a2'),
  ];

  describe('sortElementsByZIndex', () => {
    it('sorts by fractional index ascending', () => {
      const sorted = sortElementsByZIndex([elements[2], elements[0], elements[1]]);
      expect(sorted.map(e => e.id)).toEqual(['a', 'b', 'c']);
    });

    it('handles empty fractional index', () => {
      const withEmpty = [rect('x', ''), rect('a', 'a0')];
      const sorted = sortElementsByZIndex(withEmpty);
      expect(sorted[0].id).toBe('x');
    });
  });

  describe('sortElementsByZIndexDescending', () => {
    it('sorts by fractional index descending', () => {
      const sorted = sortElementsByZIndexDescending(elements);
      expect(sorted.map(e => e.id)).toEqual(['c', 'b', 'a']);
    });
  });

  describe('bringToFront', () => {
    it('moves element to highest index', () => {
      const result = bringToFront(elements[0], elements);
      expect(result.fractionalIndex).toBeTruthy();
      // After bringToFront, it should sort last
      const all = sortElementsByZIndex([...elements.slice(1), result]);
      expect(all[all.length - 1].id).toBe('a');
    });
  });

  describe('sendToBack', () => {
    it('moves element to lowest index', () => {
      const result = sendToBack(elements[2], elements);
      expect(result.fractionalIndex).toBeTruthy();
      // After sendToBack, it should sort first
      const all = sortElementsByZIndex([...elements.slice(0, 2), result]);
      expect(all[0].id).toBe('c');
    });
  });

  describe('bringForward', () => {
    it('moves element one position forward', () => {
      const result = bringForward(elements[0], elements);
      expect(result.fractionalIndex).toBeTruthy();
      // Should now be between b and c
      const sorted = sortElementsByZIndex([result, elements[1], elements[2]]);
      const idx = sorted.findIndex(e => e.id === 'a');
      expect(idx).toBe(1);
    });

    it('returns same element if already at front', () => {
      const result = bringForward(elements[2], elements);
      expect(result.id).toBe('c');
      expect(result).toBe(elements[2]);
    });
  });

  describe('sendBackward', () => {
    it('moves element one position backward', () => {
      const result = sendBackward(elements[2], elements);
      expect(result.fractionalIndex).toBeTruthy();
      // Should now be between a and b
      const sorted = sortElementsByZIndex([elements[0], elements[1], result]);
      const idx = sorted.findIndex(e => e.id === 'c');
      expect(idx).toBe(1);
    });

    it('returns same element if already at back', () => {
      const result = sendBackward(elements[0], elements);
      expect(result.id).toBe('a');
      expect(result).toBe(elements[0]);
    });
  });

  describe('getZIndexRange', () => {
    it('returns min/max range', () => {
      const range = getZIndexRange(elements);
      expect(range).toEqual({ min: 0, max: 2 });
    });

    it('returns 0/0 for single element', () => {
      const range = getZIndexRange([elements[0]]);
      expect(range).toEqual({ min: 0, max: 0 });
    });
  });

  describe('normalizeZIndices', () => {
    it('reindexes elements with no gaps', () => {
      const result = normalizeZIndices(elements);
      expect(result).toHaveLength(3);
      // Each should have a valid fractional index
      result.forEach(el => {
        expect(el.fractionalIndex).toBeTruthy();
      });
    });
  });
});
