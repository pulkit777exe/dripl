import { describe, it, expect } from 'vitest';
import type { RectangleElement, DriplElement } from '@dripl/common';
import type { Bounds } from '../src/geometry';
import {
  isPointInSelectionRect,
  elementIntersectsSelectionRect,
  getElementAtPoint,
  getElementsInSelectionRect,
} from '../src/hit-detection';

function makeRect(overrides: Partial<RectangleElement> = {}): RectangleElement {
  return {
    id: 'el-1',
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...overrides,
  };
}

function makeElement(overrides: Partial<DriplElement>): DriplElement {
  return {
    id: 'el-1',
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...overrides,
  } as DriplElement;
}

// ===== isPointInSelectionRect =====

describe('isPointInSelectionRect', () => {
  const rect: Bounds = { x: 10, y: 10, width: 100, height: 100 };

  it('returns true for point inside rect', () => {
    expect(isPointInSelectionRect({ x: 50, y: 50 }, rect)).toBe(true);
  });

  it('returns true for point on edges', () => {
    expect(isPointInSelectionRect({ x: 10, y: 50 }, rect)).toBe(true);
    expect(isPointInSelectionRect({ x: 110, y: 50 }, rect)).toBe(true);
    expect(isPointInSelectionRect({ x: 50, y: 10 }, rect)).toBe(true);
    expect(isPointInSelectionRect({ x: 50, y: 110 }, rect)).toBe(true);
  });

  it('returns true for corners', () => {
    expect(isPointInSelectionRect({ x: 10, y: 10 }, rect)).toBe(true);
    expect(isPointInSelectionRect({ x: 110, y: 110 }, rect)).toBe(true);
  });

  it('returns false for point outside rect', () => {
    expect(isPointInSelectionRect({ x: 5, y: 50 }, rect)).toBe(false);
    expect(isPointInSelectionRect({ x: 115, y: 50 }, rect)).toBe(false);
    expect(isPointInSelectionRect({ x: 50, y: 5 }, rect)).toBe(false);
    expect(isPointInSelectionRect({ x: 50, y: 115 }, rect)).toBe(false);
  });

  it('handles zero-size rect', () => {
    const zero: Bounds = { x: 50, y: 50, width: 0, height: 0 };
    expect(isPointInSelectionRect({ x: 50, y: 50 }, zero)).toBe(true);
    expect(isPointInSelectionRect({ x: 51, y: 50 }, zero)).toBe(false);
  });

  it('handles negative coordinates', () => {
    const neg: Bounds = { x: -100, y: -100, width: 50, height: 50 };
    expect(isPointInSelectionRect({ x: -75, y: -75 }, neg)).toBe(true);
    expect(isPointInSelectionRect({ x: -101, y: -75 }, neg)).toBe(false);
  });
});

// ===== elementIntersectsSelectionRect =====

describe('elementIntersectsSelectionRect', () => {
  it('detects rectangle fully inside selection', () => {
    const el = makeRect({ x: 10, y: 10, width: 50, height: 50 });
    const rect: Bounds = { x: 0, y: 0, width: 200, height: 200 };
    expect(elementIntersectsSelectionRect(el, rect)).toBe(true);
  });

  it('detects rectangle fully outside selection', () => {
    const el = makeRect({ x: 300, y: 300, width: 50, height: 50 });
    const rect: Bounds = { x: 0, y: 0, width: 100, height: 100 };
    expect(elementIntersectsSelectionRect(el, rect)).toBe(false);
  });

  it('detects rectangle partially overlapping selection', () => {
    const el = makeRect({ x: 50, y: 50, width: 100, height: 100 });
    const rect: Bounds = { x: 0, y: 0, width: 75, height: 75 };
    expect(elementIntersectsSelectionRect(el, rect)).toBe(true);
  });

  it('detects selection fully inside rectangle', () => {
    const el = makeRect({ x: 0, y: 0, width: 200, height: 200 });
    const rect: Bounds = { x: 50, y: 50, width: 50, height: 50 };
    expect(elementIntersectsSelectionRect(el, rect)).toBe(true);
  });

  it('detects ellipse intersection', () => {
    const el = makeElement({ type: 'ellipse', x: 0, y: 0, width: 100, height: 100 });
    const rect: Bounds = { x: 80, y: 0, width: 50, height: 50 };
    expect(elementIntersectsSelectionRect(el, rect)).toBe(true);
  });

  it('detects diamond intersection', () => {
    const el = makeElement({ type: 'diamond', x: 0, y: 0, width: 100, height: 100 });
    const rect: Bounds = { x: 80, y: 0, width: 50, height: 50 };
    expect(elementIntersectsSelectionRect(el, rect)).toBe(true);
  });

  it('detects rotated rectangle intersection', () => {
    const el = makeRect({ x: 0, y: 0, width: 100, height: 100, angle: Math.PI / 4 });
    const rect: Bounds = { x: 60, y: -20, width: 50, height: 50 };
    expect(elementIntersectsSelectionRect(el, rect)).toBe(true);
  });

  it('detects arrow/line intersection', () => {
    const el = makeElement({
      type: 'arrow',
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      points: [
        { x: 0, y: 50 },
        { x: 200, y: 50 },
      ],
    });
    const rect: Bounds = { x: 90, y: 0, width: 20, height: 100 };
    expect(elementIntersectsSelectionRect(el, rect)).toBe(true);
  });

  it('detects freedraw intersection', () => {
    const el = makeElement({
      type: 'freedraw',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      points: [
        { x: 0, y: 50 },
        { x: 25, y: 25 },
        { x: 50, y: 50 },
        { x: 75, y: 25 },
        { x: 100, y: 50 },
      ],
    });
    const rect: Bounds = { x: 40, y: 0, width: 20, height: 100 };
    expect(elementIntersectsSelectionRect(el, rect)).toBe(true);
  });

  it('returns false for non-intersecting arrow', () => {
    const el = makeElement({
      type: 'arrow',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
    });
    const rect: Bounds = { x: 200, y: 200, width: 50, height: 50 };
    expect(elementIntersectsSelectionRect(el, rect)).toBe(false);
  });

  it('handles element with no points', () => {
    const el = makeElement({
      type: 'arrow',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      points: [],
    });
    const rect: Bounds = { x: 0, y: 0, width: 200, height: 200 };
    expect(elementIntersectsSelectionRect(el, rect)).toBe(true);
  });
});

// ===== getElementAtPoint =====

describe('getElementAtPoint', () => {
  const elements: DriplElement[] = [
    makeRect({ id: 'bottom', x: 0, y: 0, width: 200, height: 200 }),
    makeRect({ id: 'middle', x: 50, y: 50, width: 100, height: 100 }),
    makeRect({ id: 'top', x: 75, y: 75, width: 50, height: 50 }),
  ];

  it('returns topmost element at point', () => {
    const el = getElementAtPoint({ x: 90, y: 90 }, elements);
    expect(el?.id).toBe('top');
  });

  it('returns middle element when top is not covering', () => {
    const el = getElementAtPoint({ x: 60, y: 60 }, elements);
    expect(el?.id).toBe('middle');
  });

  it('returns bottom element when others are not covering', () => {
    const el = getElementAtPoint({ x: 10, y: 10 }, elements);
    expect(el?.id).toBe('bottom');
  });

  it('returns null for point outside all elements', () => {
    const el = getElementAtPoint({ x: 300, y: 300 }, elements);
    expect(el).toBeNull();
  });

  it('skips deleted elements', () => {
    const withDeleted: DriplElement[] = [
      makeRect({ id: 'deleted', x: 0, y: 0, width: 200, height: 200, isDeleted: true }),
      makeRect({ id: 'visible', x: 0, y: 0, width: 200, height: 200 }),
    ];
    const el = getElementAtPoint({ x: 50, y: 50 }, withDeleted);
    expect(el?.id).toBe('visible');
  });

  it('returns null for empty array', () => {
    expect(getElementAtPoint({ x: 0, y: 0 }, [])).toBeNull();
  });
});

// ===== getElementsInSelectionRect =====

describe('getElementsInSelectionRect', () => {
  const elements: DriplElement[] = [
    makeRect({ id: 'el1', x: 0, y: 0, width: 50, height: 50 }),
    makeRect({ id: 'el2', x: 100, y: 100, width: 50, height: 50 }),
    makeRect({ id: 'el3', x: 200, y: 200, width: 50, height: 50 }),
  ];

  it('returns elements inside selection rect', () => {
    const rect: Bounds = { x: 0, y: 0, width: 60, height: 60 };
    const result = getElementsInSelectionRect(rect, elements);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('el1');
  });

  it('returns multiple elements inside selection rect', () => {
    const rect: Bounds = { x: 0, y: 0, width: 160, height: 160 };
    const result = getElementsInSelectionRect(rect, elements);
    expect(result).toHaveLength(2);
    expect(result.map(e => e.id).sort()).toEqual(['el1', 'el2']);
  });

  it('returns all elements when rect covers everything', () => {
    const rect: Bounds = { x: 0, y: 0, width: 300, height: 300 };
    const result = getElementsInSelectionRect(rect, elements);
    expect(result).toHaveLength(3);
  });

  it('returns empty array when no elements intersect', () => {
    const rect: Bounds = { x: 500, y: 500, width: 100, height: 100 };
    const result = getElementsInSelectionRect(rect, elements);
    expect(result).toHaveLength(0);
  });

  it('skips deleted elements', () => {
    const withDeleted: DriplElement[] = [
      ...elements,
      makeRect({ id: 'deleted', x: 0, y: 0, width: 50, height: 50, isDeleted: true }),
    ];
    const rect: Bounds = { x: 0, y: 0, width: 60, height: 60 };
    const result = getElementsInSelectionRect(rect, withDeleted);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('el1');
  });

  it('handles overlapping elements', () => {
    const overlapping: DriplElement[] = [
      makeRect({ id: 'a', x: 0, y: 0, width: 100, height: 100 }),
      makeRect({ id: 'b', x: 50, y: 50, width: 100, height: 100 }),
    ];
    const rect: Bounds = { x: 60, y: 60, width: 30, height: 30 };
    const result = getElementsInSelectionRect(rect, overlapping);
    expect(result).toHaveLength(2);
  });

  it('handles rotated elements', () => {
    const rotated = makeElement({
      id: 'rotated',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      angle: Math.PI / 4,
    });
    const rect: Bounds = { x: 60, y: -10, width: 30, height: 30 };
    const result = getElementsInSelectionRect(rect, [rotated]);
    expect(result).toHaveLength(1);
  });
});
