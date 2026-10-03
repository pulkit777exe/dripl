import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import { LaserCanvas } from '@/components/canvas/LaserCanvas';

interface Ctx {
  calls: string[];
  transform: number[];
}

function fakeContext(): { ctx: CanvasRenderingContext2D; calls: Ctx } {
  const calls: Ctx = { calls: [], transform: [] };
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.calls.push(`${name}(${args.join(',')})`);
    };
  const ctx = {
    setTransform: (...args: number[]) => {
      calls.transform.push(args[0] as number);
    },
    clearRect: record('clearRect'),
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    arc: record('arc'),
    fill: record('fill'),
    set lineWidth(_v: number) {},
    set lineCap(_v: string) {},
    set lineJoin(_v: string) {},
    set strokeStyle(_v: string) {},
    set shadowColor(_v: string) {},
    set shadowBlur(_v: number) {},
    set globalAlpha(_v: number) {},
    set fillStyle(_v: string) {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

class MockResizeObserver {
  static last: MockResizeObserver | null = null;
  observed: Element[] = [];
  disconnected = false;

  constructor(private callback: () => void) {
    MockResizeObserver.last = this;
  }

  observe = vi.fn((el: Element) => {
    this.observed.push(el);
  });
  disconnect = vi.fn(() => {
    this.disconnected = true;
  });
  unobserve = vi.fn();

  fire() {
    this.callback();
  }
}

let ctx: CanvasRenderingContext2D;
let calls: Ctx;

function mountLaser() {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { configurable: true, value: 400 });
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 });
  document.body.appendChild(container);
  const utils = render(<LaserCanvas />, { container });
  // LaserCanvas positions absolutely, so it lands inside the container we pass.
  return { ...utils, container };
}

function emit(type: 'start' | 'move' | 'end', detail?: { x: number; y: number }) {
  act(() => {
    window.dispatchEvent(
      detail
        ? new CustomEvent(`dripl:laser-${type}`, { detail })
        : new CustomEvent(`dripl:laser-${type}`)
    );
  });
}

function frame(n = 1) {
  act(() => {
    for (let i = 0; i < n; i++) vi.advanceTimersToNextFrame();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  const made = fakeContext();
  ctx = made.ctx;
  calls = made.calls;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  useCanvasStore.setState({ zoom: 1, panX: 0, panY: 0 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('LaserCanvas', () => {
  it('is decorative and never intercepts pointer events', () => {
    const { container } = mountLaser();
    const canvas = container.querySelector('canvas')!;
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
    expect(canvas.className).toContain('pointer-events-none');
  });

  it('sizes the backing store to the device pixel ratio', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const { container } = mountLaser();
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(canvas.style.width).toBe('400px');
    expect(canvas.style.height).toBe('300px');
    expect(calls.transform).toContain(2);
  });

  it('draws the trail in world × zoom + pan space', () => {
    const { container } = mountLaser();
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    useCanvasStore.setState({ zoom: 2, panX: 10, panY: -5 });

    emit('start', { x: 5, y: 7 });
    emit('move', { x: 25, y: 17 });
    frame(2);

    const moves = calls.calls.filter(c => c.startsWith('moveTo'));
    const lines = calls.calls.filter(c => c.startsWith('lineTo'));
    // 5 * 2 + 10 = 20, 7 * 2 - 5 = 9.
    expect(moves).toContain('moveTo(20,9)');
    // 25 * 2 + 10 = 60, 17 * 2 - 5 = 29.
    expect(lines).toContain('lineTo(60,29)');
    expect(calls.calls).toContain('stroke()');
    expect(canvas).toBeTruthy();
  });

  it('draws the head dot only while the laser is active', () => {
    mountLaser();

    emit('start', { x: 5, y: 5 });
    frame(2);
    expect(calls.calls.filter(c => c.startsWith('arc'))).not.toHaveLength(0);

    emit('end');
    frame(3);
    const arcsAfterEnd = calls.calls.filter(c => c.startsWith('arc')).length;

    // After laser-end the trail keeps fading but no new head dot is drawn.
    emit('move', { x: 40, y: 40 });
    frame(2);
    expect(calls.calls.filter(c => c.startsWith('arc'))).toHaveLength(arcsAfterEnd);
  });

  it('keeps repainting while the trail is fading, then parks', () => {
    mountLaser();
    emit('start', { x: 1, y: 1 });
    frame(2);
    emit('end');

    // Mid-fade: the loop is still running so the trail visibly dissolves.
    const before = calls.calls.filter(c => c.startsWith('clearRect(')).length;
    act(() => {
      vi.advanceTimersByTime(300);
      for (let i = 0; i < 3; i++) vi.advanceTimersToNextFrame();
    });
    expect(calls.calls.filter(c => c.startsWith('clearRect(')).length).toBeGreaterThan(before);

    // Past the 1s fade window pruning empties the trail and the loop stops
    // scheduling entirely, so an idle canvas costs nothing.
    act(() => {
      vi.advanceTimersByTime(1200);
      for (let i = 0; i < 3; i++) vi.advanceTimersToNextFrame();
    });
    const parked = calls.calls.filter(c => c.startsWith('clearRect(')).length;
    act(() => {
      vi.advanceTimersByTime(5000);
      for (let i = 0; i < 10; i++) vi.advanceTimersToNextFrame();
    });
    expect(calls.calls.filter(c => c.startsWith('clearRect(')).length).toBe(parked);
  });

  it('cleans up its listeners and frame on unmount', () => {
    const removeStart = vi.spyOn(window, 'removeEventListener');
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount } = mountLaser();

    emit('start', { x: 1, y: 1 });
    frame(2);
    unmount();

    for (const type of ['start', 'move', 'end']) {
      expect(removeStart).toHaveBeenCalledWith(`dripl:laser-${type}`, expect.any(Function));
    }
    expect(cancel).toHaveBeenCalled();
  });

  it('observes the parent and redraws when it resizes', () => {
    mountLaser();
    emit('start', { x: 1, y: 1 });
    frame(2);

    const observer = MockResizeObserver.last!;
    expect(observer.observed).toHaveLength(1);

    const clearBefore = calls.calls.filter(c => c.startsWith('clearRect(')).length;
    act(() => {
      observer.fire();
    });
    frame(2);

    expect(calls.calls.filter(c => c.startsWith('clearRect(')).length).toBeGreaterThan(clearBefore);
  });
});
