import { describe, it, expect } from 'vitest';
import { isDriplElement } from './types/element';
import type { DriplElement } from './types/element';

describe('isDriplElement', () => {
  it('returns true for valid rectangle element', () => {
    const el: DriplElement = {
      id: 'el-1',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    };
    expect(isDriplElement(el)).toBe(true);
  });

  it('returns true for valid ellipse element', () => {
    const el: DriplElement = {
      id: 'el-1',
      type: 'ellipse',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    };
    expect(isDriplElement(el)).toBe(true);
  });

  it('returns true for valid arrow element', () => {
    const el: DriplElement = {
      id: 'el-1',
      type: 'arrow',
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 100 },
      ],
    };
    expect(isDriplElement(el)).toBe(true);
  });

  it('returns true for valid text element', () => {
    const el: DriplElement = {
      id: 'el-1',
      type: 'text',
      x: 0,
      y: 0,
      width: 100,
      height: 30,
      text: 'Hello',
      fontSize: 16,
      fontFamily: 'Helvetica',
    };
    expect(isDriplElement(el)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isDriplElement(null)).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(isDriplElement('string')).toBe(false);
    expect(isDriplElement(42)).toBe(false);
    expect(isDriplElement(undefined)).toBe(false);
  });

  it('returns false for missing required fields', () => {
    expect(isDriplElement({ id: 'el-1', type: 'rectangle' })).toBe(false);
    expect(isDriplElement({ id: 'el-1', x: 0, y: 0 })).toBe(false);
    expect(isDriplElement({ x: 0, y: 0, width: 100, height: 100 })).toBe(false);
  });

  it('returns false for wrong field types', () => {
    expect(isDriplElement({ id: 123, type: 'rectangle', x: 0, y: 0, width: 100, height: 100 })).toBe(false);
    expect(isDriplElement({ id: 'el-1', type: 'rectangle', x: '0', y: 0, width: 100, height: 100 })).toBe(false);
  });
});
