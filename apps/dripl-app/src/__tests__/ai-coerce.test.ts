import { describe, it, expect } from 'vitest';
import {
  boundedNumber,
  isRecord,
  newElementId,
  normalizeId,
  normalizePoints,
  readColor,
  readCoordinate,
  readNumber,
  readString,
} from '@/lib/ai/coerce';

describe('readNumber', () => {
  it('accepts finite numbers and numeric strings', () => {
    expect(readNumber(5, 0)).toBe(5);
    expect(readNumber('42', 0)).toBe(42);
  });

  it('falls back on garbage', () => {
    expect(readNumber(Number.NaN, 7)).toBe(7);
    expect(readNumber(Number.POSITIVE_INFINITY, 7)).toBe(7);
    expect(readNumber('', 7)).toBe(7);
    expect(readNumber('  ', 7)).toBe(7);
    expect(readNumber('abc', 7)).toBe(7);
    expect(readNumber(undefined, 7)).toBe(7);
  });
});

describe('boundedNumber', () => {
  it('clamps both sides and falls back', () => {
    expect(boundedNumber(500, 0, 0, 100)).toBe(100);
    expect(boundedNumber(-5, 0, 0, 100)).toBe(0);
    expect(boundedNumber('nope', 42, 0, 100)).toBe(42);
  });
});

describe('readColor', () => {
  it('accepts hex, transparent, and css functions within budget', () => {
    expect(readColor('#ff0000', 'x')).toBe('#ff0000');
    expect(readColor('transparent', 'x')).toBe('transparent');
    expect(readColor('rgb(1,2,3)', 'x')).toBe('rgb(1,2,3)');
  });

  it('rejects oversized and non-color strings', () => {
    expect(readColor('a'.repeat(81), 'fb')).toBe('fb');
    expect(readColor('javascript:alert(1)', 'fb')).toBe('fb');
    expect(readColor(42, 'fb')).toBe('fb');
  });
});

describe('readString', () => {
  it('trims and truncates', () => {
    expect(readString('  hi  ', '')).toBe('hi');
    expect(readString('abcdef', '', 3)).toBe('abc');
    expect(readString(42, 'fb')).toBe('fb');
  });
});

describe('readCoordinate', () => {
  it('prefers the flat key over the position object', () => {
    expect(readCoordinate({ x: 5, position: { x: 9 } }, 'x', 0)).toBe(5);
    expect(readCoordinate({ position: { x: 9 } }, 'x', 0)).toBe(9);
    expect(readCoordinate({}, 'x', 3)).toBe(3);
  });
});

describe('normalizePoints', () => {
  it('accepts pair arrays and point objects', () => {
    expect(normalizePoints([[0, 1], { x: 2, y: 3 }])).toEqual([
      { x: 0, y: 1 },
      { x: 2, y: 3 },
    ]);
  });

  it('returns [] for non-arrays and null for oversized or malformed input', () => {
    expect(normalizePoints('nope')).toEqual([]);
    expect(normalizePoints(new Array(10_001).fill([0, 0]))).toBeNull();
    expect(normalizePoints([[0]])).toBeNull();
    expect(normalizePoints([{ x: 'a', y: 0 }])).toBeNull();
    expect(normalizePoints([[Number.NaN, 0]])).toBeNull();
  });

  it('clamps coordinates to canvas bounds', () => {
    expect(normalizePoints([[1e9, -1e9]])).toEqual([{ x: 100_000, y: -100_000 }]);
  });
});

describe('normalizeId', () => {
  it('keeps a fresh valid UUID and regenerates otherwise', () => {
    const used = new Set<string>();
    const good = '123e4567-e89b-42d3-a456-426614174000';
    expect(normalizeId(good, used)).toBe(good);
    expect(normalizeId(good, used)).not.toBe(good);
    expect(normalizeId('garbage', used)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('newElementId never returns a used id', () => {
    const used = new Set(['a']);
    const id = newElementId(used);
    expect(used.has(id)).toBe(true);
    expect(id).not.toBe('a');
  });
});

describe('isRecord', () => {
  it('rejects arrays, null, and primitives', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });
});
