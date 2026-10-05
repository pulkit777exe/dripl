import { describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';

import { normalizeElement } from '@/utils/canvasUtils';
import { FONT_PREFERENCES } from '@/utils/fontPreferences';

/**
 * `normalizeElement`: the standardiser every element passes through on the way
 * into a scene, no matter whether it arrived from a tool, a JSON payload, or a
 * remote delta.
 *
 * Every branch here *substitutes a default*, so the tests are written as "this
 * input yields this default" rather than as round-trip snapshots -- a snapshot
 * would pass for an element that was normalized wrongly in the same way the
 * fixture was built. Three of the substitutions have a geometry claim behind them
 * that a user can see:
 *
 *   size    -- a zero or negative width/height renders nothing, so both are
 *              floored at 1px. A rectangle dragged to zero width is a normal
 *              gesture, so this is the common path, not an edge case.
 *   angle   -- an angle is normalised into [0, 2*PI). This is what makes a
 *              rotation of 3*PI equal a rotation of PI, and a negative angle
 *              equal the positive one; without it, two elements at the same
 *              visual rotation compare as different.
 *   default font -- a text element with no font family takes the *user's*
 *              preference, so the default is read from `fontPreferences` rather
 *              than hardcoded here.
 */

const TWO_PI = 2 * Math.PI;

/** A rectangle carrying only the schema-required fields. */
const bare = (over: Partial<DriplElement> = {}): DriplElement =>
  ({
    id: 'e1',
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    ...over,
  }) as DriplElement;

/**
 * The property every normalization guarantees, as an invariant rather than a
 * list of expected literals: the output is a usable element.
 */
const isNormalized = (element: DriplElement) => {
  expect(typeof element.id).toBe('string');
  expect(element.id.length).toBeGreaterThan(0);
  expect(typeof element.type).toBe('string');
  expect(element.type.length).toBeGreaterThan(0);
  expect(element.width).toBeGreaterThanOrEqual(1);
  expect(element.height).toBeGreaterThanOrEqual(1);
  expect(element.angle).toBeGreaterThanOrEqual(0);
  expect(element.angle).toBeLessThan(TWO_PI);
};

describe('normalizeElement — required fields', () => {
  it('keeps every supplied field and leaves the result usable', () => {
    const input = bare({ x: 5, y: 6, width: 20, height: 30, strokeColor: '#ff0000' });

    const out = normalizeElement(input);

    isNormalized(out);
    expect(out.x).toBe(5);
    expect(out.y).toBe(6);
    expect(out.width).toBe(20);
    expect(out.height).toBe(30);
    expect(out.strokeColor).toBe('#ff0000');
  });

  // Regression: the missing-id path. An element with no id renders but cannot be
  // selected, locked, bound, or undone by reference -- and it makes every map
  // keyed by id silently collapse.
  it('mints an id when one is missing', () => {
    const input = { ...bare(), id: '' } as DriplElement;

    const out = normalizeElement(input);

    expect(out.id).not.toBe('');
    isNormalized(out);
  });

  it('gives distinct elements distinct minted ids', () => {
    const a = normalizeElement({ ...bare(), id: '' } as DriplElement);
    const b = normalizeElement({ ...bare(), id: '' } as DriplElement);

    expect(a.id).not.toBe(b.id);
  });

  it('falls back to the rectangle renderer for an unknown type', () => {
    const out = normalizeElement({ ...bare(), type: '' } as unknown as DriplElement);

    expect(out.type).toBe('rectangle');
  });

  // Regression: the coordinate defaults. `?? 0` rather than `|| 0` means a
  // deliberate `x: 0` survives, which is the common case for a first element.
  it.each([
    ['x', 0],
    ['y', 0],
  ])('defaults a missing %s to the origin', (field, expected) => {
    const input = bare();
    delete (input as unknown as Record<string, unknown>)[field];

    const out = normalizeElement(input);

    expect(out[field as 'x' | 'y']).toBe(expected);
  });

  it('keeps an explicit zero coordinate rather than treating it as missing', () => {
    const out = normalizeElement(bare({ x: 0, y: 0 }));

    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });
});

describe('normalizeElement — size floor', () => {
  // Regression: a zero-width rectangle is what a click-drag produces, and it
  // renders as nothing. Flooring at 1px keeps the element present and
  // selectable rather than invisible-and-unreachable.
  it.each([
    ['a zero width', { width: 0 }],
    ['a negative width', { width: -50 }],
    ['a zero height', { height: 0 }],
    ['a negative height', { height: -1 }],
  ])('floors %s at one pixel', (_label, over) => {
    const out = normalizeElement(bare(over as Partial<DriplElement>));

    expect(out.width).toBeGreaterThanOrEqual(1);
    expect(out.height).toBeGreaterThanOrEqual(1);
  });

  // The floor is a minimum, not a replacement: a large element must keep its
  // size. Asserting only ">= 1" would pass for an implementation that sets
  // everything to 1.
  it('leaves a size above the floor untouched', () => {
    const out = normalizeElement(bare({ width: 250, height: 175 }));

    expect(out.width).toBe(250);
    expect(out.height).toBe(175);
  });

  it('defaults an absent size to 100 rather than to the floor', () => {
    const input = bare();
    delete (input as unknown as Record<string, unknown>).width;
    delete (input as unknown as Record<string, unknown>).height;

    const out = normalizeElement(input);

    expect(out.width).toBe(100);
    expect(out.height).toBe(100);
  });
});

describe('normalizeElement — angle', () => {
  // Regression: the wrap. An angle left outside [0, 2*PI) makes two elements at
  // the same visual rotation compare as different, which shows up as z-order and
  // hit-testing disagreeing about what is on top.
  it.each([
    ['a full turn plus a quarter', 2.5 * Math.PI, 0.5 * Math.PI],
    ['two full turns plus a quarter', 4.5 * Math.PI, 0.5 * Math.PI],
  ])('wraps %s back into one revolution', (_label, input, expected) => {
    const out = normalizeElement(bare({ angle: input }));

    expect(out.angle).toBeCloseTo(expected, 10);
  });

  // Regression: the negative branch, which is the half a plain `%` cannot
  // produce. JavaScript's `%` keeps the sign of the dividend, so `-0.25 * 2PI` is
  // still negative after the modulo and has to be corrected by adding 2*PI.
  it('corrects a negative angle into the positive range', () => {
    const out = normalizeElement(bare({ angle: -0.25 * TWO_PI }));

    expect(out.angle).toBeCloseTo(1.5 * Math.PI, 10);
  });

  it('maps the two signed representations of a quarter turn to the same angle', () => {
    const positive = normalizeElement(bare({ angle: 0.25 * TWO_PI })).angle;
    const negative = normalizeElement(bare({ angle: -0.75 * TWO_PI })).angle;

    expect(negative as number).toBeCloseTo(positive as number, 10);
  });

  it.each([
    ['zero', 0],
    ['a full turn', TWO_PI],
    ['just under a full turn', TWO_PI - 1e-9],
  ])('keeps %s inside the range', (_label, input) => {
    const out = normalizeElement(bare({ angle: input }));

    expect(out.angle).toBeGreaterThanOrEqual(0);
    expect(out.angle).toBeLessThanOrEqual(TWO_PI);
  });

  // Regression: the non-number guard. `angle` is set by a rotation gesture, and a
  // payload carrying `angle: null` must not reach the modulo as `null`, which
  // coerces to 0 for the division but not for the range check.
  it.each([
    ['null', null],
    ['a string', '90'],
    ['an array', [1, 2]],
  ])('replaces a non-numeric angle (%s) with zero', (_label, angle) => {
    const out = normalizeElement({ ...bare(), angle } as unknown as DriplElement);

    expect(out.angle).toBe(0);
    isNormalized(out);
  });

  // The guard is finiteness, not `typeof`. `typeof NaN === 'number'` and so is
  // `typeof Infinity`, so a `typeof` guard waved all three through; the modulo then
  // yielded `NaN` for each, `NaN < 0` is false so nothing corrected them, and the
  // element left normalisation with a `NaN` rotation — poisoning every coordinate
  // computed from it, which is much harder to trace back than a zeroed angle.
  //
  // `JSON.stringify` renders all three as `null`, so none can arrive from a stored
  // scene or a remote delta. The live path is an in-process producer: a pointer
  // coordinate going non-finite mid-gesture makes `computeRotationAngle`'s `atan2`
  // return `NaN`, which is stored as the angle.
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('zeroes a %s angle rather than letting it poison the coordinates', (_label, angle) => {
    const out = normalizeElement({ ...bare(), angle } as unknown as DriplElement);

    expect(out.angle).toBe(0);
    // The consequence that made this worth fixing: a non-finite rotation turns every
    // derived coordinate non-finite too.
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.y)).toBe(true);
    expect(Number.isFinite(out.width)).toBe(true);
    expect(Number.isFinite(out.height)).toBe(true);
  });

  it('still wraps an ordinary out-of-range angle into 0..2π', () => {
    const tau = 2 * Math.PI;
    expect(normalizeElement({ ...bare(), angle: tau + 1 } as DriplElement).angle).toBeCloseTo(
      1,
      10
    );
    expect(normalizeElement({ ...bare(), angle: -1 } as DriplElement).angle).toBeCloseTo(
      tau - 1,
      10
    );
  });

  it('defaults an absent angle to zero', () => {
    const input = bare();
    delete (input as unknown as Record<string, unknown>).angle;

    expect(normalizeElement(input).angle).toBe(0);
  });

  // Unreachable branch, pinned so it cannot drift silently.
  //
  // The `else` at line 47 assigns 0 when `normalized.angle` is not a number, but
  // the object literal above it already normalised `angle` to
  // `typeof element.angle === 'number' ? element.angle : 0`. So by the time the
  // `typeof` re-test runs, the value is a number for *every* input. The proof is
  // one-directional, as an unreachable branch's must be: feeding the full range of
  // non-numeric inputs still leaves a numeric angle.
  it('cannot reach the non-number else branch, whatever the input angle is', () => {
    const nonNumeric = [
      null,
      undefined,
      '90',
      '',
      {},
      [],
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      true,
      () => 0,
    ];

    for (const angle of nonNumeric) {
      const out = normalizeElement({ ...bare(), angle } as unknown as DriplElement);
      expect(typeof out.angle).toBe('number');
    }
    // And the reachable path still works, so the invariant above is not vacuous:
    // a wrong `angle` that *is* numeric still reaches the modulo.
    expect(normalizeElement(bare({ angle: 2.5 * Math.PI })).angle).toBeCloseTo(0.5 * Math.PI, 10);
  });
});

describe('normalizeElement — style defaults', () => {
  it('fills every style field the renderer reads', () => {
    const input = bare();
    delete (input as unknown as Record<string, unknown>).strokeColor;
    delete (input as unknown as Record<string, unknown>).strokeWidth;
    delete (input as unknown as Record<string, unknown>).strokeStyle;
    delete (input as unknown as Record<string, unknown>).backgroundColor;
    delete (input as unknown as Record<string, unknown>).fillStyle;
    delete (input as unknown as Record<string, unknown>).roughness;
    delete (input as unknown as Record<string, unknown>).opacity;
    delete (input as unknown as Record<string, unknown>).isDeleted;
    delete (input as unknown as Record<string, unknown>).version;
    delete (input as unknown as Record<string, unknown>).versionNonce;

    const out = normalizeElement(input);

    expect(out.strokeColor).toBe('#000000');
    expect(out.strokeWidth).toBe(2);
    expect(out.strokeStyle).toBe('solid');
    expect(out.backgroundColor).toBe('transparent');
    expect(out.fillStyle).toBe('hachure');
    expect(out.roughness).toBe(1);
    expect(out.opacity).toBe(1);
    expect(out.isDeleted).toBe(false);
    expect(typeof out.version).toBe('number');
    expect(typeof out.versionNonce).toBe('number');
  });

  // Regression: `?? 2` rather than `|| 2` for the numeric fields. A stroke width
  // of 0 is legitimate ("no outline") and an opacity of 0 is legitimate ("fully
  // transparent"), so a falsy coercion would silently make both visible.
  it('keeps a falsy numeric style value rather than replacing it with the default', () => {
    const out = normalizeElement(bare({ strokeWidth: 0, opacity: 0, roughness: 0 }));

    expect(out.strokeWidth).toBe(0);
    expect(out.opacity).toBe(0);
    expect(out.roughness).toBe(0);
  });

  // Regression: `version: element.version || 1`. Version 0 is not a legal value,
  // so folding it to 1 is the intended coercion -- unlike the geometry fields,
  // where 0 is meaningful. Pinned to keep the two conventions from being unified
  // by accident.
  it('folds a zero version to the initial version', () => {
    expect(normalizeElement(bare({ version: 0 })).version).toBe(1);
    expect(normalizeElement(bare({ version: 7 })).version).toBe(7);
  });

  it('mints a positive version nonce when one is missing', () => {
    const out = normalizeElement(bare());

    expect(typeof out.versionNonce).toBe('number');
    expect(out.versionNonce).toBeGreaterThanOrEqual(0);
  });

  it('stamps an updated time when none is supplied', () => {
    const before = Date.now();
    const out = normalizeElement(bare());

    expect(typeof out.updated).toBe('number');
    expect(out.updated).toBeGreaterThanOrEqual(before);
  });

  it('keeps an existing updated time', () => {
    expect(normalizeElement(bare({ updated: 1234 })).updated).toBe(1234);
  });

  it('preserves unknown fields from the input', () => {
    const input = { ...bare(), locked: true, customField: 'keep me' } as unknown as DriplElement;

    const out = normalizeElement(input) as unknown as Record<string, unknown>;

    expect(out.locked).toBe(true);
    expect(out.customField).toBe('keep me');
  });
});

describe('normalizeElement — points for linear elements', () => {
  // Regression: a line/arrow/freedraw with no `points` array is the shape a
  // two-click arrow arrives in. Rendering indexes `points[0]`, so the absent
  // array has to become an empty one rather than being left `undefined`.
  it.each(['line', 'arrow', 'freedraw'] as const)('gives a %s an empty points array', type => {
    const input = { ...bare(), type } as DriplElement;
    delete (input as unknown as Record<string, unknown>).points;

    const out = normalizeElement(input);

    expect(Array.isArray(out.points)).toBe(true);
    expect(out.points).toEqual([]);
  });

  // Regression: the `!Array.isArray` half. A payload carrying a *truthy*
  // non-array -- `points: "0,0"` from a naive serialiser, or an object from a
  // hand-edited scene -- passes a truthiness check on `points` alone, so the array
  // check is the only thing that catches it. `null` alone would not: it is falsy
  // and would be caught by the first half of the `||`.
  it.each([
    ['null', null],
    ['a string', '0,0'],
    ['an object', { x: 0, y: 0 }],
    ['a number', 5],
  ])('replaces a non-array points value (%s) with an empty array', (_label, points) => {
    const out = normalizeElement({
      ...bare(),
      type: 'line',
      points,
    } as unknown as DriplElement);

    expect(out.points).toEqual([]);
  });

  it('leaves an existing points array untouched', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ];

    const out = normalizeElement({ ...bare(), type: 'arrow', points } as DriplElement);

    expect(out.points).toEqual(points);
  });

  // Regression: the type gate. Only the three linear types consume `points`, so a
  // rectangle with a stale `points` must keep it rather than having it emptied.
  it('does not touch points on a non-linear element', () => {
    const out = normalizeElement({
      ...bare(),
      type: 'rectangle',
      points: [{ x: 1, y: 2 }],
    } as unknown as DriplElement);

    expect(out.points).toEqual([{ x: 1, y: 2 }]);
  });
});

describe('normalizeElement — text defaults', () => {
  // Regression: the font-size/family pair. A text element with no `text` still
  // renders a text box, and the renderer reads `fontSize` and `fontFamily`
  // unconditionally -- so the two defaults have to be applied together or the
  // element renders with `undefined` geometry.
  it('gives a text element with no content an empty string and both font defaults', () => {
    const input = { ...bare(), type: 'text' } as DriplElement;
    delete (input as unknown as Record<string, unknown>).text;
    delete (input as unknown as Record<string, unknown>).fontSize;
    delete (input as unknown as Record<string, unknown>).fontFamily;

    const out = normalizeElement(input);

    expect(out.text).toBe('');
    expect(out.fontSize).toBe(20);
    // The default family comes from the user's stored preference, not a literal
    // here -- read through the same source the preferences write to.
    expect(out.fontFamily).toBe(FONT_PREFERENCES.handwritten);
  });

  it('keeps supplied text, size and family', () => {
    const out = normalizeElement({
      ...bare(),
      type: 'text',
      text: 'hello',
      fontSize: 32,
      fontFamily: FONT_PREFERENCES.mono,
    } as unknown as DriplElement);

    expect(out.text).toBe('hello');
    expect(out.fontSize).toBe(32);
    expect(out.fontFamily).toBe(FONT_PREFERENCES.mono);
  });

  // Regression: the guard is `type === 'text' && !text`, so the font defaults are
  // applied *only* on the same branch that supplies the empty string. A text
  // element that already has content keeps whatever font it carries, including
  // none. Pinned because the pairing is what stops an existing text element's
  // font from being rewritten on every normalization pass -- and it is also why a
  // text element with content and no family reaches the renderer with an
  // `undefined` family, which is a real gap rather than an intended default.
  it('applies the font defaults only on the same branch that supplies the empty text', () => {
    const withContent = normalizeElement({
      ...bare(),
      type: 'text',
      text: 'hi',
    } as unknown as DriplElement);
    const withoutContent = normalizeElement({ ...bare(), type: 'text' } as DriplElement);

    expect(withContent.text).toBe('hi');
    expect(withContent.fontFamily).toBeUndefined();
    expect(withoutContent.text).toBe('');
    expect(withoutContent.fontFamily).toBe(FONT_PREFERENCES.handwritten);
  });

  it('keeps an explicitly empty font string on a text element that has content', () => {
    const out = normalizeElement({
      ...bare(),
      type: 'text',
      text: 'hi',
      fontFamily: '',
    } as unknown as DriplElement);

    expect(out.fontFamily).toBe('');
  });

  it('does not apply text defaults to a non-text element', () => {
    const out = normalizeElement({ ...bare(), type: 'rectangle' } as DriplElement);

    expect((out as unknown as Record<string, unknown>).text).toBeUndefined();
    expect((out as unknown as Record<string, unknown>).fontSize).toBeUndefined();
  });
});

describe('normalizeElement — image defaults', () => {
  // Regression: the `src` default. An image element with no source renders a
  // broken-image placeholder, so it must carry `''` -- which the renderer's
  // "is there a source" check reads as "not an image yet" rather than crashing on
  // `undefined`.
  it('gives an image element with no source an empty src', () => {
    const input = { ...bare(), type: 'image' } as DriplElement;
    delete (input as unknown as Record<string, unknown>).src;

    expect(normalizeElement(input).src).toBe('');
  });

  it('keeps a supplied source', () => {
    const out = normalizeElement({
      ...bare(),
      type: 'image',
      src: 'https://example.test/a.png',
    } as unknown as DriplElement);

    expect(out.src).toBe('https://example.test/a.png');
  });

  it('does not apply the image default to another type', () => {
    const out = normalizeElement(bare({ type: 'frame' }) as DriplElement);

    expect((out as unknown as Record<string, unknown>).src).toBeUndefined();
  });
});

describe('normalizeElement — frame defaults', () => {
  // Regression: the padding default. A frame's padding is what separates its
  // children from its border; leaving it undefined makes a child overlap the
  // frame edge.
  it('gives a frame with no padding the default padding', () => {
    const input = { ...bare(), type: 'frame' } as DriplElement;
    delete (input as unknown as Record<string, unknown>).padding;

    expect(normalizeElement(input).padding).toBe(20);
  });

  // The guard is `typeof !== 'number'`, so a *numeric* 0 must survive -- a frame
  // with genuinely no padding is a legitimate layout. A falsy coercion would
  // turn it into 20.
  it('keeps a numeric padding of zero', () => {
    expect(
      normalizeElement({ ...bare(), type: 'frame', padding: 0 } as unknown as DriplElement).padding
    ).toBe(0);
  });

  it.each([
    ['null', null],
    ['a string', '20'],
    ['an object', {}],
  ])('replaces a non-numeric padding (%s) with the default', (_label, padding) => {
    const out = normalizeElement({
      ...bare(),
      type: 'frame',
      padding,
    } as unknown as DriplElement);

    expect(out.padding).toBe(20);
  });

  it('keeps a supplied numeric padding', () => {
    expect(
      normalizeElement({ ...bare(), type: 'frame', padding: 48 } as unknown as DriplElement).padding
    ).toBe(48);
  });

  it('does not apply the frame default to another type', () => {
    const out = normalizeElement(bare({ padding: 0 }) as unknown as DriplElement);

    expect(out.padding).toBe(0);
  });
});

describe('normalizeElement — determinism', () => {
  // Regression: normalization runs on every element on the autosave and collab
  // paths, so a per-call coin flip in `versionNonce` would make two normalizations
  // of the same element differ and defeat the LWW freshness fence, which compares
  // `(version, versionNonce)`. Only the *missing* case is allowed to be random.
  it('is idempotent once every defaulted field is present', () => {
    const once = normalizeElement(bare());
    const twice = normalizeElement(once);

    expect(twice).toEqual(once);
  });

  it('only mints a fresh nonce when the input lacks one', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      expect(normalizeElement(bare({ versionNonce: 99 })).versionNonce).toBe(99);
      expect(normalizeElement(bare()).versionNonce).toBe(Math.floor(0.5 * 2_147_483_647));
    } finally {
      spy.mockRestore();
    }
  });
});
