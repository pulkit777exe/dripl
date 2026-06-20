import type { DriplElement, TextElement, LinearElement } from '@dripl/common';
import { getBounds } from '@dripl/math/geometry';
import { getDefaultFontFamily } from './fontPreferences';

export const TEXT_ALIGN = {
  LEFT: 'left',
  CENTER: 'center',
  RIGHT: 'right',
} as const;

export const VERTICAL_ALIGN = {
  TOP: 'top',
  MIDDLE: 'middle',
  BOTTOM: 'bottom',
} as const;

const DEFAULT_FONT_SIZE = 20;

function getFontFamily(): string {
  return getDefaultFontFamily();
}

function measureText(text: string, fontSize: number): { width: number; height: number } {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return { width: 0, height: 0 };

  ctx.font = `${fontSize}px ${getFontFamily()}, cursive`;
  const metrics = ctx.measureText(text);

  return {
    width: Math.ceil(metrics.width),
    height: Math.ceil(fontSize * 1.25),
  };
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

export function hasBoundText(element: DriplElement, elements: DriplElement[]): boolean {
  return elements.some(el => el.type === 'text' && el.boundElementId === element.id);
}

export function getBoundText(element: DriplElement, elements: DriplElement[]): TextElement | null {
  return elements.find(
    el => el.type === 'text' && el.boundElementId === element.id
  ) as TextElement | null;
}

export function createBoundText(
  text: string,
  boundElement: DriplElement,
  baseProps: Partial<TextElement> = {}
): TextElement {
  const bounds = getBounds([
    { x: boundElement.x, y: boundElement.y },
    {
      x: boundElement.x + boundElement.width,
      y: boundElement.y + boundElement.height,
    },
  ]);

  const fontSize = baseProps.fontSize ?? DEFAULT_FONT_SIZE;
  const fontFamily = baseProps.fontFamily ?? getFontFamily();

  const wrappedText = wrapText(text, fontSize, bounds.width - 10);
  const textHeight = wrappedText.length * measureText('A', fontSize).height;

  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2 - textHeight / 2;

  return {
    id: crypto.randomUUID(),
    type: 'text',
    text: wrappedText.join('\n'),
    fontSize,
    fontFamily,
    textAlign: baseProps.textAlign ?? TEXT_ALIGN.CENTER,
    verticalAlign: baseProps.verticalAlign ?? VERTICAL_ALIGN.MIDDLE,
    strokeColor: baseProps.strokeColor ?? '#000000',
    x,
    y,
    width: bounds.width - 10,
    height: textHeight,
    boundElementId: boundElement.id,
    ...baseProps,
  };
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

export function handleContainerResize(
  container: DriplElement,
  textElement: TextElement,
  elements: DriplElement[]
): DriplElement[] {
  const updatedTextElement = updateBoundTextPosition(container, textElement);

  return elements.map(el => (el.id === textElement.id ? updatedTextElement : el));
}

/**
 * Unbind text from container (remove association)
 */
export function unbindText(textElement: TextElement, elements: DriplElement[]): DriplElement[] {
  // Remove boundElementId property from text element
  const unboundTextElement = {
    ...textElement,
    boundElementId: undefined,
  };

  return elements.map(el => (el.id === textElement.id ? unboundTextElement : el));
}

export function updateAllBoundTextPositions(elements: DriplElement[]): DriplElement[] {
  const textElements = elements.filter(
    el => el.type === 'text' && el.boundElementId
  ) as TextElement[];
  const otherElements = elements.filter(el => el.type !== 'text' || !el.boundElementId);

  const updatedTextElements = textElements.map(textEl => {
    const boundElement = otherElements.find(el => el.id === textEl.boundElementId);
    return boundElement ? updateBoundTextPosition(boundElement, textEl) : textEl;
  });

  return otherElements.map(el => {
    if (el.type === 'text' && el.boundElementId) {
      const updated = updatedTextElements.find(textEl => textEl.id === el.id);
      return updated ?? el;
    }
    return el;
  });
}

export function deleteBoundText(elementId: string, elements: DriplElement[]): DriplElement[] {
  return elements.filter(el => el.type !== 'text' || el.boundElementId !== elementId);
}

export function getElementsWithBoundText(elements: DriplElement[]): Array<{
  element: DriplElement;
  boundText: TextElement | null;
}> {
  const nonTextElements = elements.filter(el => el.type !== 'text');
  return nonTextElements.map(element => ({
    element,
    boundText: getBoundText(element, elements),
  }));
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
