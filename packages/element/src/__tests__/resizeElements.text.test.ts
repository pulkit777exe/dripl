import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { DriplElement } from '@dripl/common';

import { resizeSingleElement, resizeSingleTextElement } from '../resizeElements';

/**
 * A font metric that is exactly derivable by hand: every character is
 * `fontSize * CHAR_ADVANCE` wide, and the font size is read back off `ctx.font`
 * the way a real 2D context exposes it. jsdom has no canvas backend, so the
 * measurement surface is stubbed; the arithmetic under test is the caller's, and
 * this keeps the expectations independent of any font library.
 */
const CHAR_ADVANCE = 0.5;

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = function stubbed(
    this: HTMLCanvasElement
  ): CanvasRenderingContext2D {
    const ctx = {
      font: '',
      measureText(text: string) {
        const fontSize = Number(/([0-9.]+)px/.exec(ctx.font)?.[1] ?? '16');
        return { width: text.length * fontSize * CHAR_ADVANCE } as TextMetrics;
      },
    } as unknown as CanvasRenderingContext2D;
    return ctx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

function textElement(overrides: Partial<DriplElement> = {}): DriplElement {
  return {
    id: 't1',
    type: 'text',
    x: 0,
    y: 0,
    width: 400,
    height: 24,
    text: 'aaaa bbbb cccc dddd',
    originalText: 'aaaa bbbb cccc dddd',
    fontSize: 20,
    fontFamily: 'Arial',
    lineHeight: 1.2,
    textAlign: 'left',
    autoResize: true,
    version: 1,
    versionNonce: 1,
    ...overrides,
  } as DriplElement;
}

describe('side-handle text resize reports a usable height', () => {
  it('reports the wrapped text box in pixels, not in line-height units', () => {
    const element = textElement();
    const result = resizeSingleTextElement(element, element, 'e', false, 60, 24);

    expect(result.text).toBe('aaaa\nbbbb\ncccc\ndddd');
    // 4 lines at 20px with a 1.2 multiplier is 96 device pixels. `lineHeight`
    // on an element is a unitless multiplier, so multiplying only by it would
    // yield 4.8 — a box 4.8px tall that no longer contains its own glyphs.
    expect(result.height).toBeCloseTo(4 * 20 * 1.2, 9);
    expect(result.height).toBe(96);
  });

  it('scales the reported height with both the line count and the font size', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(8, 12, 16, 20, 48),
        fc.constantFrom(1, 1.2, 1.4, 2),
        fc.constantFrom<'e' | 'w'>('e', 'w'),
        (fontSize, lineHeight, handle) => {
          const element = textElement({ fontSize, lineHeight });
          const result = resizeSingleTextElement(element, element, handle, false, 50, 24);
          const lineCount = (result.text as string).split('\n').length;
          expect(result.height).toBeCloseTo(lineCount * fontSize * lineHeight, 6);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('keeps the reported height equal to the rendered line pitch', () => {
    // The app's own text renderer lays lines out at `fontSize * 1.25`. If the
    // resize path disagreed, the box the resize commits to and the box the
    // renderer fills would drift apart with every wrap.
    const element = textElement({ fontSize: 16, lineHeight: 1.25 });
    const result = resizeSingleTextElement(element, element, 'e', false, 70, 24);
    const lineCount = (result.text as string).split('\n').length;
    expect(result.height).toBeCloseTo(lineCount * 16 * 1.25, 6);
  });

  it('defaults the multiplier to 1.2 when the element carries none', () => {
    const element = textElement({ lineHeight: undefined } as unknown as Partial<DriplElement>);
    const result = resizeSingleTextElement(element, element, 'e', false, 50, 24);
    const lineCount = (result.text as string).split('\n').length;
    expect(result.height).toBeCloseTo(lineCount * 20 * 1.2, 6);
  });
});

describe('side-handle text re-wrapping', () => {
  it('never loses or duplicates a word', () => {
    fc.assert(
      fc.property(
        // Non-space words only: a whitespace-only "word" cannot survive a
        // whitespace-normalising round trip, so including it would assert a
        // property of the generator rather than of the wrapper.
        fc.array(
          fc
            .string({ minLength: 1, maxLength: 8, unit: 'grapheme-ascii' })
            .map(word => word.replace(/\s/g, 'x').replace(/^$/, 'x')),
          { minLength: 1, maxLength: 14 }
        ),
        fc.double({ min: 20, max: 600, noNaN: true }),
        fc.constantFrom<'e' | 'w'>('e', 'w'),
        (words, nextWidth, handle) => {
          const source = words.join(' ');
          const element = textElement({ text: source, originalText: source });
          const result = resizeSingleTextElement(element, element, handle, false, nextWidth, 24);
          const roundTripped = (result.text as string).split(/\s+/).filter(Boolean);
          expect(roundTripped).toEqual(words);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('reports a positive width even when asked for a negative one', () => {
    const element = textElement();
    const result = resizeSingleTextElement(element, element, 'w', false, -500, 24);
    expect(result.width).toBeGreaterThan(0);
    expect(Number.isFinite(result.width as number)).toBe(true);
  });

  it('will not shrink below one glyph plus its padding', () => {
    // 'A' at 20px is 10px under this metric, so the floor is 18px. Asking for
    // less must clamp, or the box collapses to nothing and the text is
    // unreachable.
    const element = textElement({ fontSize: 20 });
    const result = resizeSingleTextElement(element, element, 'e', false, 2, 24);
    expect(result.width).toBe(18);
  });

  it('turns off auto-resize so the committed width survives', () => {
    const element = textElement();
    expect(resizeSingleTextElement(element, element, 'e', false, 60, 24).autoResize).toBe(false);
  });

  it('wraps from the original text, not from an already-wrapped copy', () => {
    // `text` is the wrapped form; `originalText` is the source. Wrapping the
    // wrapped form would accumulate newlines on every gesture frame.
    const element = textElement({
      text: 'aaaa\nbbbb\ncccc\ndddd',
      originalText: 'aaaa bbbb cccc dddd',
    });
    const once = resizeSingleTextElement(element, element, 'e', false, 60, 24);
    expect(once.text).toBe('aaaa\nbbbb\ncccc\ndddd');

    const wrappedAgain = resizeSingleTextElement(
      element,
      { ...element, text: once.text, originalText: 'aaaa bbbb cccc dddd' } as DriplElement,
      'e',
      false,
      60,
      24
    );
    expect(wrappedAgain.text).toBe(once.text);
  });
});

describe('north and south handle text resize', () => {
  it('reports the aspect-preserving width derived from the gesture', () => {
    // `origWidth * nextHeight / origHeight`: a 400x24 box dragged to 48 tall
    // doubles its height, so its width must double too.
    const element = textElement({ width: 400, height: 24 });
    for (const handle of ['n', 's', 'ne', 'se', 'nw', 'sw'] as const) {
      const result = resizeSingleTextElement(element, element, handle, false, 400, 48);
      expect(result.width).toBeCloseTo(400 * (48 / 24), 6);
      expect(result.height).toBe(48);
    }
  });

  it('keeps the font size inside the clamp the search enforces', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 5000, noNaN: true }),
        fc.double({ min: -1000, max: -1, noNaN: true }),
        fc.constantFrom(200, 48, 24),
        (nextHeight, _unused, fontSize) => {
          const element = textElement({ fontSize } as Partial<DriplElement>);
          const result = resizeSingleTextElement(element, element, 'n', false, 400, nextHeight);
          expect(result.fontSize).toBeGreaterThanOrEqual(8);
          expect(result.fontSize).toBeLessThanOrEqual(200);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('picks the largest font size whose measured text still fits', () => {
    // The search runs from 200 downwards and stops at the first size that fits,
    // so it must be *maximal*: one step larger has to overflow. This is the
    // exact contract of the loop, and an off-by-one in the comparison or the
    // direction of the scan would break it without changing the clamp.
    fc.assert(
      fc.property(
        fc.double({ min: 8, max: 200, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.constantFrom(200, 20),
        (nextHeight, fontSize, height) => {
          const element = textElement({ fontSize, height });
          const result = resizeSingleTextElement(element, element, 'n', false, 400, nextHeight);
          const chosen = result.fontSize as number;
          const glyphCount = (element.text as string).length;
          const fits = (size: number) => glyphCount * size * CHAR_ADVANCE;
          const metricsWidth = element.width * (nextHeight / element.height);

          expect(chosen).toBeGreaterThanOrEqual(8);
          expect(chosen).toBeLessThanOrEqual(200);
          // The 8px floor is returned unconditionally when nothing fits, so it
          // is the one size allowed to overflow.
          if (chosen > 8) {
            expect(fits(chosen)).toBeLessThanOrEqual(metricsWidth);
          }
          if (chosen < 200) {
            expect(fits(chosen + 1)).toBeGreaterThan(metricsWidth);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('keeps the font size finite when the gesture-start box has zero height', () => {
    // A degenerate gesture-start height makes the derived target width
    // infinite, so the very first candidate fits. The clamp still has to hold.
    const element = textElement({ width: 400, height: 0 });
    const result = resizeSingleTextElement(element, element, 'n', false, 400, 48);
    expect(Number.isFinite(result.fontSize as number)).toBe(true);
    expect(result.fontSize).toBeGreaterThanOrEqual(8);
    expect(result.fontSize).toBeLessThanOrEqual(200);
    expect(result.height).toBe(48);
  });
});

describe('resizeSingleElement dispatch for text', () => {
  it('routes a text element through the text resizer for every handle', () => {
    const element = textElement();
    for (const handle of ['n', 's', 'e', 'w', 'ne', 'se', 'nw', 'sw'] as const) {
      const result = resizeSingleElement(60, 48, element, element, handle);
      expect(Object.keys(result).length).toBeGreaterThan(0);
      // x and y are deliberately left to the pointer handler.
      expect(result).not.toHaveProperty('x');
      expect(result).not.toHaveProperty('y');
    }
  });

  it('clamps the size before the text resizer sees it', () => {
    const element = textElement();
    const result = resizeSingleElement(-100, -100, element, element, 'n');
    expect(result.height).toBe(1);
  });

  it('returns nothing for a non-text element routed at the text resizer', () => {
    const rectangle = textElement({ type: 'rectangle' } as Partial<DriplElement>);
    expect(resizeSingleTextElement(rectangle, rectangle, 'n', false, 100, 100)).toEqual({});
  });
});
