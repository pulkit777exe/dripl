import { describe, it, expect, beforeEach } from 'vitest';
import {
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
  createTestUser,
  createTestPresence,
  resetUserCounter,
  createMockCanvasContext,
  createMockCanvasElement,
} from './index';

describe('element factories', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('creates a rectangle element with defaults', () => {
    const el = createRectangleElement();
    expect(el.type).toBe('rectangle');
    expect(el.x).toBe(0);
    expect(el.y).toBe(0);
    expect(el.width).toBe(100);
    expect(el.height).toBe(100);
    expect(el.id).toMatch(/^el-1-/);
  });

  it('creates a rectangle with custom options', () => {
    const el = createRectangleElement({
      x: 50,
      y: 100,
      width: 200,
      height: 150,
      strokeColor: '#ff0000',
      angle: Math.PI / 4,
    });
    expect(el.x).toBe(50);
    expect(el.y).toBe(100);
    expect(el.width).toBe(200);
    expect(el.height).toBe(150);
    expect(el.strokeColor).toBe('#ff0000');
    expect(el.angle).toBe(Math.PI / 4);
  });

  it('creates an ellipse element', () => {
    const el = createEllipseElement({ x: 10, y: 20, width: 80, height: 60 });
    expect(el.type).toBe('ellipse');
    expect(el.x).toBe(10);
    expect(el.y).toBe(20);
  });

  it('creates a diamond element', () => {
    const el = createDiamondElement({ x: 0, y: 0, width: 50, height: 50 });
    expect(el.type).toBe('diamond');
  });

  it('creates an arrow element with points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 0 },
    ];
    const el = createArrowElement(points);
    expect(el.type).toBe('arrow');
    expect(el.points).toEqual(points);
    expect(el.width).toBe(100);
    expect(el.height).toBe(0);
  });

  it('creates a line element with points', () => {
    const points = [
      { x: 10, y: 10 },
      { x: 90, y: 90 },
    ];
    const el = createLineElement(points);
    expect(el.type).toBe('line');
    expect(el.points).toEqual(points);
  });

  it('creates a freedraw element with auto-calculated bounds', () => {
    const points = [
      { x: 10, y: 20 },
      { x: 30, y: 10 },
      { x: 50, y: 40 },
    ];
    const el = createFreeDrawElement(points);
    expect(el.type).toBe('freedraw');
    expect(el.points).toEqual(points);
    expect(el.x).toBe(10);
    expect(el.y).toBe(10);
    expect(el.width).toBe(40);
    expect(el.height).toBe(30);
  });

  it('creates a text element with estimated dimensions', () => {
    const el = createTextElement({ text: 'Hello', fontSize: 20, fontFamily: 'Arial' });
    expect(el.type).toBe('text');
    expect(el.text).toBe('Hello');
    expect(el.fontSize).toBe(20);
    expect(el.fontFamily).toBe('Arial');
    expect(el.autoResize).toBe(true);
  });

  it('creates a text element with custom dimensions', () => {
    const el = createTextElement({
      text: 'Test',
      width: 200,
      height: 50,
      fontSize: 24,
      lineHeight: 1.5,
    });
    expect(el.width).toBe(200);
    expect(el.height).toBe(50);
    expect(el.fontSize).toBe(24);
    expect(el.lineHeight).toBe(1.5);
  });

  it('creates an image element', () => {
    const el = createImageElement({
      src: 'data:image/png;base64,abc',
      width: 300,
      height: 200,
    });
    expect(el.type).toBe('image');
    expect(el.src).toBe('data:image/png;base64,abc');
  });

  it('creates a frame element', () => {
    const el = createFrameElement({
      title: 'My Frame',
      padding: 30,
      width: 400,
      height: 300,
    });
    expect(el.type).toBe('frame');
    expect(el.title).toBe('My Frame');
    expect(el.padding).toBe(30);
  });

  it('creates elements via createTestElement dispatcher', () => {
    const rect = createTestElement('rectangle');
    expect(rect.type).toBe('rectangle');

    const text = createTestElement('text', { text: 'Hi' });
    expect(text.type).toBe('text');
    expect(text.text).toBe('Hi');

    const arrow = createTestElement('arrow');
    expect(arrow.type).toBe('arrow');
    expect(arrow.points).toBeDefined();
  });

  it('throws for unknown element type', () => {
    expect(() => createTestElement('unknown' as never)).toThrow('Unknown element type');
  });

  it('generates unique IDs', () => {
    const el1 = createRectangleElement();
    const el2 = createRectangleElement();
    expect(el1.id).not.toBe(el2.id);
  });
});

describe('user factories', () => {
  beforeEach(() => {
    resetUserCounter();
  });

  it('creates a test user with defaults', () => {
    const user = createTestUser();
    expect(user.id).toBe('user-1');
    expect(user.name).toBe('User 1');
    expect(user.color).toMatch(/^hsl\(/);
  });

  it('creates users with custom overrides', () => {
    const user = createTestUser({
      id: 'custom-id',
      name: 'Alice',
      color: '#ff0000',
    });
    expect(user.id).toBe('custom-id');
    expect(user.name).toBe('Alice');
    expect(user.color).toBe('#ff0000');
  });

  it('creates presence data', () => {
    const presence = createTestPresence('user-1', {
      cursor: { x: 100, y: 200 },
      selection: ['el-1', 'el-2'],
    });
    expect(presence.userId).toBe('user-1');
    expect(presence.cursor).toEqual({ x: 100, y: 200 });
    expect(presence.selection).toEqual(['el-1', 'el-2']);
  });
});

describe('mock canvas', () => {
  it('creates a mock canvas context', () => {
    const ctx = createMockCanvasContext();
    expect(ctx.measureText).toBeDefined();
    expect(ctx.font).toBe('');
  });

  it('measures text with default width', () => {
    const ctx = createMockCanvasContext();
    const metrics = ctx.measureText('Hello');
    expect(metrics.width).toBeGreaterThan(0);
  });

  it('measures text with custom font metrics', () => {
    const ctx = createMockCanvasContext({
      fontMetrics: {
        'Hello': { width: 45, height: 20 },
      },
    });
    const metrics = ctx.measureText('Hello');
    expect(metrics.width).toBe(45);
  });

  it('creates a mock canvas element', () => {
    const canvas = createMockCanvasElement();
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
  });
});
