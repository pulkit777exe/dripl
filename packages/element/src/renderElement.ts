import type { DriplElement } from '@dripl/common';
import { createRoughCanvas, renderRoughElement } from './rough-renderer';
import { getShapeCacheKey, getShapeFromCache, setShapeInCache } from './shape-cache';

export type Theme = 'light' | 'dark';

export interface RenderConfig {
  theme: Theme;
  selectionColor?: string;
}

export interface StaticCanvasRenderConfig extends RenderConfig {
  shouldCacheIgnoreZoom?: boolean;
}

export interface ExcalidrawElementWithCanvas {
  element: DriplElement;
  canvas: HTMLCanvasElement;
  boundTextCanvas: HTMLCanvasElement;
  scale: number;
  theme: Theme;
  zoomValue: number;
  boundTextElementVersion: number | null;
  imageCrop: any;
  containingFrameOpacity: number;
}

const elementWithCanvasCache = new Map<DriplElement, ExcalidrawElementWithCanvas>();

export const generateElementCanvas = (
  element: DriplElement,
  elementsMap: Map<string, DriplElement>,
  zoom: { value: number },
  renderConfig: StaticCanvasRenderConfig,
  appState: any
): ExcalidrawElementWithCanvas | null => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const rc = createRoughCanvas(canvas);
  if (!rc) return null;

  const padding = 10;
  const scale = window.devicePixelRatio * zoom.value;

  canvas.width = (element.width + padding * 2) * scale;
  canvas.height = (element.height + padding * 2) * scale;

  ctx.scale(scale, scale);
  ctx.translate(padding, padding);

  renderRoughElement(rc, ctx, element, Array.from(elementsMap.values()), renderConfig.theme);

  const boundTextCanvas = document.createElement('canvas');
  const boundTextCanvasContext = boundTextCanvas.getContext('2d')!;

  boundTextCanvas.width = canvas.width;
  boundTextCanvas.height = canvas.height;
  boundTextCanvasContext.drawImage(canvas, 0, 0);

  return {
    element,
    canvas,
    boundTextCanvas,
    scale: zoom.value,
    theme: renderConfig.theme,
    zoomValue: zoom.value,
    boundTextElementVersion: null,
    imageCrop: null,
    containingFrameOpacity: 100,
  };
};

export const generateElementWithCanvas = (
  element: DriplElement,
  elementsMap: Map<string, DriplElement>,
  renderConfig: StaticCanvasRenderConfig,
  appState: any
): ExcalidrawElementWithCanvas | null => {
  const zoom: { value: number } = renderConfig
    ? appState.zoom
    : {
        value: 1,
      };
  const prevElementWithCanvas = elementWithCanvasCache.get(element);

  if (
    !prevElementWithCanvas ||
    prevElementWithCanvas.theme !== appState.theme ||
    prevElementWithCanvas.zoomValue !== zoom.value
  ) {
    const elementWithCanvas = generateElementCanvas(
      element,
      elementsMap,
      zoom,
      renderConfig,
      appState
    );

    if (!elementWithCanvas) {
      return null;
    }

    elementWithCanvasCache.set(element, elementWithCanvas);

    return elementWithCanvas;
  }

  return prevElementWithCanvas;
};

export const drawElementFromCanvas = (
  elementWithCanvas: ExcalidrawElementWithCanvas,
  context: CanvasRenderingContext2D,
  renderConfig: StaticCanvasRenderConfig,
  appState: any,
  allElementsMap: Map<string, DriplElement>
): void => {
  const element = elementWithCanvas.element;
  const padding = 10;
  const [x, y, width, height] = [element.x, element.y, element.width, element.height];

  context.save();

  context.translate(x + width / 2, y + height / 2);
  if (element.angle !== 0 && element.angle !== undefined) {
    context.rotate(element.angle);
  }
  context.translate(-(x + width / 2), -(y + height / 2));

  context.drawImage(
    elementWithCanvas.canvas,
    x - padding,
    y - padding,
    element.width + padding * 2,
    element.height + padding * 2
  );

  context.restore();
};

export const renderSelectionElement = (
  element: DriplElement,
  context: CanvasRenderingContext2D,
  appState: any,
  elementsMap: Map<string, DriplElement>
): void => {
  const selectionColor = appState.theme === 'dark' ? '#000000' : '#ffffff';

  context.save();
  context.strokeStyle = selectionColor;
  context.lineWidth = 2;
  context.strokeRect(element.x, element.y, element.width, element.height);
  context.restore();
};
