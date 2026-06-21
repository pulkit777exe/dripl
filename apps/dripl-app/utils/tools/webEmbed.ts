import type { DriplElement, Point } from '@dripl/common';

export interface WebEmbedToolState {
  startPoint: Point;
  currentPoint: Point;
  shiftKey: boolean;
}

export function createEmbedElement(
  state: WebEmbedToolState,
  baseProps: Omit<DriplElement, 'type' | 'x' | 'y' | 'width' | 'height'> & {
    id: string;
  },
  url: string,
  title?: string
) {
  const { startPoint, currentPoint, shiftKey } = state;

  let x, y, width, height;

  if (shiftKey) {
    const size = Math.max(
      Math.abs(currentPoint.x - startPoint.x),
      Math.abs(currentPoint.y - startPoint.y)
    );
    x = currentPoint.x > startPoint.x ? startPoint.x : startPoint.x - size;
    y = currentPoint.y > startPoint.y ? startPoint.y : startPoint.y - size;
    width = size;
    height = size;
  } else {
    x = Math.min(startPoint.x, currentPoint.x);
    y = Math.min(startPoint.y, currentPoint.y);
    width = Math.abs(currentPoint.x - startPoint.x);
    height = Math.abs(currentPoint.y - startPoint.y);
  }

  return {
    ...baseProps,
    type: 'embed' as const,
    x,
    y,
    width,
    height,
    url,
    title: title || extractDomain(url),
  };
}

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url;
  }
}
