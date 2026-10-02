import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { getElementBounds } from './intersection';

describe('getElementBounds cache', () => {
  it('reuses bounds for an unchanged element and invalidates changed geometry', () => {
    const element: DriplElement = {
      id: 'rect-1',
      type: 'rectangle',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      strokeWidth: 2,
      version: 1,
    };

    const first = getElementBounds(element);
    expect(getElementBounds(element)).toBe(first);

    const moved = { ...element, x: 40, version: 2 };
    const second = getElementBounds(moved);
    expect(second).not.toBe(first);
    expect(second.x).toBe(39);
  });

  it('invalidates path bounds when the points array changes', () => {
    const element: DriplElement = {
      id: 'line-1',
      type: 'line',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      strokeWidth: 2,
      version: 1,
    };

    const first = getElementBounds(element);
    const moved = {
      ...element,
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 10 },
      ],
      version: 2,
    };
    const second = getElementBounds(moved);

    expect(second).not.toBe(first);
    expect(second.width).toBe(32);
  });
});
