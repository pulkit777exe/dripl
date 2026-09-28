import { describe, it, expect } from 'vitest';
import {
  sortElementsByZIndex,
  bringToFront,
  sendToBack,
  bringForward,
  sendBackward,
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
  const elements = [rect('a', 'a0'), rect('b', 'a1'), rect('c', 'a2')];

  describe('sortElementsByZIndex', () => {
    it('sorts by fractional index ascending', () => {
      const sorted = sortElementsByZIndex([elements[2]!, elements[0]!, elements[1]!]);
      expect(sorted.map(e => e.id)).toEqual(['a', 'b', 'c']);
    });

    it('handles empty fractional index', () => {
      const withEmpty = [rect('x', ''), rect('a', 'a0')];
      const sorted = sortElementsByZIndex(withEmpty);
      expect(sorted[0]!.id).toBe('x');
    });
  });

  describe('bringToFront', () => {
    it('moves element to highest index', () => {
      const result = bringToFront(elements[0]!, elements);
      expect(result.fractionalIndex).toBeTruthy();
      const all = sortElementsByZIndex([...elements.slice(1), result]);
      expect(all[all.length - 1]!.id).toBe('a');
    });
  });

  describe('sendToBack', () => {
    it('moves element to lowest index', () => {
      const result = sendToBack(elements[2]!, elements);
      expect(result.fractionalIndex).toBeTruthy();
      const all = sortElementsByZIndex([...elements.slice(0, 2), result]);
      expect(all[0]!.id).toBe('c');
    });
  });

  describe('bringForward', () => {
    it('moves element one position forward', () => {
      const result = bringForward(elements[0]!, elements);
      expect(result.fractionalIndex).toBeTruthy();
      const sorted = sortElementsByZIndex([result, elements[1]!, elements[2]!]);
      const idx = sorted.findIndex(e => e.id === 'a');
      expect(idx).toBe(1);
    });

    it('returns same element if already at front', () => {
      const result = bringForward(elements[2]!, elements);
      expect(result.id).toBe('c');
      expect(result).toBe(elements[2]);
    });
  });

  describe('sendBackward', () => {
    it('moves element one position backward', () => {
      const result = sendBackward(elements[2]!, elements);
      expect(result.fractionalIndex).toBeTruthy();
      const sorted = sortElementsByZIndex([elements[0]!, elements[1]!, result]);
      const idx = sorted.findIndex(e => e.id === 'c');
      expect(idx).toBe(1);
    });

    it('returns same element if already at back', () => {
      const result = sendBackward(elements[0]!, elements);
      expect(result.id).toBe('a');
      expect(result).toBe(elements[0]);
    });
  });
});
