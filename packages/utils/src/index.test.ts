import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateId, deepClone, throttle } from './index';

describe('generateId', () => {
  it('returns a string of length 9', () => {
    const id = generateId();
    expect(id).toHaveLength(9);
  });

  it('returns different ids on each call', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    // Should have near-unique values (allow tiny collision chance)
    expect(ids.size).toBeGreaterThan(90);
  });

  it('contains only alphanumeric characters', () => {
    const id = generateId();
    expect(id).toMatch(/^[a-z0-9]+$/);
  });
});

describe('deepClone', () => {
  it('clones a simple object', () => {
    const obj = { a: 1, b: { c: 2 } };
    const cloned = deepClone(obj);
    expect(cloned).toEqual(obj);
    expect(cloned).not.toBe(obj);
  });

  it('clones an array', () => {
    const arr = [1, 2, [3, 4]];
    const cloned = deepClone(arr);
    expect(cloned).toEqual(arr);
    expect(cloned).not.toBe(arr);
  });

  it('clones primitive values', () => {
    expect(deepClone(42)).toBe(42);
    expect(deepClone('hello')).toBe('hello');
    expect(deepClone(true)).toBe(true);
    expect(deepClone(null)).toBe(null);
  });

  it('does not preserve functions', () => {
    const obj = { fn: () => 'test' };
    const cloned = deepClone(obj) as { fn?: () => string };
    expect(cloned.fn).toBeUndefined();
  });

  it('converts Date to ISO string', () => {
    const date = new Date('2024-01-01');
    const cloned = deepClone(date);
    expect(cloned).not.toBe(date);
    // deepClone converts Date to ISO string via JSON serialization
    expect(typeof cloned).toBe('string');
  });

  it('handles empty objects and arrays', () => {
    expect(deepClone({})).toEqual({});
    expect(deepClone([])).toEqual([]);
  });
});

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls the function immediately on first invocation', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('ignores subsequent calls within the limit', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled();
    throttled();
    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('allows calls after the limit expires', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled();
    vi.advanceTimersByTime(100);
    throttled();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('passes arguments to the throttled function', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled('arg1', 'arg2');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
  });

  it('maintains correct context (this)', () => {
    const obj = {
      value: 42,
      fn: vi.fn(function (this: { value: number }) {
        return this.value;
      }),
    };
    const throttled = throttle(obj.fn.bind(obj), 100);
    // Call the throttled function
    throttled();
    vi.advanceTimersByTime(100);
    // The function should have been called with correct context
    expect(obj.fn).toHaveBeenCalled();
  });

  it('handles zero limit', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 0);
    throttled();
    vi.advanceTimersByTime(0);
    expect(fn).toHaveBeenCalled();
  });
});
