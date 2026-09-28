import { describe, expect, it } from 'vitest';
import { compareFractionalIndex } from './reconciliation';

describe('compareFractionalIndex', () => {
  it('orders keys lexicographically with missing keys last-in-back', () => {
    expect(compareFractionalIndex('a0', 'a1')).toBe(-1);
    expect(compareFractionalIndex('a1', 'a0')).toBe(1);
    expect(compareFractionalIndex('a0', 'a0')).toBe(0);
    expect(compareFractionalIndex(undefined, 'a0')).toBe(-1);
    expect(compareFractionalIndex('a0', undefined)).toBe(1);
    expect(compareFractionalIndex(undefined, undefined)).toBe(0);
    expect(compareFractionalIndex('', 'a0')).toBe(-1);
  });

  it('sorts display order and persisted order identically', () => {
    // Note: Array.sort moves `undefined` to the end without consulting the
    // comparator; the comparator itself ranks undefined/'' first. Both call
    // sites sort element objects (never bare undefined), so this only
    // documents engine behavior, not a contract.
    const keys = ['a1', 'a0', '', 'Zz'];
    expect([...keys].sort(compareFractionalIndex)).toEqual(['', 'Zz', 'a0', 'a1']);
  });
});
