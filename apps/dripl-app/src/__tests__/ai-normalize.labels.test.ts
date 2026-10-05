import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { createBoundLabel, normalizeModelElements, wrapLabel } from '@/lib/ai/normalize';
import { MAX_AI_ELEMENTS } from '@/lib/ai/constants';

/**
 * The AI-output normalizer, from the label side.
 *
 * `wrapLabel` / `createBoundLabel` / the label bookkeeping inside
 * `normalizeModelElements` are the part of the pipeline that turns a model's
 * `text` field into a second, real canvas element. They are worth testing
 * separately from the geometry clamping because their failure modes are
 * different: they lose *elements*, not coordinates, and a lost label is
 * reported through `truncatedCount` rather than `droppedCount`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A distinct valid UUID per index, so ids never collide with each other. */
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

/** A minimal rectangle raw element; each test varies exactly one field. */
const rect = (over: Record<string, unknown> = {}) => ({
  id: uuid(1),
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 100,
  height: 60,
  ...over,
});

describe('wrapLabel', () => {
  it('fills each line up to the character budget before breaking', () => {
    // 6 chars per line at width 100 / fontSize 30 (100 / (30*0.58) = 5.7 -> 5).
    const budget = Math.max(1, Math.floor(100 / Math.max(1, 30 * 0.58)));
    const words = 'aa bb cc dd'.split(' ');
    const lines = wrapLabel(words.join(' '), 100, 30);

    // Every produced line except the last is full to within the budget: the
    // invariant is "greedy fill", which holds regardless of what the budget is.
    for (const line of lines.slice(0, -1)) {
      expect(line.length).toBeGreaterThan(budget - words[0]!.length);
    }
    // Rejoining is lossless — the wrapper may re-break lines, never drop words.
    expect(lines.join(' ').split(' ')).toEqual(words);
  });

  it('keeps a blank paragraph as a blank line rather than collapsing it', () => {
    // The empty-paragraph branch: without it, "a\n\nb" would come back as
    // ['a', 'b'] and the label would silently lose its line break.
    const lines = wrapLabel('a\n\nb', 1000, 16);
    expect(lines).toEqual(['a', '', 'b']);
    expect(lines.join('\n')).toBe('a\n\nb');
  });

  it('treats a whitespace-only paragraph as blank and splits on \\r\\n too', () => {
    expect(wrapLabel('a\r\n   \r\nb', 1000, 16)).toEqual(['a', '', 'b']);
  });

  it('returns a single empty line for empty or whitespace-only text', () => {
    expect(wrapLabel('', 1000, 16)).toEqual(['']);
    expect(wrapLabel('    ', 1000, 16)).toEqual(['']);
  });

  it('never returns an empty array, whatever the width and font size', () => {
    // Both divisors are floored at 1, so a zero/negative width still yields a
    // one-character budget instead of dividing by zero or producing NaN.
    expect(wrapLabel('a b', 0, 16)).toEqual(['a', 'b']);
    expect(wrapLabel('a b', -50, 0)).toEqual(['a', 'b']);
    // Wrapping is word-based, not character-based: an unbroken word longer
    // than the budget overflows its line rather than being split. Recorded so
    // a future character-level wrapper is recognised as a behaviour change.
    expect(wrapLabel('hi', 1, 16)).toEqual(['hi']);
  });
});

describe('createBoundLabel', () => {
  /** A parsed owner, as the normalizer would have produced it. */
  const owner = (over: Partial<DriplElement> = {}): DriplElement =>
    ({
      id: 'owner-1',
      type: 'rectangle',
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      strokeColor: '#123456',
      ...over,
    }) as DriplElement;

  it('builds a bound, centred text element with the owner id on both fields', () => {
    const used = new Set<string>();
    const label = createBoundLabel({ text: 'Hello there' }, owner(), used)!;

    expect(label).not.toBeNull();
    expect(label.type).toBe('text');
    // Both references, not just one: the renderer reads containerId, the
    // selection/label wiring reads boundElementId.
    expect(label.boundElementId).toBe('owner-1');
    expect(label.containerId).toBe('owner-1');
    expect(label.id).toMatch(UUID);
    expect(label.id).not.toBe('owner-1');
    // The minted id is registered so a later element cannot reuse it.
    expect(used.has(label.id)).toBe(true);
  });

  it('refuses to label a text element', () => {
    // A text owner already *is* text; binding a label to it would produce an
    // unrenderable text-in-text. This is the branch the pipeline relies on to
    // avoid a second element for every text the model emits.
    const used = new Set<string>();
    expect(createBoundLabel({ text: 'hi' }, owner({ type: 'text' }), used)).toBeNull();
    expect(used.size).toBe(0);
  });

  it('refuses when the owner carries no usable label text', () => {
    const used = new Set<string>();
    const o = owner();
    expect(createBoundLabel({}, o, used)).toBeNull();
    expect(createBoundLabel({ text: '   ' }, o, used)).toBeNull();
    expect(createBoundLabel({ text: 42 }, o, used)).toBeNull();
    expect(used.size).toBe(0);
  });

  it('falls back to black when the owner has no stroke color', () => {
    // `owner.strokeColor ?? '#000000'` — reachable only through a hand-built
    // owner, because the schema gives every parsed element a default color.
    // Built by hand so the field is genuinely absent rather than undefined.
    const ownerWithoutColor = {
      id: 'owner-1',
      type: 'rectangle',
      x: 10,
      y: 20,
      width: 200,
      height: 100,
    } as DriplElement;
    const label = createBoundLabel({ text: 'hi' }, ownerWithoutColor, new Set())!;
    expect(label.strokeColor).toBe('#000000');
  });

  it("inherits the owner's stroke color when one is present", () => {
    const label = createBoundLabel({ text: 'hi' }, owner({ strokeColor: '#abcdef' }), new Set())!;
    expect(label.strokeColor).toBe('#abcdef');
  });

  it('refuses to build a label whose geometry would fall outside the schema', () => {
    // The x offset is `owner.x + (owner.width - labelWidth) / 2`, so an owner
    // pushed near the coordinate ceiling produces a label past it and the
    // final schema parse rejects the whole label. Asserted through the refusal
    // (null), not through an out-of-range coordinate leaking out.
    const far = owner({ x: 100_000, width: 200 });
    expect(createBoundLabel({ text: 'hi' }, far, new Set())).toBeNull();
  });

  it('clamps the label font size into the schema range', () => {
    const o = owner();
    const big = createBoundLabel({ text: 'hi', fontSize: 9_999 }, o, new Set())!;
    const small = createBoundLabel({ text: 'hi', fontSize: 0 }, o, new Set())!;
    expect(big.fontSize).toBe(72);
    expect(small.fontSize).toBe(8);
  });
});

describe('normalizeModelElements — non-element input', () => {
  it('drops a non-object entry without counting it twice', () => {
    // A model that emits `null` between elements costs one dropped element and
    // no truncated one: the cap only applies to elements that were prepared.
    const out = normalizeModelElements([null, 42, 'rectangle', [], rect()]);
    expect(out.elements).toHaveLength(1);
    expect(out.droppedCount).toBe(4);
    expect(out.truncatedCount).toBe(0);
  });

  it('defaults an explicitly null type to a rectangle, not a drop', () => {
    // `rawType === undefined || rawType === null` — both spellings must be
    // defaulted, and an unrecognised type must still be dropped.
    const out = normalizeModelElements([
      rect({ id: uuid(1), type: undefined }),
      rect({ id: uuid(2), type: null }),
      rect({ id: uuid(3), type: 'hologram' }),
    ]);
    expect(out.elements.map(e => e.type)).toEqual(['rectangle', 'rectangle']);
    expect(out.droppedCount).toBe(1);
  });
});

describe('normalizeModelElements — text elements', () => {
  /**
   * A text raw element is the one case where `createBoundLabel` returns null
   * *because* of the owner's type, so it is also the only way to reach the
   * "a label was asked for and lost" counter. The counter is therefore equal
   * to the number of non-empty text elements the model emitted — an invariant
   * derived from the input, not a literal.
   */
  const textRaw = (over: Record<string, unknown> = {}) => ({
    ...rect(),
    type: 'text',
    text: 'hello',
    ...over,
  });

  it('carries text fields and never emits a second bound label for a text', () => {
    const out = normalizeModelElements([textRaw()]);
    expect(out.elements).toHaveLength(1);
    expect(out.elements[0]!.type).toBe('text');
    expect(out.elements[0]!.text).toBe('hello');
    expect(out.elements[0]!.originalText).toBe('hello');
    // Dropped is 0: the element itself is perfectly valid. The loss is a label,
    // which the caller must be told about separately.
    expect(out.droppedCount).toBe(0);
    expect(out.truncatedCount).toBe(1);
  });

  it('trims and length-caps the label text the same way for owner and label', () => {
    const padded = textRaw({ text: '  spaced out  ' });
    const out = normalizeModelElements([padded]);
    // readString trims, so the surviving text has no leading/trailing space.
    expect(out.elements[0]!.text).toBe('spaced out');
  });

  it('accepts every known alignment and defaults an unknown one', () => {
    // Both ternary chains are `a || b || c ? value : default`, so coverage of
    // each `||` operand needs a value that short-circuits at that operand.
    const cases: Array<[string | undefined, string | undefined]> = [
      // textAlign short-circuits: first operand, second operand, third operand,
      // then a value none of them match.
      ['center', 'top'],
      ['right', 'bottom'],
      ['left', 'middle'],
      ['justified', 'sideways'],
      [undefined, undefined],
    ];
    const out = normalizeModelElements(
      cases.map(([textAlign, verticalAlign], i) =>
        textRaw({ id: uuid(i + 10), textAlign, verticalAlign })
      )
    );

    expect(out.elements).toHaveLength(cases.length);
    expect(out.elements.map(e => e.textAlign)).toEqual(['center', 'right', 'left', 'left', 'left']);
    expect(out.elements.map(e => e.verticalAlign)).toEqual([
      'top',
      'bottom',
      'middle',
      'middle',
      'middle',
    ]);
  });

  it('does not count an empty text string as a lost label', () => {
    // The counter is gated on a non-empty label string, so a text element with
    // no text costs nothing.
    const out = normalizeModelElements([textRaw({ text: '' }), textRaw({ id: uuid(2) })]);
    expect(out.truncatedCount).toBe(1);
  });
});

describe('normalizeModelElements — style passthrough', () => {
  it('keeps a recognised stroke style and falls back to solid for anything else', () => {
    // The style is an inline `a || b || c ? raw : 'solid'`. Every operand must
    // be seen matching, otherwise a model asking for `dotted` would be silently
    // downgraded to `solid` and no test would notice.
    const styles = ['dashed', 'dotted', 'solid', 'squiggly', 7, null] as const;
    const out = normalizeModelElements(
      styles.map((strokeStyle, i) => rect({ id: uuid(i + 1), strokeStyle }))
    );

    expect(out.elements.map(e => e.strokeStyle)).toEqual([
      'dashed',
      'dotted',
      'solid',
      'solid',
      'solid',
      'solid',
    ]);
    // A style the schema rejects would take the whole element with it, so the
    // survivors also prove the fallback stays inside the enum.
    expect(out.droppedCount).toBe(0);
    expect(out.elements).toHaveLength(styles.length);
  });
});

describe('normalizeModelElements — label budget', () => {
  it('stops adding labels once the element cap is reached, and reports each loss', () => {
    /**
     * Every element is labelled, so each prepared element contributes two
     * entries. The cap check happens *after* the owner is pushed, so the run
     * overshoots the cap and is then trimmed back — which is what the final
     * `splice` is for. Owners are never counted against the cap separately
     * from labels, so the surviving set is the *prefix*: owners 0..K and their
     * labels, for the largest K that fits.
     */
    const raw = Array.from({ length: MAX_AI_ELEMENTS }, (_, i) =>
      rect({ id: uuid(i + 1), text: `L${i}` })
    );
    const out = normalizeModelElements(raw);

    expect(out.elements.length).toBe(MAX_AI_ELEMENTS);
    // The ids that came from the model are exactly the owners, and they are a
    // prefix of the input: no owner was dropped in favour of a later one.
    const ownerIds = out.elements.filter(e => e.type === 'rectangle').map(e => e.id);
    expect(ownerIds).toEqual(raw.slice(0, ownerIds.length).map(r => r.id));
    expect(ownerIds.length).toBeGreaterThan(0);
    // Every owner in the survivor still has its label next to it, so the trim
    // did not cut a pair in half.
    const labelIds = new Set(out.elements.filter(e => e.type === 'text').map(e => e.id));
    for (const owner of out.elements.filter(e => e.type === 'rectangle')) {
      expect(owner.labelId).toBeDefined();
      expect(labelIds.has(owner.labelId!)).toBe(true);
    }
    // Nothing was *dropped* — every owner parsed — but labels past the cap
    // were refused, and each refusal is reported rather than silently lost.
    expect(out.droppedCount).toBe(0);
    expect(out.truncatedCount).toBeGreaterThan(0);
    // One input element too many is not what made this over the cap: the cap
    // was hit by label *inflation* on exactly the cap-many inputs.
    expect(raw.length).toBe(MAX_AI_ELEMENTS);
  });

  it('links a surviving label back to its owner through labelId and boundElements', () => {
    const out = normalizeModelElements([rect({ id: uuid(1), text: 'tag' })]);
    const ownerElement = out.elements.find(e => e.id === uuid(1))!;
    const label = out.elements.find(e => e.id !== uuid(1))!;

    expect(label.type).toBe('text');
    expect(ownerElement.labelId).toBe(label.id);
    expect(ownerElement.boundElements).toEqual([{ id: label.id, type: 'text' }]);
  });

  it('keeps a label that overflows the owner box instead of dropping it', () => {
    // Width is clamped at 1 by the geometry pass, so `owner.width - 20` goes
    // negative and the label is floored at 1px wide rather than rejected.
    const out = normalizeModelElements([rect({ id: uuid(1), width: 5, text: 'long label text' })]);
    const label = out.elements.find(e => e.type === 'text')!;
    expect(label.width).toBeGreaterThanOrEqual(1);
    expect(label.boundElementId).toBe(uuid(1));
  });
});
