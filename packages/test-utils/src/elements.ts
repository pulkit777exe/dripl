import type { DriplElement, Point } from '@dripl/common';

let idCounter = 0;

function nextId(prefix = 'test'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${crypto.randomUUID()}`;
}

export function resetIdCounter(): void {
  idCounter = 0;
}

export interface ElementFactoryOptions {
  id?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  angle?: number;
  strokeColor?: string;
  backgroundColor?: string;
  strokeWidth?: number;
  opacity?: number;
  roughness?: number;
  seed?: number;
  locked?: boolean;
  zIndex?: number;
  fractionalIndex?: string;
  boundElements?: Array<{ id: string; type: 'arrow' | 'text' }>;
}

function baseElement(options: ElementFactoryOptions = {}): ElementFactoryOptions {
  return {
    id: options.id ?? nextId('el'),
    x: options.x ?? 0,
    y: options.y ?? 0,
    width: options.width ?? 100,
    height: options.height ?? 100,
    angle: options.angle ?? 0,
    strokeColor: options.strokeColor ?? '#000000',
    backgroundColor: options.backgroundColor ?? 'transparent',
    strokeWidth: options.strokeWidth ?? 2,
    opacity: options.opacity ?? 1,
    roughness: options.roughness ?? 1,
    seed: options.seed ?? Math.random() * 1000,
    locked: options.locked ?? false,
    zIndex: options.zIndex,
    fractionalIndex: options.fractionalIndex,
    boundElements: options.boundElements,
  };
}

export function createRectangleElement(options: ElementFactoryOptions = {}): DriplElement {
  return {
    ...baseElement(options),
    type: 'rectangle',
  } as DriplElement;
}

export function createEllipseElement(options: ElementFactoryOptions = {}): DriplElement {
  return {
    ...baseElement(options),
    type: 'ellipse',
  } as DriplElement;
}

export function createDiamondElement(options: ElementFactoryOptions = {}): DriplElement {
  return {
    ...baseElement(options),
    type: 'diamond',
  } as DriplElement;
}

export function createArrowElement(
  points: Point[],
  options: ElementFactoryOptions = {}
): DriplElement {
  const pts = points ?? [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
  ];
  const lastPoint = pts[pts.length - 1]!;
  const firstPoint = pts[0]!;
  const base = baseElement(options);
  return {
    ...base,
    type: 'arrow',
    points: pts,
    width: options.width ?? Math.abs(lastPoint.x - firstPoint.x),
    height: options.height ?? Math.abs(lastPoint.y - firstPoint.y),
  } as DriplElement;
}

export function createLineElement(
  points: Point[],
  options: ElementFactoryOptions = {}
): DriplElement {
  const pts = points ?? [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
  ];
  const lastPoint = pts[pts.length - 1]!;
  const firstPoint = pts[0]!;
  const base = baseElement(options);
  return {
    ...base,
    type: 'line',
    points: pts,
    width: options.width ?? Math.abs(lastPoint.x - firstPoint.x),
    height: options.height ?? Math.abs(lastPoint.y - firstPoint.y),
  } as DriplElement;
}

export function createFreeDrawElement(
  points: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 20, y: 5 },
    { x: 30, y: 15 },
  ],
  options: ElementFactoryOptions = {}
): DriplElement {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    ...baseElement(options),
    type: 'freedraw',
    points,
    x: options.x ?? minX,
    y: options.y ?? minY,
    width: options.width ?? maxX - minX,
    height: options.height ?? maxY - minY,
  } as DriplElement;
}

export interface TextElementOptions extends ElementFactoryOptions {
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  textAlign?: 'left' | 'center' | 'right';
  lineHeight?: number;
  autoResize?: boolean;
}

export function createTextElement(options: TextElementOptions = {}): DriplElement {
  const text = options.text ?? 'Hello World';
  const fontSize = options.fontSize ?? 20;
  const fontFamily = options.fontFamily ?? 'Arial';
  const lineHeight = options.lineHeight ?? 1.2;

  const estimatedWidth = text.length * fontSize * 0.6;
  const estimatedHeight = fontSize * lineHeight;

  return {
    ...baseElement(options),
    type: 'text',
    text,
    originalText: text,
    fontSize,
    fontFamily,
    textAlign: options.textAlign ?? 'left',
    lineHeight,
    autoResize: options.autoResize ?? true,
    width: options.width ?? estimatedWidth,
    height: options.height ?? estimatedHeight,
  } as DriplElement;
}

export interface ImageElementOptions extends ElementFactoryOptions {
  src?: string;
}

export function createImageElement(options: ImageElementOptions = {}): DriplElement {
  return {
    ...baseElement(options),
    type: 'image',
    src: options.src ?? 'data:image/png;base64,test',
  } as DriplElement;
}

export interface FrameElementOptions extends ElementFactoryOptions {
  title?: string;
  padding?: number;
}

export function createFrameElement(options: FrameElementOptions = {}): DriplElement {
  return {
    ...baseElement(options),
    type: 'frame',
    title: options.title ?? 'Frame',
    padding: options.padding ?? 20,
  } as DriplElement;
}

export function createTestElement(
  type: DriplElement['type'],
  options: ElementFactoryOptions & Partial<TextElementOptions & ImageElementOptions & FrameElementOptions> = {}
): DriplElement {
  switch (type) {
    case 'rectangle':
      return createRectangleElement(options);
    case 'ellipse':
      return createEllipseElement(options);
    case 'diamond':
      return createDiamondElement(options);
    case 'arrow':
      return createArrowElement([
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ], options);
    case 'line':
      return createLineElement([
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ], options);
    case 'freedraw':
      return createFreeDrawElement([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 5 },
        { x: 30, y: 15 },
      ], options);
    case 'text':
      return createTextElement(options as TextElementOptions);
    case 'image':
      return createImageElement(options as ImageElementOptions);
    case 'frame':
      return createFrameElement(options as FrameElementOptions);
    default:
      throw new Error(`Unknown element type: ${type}`);
  }
}
