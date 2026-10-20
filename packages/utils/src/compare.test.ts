import { describe, expect, it } from 'vitest';

import { timingSafeEqualString } from './compare';

describe('timingSafeEqualString', () => {
  it('accepts identical strings', () => {
    expect(timingSafeEqualString('same', 'same')).toBe(true);
    expect(timingSafeEqualString('', '')).toBe(true);
  });

  it('rejects strings differing anywhere, including the last byte', () => {
    // `===` short-circuits on the first difference; this pin exists so a
    // refactor back to `===` cannot pass on a prefix match.
    expect(timingSafeEqualString('abc', 'abd')).toBe(false);
    expect(timingSafeEqualString('abcdef', 'abcdeX')).toBe(false);
    expect(timingSafeEqualString('', 'a')).toBe(false);
  });

  it('rejects unequal lengths without throwing', () => {
    // `timingSafeEqual` throws on length mismatch, which would take down the
    // request; the pre-check is the contract, not an optimization.
    expect(timingSafeEqualString('short', 'longer-value')).toBe(false);
    expect(timingSafeEqualString('longer-value', 'short')).toBe(false);
  });

  it('compares by UTF-8 bytes, so a multi-byte tail cannot collide', () => {
    // Same UTF-16 length, different byte length and different bytes: must be
    // false and must not throw inside `timingSafeEqual`.
    expect(timingSafeEqualString('abé', 'abê')).toBe(false);
  });
});
