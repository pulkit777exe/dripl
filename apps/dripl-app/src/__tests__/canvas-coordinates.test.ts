import { describe, it, expect } from 'vitest';
import {
  screenToCanvas,
  canvasToScreen,
  getViewportBounds,
  type Viewport,
} from '../../utils/canvas-coordinates';

describe('Canvas Coordinates', () => {
  const defaultViewport: Viewport = {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    zoom: 1,
  };

  describe('screenToCanvas', () => {
    it('should convert screen coordinates to canvas coordinates at zoom 1', () => {
      const result = screenToCanvas(100, 200, defaultViewport);
      expect(result.x).toBe(100);
      expect(result.y).toBe(200);
    });

    it('should convert screen coordinates to canvas coordinates at zoom 2', () => {
      const viewport = { ...defaultViewport, zoom: 2 };
      const result = screenToCanvas(200, 400, viewport);
      expect(result.x).toBe(100);
      expect(result.y).toBe(200);
    });

    it('should account for viewport offset', () => {
      const viewport = { ...defaultViewport, x: 100, y: 50, zoom: 1 };
      const result = screenToCanvas(100, 50, viewport);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it('should handle zoom of 0.5', () => {
      const viewport = { ...defaultViewport, zoom: 0.5 };
      const result = screenToCanvas(100, 100, viewport);
      expect(result.x).toBe(200);
      expect(result.y).toBe(200);
    });
  });

  describe('canvasToScreen', () => {
    it('should convert canvas coordinates to screen coordinates at zoom 1', () => {
      const result = canvasToScreen(100, 200, defaultViewport);
      expect(result.x).toBe(100);
      expect(result.y).toBe(200);
    });

    it('should convert canvas coordinates to screen coordinates at zoom 2', () => {
      const viewport = { ...defaultViewport, zoom: 2 };
      const result = canvasToScreen(50, 100, viewport);
      expect(result.x).toBe(100);
      expect(result.y).toBe(200);
    });

    it('should account for viewport offset', () => {
      const viewport = { ...defaultViewport, x: 100, y: 50, zoom: 1 };
      const result = canvasToScreen(0, 0, viewport);
      expect(result.x).toBe(100);
      expect(result.y).toBe(50);
    });
  });

  describe('getViewportBounds', () => {
    it('should return visible canvas area at zoom 1', () => {
      const result = getViewportBounds(defaultViewport);
      expect(result.x === 0 || result.x === -0).toBe(true);
      expect(result.y === 0 || result.y === -0).toBe(true);
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
    });

    it('should return scaled bounds at zoom 2', () => {
      const viewport = { ...defaultViewport, zoom: 2 };
      const result = getViewportBounds(viewport);
      expect(result.width).toBe(400);
      expect(result.height).toBe(300);
    });

    it('should account for viewport offset', () => {
      const viewport = { ...defaultViewport, x: 100, y: 100, zoom: 1 };
      const result = getViewportBounds(viewport);
      expect(result.x).toBe(-100);
      expect(result.y).toBe(-100);
    });
  });
});
