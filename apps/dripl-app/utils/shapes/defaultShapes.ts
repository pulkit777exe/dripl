import type { ShapeDefinition, DriplElement, Point, ElementBase, LinearElement, TextElement, ImageElement, FrameElement, EmbedElement, FreeDrawElement } from '@dripl/common';
import { isDriplElement } from '@dripl/common';
import { imageCache } from '@dripl/element/image-cache';
import { createRectangleElement, RectangleToolState } from '@/utils/tools/rectangle';
import { createEllipseElement, EllipseToolState } from '@/utils/tools/ellipse';
import { createDiamondElement, DiamondToolState } from '@/utils/tools/diamond';
import { createArrowElement, ArrowToolState } from '@/utils/tools/arrow';
import { createLineElement, LineToolState } from '@/utils/tools/line';
import { createFreedrawElement, FreedrawToolState } from '@/utils/tools/freedraw';
import { createTextElement, TextToolState } from '@/utils/tools/text';
import { createFrameElement, FrameToolState } from '@/utils/tools/frame';
import { getDefaultFontFamily } from '@/utils/fontPreferences';

// Rectangle shape definition
export const rectangleShape: ShapeDefinition = {
  type: 'rectangle',
  name: 'Rectangle',
  icon: 'square',
  category: 'basic',
  create: (props: Partial<DriplElement>) =>
    ({
      id: crypto.randomUUID(),
      type: 'rectangle' as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeColor: '#000000',
      backgroundColor: 'transparent',
      strokeWidth: 2,
      opacity: 1,
      roughness: 1,
      strokeStyle: 'solid',
      fillStyle: 'hachure',
      ...props,
    }) as DriplElement,
  validate: (element: unknown) => {
    if (!isDriplElement(element) || element.type !== 'rectangle') {
      return false;
    }
    return (
      typeof element.x === 'number' &&
      typeof element.y === 'number' &&
      typeof element.width === 'number' &&
      typeof element.height === 'number'
    );
  },
  render: (ctx: CanvasRenderingContext2D, element: DriplElement) => {
    ctx.strokeStyle = element.strokeColor || '#000000';
    ctx.lineWidth = element.strokeWidth || 2;
    ctx.globalAlpha = element.opacity || 1;

    if (element.backgroundColor && element.backgroundColor !== 'transparent') {
      ctx.fillStyle = element.backgroundColor;
      ctx.fillRect(element.x, element.y, element.width, element.height);
    }

    ctx.strokeRect(element.x, element.y, element.width, element.height);
  },
  getProperties: (element: DriplElement) => {
    return {
      strokeColor: element.strokeColor,
      backgroundColor: element.backgroundColor,
      strokeWidth: element.strokeWidth,
      opacity: element.opacity,
      roughness: element.roughness,
      strokeStyle: element.strokeStyle,
      fillStyle: element.fillStyle,
    };
  },
  setProperties: (element: DriplElement, properties: Record<string, unknown>) => {
    return {
      ...element,
      ...properties,
    };
  },
};

export const ellipseShape: ShapeDefinition = {
  type: 'ellipse',
  name: 'Ellipse',
  icon: 'circle',
  category: 'basic',
  create: (props: Partial<DriplElement>) =>
    ({
      id: crypto.randomUUID(),
      type: 'ellipse' as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeColor: '#000000',
      backgroundColor: 'transparent',
      strokeWidth: 2,
      opacity: 1,
      roughness: 1,
      strokeStyle: 'solid',
      fillStyle: 'hachure',
      ...props,
    }) as DriplElement,
  validate: (element: unknown) => {
    if (!isDriplElement(element) || element.type !== 'ellipse') {
      return false;
    }
    return (
      typeof element.x === 'number' &&
      typeof element.y === 'number' &&
      typeof element.width === 'number' &&
      typeof element.height === 'number'
    );
  },
  render: (ctx: CanvasRenderingContext2D, element: DriplElement) => {
    ctx.strokeStyle = element.strokeColor || '#000000';
    ctx.lineWidth = element.strokeWidth || 2;
    ctx.globalAlpha = element.opacity || 1;

    ctx.beginPath();
    ctx.ellipse(
      element.x + element.width / 2,
      element.y + element.height / 2,
      element.width / 2,
      element.height / 2,
      0,
      0,
      2 * Math.PI
    );

    if (element.backgroundColor && element.backgroundColor !== 'transparent') {
      ctx.fillStyle = element.backgroundColor;
      ctx.fill();
    }

    ctx.stroke();
  },
  getProperties: (element: DriplElement) => {
    return {
      strokeColor: element.strokeColor,
      backgroundColor: element.backgroundColor,
      strokeWidth: element.strokeWidth,
      opacity: element.opacity,
      roughness: element.roughness,
      strokeStyle: element.strokeStyle,
      fillStyle: element.fillStyle,
    };
  },
  setProperties: (element: DriplElement, properties: Record<string, unknown>) => {
    return {
      ...element,
      ...properties,
    };
  },
};

export const diamondShape: ShapeDefinition = {
  type: 'diamond',
  name: 'Diamond',
  icon: 'diamond',
  category: 'basic',
  create: (props: Partial<DriplElement>) =>
    ({
      id: crypto.randomUUID(),
      type: 'diamond' as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeColor: '#000000',
      backgroundColor: 'transparent',
      strokeWidth: 2,
      opacity: 1,
      roughness: 1,
      strokeStyle: 'solid',
      fillStyle: 'hachure',
      ...props,
    }) as DriplElement,
  validate: (element: unknown) => {
    if (!isDriplElement(element) || element.type !== 'diamond') {
      return false;
    }
    return (
      typeof element.x === 'number' &&
      typeof element.y === 'number' &&
      typeof element.width === 'number' &&
      typeof element.height === 'number'
    );
  },
  render: (ctx: CanvasRenderingContext2D, element: DriplElement) => {
    ctx.strokeStyle = element.strokeColor || '#000000';
    ctx.lineWidth = element.strokeWidth || 2;
    ctx.globalAlpha = element.opacity || 1;

    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    const halfWidth = element.width / 2;
    const halfHeight = element.height / 2;

    ctx.beginPath();
    ctx.moveTo(centerX, element.y);
    ctx.lineTo(element.x + element.width, centerY);
    ctx.lineTo(centerX, element.y + element.height);
    ctx.lineTo(element.x, centerY);
    ctx.closePath();

    if (element.backgroundColor && element.backgroundColor !== 'transparent') {
      ctx.fillStyle = element.backgroundColor;
      ctx.fill();
    }

    ctx.stroke();
  },
  getProperties: (element: DriplElement) => {
    return {
      strokeColor: element.strokeColor,
      backgroundColor: element.backgroundColor,
      strokeWidth: element.strokeWidth,
      opacity: element.opacity,
      roughness: element.roughness,
      strokeStyle: element.strokeStyle,
      fillStyle: element.fillStyle,
    };
  },
  setProperties: (element: DriplElement, properties: Record<string, unknown>) => {
    return {
      ...element,
      ...properties,
    };
  },
};

export const arrowShape: ShapeDefinition = {
  type: 'arrow',
  name: 'Arrow',
  icon: 'arrow-right',
  category: 'connectors',
  create: (props: Partial<DriplElement>) =>
    ({
      id: crypto.randomUUID(),
      type: 'arrow' as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeColor: '#000000',
      backgroundColor: 'transparent',
      strokeWidth: 2,
      opacity: 1,
      roughness: 1,
      strokeStyle: 'solid',
      fillStyle: 'hachure',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      ...props,
    }) as DriplElement,
  validate: (element: unknown) => {
    if (!isDriplElement(element) || element.type !== 'arrow') {
      return false;
    }
    return 'points' in element && Array.isArray((element as LinearElement).points) && (element as LinearElement).points.length >= 2;
  },
  render: (ctx: CanvasRenderingContext2D, element: DriplElement) => {
    const arrowElement = element as LinearElement;
    if (!arrowElement.points || arrowElement.points.length < 2) return;

    const first = arrowElement.points[0];
    const second = arrowElement.points[1];
    if (!first || !second) return;

    ctx.strokeStyle = element.strokeColor || '#000000';
    ctx.lineWidth = element.strokeWidth || 2;
    ctx.globalAlpha = element.opacity || 1;

    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    ctx.lineTo(second.x, second.y);
    ctx.stroke();

    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const angle = Math.atan2(dy, dx);
    const headLength = 10;

    ctx.beginPath();
    ctx.moveTo(second.x, second.y);
    ctx.lineTo(
      second.x - headLength * Math.cos(angle - Math.PI / 6),
      second.y - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      second.x - headLength * Math.cos(angle + Math.PI / 6),
      second.y - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  },
  getProperties: (element: DriplElement) => {
    return {
      strokeColor: element.strokeColor,
      strokeWidth: element.strokeWidth,
      opacity: element.opacity,
      roughness: element.roughness,
      strokeStyle: element.strokeStyle,
    };
  },
  setProperties: (element: DriplElement, properties: Record<string, unknown>) => {
    return {
      ...element,
      ...properties,
    };
  },
};

export const lineShape: ShapeDefinition = {
  type: 'line',
  name: 'Line',
  icon: 'minus',
  category: 'connectors',
  create: (props: Partial<DriplElement>) =>
    ({
      id: crypto.randomUUID(),
      type: 'line' as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeColor: '#000000',
      backgroundColor: 'transparent',
      strokeWidth: 2,
      opacity: 1,
      roughness: 1,
      strokeStyle: 'solid',
      fillStyle: 'hachure',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      ...props,
    }) as DriplElement,
  validate: (element: unknown) => {
    if (!isDriplElement(element) || element.type !== 'line') {
      return false;
    }
    return 'points' in element && Array.isArray((element as LinearElement).points) && (element as LinearElement).points.length >= 2;
  },
  render: (ctx: CanvasRenderingContext2D, element: DriplElement) => {
    const lineElement = element as LinearElement;
    const first = lineElement.points[0];
    const second = lineElement.points[1];
    if (!first || !second) return;

    ctx.strokeStyle = element.strokeColor || '#000000';
    ctx.lineWidth = element.strokeWidth || 2;
    ctx.globalAlpha = element.opacity || 1;

    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    ctx.lineTo(second.x, second.y);
    ctx.stroke();
  },
  getProperties: (element: DriplElement) => {
    return {
      strokeColor: element.strokeColor,
      strokeWidth: element.strokeWidth,
      opacity: element.opacity,
      roughness: element.roughness,
      strokeStyle: element.strokeStyle,
    };
  },
  setProperties: (element: DriplElement, properties: Record<string, unknown>) => {
    return {
      ...element,
      ...properties,
    };
  },
};

export const textShape: ShapeDefinition = {
  type: 'text',
  name: 'Text',
  icon: 'type',
  category: 'text',
  create: (props: Partial<DriplElement>) =>
    ({
      id: crypto.randomUUID(),
      type: 'text' as const,
      x: 0,
      y: 0,
      width: 100,
      height: 30,
      strokeColor: '#000000',
      backgroundColor: 'transparent',
      strokeWidth: 2,
      opacity: 1,
      roughness: 1,
      strokeStyle: 'solid',
      fillStyle: 'hachure',
      text: 'Text',
      originalText: 'Text',
      fontSize: 20,
      fontFamily: getDefaultFontFamily(),
      ...props,
    }) as DriplElement,
  validate: (element: unknown) => {
    if (!isDriplElement(element) || element.type !== 'text') {
      return false;
    }
    return 'text' in element && typeof (element as TextElement).text === 'string';
  },
  render: (ctx: CanvasRenderingContext2D, element: DriplElement) => {
    const textElement = element as TextElement;

    ctx.fillStyle = element.strokeColor || '#000000';
    ctx.font = `${textElement.fontSize}px ${textElement.fontFamily}`;
    ctx.globalAlpha = element.opacity || 1;

    ctx.fillText(textElement.text, element.x, element.y + textElement.fontSize);
  },
  getProperties: (element: DriplElement) => {
    const textElement = element as TextElement;
    return {
      strokeColor: element.strokeColor,
      text: textElement.text,
      fontSize: textElement.fontSize,
      fontFamily: textElement.fontFamily,
    };
  },
  setProperties: (element: DriplElement, properties: Record<string, unknown>) => {
    return {
      ...element,
      ...properties,
    };
  },
};

export const imageShape: ShapeDefinition = {
  type: 'image',
  name: 'Image',
  icon: 'image',
  category: 'media',
  create: (props: Partial<DriplElement>) =>
    ({
      id: crypto.randomUUID(),
      type: 'image' as const,
      x: 0,
      y: 0,
      width: 200,
      height: 150,
      strokeColor: '#000000',
      backgroundColor: 'transparent',
      strokeWidth: 2,
      opacity: 1,
      roughness: 1,
      strokeStyle: 'solid',
      fillStyle: 'hachure',
      src: '',
      ...props,
    }) as DriplElement,
  validate: (element: unknown) => {
    if (!isDriplElement(element) || element.type !== 'image') {
      return false;
    }
    return 'src' in element && typeof (element as ImageElement).src === 'string';
  },
  render: (ctx: CanvasRenderingContext2D, element: DriplElement) => {
    const imageElement = element as ImageElement;
    if (!imageElement.src) return;

    ctx.globalAlpha = element.opacity || 1;

    const cached = imageCache.get(imageElement.src);
    if (cached?.loaded) {
      ctx.drawImage(cached.image, element.x, element.y, element.width, element.height);
    } else if (cached?.error) {
      ctx.fillStyle = 'rgba(255,0,0,0.1)';
      ctx.fillRect(element.x, element.y, element.width, element.height);
    } else {
      // Start loading if not already in progress
      if (!cached) {
        imageCache.load(imageElement.src).catch(() => {});
      }
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.fillRect(element.x, element.y, element.width, element.height);
    }
  },
  getProperties: (element: DriplElement) => {
    const imageElement = element as ImageElement;
    return {
      src: imageElement.src,
      opacity: element.opacity,
    };
  },
  setProperties: (element: DriplElement, properties: Record<string, unknown>) => {
    return {
      ...element,
      ...properties,
    };
  },
};

export const frameShape: ShapeDefinition = {
  type: 'frame',
  name: 'Frame',
  icon: 'square',
  category: 'containers',
  create: (props: Partial<DriplElement>) =>
    ({
      id: crypto.randomUUID(),
      type: 'frame' as const,
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      strokeColor: '#000000',
      backgroundColor: 'transparent',
      strokeWidth: 2,
      opacity: 1,
      roughness: 1,
      strokeStyle: 'solid',
      fillStyle: 'hachure',
      title: 'Frame',
      padding: 20,
      ...props,
    }) as DriplElement,
  validate: (element: unknown) => {
    if (!isDriplElement(element) || element.type !== 'frame') {
      return false;
    }
    return (
      typeof element.x === 'number' &&
      typeof element.y === 'number' &&
      typeof element.width === 'number' &&
      typeof element.height === 'number'
    );
  },
  render: (ctx: CanvasRenderingContext2D, element: DriplElement) => {
    const frameElement = element as FrameElement;

    ctx.strokeStyle = element.strokeColor || '#000000';
    ctx.lineWidth = element.strokeWidth || 2;
    ctx.globalAlpha = element.opacity || 1;

    ctx.strokeRect(element.x, element.y, element.width, element.height);

    const padding = frameElement.padding || 20;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(
      element.x + padding,
      element.y + padding,
      element.width - 2 * padding,
      element.height - 2 * padding
    );
    ctx.setLineDash([]);

    if (frameElement.title) {
      ctx.fillStyle = element.strokeColor || '#000000';
      ctx.font = '14px "Comic Sans MS", "Chalkboard SE", "Marker Felt", "Comic Neue", cursive';
      ctx.fillText(frameElement.title, element.x + 10, element.y - 10);
    }
  },
  getProperties: (element: DriplElement) => {
    const frameElement = element as FrameElement;
    return {
      strokeColor: element.strokeColor,
      backgroundColor: element.backgroundColor,
      strokeWidth: element.strokeWidth,
      opacity: element.opacity,
      roughness: element.roughness,
      strokeStyle: element.strokeStyle,
      fillStyle: element.fillStyle,
      title: frameElement.title,
      padding: frameElement.padding,
    };
  },
  setProperties: (element: DriplElement, properties: Record<string, unknown>) => {
    return {
      ...element,
      ...properties,
    };
  },
};

export const freedrawShape: ShapeDefinition = {
  type: 'freedraw',
  name: 'Freedraw',
  icon: 'pen',
  category: 'drawing',
  create: (props: Partial<DriplElement>) =>
    ({
      id: crypto.randomUUID(),
      type: 'freedraw' as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeColor: '#000000',
      backgroundColor: 'transparent',
      strokeWidth: 2,
      opacity: 1,
      roughness: 1,
      strokeStyle: 'solid',
      fillStyle: 'hachure',
      points: [],
      ...props,
    }) as DriplElement,
  validate: (element: unknown) => {
    if (!isDriplElement(element) || element.type !== 'freedraw') {
      return false;
    }
    return 'points' in element && Array.isArray((element as FreeDrawElement).points);
  },
  render: (ctx: CanvasRenderingContext2D, element: DriplElement) => {
    const freedrawElement = element as FreeDrawElement;
    if (!freedrawElement.points || freedrawElement.points.length < 2) return;

    ctx.strokeStyle = element.strokeColor || '#000000';
    ctx.lineWidth = element.strokeWidth || 2;
    ctx.globalAlpha = element.opacity || 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const first = freedrawElement.points[0];
    if (!first) return;

    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < freedrawElement.points.length; i++) {
      const point = freedrawElement.points[i];
      if (point) {
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.stroke();
  },
  getProperties: (element: DriplElement) => {
    return {
      strokeColor: element.strokeColor,
      strokeWidth: element.strokeWidth,
      opacity: element.opacity,
    };
  },
  setProperties: (element: DriplElement, properties: Record<string, unknown>) => {
    return {
      ...element,
      ...properties,
    };
  },
};

export const embedShape: ShapeDefinition = {
  type: 'embed',
  name: 'Web Embed',
  icon: 'globe',
  category: 'containers',
  create: (props: Partial<DriplElement>) =>
    ({
      id: crypto.randomUUID(),
      type: 'embed' as const,
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      strokeColor: '#6B6860',
      backgroundColor: '#FAFAF7',
      strokeWidth: 1,
      opacity: 1,
      roughness: 0,
      strokeStyle: 'solid',
      url: '',
      title: 'Web Embed',
      ...props,
    }) as DriplElement,
  validate: (element: unknown) => {
    if (!isDriplElement(element) || element.type !== 'embed') {
      return false;
    }
    return (
      typeof element.x === 'number' &&
      typeof element.y === 'number' &&
      typeof element.width === 'number' &&
      typeof element.height === 'number'
    );
  },
  render: (ctx: CanvasRenderingContext2D, element: DriplElement) => {
    const embedEl = element as EmbedElement;

    // Draw outer rectangle
    ctx.strokeStyle = element.strokeColor || '#6B6860';
    ctx.lineWidth = element.strokeWidth || 1;
    ctx.strokeRect(element.x, element.y, element.width, element.height);

    // Fill background
    ctx.fillStyle = element.backgroundColor || '#FAFAF7';
    ctx.fillRect(element.x, element.y, element.width, element.height);

    // Draw globe icon placeholder
    ctx.fillStyle = '#6B6860';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🌐', element.x + element.width / 2, element.y + element.height / 2 - 15);

    // Draw URL or title
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#6B6860';
    const displayText = embedEl.title || embedEl.url || 'Web Embed';
    const maxWidth = element.width - 20;
    const textWidth = ctx.measureText(displayText).width;
    const truncatedText = textWidth > maxWidth ? displayText.slice(0, 30) + '...' : displayText;
    ctx.fillText(truncatedText, element.x + element.width / 2, element.y + element.height / 2 + 15);

    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  },
  getProperties: (element: DriplElement) => {
    const embedEl = element as EmbedElement;
    return {
      strokeColor: element.strokeColor,
      backgroundColor: element.backgroundColor,
      strokeWidth: element.strokeWidth,
      opacity: element.opacity,
      url: embedEl.url,
      title: embedEl.title,
    };
  },
  setProperties: (element: DriplElement, properties: Record<string, unknown>) => {
    return {
      ...element,
      ...properties,
    };
  },
};

export const defaultShapes = [
  rectangleShape,
  ellipseShape,
  diamondShape,
  arrowShape,
  lineShape,
  textShape,
  imageShape,
  frameShape,
  freedrawShape,
  embedShape,
];
