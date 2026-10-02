import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';

import { resolveElementSeed } from './rough-renderer';

function element(overrides: Partial<DriplElement>): DriplElement {
  return {
    id: 'element-1',
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    ...overrides,
  } as DriplElement;
}

describe('resolveElementSeed', () => {
  it('uses the element seed when present', () => {
    expect(resolveElementSeed(element({ seed: 4242 }))).toBe(4242);
  });

  it('derives a stable seed from the id when none is set', () => {
    const first = resolveElementSeed(element({ id: 'abc' }));
    const second = resolveElementSeed(element({ id: 'abc' }));
    expect(first).toBe(second);
  });

  it('gives different ids different seeds', () => {
    expect(resolveElementSeed(element({ id: 'abc' }))).not.toBe(
      resolveElementSeed(element({ id: 'abd' }))
    );
  });

  it('stays inside the positive 32-bit range Rough.js accepts', () => {
    for (const id of ['a', 'element-9999', 'a-very-long-element-identifier-value']) {
      const seed = resolveElementSeed(element({ id }));
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2_147_483_647);
      expect(Number.isInteger(seed)).toBe(true);
    }
  });

  it('treats a zero seed as a real seed rather than missing', () => {
    expect(resolveElementSeed(element({ seed: 0 }))).toBe(0);
  });
});
