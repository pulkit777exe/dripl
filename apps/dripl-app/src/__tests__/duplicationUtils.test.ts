import { describe, it, expect } from 'vitest';
import {
  createElementCopy,
  duplicateElement,
  duplicateElements,
  duplicateElementWithBoundText,
} from '../../utils/duplicationUtils';
import type { DriplElement } from '@dripl/common';

function rect(id: string, overrides: Partial<DriplElement> = {}): DriplElement {
  return {
    type: 'rectangle',
    id,
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    ...overrides,
  } as DriplElement;
}

function text(id: string, boundElementId?: string): DriplElement {
  return {
    type: 'text',
    id,
    x: 15,
    y: 25,
    width: 80,
    height: 20,
    text: 'Hello',
    boundElementId,
  } as DriplElement;
}

describe('duplicationUtils', () => {
  describe('createElementCopy', () => {
    it('creates a copy with new ID', () => {
      const original = rect('original');
      const copy = createElementCopy(original);
      expect(copy.id).not.toBe('original');
      expect(copy.id).toBeTruthy();
      expect(copy.x).toBe(original.x);
      expect(copy.type).toBe('rectangle');
    });

    it('resets isDeleted', () => {
      const original = rect('deleted', { isDeleted: true } as any);
      const copy = createElementCopy(original);
      expect(copy.isDeleted).toBe(false);
    });

    it('clears boundElementId', () => {
      const original = rect('bound', { boundElementId: 'parent' } as any);
      const copy = createElementCopy(original);
      expect(copy.boundElementId).toBeUndefined();
    });
  });

  describe('duplicateElement', () => {
    it('offsets position by default', () => {
      const original = rect('r1');
      const copy = duplicateElement(original);
      expect(copy.x).toBe(original.x + 20);
      expect(copy.y).toBe(original.y + 20);
    });

    it('uses custom offset', () => {
      const original = rect('r1');
      const copy = duplicateElement(original, 50);
      expect(copy.x).toBe(original.x + 50);
      expect(copy.y).toBe(original.y + 50);
    });

    it('offsets points for linear elements', () => {
      const arrow = {
        type: 'arrow',
        id: 'a1',
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        points: [{ x: 0, y: 0 }, { x: 100, y: 50 }],
      } as DriplElement;
      const copy = duplicateElement(arrow, 10);
      expect(copy.points).toEqual([
        { x: 10, y: 10 },
        { x: 110, y: 60 },
      ]);
    });
  });

  describe('duplicateElements', () => {
    it('duplicates only selected elements', () => {
      const elements = [rect('a'), rect('b'), rect('c')];
      const result = duplicateElements(elements, ['a', 'c']);
      // non-selected (b) + copies of selected (a, c) = 3
      expect(result).toHaveLength(3);
      // Original selected elements are replaced by copies
      expect(result.find(e => e.id === 'b')).toBeTruthy();
      expect(result.find(e => e.id !== 'b')).toBeTruthy();
    });

    it('returns all elements unchanged when no selection', () => {
      const elements = [rect('a'), rect('b')];
      const result = duplicateElements(elements, []);
      expect(result).toHaveLength(2);
    });

    it('preserves non-selected elements', () => {
      const elements = [rect('a'), rect('b'), rect('c')];
      const result = duplicateElements(elements, ['b']);
      const nonSelected = result.filter(e => e.id === 'a' || e.id === 'c');
      expect(nonSelected).toHaveLength(2);
    });
  });

  describe('duplicateElementWithBoundText', () => {
    it('duplicates element with its bound text', () => {
      const parent = rect('parent');
      const label = text('label', 'parent');
      const result = duplicateElementWithBoundText(parent, [parent, label]);
      expect(result).toHaveLength(2);
      // The text copy should reference the parent copy
      const textCopy = result.find(e => e.type === 'text');
      const rectCopy = result.find(e => e.type === 'rectangle');
      expect(textCopy!.boundElementId).toBe(rectCopy!.id);
      expect(textCopy!.id).not.toBe('label');
    });

    it('returns single copy when no bound text', () => {
      const parent = rect('parent');
      const result = duplicateElementWithBoundText(parent, [parent]);
      expect(result).toHaveLength(1);
    });
  });
});
