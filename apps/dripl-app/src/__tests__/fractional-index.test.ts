import { describe, it, expect } from 'vitest';
import { generateKeyBetween } from 'fractional-indexing';
import type { DriplElement } from '@dripl/common';
import {
  sortElementsByZIndex,
  bringToFront,
  sendToBack,
  bringForward,
  sendBackward,
  normalizeZIndices,
} from '../../utils/zIndexUtils';

function el(id: string, fractionalIndex?: string): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    fractionalIndex,
  } as DriplElement;
}

function generateIndexes(n: number): string[] {
  const indexes: string[] = [];
  for (let i = 0; i < n; i++) {
    indexes.push(generateKeyBetween(indexes[i - 1] ?? null, null));
  }
  return indexes;
}

describe('fractional index sorting', () => {
  it('sorts elements by fractional index lexicographically', () => {
    const [i0, i1, i2] = generateIndexes(3);
    const elements = [
      el('c', i2),
      el('a', i0),
      el('b', i1),
    ];
    const sorted = sortElementsByZIndex(elements);
    expect(sorted.map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('puts elements without fractionalIndex first', () => {
    const [i0, i1] = generateIndexes(2);
    const elements = [
      el('b', i1),
      el('a'),
      el('c', i0),
    ];
    const sorted = sortElementsByZIndex(elements);
    expect(sorted.map(e => e.id)).toEqual(['a', 'c', 'b']);
  });

  it('handles empty array', () => {
    expect(sortElementsByZIndex([])).toEqual([]);
  });

  it('handles single element', () => {
    const [i0] = generateIndexes(1);
    const elements = [el('a', i0)];
    expect(sortElementsByZIndex(elements).map(e => e.id)).toEqual(['a']);
  });
});

describe('bringToFront', () => {
  it('moves element to highest fractional index', () => {
    const [i0, i1, i2] = generateIndexes(3);
    const elements = [
      el('a', i0),
      el('b', i1),
      el('c', i2),
    ];
    const result = bringToFront(elements[1], elements);
    expect(result.fractionalIndex).toBeDefined();
    expect(result.fractionalIndex! > i2).toBe(true);
  });

  it('does not change if already at front', () => {
    const [i0, i1] = generateIndexes(2);
    const elements = [
      el('a', i0),
      el('b', i1),
    ];
    const result = bringToFront(elements[1], elements);
    expect(result.fractionalIndex).toBeDefined();
    const sorted = sortElementsByZIndex([...elements.slice(0, 1), result]);
    expect(sorted[sorted.length - 1].id).toBe('b');
  });
});

describe('sendToBack', () => {
  it('moves element to lowest fractional index', () => {
    const [i0, i1, i2] = generateIndexes(3);
    const elements = [
      el('a', i0),
      el('b', i1),
      el('c', i2),
    ];
    const result = sendToBack(elements[2], elements);
    expect(result.fractionalIndex).toBeDefined();
    expect(result.fractionalIndex! < i0).toBe(true);
  });
});

describe('bringForward', () => {
  it('moves element one position forward in sorted order', () => {
    const [i0, i1, i2] = generateIndexes(3);
    const elements = [
      el('a', i0),
      el('b', i1),
      el('c', i2),
    ];
    const result = bringForward(elements[0], elements);
    expect(result.fractionalIndex).toBeDefined();
    expect(result.fractionalIndex! > i0).toBe(true);
    // After applying, 'a' should sort between 'b' and 'c'
    const after = sortElementsByZIndex([
      { ...elements[0], fractionalIndex: result.fractionalIndex },
      elements[1],
      elements[2],
    ]);
    expect(after.map(e => e.id)).toEqual(['b', 'a', 'c']);
  });

  it('does not change if already at front', () => {
    const [i0, i1] = generateIndexes(2);
    const elements = [
      el('a', i0),
      el('b', i1),
    ];
    const result = bringForward(elements[1], elements);
    expect(result.fractionalIndex).toBe(i1);
  });
});

describe('sendBackward', () => {
  it('moves element one position backward in sorted order', () => {
    const [i0, i1, i2] = generateIndexes(3);
    const elements = [
      el('a', i0),
      el('b', i1),
      el('c', i2),
    ];
    const result = sendBackward(elements[2], elements);
    expect(result.fractionalIndex).toBeDefined();
    expect(result.fractionalIndex! < i2).toBe(true);
    // After applying, 'c' should sort between 'a' and 'b'
    const after = sortElementsByZIndex([
      elements[0],
      elements[1],
      { ...elements[2], fractionalIndex: result.fractionalIndex },
    ]);
    expect(after.map(e => e.id)).toEqual(['a', 'c', 'b']);
  });

  it('does not change if already at back', () => {
    const [i0, i1] = generateIndexes(2);
    const elements = [
      el('a', i0),
      el('b', i1),
    ];
    const result = sendBackward(elements[0], elements);
    expect(result.fractionalIndex).toBe(i0);
  });
});

describe('normalizeZIndices', () => {
  it('reassigns compact fractional indexes', () => {
    const [i0, i1, i2] = generateIndexes(3);
    const elements = [
      el('a', i0),
      el('b', i1),
      el('c', i2),
    ];
    const normalized = normalizeZIndices(elements);
    const sorted = sortElementsByZIndex(normalized);
    expect(sorted.map(e => e.id)).toEqual(['a', 'b', 'c']);
    for (const el of sorted) {
      expect(typeof el.fractionalIndex).toBe('string');
    }
  });
});

describe('generateKeyBetween', () => {
  it('generates a key between two nulls', () => {
    const key = generateKeyBetween(null, null);
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });

  it('generates a key between two existing keys', () => {
    const [a, b] = generateIndexes(2);
    const key = generateKeyBetween(a, b);
    expect(key > a).toBe(true);
    expect(key < b).toBe(true);
  });

  it('generates a key after an existing key', () => {
    const [a] = generateIndexes(1);
    const key = generateKeyBetween(a, null);
    expect(key > a).toBe(true);
  });

  it('generates a key before an existing key', () => {
    const [a] = generateIndexes(1);
    const key = generateKeyBetween(null, a);
    expect(key < a).toBe(true);
  });

  it('generates many keys between two keys without overflow', () => {
    let a = generateKeyBetween(null, null);
    let b = generateKeyBetween(a, null);
    for (let i = 0; i < 100; i++) {
      const mid = generateKeyBetween(a, b);
      expect(mid > a).toBe(true);
      expect(mid < b).toBe(true);
      a = mid;
    }
  });
});
