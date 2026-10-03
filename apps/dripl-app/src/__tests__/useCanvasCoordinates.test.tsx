import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCanvasCoordinates } from '@/hooks/canvas/useCanvasCoordinates';
import { canvasToScreen, screenToCanvas, type Viewport } from '@/utils/canvas-coordinates';

interface Rect {
  left: number;
  top: number;
}

function canvasAt(rect: Rect) {
  const el = document.createElement('canvas');
  el.getBoundingClientRect = () =>
    ({
      left: rect.left,
      top: rect.top,
      right: rect.left + 800,
      bottom: rect.top + 600,
      width: 800,
      height: 600,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

function containerWith(...children: HTMLElement[]) {
  const el = document.createElement('div');
  children.forEach(child => el.appendChild(child));
  return { current: el } as React.RefObject<HTMLDivElement>;
}

function pointerEvent(target: HTMLElement, clientX: number, clientY: number) {
  return { target, clientX, clientY } as unknown as React.PointerEvent<HTMLCanvasElement>;
}

function setup(overrides: Partial<Parameters<typeof useCanvasCoordinates>[0]> = {}) {
  const viewport: Viewport = { x: 0, y: 0, width: 800, height: 600, zoom: 1 };
  return renderHook(() =>
    useCanvasCoordinates({
      containerRef: containerWith(),
      viewport,
      gridEnabled: false,
      gridSize: 20,
      ...overrides,
    })
  );
}

describe('useCanvasCoordinates.getCanvasCoordinates', () => {
  it('subtracts the canvas origin before applying the viewport', () => {
    const canvas = canvasAt({ left: 40, top: 25 });
    const { result } = setup({
      containerRef: containerWith(canvas),
      viewport: { x: 100, y: 50, width: 800, height: 600, zoom: 2 },
    });

    // client (140, 125) is pixel (100, 100) inside the canvas.
    // screenToCanvas(100, 100) with pan (100, 50) and zoom 2 → (0, 25).
    expect(result.current.getCanvasCoordinates(pointerEvent(canvas, 140, 125))).toEqual({
      x: 0,
      y: 25,
    });
  });

  it('prefers the event target canvas over the container lookup', () => {
    const target = canvasAt({ left: 0, top: 0 });
    const other = canvasAt({ left: 500, top: 500 });
    const { result } = setup({
      containerRef: containerWith(other),
      viewport: { x: 0, y: 0, width: 800, height: 600, zoom: 1 },
    });

    expect(result.current.getCanvasCoordinates(pointerEvent(target, 10, 20))).toEqual({
      x: 10,
      y: 20,
    });
  });

  it('falls back to the first canvas in the container for non-canvas targets', () => {
    const canvas = canvasAt({ left: 7, top: 9 });
    const overlay = document.createElement('div');
    const { result } = setup({
      containerRef: containerWith(canvas, overlay),
      viewport: { x: 0, y: 0, width: 800, height: 600, zoom: 1 },
    });

    expect(result.current.getCanvasCoordinates(pointerEvent(overlay, 107, 109))).toEqual({
      x: 100,
      y: 100,
    });
  });

  it('returns the origin when there is no canvas to measure', () => {
    const detached: React.RefObject<HTMLDivElement | null> = { current: null };
    const { result } = setup({ containerRef: detached });
    expect(
      result.current.getCanvasCoordinates(pointerEvent(document.createElement('div'), 50, 60))
    ).toEqual({ x: 0, y: 0 });
  });

  it('round-trips a client point through world space back to the same client point', () => {
    // Pointer → world → screen must be the identity. A sign flip or a
    // missing /zoom in either conversion breaks this for every point.
    const viewport: Viewport = { x: -37, y: 91, width: 800, height: 600, zoom: 1.75 };
    const canvas = canvasAt({ left: 12, top: 34 });
    const { result } = setup({ containerRef: containerWith(canvas), viewport });

    for (const [cx, cy] of [
      [12, 34],
      [500, 400],
      [812, 634],
    ] as const) {
      const world = result.current.getCanvasCoordinates(pointerEvent(canvas, cx, cy));
      const screen = canvasToScreen(world.x, world.y, viewport);
      expect(screen.x).toBeCloseTo(cx - 12, 9);
      expect(screen.y).toBeCloseTo(cy - 34, 9);
    }
  });

  it('agrees with screenToCanvas for the same pixel', () => {
    const viewport: Viewport = { x: 33, y: -12, width: 800, height: 600, zoom: 0.4 };
    const canvas = canvasAt({ left: 0, top: 0 });
    const { result } = setup({ containerRef: containerWith(canvas), viewport });

    const world = result.current.getCanvasCoordinates(pointerEvent(canvas, 120, 240));
    expect(world.x).toBe(screenToCanvas(120, 240, viewport).x);
    expect(world.y).toBe(screenToCanvas(120, 240, viewport).y);
  });
});

describe('useCanvasCoordinates.snapPointToGrid', () => {
  it('rounds to the nearest multiple when the grid is on', () => {
    const { result } = setup({ gridEnabled: true, gridSize: 20 });
    expect(result.current.snapPointToGrid({ x: 31, y: -29 })).toEqual({ x: 40, y: -20 });
    expect(result.current.snapPointToGrid({ x: 10, y: 10 })).toEqual({ x: 20, y: 20 });
  });

  it('passes points through when the grid is off', () => {
    const { result } = setup({ gridEnabled: false, gridSize: 20 });
    expect(result.current.snapPointToGrid({ x: 31, y: -29 })).toEqual({ x: 31, y: -29 });
  });

  it('passes points through for a degenerate grid size', () => {
    for (const gridSize of [0, 1, -5]) {
      const { result } = setup({ gridEnabled: true, gridSize });
      expect(result.current.snapPointToGrid({ x: 33, y: 44 })).toEqual({ x: 33, y: 44 });
    }
  });
});
