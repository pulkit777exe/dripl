export {
  createTestElement,
  createRectangleElement,
  createEllipseElement,
  createDiamondElement,
  createArrowElement,
  createLineElement,
  createFreeDrawElement,
  createTextElement,
  createImageElement,
  createFrameElement,
  resetIdCounter,
} from './elements';

export type { ElementFactoryOptions, TextElementOptions, ImageElementOptions, FrameElementOptions } from './elements';

export { createTestUser, createTestPresence, resetUserCounter } from './users';

export { createMockCanvasContext, createMockCanvasElement } from './mock-canvas';

export type { MockCanvas2DOptions } from './mock-canvas';
