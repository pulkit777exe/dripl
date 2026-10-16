import type { DriplElement, TextElement } from '@dripl/common';

export interface TextToolState {
  position: { x: number; y: number };
  text: string;
  fontSize: number;
  fontFamily: string;
}

export function createTextElement(
  state: TextToolState,
  baseProps: Omit<
    DriplElement,
    'type' | 'x' | 'y' | 'width' | 'height' | 'text' | 'fontSize' | 'fontFamily'
  > & { id: string }
): TextElement {
  // Estimate text dimensions per line: the renderers lay out one fillText per
  // line at a 1.25 pitch, so sizing off the whole string (or a single line)
  // misplaces verticalAlign middle/bottom against the stored box.
  const lines = state.text.split('\n');
  const estimatedWidth = Math.max(0, ...lines.map(line => line.length * (state.fontSize * 0.6)));
  const estimatedHeight = lines.length * state.fontSize * 1.25;

  return {
    ...baseProps,
    type: 'text',
    x: state.position.x,
    y: state.position.y,
    width: Math.max(estimatedWidth, 100),
    height: estimatedHeight,
    text: state.text,
    originalText: state.text,
    fontSize: state.fontSize,
    fontFamily: state.fontFamily,
  };
}

export function updateTextDimensions(
  element: TextElement,
  text: string,
  canvas?: HTMLCanvasElement
): TextElement {
  let width = element.width;
  let height = element.height;

  if (canvas) {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.font = `${element.fontSize}px ${element.fontFamily}`;
      const lines = text.split('\n');
      const measured = lines.map(line => ctx.measureText(line).width);
      width = Math.max(...measured, 100);
      height = lines.length * element.fontSize * 1.25;
    }
  } else {
    const lines = text.split('\n');
    width = Math.max(...lines.map(line => line.length * (element.fontSize * 0.6)), 100);
    height = lines.length * element.fontSize * 1.25;
  }

  return {
    ...element,
    text,
    width,
    height,
  };
}
