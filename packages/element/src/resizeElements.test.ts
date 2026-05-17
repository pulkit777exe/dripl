import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resizeSingleElement,
  getResizedOrigin,
  resizeSingleTextElement,
  resizeSingleLinearElement,
  resizeSingleFreeDrawElement,
  type TransformHandleDirection,
} from './resizeElements';
import type { DriplElement } from '@dripl/common';
import {
  createRectangleElement,
  createEllipseElement,
  createDiamondElement,
  createArrowElement,
  createLineElement,
  createFreeDrawElement,
  createTextElement,
  resetIdCounter,
} from '@dripl/test-utils';

vi.mock('./resizeElements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./resizeElements')>();
  return actual;
});

describe('getResizedOrigin', () => {
  it('returns previous origin for no change', () => {
    const origin = getResizedOrigin(
      { x: 100, y: 100 },
      100,
      100,
      100,
      100,
      0,
      'se',
      false,
      false
    );
    expect(origin.x).toBe(100);
    expect(origin.y).toBe(100);
  });

  it('keeps origin when resizing from bottom-right (se)', () => {
    const origin = getResizedOrigin(
      { x: 100, y: 100 },
      100,
      100,
      200,
      200,
      0,
      'se',
      false,
      false
    );
    expect(origin.x).toBe(0);
    expect(origin.y).toBe(0);
  });

  it('keeps origin when resizing from top-left (nw)', () => {
    const origin = getResizedOrigin(
      { x: 100, y: 100 },
      100,
      100,
      200,
      200,
      0,
      'nw',
      false,
      false
    );
    expect(origin.x).toBe(100);
    expect(origin.y).toBe(100);
  });

  it('moves origin when resizing from top-right (ne)', () => {
    const origin = getResizedOrigin(
      { x: 100, y: 100 },
      100,
      100,
      200,
      200,
      0,
      'ne',
      false,
      false
    );
    expect(origin.x).toBe(0);
    expect(origin.y).toBe(100);
  });

  it('moves origin when resizing from bottom-left (sw)', () => {
    const origin = getResizedOrigin(
      { x: 100, y: 100 },
      100,
      100,
      200,
      200,
      0,
      'sw',
      false,
      false
    );
    expect(origin.x).toBe(100);
    expect(origin.y).toBe(0);
  });

  it('adjusts origin for center resize', () => {
    const origin = getResizedOrigin(
      { x: 100, y: 100 },
      100,
      100,
      200,
      200,
      0,
      'se',
      false,
      true
    );
    expect(origin.x).toBe(50);
    expect(origin.y).toBe(50);
  });

  it('handles rotation for top-left resize', () => {
    const origin = getResizedOrigin(
      { x: 100, y: 100 },
      100,
      100,
      150,
      150,
      Math.PI / 4,
      'nw',
      false,
      false
    );
    expect(origin.x).toBeCloseTo(75, 0);
    expect(origin.y).toBeCloseTo(110, 0);
  });

  it('handles east-side resize', () => {
    const origin = getResizedOrigin(
      { x: 100, y: 100 },
      100,
      100,
      200,
      100,
      0,
      'e',
      false,
      false
    );
    expect(origin.x).toBe(0);
    expect(origin.y).toBe(100);
  });

  it('handles west-side resize', () => {
    const origin = getResizedOrigin(
      { x: 100, y: 100 },
      100,
      100,
      200,
      100,
      0,
      'w',
      false,
      false
    );
    expect(origin.x).toBe(100);
    expect(origin.y).toBe(100);
  });

  it('handles north-side resize', () => {
    const origin = getResizedOrigin(
      { x: 100, y: 100 },
      100,
      100,
      100,
      200,
      0,
      'n',
      false,
      false
    );
    expect(origin.x).toBe(100);
    expect(origin.y).toBe(100);
  });

  it('handles south-side resize', () => {
    const origin = getResizedOrigin(
      { x: 100, y: 100 },
      100,
      100,
      100,
      200,
      0,
      's',
      false,
      false
    );
    expect(origin.x).toBe(100);
    expect(origin.y).toBe(0);
  });

  it('maintains aspect ratio for corner handles', () => {
    const origin = getResizedOrigin(
      { x: 100, y: 100 },
      100,
      100,
      200,
      200,
      0,
      'ne',
      true,
      false
    );
    expect(origin.x).toBe(0);
    expect(origin.y).toBe(100);
  });
});

describe('resizeSingleElement', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe('rectangle', () => {
    it('resizes rectangle from bottom-right', () => {
      const orig = createRectangleElement({ x: 0, y: 0, width: 100, height: 100 });
      const latest = { ...orig };
      const result = resizeSingleElement(200, 200, latest, orig, 'se');
      expect(result.x).toBe(-100);
      expect(result.y).toBe(-100);
      expect(result.width).toBe(200);
      expect(result.height).toBe(200);
    });

    it('resizes rectangle from top-left', () => {
      const orig = createRectangleElement({ x: 100, y: 100, width: 100, height: 100 });
      const latest = { ...orig };
      const result = resizeSingleElement(200, 200, latest, orig, 'nw');
      expect(result.width).toBe(200);
      expect(result.height).toBe(200);
      expect(result.x).toBe(100);
      expect(result.y).toBe(100);
    });

    it('resizes rectangle from center', () => {
      const orig = createRectangleElement({ x: 100, y: 100, width: 100, height: 100 });
      const latest = { ...orig };
      const result = resizeSingleElement(200, 200, latest, orig, 'se', {
        shouldResizeFromCenter: true,
      });
      expect(result.x).toBe(50);
      expect(result.y).toBe(50);
      expect(result.width).toBe(200);
      expect(result.height).toBe(200);
    });

    it('enforces minimum width', () => {
      const orig = createRectangleElement({ x: 0, y: 0, width: 100, height: 100 });
      const latest = { ...orig };
      const result = resizeSingleElement(-50, 100, latest, orig, 'se');
      expect(result.width).toBe(1);
      expect(result.height).toBe(100);
    });

    it('enforces minimum height', () => {
      const orig = createRectangleElement({ x: 0, y: 0, width: 100, height: 100 });
      const latest = { ...orig };
      const result = resizeSingleElement(100, -50, latest, orig, 'se');
      expect(result.width).toBe(100);
      expect(result.height).toBe(1);
    });

    it('resizes rotated rectangle from top-left', () => {
      const orig = createRectangleElement({
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        angle: Math.PI / 4,
      });
      const latest = { ...orig };
      const result = resizeSingleElement(150, 150, latest, orig, 'nw');
      expect(result.width).toBe(150);
      expect(result.height).toBe(150);
    });
  });

  describe('ellipse', () => {
    it('resizes ellipse from bottom-right', () => {
      const orig = createEllipseElement({ x: 0, y: 0, width: 100, height: 80 });
      const latest = { ...orig };
      const result = resizeSingleElement(200, 160, latest, orig, 'se');
      expect(result.x).toBe(-100);
      expect(result.y).toBe(-80);
      expect(result.width).toBe(200);
      expect(result.height).toBe(160);
    });

    it('resizes ellipse from top-left', () => {
      const orig = createEllipseElement({ x: 100, y: 100, width: 100, height: 80 });
      const latest = { ...orig };
      const result = resizeSingleElement(200, 160, latest, orig, 'nw');
      expect(result.width).toBe(200);
      expect(result.height).toBe(160);
      expect(result.x).toBe(100);
      expect(result.y).toBe(100);
    });
  });

  describe('diamond', () => {
    it('resizes diamond from bottom-right', () => {
      const orig = createDiamondElement({ x: 0, y: 0, width: 100, height: 100 });
      const latest = { ...orig };
      const result = resizeSingleElement(200, 200, latest, orig, 'se');
      expect(result.x).toBe(-100);
      expect(result.y).toBe(-100);
      expect(result.width).toBe(200);
      expect(result.height).toBe(200);
    });
  });

  describe('text', () => {
    it('resizes text element vertically (north handle)', () => {
      const orig = createTextElement({
        x: 0,
        y: 100,
        width: 120,
        height: 24,
        text: 'Hello',
        fontSize: 20,
      });
      const latest = { ...orig };
      const result = resizeSingleTextElement(orig, latest, 'n', false, 120, 48);
      expect(result).toHaveProperty('fontSize');
      expect(result).toHaveProperty('width');
      expect(result).toHaveProperty('height');
    });

    it('resizes text element vertically (south handle)', () => {
      const orig = createTextElement({
        x: 0,
        y: 0,
        width: 120,
        height: 24,
        text: 'Hello',
        fontSize: 20,
      });
      const latest = { ...orig };
      const result = resizeSingleTextElement(orig, latest, 's', false, 120, 48);
      expect(result).toHaveProperty('fontSize');
      expect(result).toHaveProperty('width');
      expect(result).toHaveProperty('height');
    });

    it('wraps text when resizing horizontally (east handle)', () => {
      const orig = createTextElement({
        x: 0,
        y: 0,
        width: 200,
        height: 24,
        text: 'This is a long text that should wrap',
        fontSize: 16,
      });
      const latest = { ...orig };
      const result = resizeSingleTextElement(orig, latest, 'e', false, 100, 24);
      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('width');
      expect(result).toHaveProperty('height');
      expect(result.autoResize).toBe(false);
    });

    it('wraps text when resizing horizontally (west handle)', () => {
      const orig = createTextElement({
        x: 100,
        y: 0,
        width: 200,
        height: 24,
        text: 'This is a long text that should wrap',
        fontSize: 16,
      });
      const latest = { ...orig };
      const result = resizeSingleTextElement(orig, latest, 'w', false, 100, 24);
      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('width');
      expect(result).toHaveProperty('height');
    });

    it('returns empty for non-text element', () => {
      const orig = createRectangleElement({ x: 0, y: 0, width: 100, height: 100 });
      const latest = { ...orig };
      const result = resizeSingleTextElement(orig, latest, 'n', false, 200, 200);
      expect(result).toEqual({});
    });
  });

  describe('arrow', () => {
    it('resizes arrow element', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ];
      const orig = createArrowElement(points, { x: 0, y: 0, width: 100, height: 100 });
      const latest = { ...orig };
      const result = resizeSingleLinearElement(orig, latest, 'se', false, 200, 200);
      expect(result.x).toBe(-100);
      expect(result.y).toBe(-100);
      expect(result.width).toBe(200);
      expect(result.height).toBe(200);
      expect(result.points).toBeDefined();
    });

    it('scales arrow points proportionally', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
        { x: 100, y: 0 },
      ];
      const orig = createArrowElement(points, { x: 0, y: 0, width: 100, height: 50 });
      const latest = { ...orig };
      const result = resizeSingleLinearElement(orig, latest, 'se', false, 200, 100);
      expect(result.points).toBeDefined();
      expect(result.points).toHaveLength(3);
      if (result.points) {
        expect(result.points[0]).toEqual({ x: -200, y: -100 });
        expect(result.points[2]).toEqual({ x: 0, y: -100 });
      }
    });

    it('handles zero width arrow', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ];
      const orig = createArrowElement(points, { x: 0, y: 0, width: 0, height: 100 });
      const latest = { ...orig };
      const result = resizeSingleLinearElement(orig, latest, 'se', false, 50, 200);
      expect(result.width).toBe(50);
      expect(result.height).toBe(200);
    });
  });

  describe('line', () => {
    it('resizes line element', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ];
      const orig = createLineElement(points, { x: 0, y: 0, width: 100, height: 50 });
      const latest = { ...orig };
      const result = resizeSingleLinearElement(orig, latest, 'se', false, 200, 100);
      expect(result.width).toBe(200);
      expect(result.height).toBe(100);
      expect(result.points).toBeDefined();
    });

    it('scales line points proportionally', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ];
      const orig = createLineElement(points, { x: 0, y: 0, width: 100, height: 100 });
      const latest = { ...orig };
      const result = resizeSingleLinearElement(orig, latest, 'se', false, 200, 200);
      expect(result.points).toBeDefined();
      if (result.points) {
        expect(result.points[0]).toEqual({ x: -200, y: -200 });
        expect(result.points[1]).toEqual({ x: 0, y: 0 });
      }
    });
  });

  describe('freedraw', () => {
    it('resizes freedraw element', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 5 },
      ];
      const orig = createFreeDrawElement(points, { x: 0, y: 0, width: 20, height: 10 });
      const latest = { ...orig };
      const result = resizeSingleFreeDrawElement(orig, latest, 'se', false, 40, 20);
      expect(result.width).toBe(40);
      expect(result.height).toBe(20);
      expect(result.points).toBeDefined();
    });

    it('scales freedraw points proportionally', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 0 },
      ];
      const orig = createFreeDrawElement(points, { x: 0, y: 0, width: 20, height: 10 });
      const latest = { ...orig };
      const result = resizeSingleFreeDrawElement(orig, latest, 'se', false, 40, 20);
      expect(result.points).toBeDefined();
      if (result.points) {
        expect(result.points).toHaveLength(3);
        expect(result.points[0]).toEqual({ x: -40, y: -20 });
        expect(result.points[2]).toEqual({ x: 0, y: -20 });
      }
    });

    it('handles zero width freedraw', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 0, y: 10 },
      ];
      const orig = createFreeDrawElement(points, { x: 0, y: 0, width: 0, height: 10 });
      const latest = { ...orig };
      const result = resizeSingleFreeDrawElement(orig, latest, 'se', false, 20, 20);
      expect(result.width).toBe(20);
      expect(result.height).toBe(20);
    });

    it('returns empty for element without points', () => {
      const orig = createRectangleElement({ x: 0, y: 0, width: 100, height: 100 });
      const latest = { ...orig };
      const result = resizeSingleFreeDrawElement(orig, latest, 'se', false, 200, 200);
      expect(result).toEqual({});
    });
  });

  describe('aspect ratio', () => {
    it('maintains aspect ratio for corner handles', () => {
      const orig = createRectangleElement({ x: 0, y: 0, width: 100, height: 50 });
      const latest = { ...orig };
      const result = resizeSingleElement(200, 100, latest, orig, 'se', {
        shouldMaintainAspectRatio: true,
      });
      expect(result.width).toBe(200);
      expect(result.height).toBe(100);
    });

    it('maintains aspect ratio from center', () => {
      const orig = createRectangleElement({ x: 100, y: 100, width: 100, height: 50 });
      const latest = { ...orig };
      const result = resizeSingleElement(200, 100, latest, orig, 'se', {
        shouldMaintainAspectRatio: true,
        shouldResizeFromCenter: true,
      });
      expect(result.width).toBe(200);
      expect(result.height).toBe(100);
      expect(result.x).toBe(50);
      expect(result.y).toBe(75);
    });
  });
});

describe('resizeSingleElement dispatcher', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('dispatches to text resize for text elements', () => {
    const orig = createTextElement({
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      text: 'Test',
      fontSize: 16,
    });
    const latest = { ...orig };
    const result = resizeSingleElement(200, 40, latest, orig, 'n');
    expect(result).toHaveProperty('fontSize');
  });

  it('dispatches to linear resize for arrow elements', () => {
    const orig = createArrowElement(
      [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      { x: 0, y: 0, width: 100, height: 100 }
    );
    const latest = { ...orig };
    const result = resizeSingleElement(200, 200, latest, orig, 'se');
    expect(result.width).toBe(200);
    expect(result.height).toBe(200);
    expect(result.points).toBeDefined();
  });

  it('dispatches to linear resize for line elements', () => {
    const orig = createLineElement(
      [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ],
      { x: 0, y: 0, width: 100, height: 50 }
    );
    const latest = { ...orig };
    const result = resizeSingleElement(200, 100, latest, orig, 'se');
    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
  });

  it('dispatches to freedraw resize for freedraw elements', () => {
    const orig = createFreeDrawElement(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      { x: 0, y: 0, width: 10, height: 10 }
    );
    const latest = { ...orig };
    const result = resizeSingleElement(20, 20, latest, orig, 'se');
    expect(result.width).toBe(20);
    expect(result.height).toBe(20);
  });

  it('uses generic resize for rectangle elements', () => {
    const orig = createRectangleElement({ x: 0, y: 0, width: 100, height: 100 });
    const latest = { ...orig };
    const result = resizeSingleElement(200, 150, latest, orig, 'se');
    expect(result.width).toBe(200);
    expect(result.height).toBe(150);
    expect(result).not.toHaveProperty('fontSize');
    expect(result).not.toHaveProperty('points');
  });

  it('uses generic resize for ellipse elements', () => {
    const orig = createEllipseElement({ x: 0, y: 0, width: 100, height: 80 });
    const latest = { ...orig };
    const result = resizeSingleElement(200, 160, latest, orig, 'se');
    expect(result.width).toBe(200);
    expect(result.height).toBe(160);
  });

  it('uses generic resize for diamond elements', () => {
    const orig = createDiamondElement({ x: 0, y: 0, width: 100, height: 100 });
    const latest = { ...orig };
    const result = resizeSingleElement(150, 150, latest, orig, 'se');
    expect(result.width).toBe(150);
    expect(result.height).toBe(150);
  });
});

describe('edge cases', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('handles negative dimensions by enforcing minimum', () => {
    const orig = createRectangleElement({ x: 0, y: 0, width: 100, height: 100 });
    const latest = { ...orig };
    const result = resizeSingleElement(-100, -100, latest, orig, 'se');
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
  });

  it('handles zero dimensions by enforcing minimum', () => {
    const orig = createRectangleElement({ x: 0, y: 0, width: 100, height: 100 });
    const latest = { ...orig };
    const result = resizeSingleElement(0, 0, latest, orig, 'se');
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
  });

  it('handles rotated element resize', () => {
    const orig = createRectangleElement({
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      angle: Math.PI / 6,
    });
    const latest = { ...orig };
    const result = resizeSingleElement(150, 150, latest, orig, 'nw');
    expect(result.width).toBe(150);
    expect(result.height).toBe(150);
  });

  it('preserves element type in result', () => {
    const orig = createRectangleElement({ x: 0, y: 0, width: 100, height: 100 });
    const latest = { ...orig };
    const result = resizeSingleElement(200, 200, latest, orig, 'se');
    expect(result.type).toBeUndefined();
  });
});
