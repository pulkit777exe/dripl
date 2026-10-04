import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriplElement, TextElement } from '@dripl/common';
import {
  createTextElement,
  updateArrowLabelPosition,
  updateBoundTextPosition,
} from '@/utils/textBindingUtils';
import { getDefaultFontFamily } from '@/utils/fontPreferences';
import { createRecordingContext, type RecordingContext } from './helpers/canvas-recorder';
import { linear, rectangle } from './helpers/elements';

/**
 * `utils/textBindingUtils.ts` — the pure half of label binding: where a label
 * goes when its shape moves, and what a fresh label looks like.
 *
 * `lib/canvas/binding-sync.ts` is the caller that owns *which* labels move
 * (exclusions, one-owner-at-a-time, the update map); the properties below are
 * the ones this module has to hold on its own:
 *
 * - **idempotence.** `binding-sync` re-runs these on every drag frame, so a
 *   function that grows the label each time it is called turns "move the shape"
 *   into "make the label taller and taller".
 * - **purity.** The results go straight into a Zustand update; mutating the
 *   argument would rewrite a scene element behind every other consumer's back.
 * - **degeneracy.** A zero-size container is reachable (a shape created by a
 *   click rather than a drag), and it must not produce `NaN` coordinates.
 *
 * `strokeWidth: 0` keeps `getBounds`/`getElementBounds` literal; `measureText`
 * is driven by the recording context's 10px-per-character table so the wrapping
 * and height arithmetic are exact rather than dependent on a real font.
 */

const LINE_HEIGHT = 25; // ceil(20 * 1.25), the default font size's line box.

let rec: RecordingContext;

beforeEach(() => {
  // Per-string widths so a candidate line can sit between the 90px wrap width
  // and a 100px one: a uniform 10px/char table cannot distinguish them.
  rec = createRecordingContext({
    textWidths: { 'alpha beta': 95, 'alpha beta gamma': 200 },
    defaultCharWidth: 10,
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(rec.ctx);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function textElement(id: string, overrides: Partial<TextElement> = {}): TextElement {
  return {
    ...rectangle(id, { x: 0, y: 0, width: 200, height: 20 }),
    type: 'text',
    text: 'Label',
    originalText: 'Label',
    fontSize: 20,
    fontFamily: 'Caveat',
    textAlign: 'left',
    verticalAlign: 'top',
    strokeColor: '#000000',
    ...overrides,
  } as unknown as TextElement;
}

describe('updateBoundTextPosition', () => {
  const shape = rectangle('shape', {
    x: 100,
    y: 200,
    width: 200,
    height: 100,
    strokeWidth: 0,
  });

  it('centres the label on the shape and sizes it to the shape inner width', () => {
    // Regression: the label is positioned from the shape's box, so a missing
    // `/ 2` on either axis puts it against the top-left corner of the shape —
    // a bound label visibly hanging off its own shape.
    const label = textElement('label', { text: 'Login' });
    const placed = updateBoundTextPosition(shape, label);

    expect(placed.x).toBe(200);
    expect(placed.y).toBe(200 + 50 - LINE_HEIGHT / 2);
    expect(placed.width).toBe(190);
    expect(placed.height).toBe(LINE_HEIGHT);
    expect(placed.text).toBe('Login');
  });

  it('wraps at the shape width and grows one line box per line', () => {
    // Regression: ignoring `bounds.width - 10` when wrapping lets a long label
    // run off the shape; ignoring `- 10` on the width itself makes it overlap
    // the shape's border. The metrics table puts 'alpha beta' at 95px, which
    // fits a 100px wrap width but not the 90px one the source asks for.
    const narrow = rectangle('narrow', { x: 0, y: 0, width: 100, height: 60, strokeWidth: 0 });

    const placed = updateBoundTextPosition(
      narrow,
      textElement('label', { text: 'alpha beta gamma delta' })
    );

    expect(placed.text).toBe('alpha\nbeta\ngamma\ndelta');
    expect(placed.width).toBe(90);
    expect(placed.height).toBe(4 * LINE_HEIGHT);
  });

  it('is idempotent: repositioning the same label twice changes nothing', () => {
    // Regression: the source collapses the label's existing `\n` before
    // wrapping. Without that collapse every re-wrap keeps the previous line
    // breaks, so dragging a shape once more makes the label one line taller —
    // the label visibly grows with each nudge.
    const label = textElement('label', { text: 'aaaa bbbb cccc dddd' });
    // 100 wide → a 90px wrap width, so the label wraps into two lines.
    const narrow = rectangle('narrow', { x: 0, y: 0, width: 100, height: 60, strokeWidth: 0 });

    const once = updateBoundTextPosition(narrow, label);
    const twice = updateBoundTextPosition(narrow, once);
    const thrice = updateBoundTextPosition(narrow, twice);

    expect(once.text).toBe('aaaa bbbb\ncccc dddd');
    expect(twice).toEqual(once);
    expect(thrice).toEqual(once);
    expect(twice.text.split('\n')).toHaveLength(2);
  });

  it('gives every label bound to one shape its own text and position', () => {
    // Regression: `binding-sync` collects label ids from one owner and writes
    // each result into a map. Anything cached or shared per shape — a memo, or
    // writing into the label instead of returning a copy — makes the second
    // label inherit the first one's text.
    const left = textElement('left', { text: 'Left' });
    const right = textElement('right', { text: 'Right', fontSize: 40 });

    const placedLeft = updateBoundTextPosition(shape, left);
    const placedRight = updateBoundTextPosition(shape, right);

    expect(placedLeft.text).toBe('Left');
    expect(placedRight.text).toBe('Right');
    // A different font size is a different line box, so the two differ in height.
    expect(placedRight.height).not.toBe(placedLeft.height);
    expect(placedLeft).not.toBe(placedRight);
  });

  it('returns a new element and leaves both arguments untouched', () => {
    // Regression: the result is written straight into the scene. Mutating the
    // argument instead would rewrite the store's element for every other
    // consumer, and would make the "same input, same output" property false.
    const label = Object.freeze(textElement('label', { text: 'Login' })) as unknown as TextElement;
    const frozenShape = Object.freeze(shape) as unknown as DriplElement;

    const placed = updateBoundTextPosition(frozenShape, label);

    expect(placed).not.toBe(label);
    expect(label.x).toBe(0);
    expect(label.text).toBe('Login');
    expect(shape.x).toBe(100);
    // Identity and style belong to the label, not to the shape.
    expect(placed.id).toBe('label');
    expect(placed.type).toBe('text');
    expect(placed.fontSize).toBe(20);
    expect(placed.textAlign).toBe('left');
  });

  it('measures with the default font size when the label carries none', () => {
    // Regression: the `?? 20` fallback. Using a different default (or the 16
    // from `createTextElement`) changes every line height, so every bound label
    // in the app is vertically mis-centred by a fraction of a line box.
    const withoutSize = {
      ...textElement('label', { text: 'Login' }),
      fontSize: undefined,
    } as unknown as TextElement;

    const placed = updateBoundTextPosition(shape, withoutSize);

    expect(placed.height).toBe(LINE_HEIGHT);
    expect(placed.y).toBe(200 + 50 - LINE_HEIGHT / 2);
  });

  it('handles a zero-size container without producing NaN coordinates', () => {
    // Regression: a shape created by a click rather than a drag arrives with
    // zero width and height. Anything that divides by those to work out the
    // wrap width or the vertical centring yields `NaN`, and a `NaN` in the
    // scene is silently dropped by validation on the next save.
    const dot = rectangle('dot', { x: 50, y: 50, width: 0, height: 0, strokeWidth: 0 });

    const placed = updateBoundTextPosition(dot, textElement('label', { text: 'one two' }));

    for (const value of [placed.x, placed.y, placed.width, placed.height]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    // Nothing fits in a zero-width wrap, so every word gets its own line.
    expect(placed.text).toBe('one\ntwo');
    expect(placed.x).toBe(50);
    expect(placed.height).toBe(2 * LINE_HEIGHT);
  });

  it('keeps an empty label as one empty line rather than none', () => {
    // Regression: `wrapText` returns `['']` for an empty string. Returning `[]`
    // instead makes `height` zero, and a zero-height text element cannot be hit
    // or clicked on the canvas.
    const placed = updateBoundTextPosition(shape, textElement('label', { text: '' }));

    expect(placed.text).toBe('');
    expect(placed.height).toBe(LINE_HEIGHT);
  });

  it('still places a label when the browser refuses a 2D context for measuring', () => {
    // Regression: `measureText` builds a throwaway canvas per call. A browser
    // that refuses the context (too many live canvases) makes that null, and
    // without the guard every bound-label update on the canvas throws a
    // TypeError mid-drag instead of degrading to "no metrics".
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    const placed = updateBoundTextPosition(
      rectangle('shape', { x: 100, y: 200, width: 200, height: 100, strokeWidth: 0 }),
      textElement('label', { text: 'aaaa bbbb cccc dddd' })
    );

    // No metrics means no wrapping and a zero line box, but the label is still
    // positioned and its text is preserved.
    expect(placed.text).toBe('aaaa bbbb cccc dddd');
    expect(placed.x).toBe(200);
    expect(placed.height).toBe(0);
    expect(placed.y).toBe(250);
  });
});

describe('createTextElement', () => {
  it('creates a label with the editor defaults, placed at the given point', () => {
    // Regression: these defaults are what a bare click-to-add produces. Any one
    // of them changing (font size, alignment) is a visible style change across
    // every scene.
    const created = createTextElement('Hello', { x: 12, y: 34 });

    expect(created.type).toBe('text');
    expect(created.text).toBe('Hello');
    expect(created.originalText).toBe('Hello');
    expect(created.x).toBe(12);
    expect(created.y).toBe(34);
    expect(created.fontSize).toBe(16);
    expect(created.fontFamily).toBe(getDefaultFontFamily());
    expect(created.textAlign).toBe('left');
    expect(created.verticalAlign).toBe('top');
    expect(created.strokeColor).toBe('#000000');
    expect(created.width).toBe(200);
    expect(created.height).toBe(20);
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('lets the caller override every default', () => {
    // Regression: `baseProps` is how a shape's own style is copied onto its
    // label. Dropping the spread (or moving it before the defaults) silently
    // discards the caller's style.
    const created = createTextElement(
      'Hello',
      { x: 0, y: 0 },
      {
        fontSize: 32,
        fontFamily: 'Inter',
        textAlign: 'center',
        verticalAlign: 'middle',
        strokeColor: '#ff0000',
        width: 120,
        height: 40,
      }
    );

    expect(created.fontSize).toBe(32);
    expect(created.fontFamily).toBe('Inter');
    expect(created.textAlign).toBe('center');
    expect(created.verticalAlign).toBe('middle');
    expect(created.strokeColor).toBe('#ff0000');
    expect(created.width).toBe(120);
    expect(created.height).toBe(40);
  });

  it('gives two labels created from the same point and text different ids', () => {
    // Regression: ids key every map in the app (scene index, lock owners, the
    // update map in `binding-sync`). A derived id means two labels collide and
    // one of them becomes unselectable and uneditable.
    const first = createTextElement('Hello', { x: 10, y: 10 });
    const second = createTextElement('Hello', { x: 10, y: 10 });

    expect(first.id).not.toBe(second.id);
  });
});

describe('updateArrowLabelPosition', () => {
  const label = textElement('label', { width: 50, height: 20 });

  it('uses the middle point of an odd-length arrow, in world coordinates', () => {
    // Regression: the point is element-local, so forgetting `arrow.x/y` puts
    // the label at the canvas origin instead of on the arrow.
    const arrow = linear(
      'arrow',
      'arrow',
      [
        { x: 0, y: 0 },
        { x: 40, y: 20 },
        { x: 80, y: 0 },
      ],
      { x: 100, y: 100 }
    );

    const placed = updateArrowLabelPosition(arrow as never, label);

    // Midpoint (140, 120), less half the label's own size.
    expect(placed.x).toBe(140 - 25);
    expect(placed.y).toBe(120 - 10);
  });

  it('uses the midpoint of the middle segment of an even-length arrow', () => {
    // Regression: the index is `length / 2 - 1`. The off-by-one alternative,
    // `length / 2`, is still in range for the first segment and reads as a
    // plausible midpoint — it just biases the label towards the arrow's end.
    const arrow = linear(
      'arrow',
      'arrow',
      [
        { x: 0, y: 0 },
        { x: 20, y: 40 },
        { x: 60, y: 40 },
        { x: 80, y: 0 },
      ],
      { x: 100, y: 100 }
    );

    const placed = updateArrowLabelPosition(arrow as never, label);

    expect(placed.x).toBe(140 - 25);
    expect(placed.y).toBe(140 - 10);
  });

  it('leaves the label alone when the arrow has fewer than two points', () => {
    // Regression: a one-point arrow is the draft state of a drag, which is not
    // schema-validated. Without the guard the midpoint stays 0 and the label
    // jumps to the canvas origin.
    for (const points of [[{ x: 30, y: 30 }], []]) {
      const arrow = {
        ...linear('arrow', 'arrow', [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ]),
        points,
      } as never;
      expect(updateArrowLabelPosition(arrow, label)).toBe(label);
    }

    const withoutPoints = {
      ...linear('arrow', 'arrow', [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    };
    delete (withoutPoints as { points?: unknown }).points;
    expect(updateArrowLabelPosition(withoutPoints as never, label)).toBe(label);
  });

  it('does not mutate the arrow or the label', () => {
    // Regression: the result is stored back into the scene; normalising the
    // arrow's `points` in place to find the midpoint would corrupt the arrow's
    // geometry, and dropping the `/ 2` would move the label off the arrow. The
    // points array is held separately so an in-place reorder is visible.
    const points = [
      { x: 40, y: 0 },
      { x: 0, y: 20 },
    ];
    const arrow = Object.freeze({
      ...linear(
        'arrow',
        'arrow',
        [
          { x: 40, y: 0 },
          { x: 0, y: 20 },
        ],
        { x: 100, y: 100 }
      ),
      points,
    }) as never;

    const placed = updateArrowLabelPosition(arrow, label);

    expect(placed).not.toBe(label);
    expect(placed.x).toBe(120 - 25);
    expect(placed.y).toBe(110 - 10);
    expect(points).toEqual([
      { x: 40, y: 0 },
      { x: 0, y: 20 },
    ]);
    expect(label.x).toBe(0);
    expect(placed.id).toBe('label');
  });
});
