import type { DriplElement, TextElement } from "@dripl/common";

export interface TextToolState {
  position: { x: number; y: number };
  text: string;
  fontSize: number;
  fontFamily: string;
}

export function createTextElement(
  state: TextToolState,
  baseProps: Omit<DriplElement, "type" | "x" | "y" | "width" | "height" | "text" | "fontSize" | "fontFamily"> & { id: string }
): TextElement {
  // Estimate text dimensions (rough approximation)
  // In a real implementation, you'd measure the actual text
  const estimatedWidth = state.text.length * (state.fontSize * 0.6);
  const estimatedHeight = state.fontSize * 1.2;

  return {
    ...baseProps,
    type: "text",
    x: state.position.x,
    y: state.position.y,
    width: Math.max(estimatedWidth, 100),
    height: estimatedHeight,
    text: state.text,
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
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.font = `${element.fontSize}px ${element.fontFamily}`;
      const metrics = ctx.measureText(text);
      width = Math.max(metrics.width, 100);
      height = element.fontSize * 1.2;
    }
  } else {
    width = Math.max(text.length * (element.fontSize * 0.6), 100);
    height = element.fontSize * 1.2;
  }

  return {
    ...element,
    text,
    width,
    height,
  };
}
