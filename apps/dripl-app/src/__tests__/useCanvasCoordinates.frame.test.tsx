import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import { useCanvasCoordinates } from '@/hooks/canvas/useCanvasCoordinates';
import type { Viewport } from '@/utils/canvas-coordinates';

/**
 * Per-frame coordinate hygiene.
 *
 * `getCanvasCoordinates` sits on the hottest path in the app: every queued
 * pointer sample calls it, and a freehand stroke replays every coalesced
 * sample in a single frame. Two properties keep that path flat, and both are
 * pinned here rather than left as comments on the implementation:
 *
 * - the canvas origin (`getBoundingClientRect`, a forced layout) is read once
 *   per frame, not once per sample;
 * - the callback identity survives viewport commits, so pan/zoom traffic does
 *   not mint a new pointer-move handler (and a new InteractiveCanvas prop) on
 *   every frame.
 */
describe('useCanvasCoordinates frame hygiene', () => {
  let frameQueue: Map<number, FrameRequestCallback>;
  let nextFrameId: number;

  beforeEach(() => {
    frameQueue = new Map();
    nextFrameId = 1;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      const id = nextFrameId++;
      frameQueue.set(id, cb);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      frameQueue.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const runFrames = () => {
    act(() => {
      const pending = Array.from(frameQueue.values());
      frameQueue.clear();
      for (const cb of pending) cb(performance.now());
    });
  };

  function countingCanvas(origin: { left: number; top: number }, reads: { count: number }) {
    const el = document.createElement('canvas');
    el.getBoundingClientRect = () => {
      reads.count += 1;
      return {
        left: origin.left,
        top: origin.top,
        right: origin.left + 800,
        bottom: origin.top + 600,
        width: 800,
        height: 600,
        x: origin.left,
        y: origin.top,
        toJSON: () => ({}),
      } as DOMRect;
    };
    return el;
  }

  function containerWith(...children: HTMLElement[]): RefObject<HTMLDivElement | null> {
    const el = document.createElement('div');
    children.forEach(child => el.appendChild(child));
    return { current: el } as RefObject<HTMLDivElement | null>;
  }

  function pointerEvent(target: HTMLElement, clientX: number, clientY: number) {
    return { target, clientX, clientY } as unknown as React.PointerEvent<HTMLCanvasElement>;
  }

  function setup(viewport: Viewport, containerRef: RefObject<HTMLDivElement | null>) {
    return renderHook(
      ({ viewport: next }: { viewport: Viewport }) =>
        useCanvasCoordinates({ containerRef, viewport: next, gridEnabled: false, gridSize: 20 }),
      { initialProps: { viewport } }
    );
  }

  it('reads the canvas origin once for repeated moves in the same frame', () => {
    const origin = { left: 40, top: 25 };
    const reads = { count: 0 };
    const canvas = countingCanvas(origin, reads);
    const viewport: Viewport = { x: 100, y: 50, width: 800, height: 600, zoom: 2 };
    const { result } = setup(viewport, containerWith(canvas));

    // One frame's worth of coalesced samples: three conversions, one layout.
    // client → pixel subtracts the origin (40, 25); pixel → world subtracts
    // the pan (100, 50) and divides by the zoom (2).
    const cases = [
      [140, 125, 0, 25],
      [142, 127, 1, 26],
      [144, 129, 2, 27],
    ] as const;
    for (const [cx, cy, x, y] of cases) {
      expect(result.current.getCanvasCoordinates(pointerEvent(canvas, cx, cy))).toEqual({ x, y });
    }
    expect(reads.count).toBe(1);
  });

  it('re-reads the origin on the next frame and picks up a moved canvas', () => {
    const origin = { left: 0, top: 0 };
    const reads = { count: 0 };
    const canvas = countingCanvas(origin, reads);
    const viewport: Viewport = { x: 0, y: 0, width: 800, height: 600, zoom: 1 };
    const { result } = setup(viewport, containerWith(canvas));

    expect(result.current.getCanvasCoordinates(pointerEvent(canvas, 10, 20))).toEqual({
      x: 10,
      y: 20,
    });
    expect(reads.count).toBe(1);

    // A resize/reflow between frames moves the box; the next frame must see it.
    origin.left = 30;
    origin.top = 50;
    runFrames();

    expect(result.current.getCanvasCoordinates(pointerEvent(canvas, 40, 70))).toEqual({
      x: 10,
      y: 20,
    });
    expect(reads.count).toBe(2);
  });

  it('re-reads when the event targets a different canvas in the same frame', () => {
    const reads = { count: 0 };
    const first = countingCanvas({ left: 0, top: 0 }, reads);
    const second = countingCanvas({ left: 500, top: 500 }, reads);
    const viewport: Viewport = { x: 0, y: 0, width: 800, height: 600, zoom: 1 };
    const { result } = setup(viewport, containerWith(first, second));

    expect(result.current.getCanvasCoordinates(pointerEvent(first, 10, 20))).toEqual({
      x: 10,
      y: 20,
    });
    // Same frame, but a different box — the cache is keyed by element.
    expect(result.current.getCanvasCoordinates(pointerEvent(second, 510, 520))).toEqual({
      x: 10,
      y: 20,
    });
    expect(reads.count).toBe(2);
  });

  it('keeps the callback identity stable across viewport commits', () => {
    const canvas = countingCanvas({ left: 0, top: 0 }, { count: 0 });
    const containerRef = containerWith(canvas);
    const { result, rerender } = setup(
      { x: 0, y: 0, width: 800, height: 600, zoom: 1 },
      containerRef
    );

    const before = result.current.getCanvasCoordinates;
    rerender({ viewport: { x: 200, y: 100, width: 800, height: 600, zoom: 2 } });
    expect(result.current.getCanvasCoordinates).toBe(before);
  });

  it('applies the latest viewport transform after a rerender', () => {
    const canvas = countingCanvas({ left: 40, top: 25 }, { count: 0 });
    const containerRef = containerWith(canvas);
    const { result, rerender } = setup(
      { x: 0, y: 0, width: 800, height: 600, zoom: 1 },
      containerRef
    );

    // client (140, 125) is pixel (100, 100) inside the canvas at zoom 1.
    expect(result.current.getCanvasCoordinates(pointerEvent(canvas, 140, 125))).toEqual({
      x: 100,
      y: 100,
    });

    // Same client point under pan (100, 50) at zoom 2 → world (0, 25).
    rerender({ viewport: { x: 100, y: 50, width: 800, height: 600, zoom: 2 } });
    expect(result.current.getCanvasCoordinates(pointerEvent(canvas, 140, 125))).toEqual({
      x: 0,
      y: 25,
    });
  });
});
