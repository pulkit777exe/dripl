import type { DriplElement, TextElement, LinearElement } from '@dripl/common';
import { getBounds } from '@dripl/math/geometry';
import { getDefaultFontFamily } from './fontPreferences';

const DEFAULT_FONT_SIZE = 20;

function getFontFamily(): string {
  return getDefaultFontFamily();
}

/**
 * Measurements are memoised and served from one canvas.
 *
 * `measureText` used to allocate a canvas **and** a 2D context on every call,
 * and `wrapText` calls it once per word — so dragging a container with a bound
 * label threw away one canvas per word per frame, on the gesture path, for
 * widths that are a pure function of (font family, size, text) and do not
 * change between frames.
 *
 * The cache is keyed on all three inputs, so changing the preferred font
 * family starts a new key space rather than serving the old family's widths.
 * It is bounded by clearing wholesale rather than by eviction order: entries
 * are cheap to recompute now that no canvas is allocated for them, and a clear
 * needs no bookkeeping on the hot path.
 *
 * The context is *re-derived* on every call instead of remembered. It costs
 * one native call that returns the same object for the life of the canvas,
 * and it buys correctness twice: an environment that starts refusing contexts
 * degrades immediately instead of reading widths an earlier context measured,
 * and a context that is swapped for one with different font metrics (the
 * label tests install a recording context per test) invalidates the widths
 * measured through the previous one rather than serving them across the swap.
 */
const MEASURE_CACHE_LIMIT = 1024;
const measuredWidths = new Map<string, number>();

let measureCanvas: HTMLCanvasElement | null = null;
let measureCtx: CanvasRenderingContext2D | null = null;

function measurementContext(): CanvasRenderingContext2D | null {
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (ctx !== measureCtx) {
    // Different source of font metrics than the one that produced the cached
    // widths (including a first failure, or a first success after one): they
    // are not comparable, so they go before anything can read them again.
    measureCtx = ctx;
    measuredWidths.clear();
  }
  return ctx;
}

/** Line height for a font size — a constant, so it needs no measurement. */
function lineHeight(fontSize: number): number {
  return Math.ceil(fontSize * 1.25);
}

function measureText(text: string, fontSize: number): { width: number; height: number } {
  const ctx = measurementContext();
  // No metrics means a zero line box, not a default one: callers distinguish
  // "measured nothing" from "measured a real height" by it, and it is what
  // keeps a context the browser refuses from throwing mid-drag.
  if (!ctx) return { width: 0, height: 0 };

  const fontFamily = getFontFamily();
  const key = `${fontFamily}|${fontSize}|${text}`;
  const cached = measuredWidths.get(key);
  if (cached !== undefined) return { width: cached, height: lineHeight(fontSize) };

  ctx.font = `${fontSize}px ${fontFamily}, cursive`;
  const width = Math.ceil(ctx.measureText(text).width);

  if (measuredWidths.size >= MEASURE_CACHE_LIMIT) measuredWidths.clear();
  measuredWidths.set(key, width);
  return { width, height: lineHeight(fontSize) };
}

function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const words = text.split(' ').filter(word => word.length > 0);
  const lines: string[] = [];

  if (words.length === 0) {
    return [''];
  }

  let currentLine = words[0] as string;

  for (let i = 1; i < words.length; i++) {
    const word = words[i] as string;
    const testLine = `${currentLine} ${word}`;
    const testWidth = measureText(testLine, fontSize).width;

    if (testWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  lines.push(currentLine);

  return lines;
}

export function updateBoundTextPosition(
  boundElement: DriplElement,
  textElement: TextElement
): TextElement {
  const bounds = getBounds([
    { x: boundElement.x, y: boundElement.y },
    {
      x: boundElement.x + boundElement.width,
      y: boundElement.y + boundElement.height,
    },
  ]);

  const fontSize = textElement.fontSize ?? DEFAULT_FONT_SIZE;
  const originalText = textElement.text.replace(/\n/g, ' ');
  const wrappedText = wrapText(originalText, fontSize, bounds.width - 10);
  // Measured rather than derived from `fontSize` alone: when the context is
  // refused the measurement comes back with height 0, and the label has to
  // collapse with it instead of claiming a line box nothing measured.
  const textHeight = wrappedText.length * measureText('A', fontSize).height;

  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2 - textHeight / 2;
  return {
    ...textElement,
    text: wrappedText.join('\n'),
    x,
    y,
    width: bounds.width - 10,
    height: textHeight,
  };
}

export function createTextElement(
  text: string,
  point: { x: number; y: number },
  baseProps: Partial<TextElement> = {}
): TextElement {
  return {
    id: crypto.randomUUID(),
    type: 'text',
    text,
    originalText: text,
    fontSize: baseProps.fontSize ?? 16,
    fontFamily: baseProps.fontFamily ?? getFontFamily(),
    textAlign: baseProps.textAlign ?? 'left',
    verticalAlign: baseProps.verticalAlign ?? 'top',
    strokeColor: baseProps.strokeColor ?? '#000000',
    x: point.x,
    y: point.y,
    width: 200,
    height: 20,
    ...baseProps,
  };
}

export function updateArrowLabelPosition(
  arrow: LinearElement,
  labelElement: TextElement
): TextElement {
  const points = arrow.points as Array<{ x: number; y: number }>;
  if (!points || points.length < 2) return labelElement;

  // Calculate midpoint of the arrow
  let midX = 0;
  let midY = 0;

  if (points.length % 2 === 1) {
    // Odd number of points: use the middle point
    const index = Math.floor(points.length / 2);
    const midPoint = points[index];
    if (midPoint) {
      midX = arrow.x + midPoint.x;
      midY = arrow.y + midPoint.y;
    }
  } else {
    // Even number of points: use the midpoint of the middle segment
    const index = points.length / 2 - 1;
    const p1 = points[index];
    const p2 = points[index + 1];
    if (p1 && p2) {
      midX = arrow.x + (p1.x + p2.x) / 2;
      midY = arrow.y + (p1.y + p2.y) / 2;
    }
  }

  return {
    ...labelElement,
    x: midX - labelElement.width / 2,
    y: midY - labelElement.height / 2,
  };
}
