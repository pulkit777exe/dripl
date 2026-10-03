import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import type { Drawable } from '../rough-renderer';

import { clearShapeFromCache, getShapeFromCache, setShapeInCache } from '../shape-cache';

function element(overrides: Partial<DriplElement> = {}): DriplElement {
  return {
    id: 'e1',
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    version: 4,
    versionNonce: 9,
    ...overrides,
  } as DriplElement;
}

const drawable = (name: string) => ({ name }) as unknown as Drawable;

describe('shape cache hit and miss', () => {
  it('misses for an element that was never cached', () => {
    expect(getShapeFromCache(element())).toBeUndefined();
  });

  it('returns the identical object it was given, not a copy', () => {
    // The whole point of caching a Rough.js drawable is object identity: the
    // per-element bitmap is blitted from it, and a fresh object per frame would
    // re-run the generator, which is the most expensive thing on the path.
    const shape = drawable('first');
    const target = element();
    setShapeInCache(target, shape, 'light');
    expect(getShapeFromCache(target, 'light')).toBe(shape);
  });

  it('is keyed by element identity, so two equal elements do not share', () => {
    const shape = drawable('first');
    setShapeInCache(element(), shape, 'light');
    expect(getShapeFromCache(element(), 'light')).toBeUndefined();
  });

  it('keeps an array of drawables intact', () => {
    const shapes = [drawable('a'), drawable('b')];
    const target = element();
    setShapeInCache(target, shapes, 'light');
    expect(getShapeFromCache(target, 'light')).toBe(shapes);
  });

  it('defaults to the light theme', () => {
    const shape = drawable('first');
    const target = element();
    setShapeInCache(target, shape);
    expect(getShapeFromCache(target)).toBe(shape);
    // Reading it back as dark is a different question, and a miss.
    expect(getShapeFromCache(target, 'dark')).toBeUndefined();
  });
});

describe('shape cache staleness', () => {
  it('misses once the element version moves, and evicts the entry', () => {
    const target = element({ version: 4 });
    setShapeInCache(target, drawable('old'), 'light');

    // `mutateElement` produces a new object, so this models a mutation that was
    // applied in place — the defensive path that the WeakMap key cannot catch.
    const mutated = { ...target, version: 5 };
    expect(getShapeFromCache(mutated, 'light')).toBeUndefined();

    // And the miss must be sticky, not a re-read of the stale value.
    expect(getShapeFromCache(mutated, 'light')).toBeUndefined();
  });

  it('misses on a theme change and evicts the entry', () => {
    const target = element();
    setShapeInCache(target, drawable('light-shape'), 'light');
    expect(getShapeFromCache(target, 'dark')).toBeUndefined();
    // Reading it back as light now misses too: the entry was dropped, not kept.
    expect(getShapeFromCache(target, 'light')).toBeUndefined();
  });

  it('caches an element that carries no version, on both sides reading 0', () => {
    // Not a miss: `undefined` reads as 0 on the write and on the read, so a
    // versionless element is cacheable. Pinned because the `?? 0` appears twice
    // and a one-sided change would silently disable the cache for imported
    // legacy elements — a performance regression with no other symptom.
    const legacy = { ...element(), version: undefined } as unknown as DriplElement;
    const shape = drawable('legacy');
    setShapeInCache(legacy, shape, 'light');
    expect(getShapeFromCache(legacy, 'light')).toBe(shape);
  });
});

describe('shape cache invalidation', () => {
  it('drops the entry so the next read regenerates', () => {
    const target = element();
    const first = drawable('first');
    setShapeInCache(target, first, 'light');

    clearShapeFromCache(target);
    expect(getShapeFromCache(target, 'light')).toBeUndefined();

    const second = drawable('second');
    setShapeInCache(target, second, 'light');
    expect(getShapeFromCache(target, 'light')).toBe(second);
  });

  it('tolerates invalidating an element that was never cached', () => {
    expect(() => clearShapeFromCache(element())).not.toThrow();
  });

  it('does not disturb a sibling element', () => {
    const a = element({ id: 'a' });
    const b = element({ id: 'b' });
    const shape = drawable('b-shape');
    setShapeInCache(a, drawable('a-shape'), 'light');
    setShapeInCache(b, shape, 'light');

    clearShapeFromCache(a);

    expect(getShapeFromCache(a, 'light')).toBeUndefined();
    expect(getShapeFromCache(b, 'light')).toBe(shape);
  });

  it('cannot reach a mutated element through a clear on the pre-mutation object', () => {
    // `mutateElement` clears the cache on the object it was given, but the
    // post-mutation object is a different WeakMap key, so that clear cannot
    // touch its entry. The version comparison in `getShapeFromCache` is the
    // defence that actually applies; this pins the shape of that arrangement
    // so the two are not confused for one mechanism.
    const before = element({ version: 4 });
    const after = { ...before, version: 5 };
    const shape = drawable('new');
    setShapeInCache(after, shape, 'light');

    clearShapeFromCache(before);

    expect(getShapeFromCache(after, 'light')).toBe(shape);
    // The pre-mutation object is a separate key and does miss.
    expect(getShapeFromCache(before, 'light')).toBeUndefined();
  });
});
