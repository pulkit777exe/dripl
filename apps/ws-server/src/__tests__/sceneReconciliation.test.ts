import { describe, expect, it } from 'vitest';
import { compareElementFreshness, shouldAcceptElement } from '@dripl/common/reconciliation';

describe('scene reconciliation', () => {
  it('orders by version before nonce', () => {
    expect(
      compareElementFreshness({ version: 2, versionNonce: 0 }, { version: 1, versionNonce: 999 })
    ).toBeGreaterThan(0);
    expect(
      compareElementFreshness({ version: 1, versionNonce: 1 }, { version: 1, versionNonce: 2 })
    ).toBeGreaterThan(0);
  });

  it('rejects equal and stale versioned elements', () => {
    const existing = { version: 3, versionNonce: 4 };
    expect(shouldAcceptElement(existing, existing)).toBe(false);
    expect(shouldAcceptElement({ version: 3, versionNonce: 3 }, existing)).toBe(true);
    expect(shouldAcceptElement({ version: 2, versionNonce: 99 }, existing)).toBe(false);
    expect(shouldAcceptElement({ version: 3, versionNonce: 5 }, existing)).toBe(false);
    expect(shouldAcceptElement({ version: 4, versionNonce: 0 }, existing)).toBe(true);
  });

  it('accepts legacy elements for backwards compatibility', () => {
    expect(shouldAcceptElement({}, {})).toBe(true);
    expect(shouldAcceptElement({ version: 1 }, {})).toBe(true);
    expect(shouldAcceptElement({ version: 0 }, {})).toBe(false);
  });
});
