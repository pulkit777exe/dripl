import { describe, expect, it } from 'vitest';
import type { LinearElement } from '@dripl/common';
import { mutateElement } from './mutateElement';

const element: LinearElement = {
  id: 'arrow-1',
  type: 'arrow',
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 50 },
  ],
  version: 3,
  versionNonce: 17,
};

describe('mutateElement point comparison', () => {
  it('returns the same reference for an equivalent point array', () => {
    const updated = mutateElement(element, {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ],
    });

    expect(updated).toBe(element);
  });

  it('detects a changed point and creates a new version', () => {
    const updated = mutateElement(element, {
      points: [
        { x: 0, y: 0 },
        { x: 120, y: 50 },
      ],
    });

    expect(updated).not.toBe(element);
    expect(updated.points).toEqual([
      { x: 0, y: 0 },
      { x: 120, y: 50 },
    ]);
    expect(updated.version).toBe(4);
    expect(updated.versionNonce).not.toBe(element.versionNonce);
  });
});
