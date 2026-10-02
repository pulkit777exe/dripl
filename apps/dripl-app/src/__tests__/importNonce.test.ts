/**
 * The `.dripl` import path must not mint a freshness key that two different
 * payloads share.
 *
 * `reconciliation.ts` documents the exact condition under which replicas stop
 * converging: when one element id carries two distinct payloads under one
 * identical `(version, versionNonce)`, the tie is resolved by arrival order and
 * the merge keeps whichever arrived first. The live mutation path mints 31
 * random bits, so it hits that condition with probability ~2^-31.
 *
 * This path used to mint a constant `0` instead, which made the condition
 * reachable by a user rather than by chance: two people edit a canvas, both
 * export, both re-import — and every element that lacked a `versionNonce`
 * arrived at the same key with different content.
 */
import { describe, expect, it } from 'vitest';
import { normalizeImportedElement } from '../../utils/export/normalize';

const base = { id: 'e', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 };

describe('imported element freshness keys', () => {
  it('gives two divergent payloads of one id different keys', () => {
    const red = normalizeImportedElement({ ...base, strokeColor: '#f00' }, {});
    const green = normalizeImportedElement({ ...base, strokeColor: '#0f0' }, {});
    expect(red?.versionNonce).not.toBe(green?.versionNonce);
  });

  it('gives different keys to payloads that normalise differently', () => {
    const near = normalizeImportedElement({ ...base, x: 0 }, {});
    const far = normalizeImportedElement({ ...base, x: 500 }, {});
    expect(near?.versionNonce).not.toBe(far?.versionNonce);
  });

  it('is idempotent, so re-importing a file is not mistaken for a new edit', () => {
    const first = normalizeImportedElement({ ...base, strokeColor: '#f00' }, {});
    const again = normalizeImportedElement({ ...base, strokeColor: '#f00' }, {});
    expect(first?.versionNonce).toBe(again?.versionNonce);
  });

  it('preserves a nonce the file already carries, so live ordering still holds', () => {
    const element = normalizeImportedElement({ ...base, version: 7, versionNonce: 12345 }, {});
    expect(element?.version).toBe(7);
    expect(element?.versionNonce).toBe(12345);
  });

  it('stays a non-negative int32, which is what the comparator expects', () => {
    for (const fill of ['#f00', '#0f0', '#00f', '#fff']) {
      const nonce = normalizeImportedElement({ ...base, strokeColor: fill }, {})?.versionNonce;
      expect(Number.isInteger(nonce)).toBe(true);
      expect(nonce).toBeGreaterThanOrEqual(0);
      expect(nonce).toBeLessThan(2_147_483_647);
    }
  });
});
