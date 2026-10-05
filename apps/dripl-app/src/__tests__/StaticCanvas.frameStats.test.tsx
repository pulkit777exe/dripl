import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, RefObject } from 'react';
import type { DriplElement } from '@dripl/common';
import type { StaticSceneFrameStats } from '@dripl/element/staticScene';

type ObserverCallback = () => void;

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  callback: ObserverCallback;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: ObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  observe(el: Element) {
    this.observed.push(el);
  }

  unobserve = vi.fn();
  disconnect = vi.fn(() => {
    this.disconnected = true;
  });
}

/**
 * The frame-stats and invalidate counters are read from the real module's shape,
 * but the scene draw itself is stubbed: this suite is about the bookkeeping
 * `StaticCanvas` does *around* a frame, not about what the frame draws.
 */
const statHooks = vi.hoisted(() => ({
  invalidateCalls: 0,
  bitmapCache: { entries: 0, trackedBytes: 0 },
  getInvalidateCallCount: vi.fn(() => statHooks.invalidateCalls),
  resetInvalidateCallCount: vi.fn(),
  getElementBitmapCacheStatsForTest: vi.fn(() => statHooks.bitmapCache),
}));

vi.mock('@dripl/element/staticScene', () => ({
  renderStaticScene: vi.fn(),
  getInvalidateCallCount: statHooks.getInvalidateCallCount,
  resetInvalidateCallCount: statHooks.resetInvalidateCallCount,
  getElementBitmapCacheStatsForTest: statHooks.getElementBitmapCacheStatsForTest,
}));

import StaticCanvas from '@/components/canvas/StaticCanvas';
import { renderStaticScene } from '@dripl/element/staticScene';

type StaticCanvasProps = ComponentProps<typeof StaticCanvas>;
type Viewport = StaticCanvasProps['viewport'];
/** The fourth argument `renderStaticScene` receives -- this component's own options. */
type SceneConfig = Parameters<typeof renderStaticScene>[3];
type DrawViewport = Parameters<typeof renderStaticScene>[2];

const draw = vi.mocked(renderStaticScene);

function createElement(id: string): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: '#000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    updated: 1700000000000,
  } as DriplElement;
}

function viewport(overrides: Partial<Viewport> = {}): Viewport {
  return { x: 0, y: 0, zoom: 1, width: 800, height: 600, ...overrides };
}

function frameStats(overrides: Partial<StaticSceneFrameStats> = {}): StaticSceneFrameStats {
  return {
    candidates: 0,
    elementsDrawn: 0,
    bitmapsGenerated: 0,
    bitmapsReused: 0,
    elementsSkipped: 0,
    bitmapsDeferred: 0,
    ...overrides,
  };
}

/** Run the pending RAF frame so `renderStaticScene` is invoked once. */
function drawFrame() {
  act(() => {
    vi.advanceTimersToNextFrame();
  });
}

/** Run any RAF frames the component scheduled, without asserting how many. */
function drainFrames() {
  act(() => {
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
  });
}

/** The config object handed to the draw call on the most recent frame. */
function lastConfig(): SceneConfig {
  const call = draw.mock.calls.at(-1);
  if (!call) throw new Error('renderStaticScene was never called');
  return call[3];
}

function lastDrawViewport(): DrawViewport {
  const call = draw.mock.calls.at(-1);
  if (!call) throw new Error('renderStaticScene was never called');
  return call[2];
}

function canvasElement(): HTMLCanvasElement {
  const canvas = document.querySelector('canvas');
  if (!canvas) throw new Error('no canvas was rendered');
  return canvas;
}

function measuredContainer(width: () => number, height: number): HTMLDivElement {
  const container = document.createElement('div');
  Object.defineProperty(container, 'offsetWidth', { configurable: true, get: width });
  Object.defineProperty(container, 'offsetHeight', { configurable: true, value: height });
  return container;
}

function asContainerRef(container: HTMLDivElement): RefObject<HTMLDivElement> {
  return { current: container };
}

type PerfWindow = Window & {
  __driplStaticFrames?: StaticSceneFrameStats[];
  __driplInvalidateCalls?: number;
  __driplResetInvalidate?: () => void;
  __driplBitmapCache?: { entries: number; trackedBytes: number };
};

const perfWindow = window as PerfWindow;

function clearPerfWindow() {
  delete perfWindow.__driplStaticFrames;
  delete perfWindow.__driplInvalidateCalls;
  delete perfWindow.__driplResetInvalidate;
  delete perfWindow.__driplBitmapCache;
}

beforeEach(() => {
  vi.useFakeTimers();
  draw.mockClear();
  MockResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  statHooks.invalidateCalls = 0;
  statHooks.bitmapCache = { entries: 0, trackedBytes: 0 };
  clearPerfWindow();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearPerfWindow();
});

describe('StaticCanvas frame statistics', () => {
  // Regression: `handleFrameStats` is reachable only through the `onFrameStats`
  // callback this component hands to the draw. If that wiring were dropped,
  // `deferredRef` would never be consulted and a frame that deferred bitmaps
  // would never get its follow-up frame -- and nothing else would notice.
  it('records a frame on the window once the draw reports one', () => {
    render(<StaticCanvas elements={[createElement('el-1')]} viewport={viewport()} theme="light" />);
    drawFrame();

    expect(perfWindow.__driplStaticFrames).toBeUndefined();
    act(() => lastConfig().onFrameStats?.(frameStats({ candidates: 3, elementsDrawn: 3 })));

    expect(perfWindow.__driplStaticFrames).toHaveLength(1);
    expect(perfWindow.__driplStaticFrames?.[0]).toMatchObject({ candidates: 3, elementsDrawn: 3 });
  });

  // Regression: the published counters are the *live* module values read at
  // publish time. Reading once and caching would leave a developer inspecting
  // `__driplInvalidateCalls` watching a number that never moves.
  it('publishes the live invalidate count, the reset hook and the bitmap totals', () => {
    render(<StaticCanvas elements={[createElement('el-1')]} viewport={viewport()} theme="light" />);
    drawFrame();

    statHooks.invalidateCalls = 12;
    statHooks.bitmapCache = { entries: 4, trackedBytes: 2048 };
    act(() => lastConfig().onFrameStats?.(frameStats()));

    expect(statHooks.getInvalidateCallCount).toHaveBeenCalled();
    expect(perfWindow.__driplInvalidateCalls).toBe(12);
    expect(perfWindow.__driplBitmapCache).toEqual({ entries: 4, trackedBytes: 2048 });
    // The reset hook is published so a dev can zero the counter between frames.
    expect(perfWindow.__driplResetInvalidate).toBe(statHooks.resetInvalidateCallCount);
  });

  // Regression: the history is a ring capped at `MAX_RECORDED_FRAMES` (300).
  // Pushing without the trim grows an unbounded array on a long canvas session,
  // in development, on every frame.
  it('caps the recorded history at 300 entries, discarding the oldest', () => {
    render(<StaticCanvas elements={[createElement('el-1')]} viewport={viewport()} theme="light" />);
    drawFrame();
    const config = lastConfig();

    // 305 frames, tagged by index. Asserting both ends distinguishes "kept the
    // newest 300" from "kept the oldest 300", which a length check alone cannot.
    for (let i = 0; i < 305; i += 1) {
      act(() => config.onFrameStats?.(frameStats({ candidates: i })));
    }

    const frames = perfWindow.__driplStaticFrames ?? [];
    expect(frames).toHaveLength(300);
    expect(frames[0]?.candidates).toBe(5);
    expect(frames.at(-1)?.candidates).toBe(304);
  });

  // Regression: a frame that deferred bitmaps schedules a follow-up frame so the
  // deferred elements get cached ones, and stops once a frame defers nothing.
  // Asserted as a call count on both sides -- "nothing visibly changed" is also
  // what a leaked-then-never-fired timer looks like from outside, so the count
  // is the only observation that distinguishes the two.
  it('schedules a follow-up frame while elements are deferred, then settles', () => {
    render(<StaticCanvas elements={[createElement('el-1')]} viewport={viewport()} theme="light" />);
    drawFrame();
    expect(draw).toHaveBeenCalledTimes(1);

    act(() => lastConfig().onFrameStats?.(frameStats({ bitmapsDeferred: 2 })));
    drawFrame();
    expect(draw).toHaveBeenCalledTimes(2);

    // A frame that defers nothing clears the deferral: no further frame is owed.
    act(() => lastConfig().onFrameStats?.(frameStats({ bitmapsDeferred: 0 })));
    drainFrames();
    expect(draw).toHaveBeenCalledTimes(2);
  });

  // Regression: the history array is mutated in place rather than replaced, so a
  // consumer that captured the reference sees it grow. Not equivalent: replacing
  // it per frame would make `__driplStaticFrames` a different array each time,
  // which is what this pins.
  it('appends to one history array across successive frames', () => {
    render(<StaticCanvas elements={[createElement('el-1')]} viewport={viewport()} theme="light" />);
    drawFrame();
    const config = lastConfig();

    act(() => config.onFrameStats?.(frameStats({ candidates: 1 })));
    const firstRef = perfWindow.__driplStaticFrames;
    act(() => config.onFrameStats?.(frameStats({ candidates: 2 })));

    expect(perfWindow.__driplStaticFrames).toBe(firstRef);
    expect(firstRef?.map(f => f.candidates)).toEqual([1, 2]);
  });
});

describe('StaticCanvas canvas sizing', () => {
  // Regression: the backing store is sized from the *container* when one is
  // supplied. Reading only the viewport leaves the canvas at the wrong
  // resolution under a container-driven layout (the editor's flex parent), and
  // the static layer goes blurry without any error.
  it('sizes the canvas from the container when a containerRef is supplied', () => {
    const containerRef = asContainerRef(measuredContainer(() => 640, 480));

    render(
      <StaticCanvas
        containerRef={containerRef}
        elements={[createElement('el-1')]}
        viewport={viewport()}
        theme="light"
      />
    );
    drawFrame();

    const canvas = canvasElement();
    expect(canvas.style.width).toBe('640px');
    expect(canvas.style.height).toBe('480px');
    // jsdom's devicePixelRatio is 1, so the backing store matches the CSS box.
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
    // ...and the draw receives the measured box, not the viewport's.
    expect(lastDrawViewport()).toMatchObject({ width: 640, height: 480 });
  });

  // Regression: with no container, sizing falls back to the viewport's own
  // dimensions -- the export and snapshot paths render `StaticCanvas` without a
  // container and rely on this.
  it('falls back to the viewport size when no container is supplied', () => {
    render(
      <StaticCanvas
        elements={[createElement('el-1')]}
        viewport={viewport({ width: 320, height: 240 })}
        theme="light"
      />
    );
    drawFrame();

    expect(canvasElement().style.width).toBe('320px');
    expect(canvasElement().style.height).toBe('240px');
  });

  // Regression: `Math.max(1, ...)` keeps a `0 x 0` backing store out of the
  // canvas -- a zero-width canvas reports `getContext('2d') === null` in every
  // browser, so the whole static layer would silently stop drawing.
  //
  // Reachability note: the `resize` closure reads
  // `container?.offsetWidth || viewport.width || window.innerWidth`, and all three
  // of those fall through a zero to the next, so the clamp only fires when every
  // source is zero at once. `window.innerWidth` cannot be 0 in a browser, which
  // makes the clamp defensive rather than load-bearing today; the test stubs all
  // three so the clamp's value is pinned rather than left unconstrained.
  it('clamps a zero-sized container to a 1x1 canvas', () => {
    vi.stubGlobal('innerWidth', 0);
    vi.stubGlobal('innerHeight', 0);
    const containerRef = asContainerRef(measuredContainer(() => 0, 0));

    render(
      <StaticCanvas
        containerRef={containerRef}
        elements={[createElement('el-1')]}
        viewport={viewport({ width: 0, height: 0 })}
        theme="light"
      />
    );
    drawFrame();

    const canvas = canvasElement();
    expect(canvas.style.width).toBe('1px');
    expect(canvas.style.height).toBe('1px');
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    expect(lastDrawViewport()).toMatchObject({ width: 1, height: 1 });
  });

  // Regression: a zero *container* alone does not reach the clamp -- `offsetWidth`
  // of 0 falls through to the viewport, which is the intended fallback chain.
  // Asserted separately so the clamp test above cannot pass merely because the
  // fallback returned a non-zero viewport.
  it('falls through a zero container measurement to the viewport', () => {
    const containerRef = asContainerRef(measuredContainer(() => 0, 0));

    render(
      <StaticCanvas
        containerRef={containerRef}
        elements={[createElement('el-1')]}
        viewport={viewport({ width: 200, height: 100 })}
        theme="light"
      />
    );
    drawFrame();

    expect(canvasElement().style.width).toBe('200px');
    expect(canvasElement().style.height).toBe('100px');
  });

  // Regression: the container is observed with a `ResizeObserver`, so a layout
  // change that never fires a window `resize` -- a sidebar collapsing, say --
  // still re-sizes the canvas.
  it('observes the container with a ResizeObserver', () => {
    const containerRef = asContainerRef(measuredContainer(() => 500, 400));

    render(
      <StaticCanvas
        containerRef={containerRef}
        elements={[createElement('el-1')]}
        viewport={viewport()}
        theme="light"
      />
    );

    expect(MockResizeObserver.instances).toHaveLength(1);
    expect(MockResizeObserver.instances[0]?.observed).toEqual([
      expect.any(HTMLDivElement) as HTMLDivElement,
    ]);
    expect(MockResizeObserver.instances[0]?.observed[0]).toBe(containerRef.current);
  });

  // Regression: teardown must remove *the very function it registered*. A
  // surviving listener still holds `container`, `viewport` and `markDirty` alive
  // and still runs `resize` on every window resize, resizing a detached canvas
  // and scheduling a frame for it forever.
  //
  // Counting frames is not enough here: `renderFrame`'s own `if (!canvas) return`
  // guard hides the leak behind a downstream check (that guard is pinned
  // separately below). So the observable is listener *identity* -- the function
  // handed to `removeEventListener` must be the one handed to
  // `addEventListener`. Both spies are installed before the render, per the
  // ordering trap.
  it('removes the exact resize listener it registered, on unmount', () => {
    const containerRef = asContainerRef(measuredContainer(() => 500, 400));
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = render(
      <StaticCanvas
        containerRef={containerRef}
        elements={[createElement('el-1')]}
        viewport={viewport()}
        theme="light"
      />
    );
    drawFrame();

    const registered = addSpy.mock.calls.find(([type]) => type === 'resize');
    expect(registered).toBeDefined();
    unmount();

    const removed = removeSpy.mock.calls.filter(([type]) => type === 'resize');
    expect(removed).toHaveLength(1);
    // Identity, not just the count: removing some *other* resize listener leaves
    // this one attached, and a count-only assertion cannot see that.
    expect(removed[0]?.[1]).toBe(registered?.[1]);
  });

  // Regression: the window `resize` listener drives the same `resize` closure,
  // so a viewport change both re-sizes and redraws. The draw count is what
  // proves the listener did the work rather than merely running.
  it('re-sizes and redraws on a window resize', () => {
    let width = 500;
    const containerRef = asContainerRef(measuredContainer(() => width, 400));

    render(
      <StaticCanvas
        containerRef={containerRef}
        elements={[createElement('el-1')]}
        viewport={viewport()}
        theme="light"
      />
    );
    drawFrame();
    expect(draw).toHaveBeenCalledTimes(1);

    width = 900;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    drawFrame();

    expect(canvasElement().style.width).toBe('900px');
    expect(draw).toHaveBeenCalledTimes(2);
  });

  // Regression: teardown must detach both the window listener and the observer.
  // A leaked observer keeps a detached container alive and keeps calling
  // `markDirty`, which schedules RAF frames against an unmounted canvas. The
  // post-unmount draw count is the observable part: a surviving listener would
  // schedule a frame that a downstream guard might silently swallow.
  it('disconnects the observer and stops redrawing after unmount', () => {
    const containerRef = asContainerRef(measuredContainer(() => 500, 400));

    const { unmount } = render(
      <StaticCanvas
        containerRef={containerRef}
        elements={[createElement('el-1')]}
        viewport={viewport()}
        theme="light"
      />
    );
    drawFrame();
    const observer = MockResizeObserver.instances[0];
    unmount();

    expect(observer?.disconnected).toBe(true);

    draw.mockClear();
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    drainFrames();
    expect(draw).not.toHaveBeenCalled();
  });
});

describe('StaticCanvas surface styling', () => {
  // Regression: the canvas is `pointer-events-none` twice over -- in the class
  // and in the inline style -- and the inline style is what wins in the DOM.
  // These are two separate declarations of the same invariant, and the teardown
  // leak above is only visible because the *style* keeps the surface inert; if
  // either were dropped the static layer would swallow pointer events aimed at
  // the interactive canvas stacked above it.
  it('keeps the surface inert to pointer events via class and style', () => {
    render(<StaticCanvas elements={[createElement('el-1')]} viewport={viewport()} theme="light" />);

    const canvas = canvasElement();
    // The exact string, not a membership check: `canvas-surface` is this
    // component's own class hook for the canvas CSS, and `pointer-events-none` is
    // the Tailwind half of the same invariant. Dropping either leaves the static
    // layer swallowing pointer events aimed at the canvas above it, and a
    // `toHaveClass('canvas-surface')` assertion passes for both.
    expect(canvas.className).toBe('canvas-surface pointer-events-none');
    expect(canvas.style.pointerEvents).toBe('none');
  });

  // Regression: the layer is positioned absolutely at the origin and pinned at
  // `zIndex: 1` so the interactive canvas sits above it. `imageRendering` is left at
  // `auto` — the CSS default — deliberately: the backing store is scaled by DPR, and
  // nearest-neighbour (`crisp-edges`) pixelates the hand-drawn strokes, which is the
  // opposite of the aesthetic this product is built around (ADR-006). Asserted so the
  // value cannot be flipped to `crisp-edges` unnoticed. `width`/`height` are asserted
  // in the sizing block instead: the resize effect overwrites them with measured pixels
  // immediately after mount, so reading `'100%'` here would assert the React prop and
  // not the DOM.
  it('pins the layer stacking and positioning, and leaves smoothing on', () => {
    render(<StaticCanvas elements={[createElement('el-1')]} viewport={viewport()} theme="light" />);

    const canvas = canvasElement();
    expect(canvas.style.position).toBe('absolute');
    expect(canvas.style.top).toBe('0px');
    expect(canvas.style.left).toBe('0px');
    expect(canvas.style.zIndex).toBe('1');
    expect(canvas.style.imageRendering).toBe('auto');
  });

  // Regression: `touchAction: none` is what stops a touch drag on the canvas from
  // being interpreted as a scroll by the browser, which would pan the page
  // instead of drawing. It is declared here in the style object rather than
  // inherited, and jsdom is the only place it can be read back.
  it('disables touch gestures on the surface', () => {
    render(<StaticCanvas elements={[createElement('el-1')]} viewport={viewport()} theme="light" />);

    expect(canvasElement().style.touchAction).toBe('none');
  });
});

describe('StaticCanvas draw guards', () => {
  // Regression: `renderFrame` runs from a RAF callback that can outlive the
  // component -- an image that finishes decoding after the canvas is gone, or a
  // resize queued in the same tick as a route change. The `canvasRef.current`
  // guard is what stops that frame from handing a detached canvas (or `null`) to
  // `renderStaticScene`, which would throw inside the render loop.
  //
  // Reached through `onAssetLoad`, which calls `markDirtyRef.current()` -- the
  // indirection that survives unmount. Asserted as a call count on the draw,
  // because "no error was thrown" is not an observation.
  it('skips the draw when a retained callback fires after unmount', () => {
    const { unmount } = render(
      <StaticCanvas elements={[createElement('el-1')]} viewport={viewport()} theme="light" />
    );
    drawFrame();

    const config = lastConfig();
    unmount();
    draw.mockClear();

    act(() => config.onAssetLoad?.());
    drainFrames();

    expect(draw).not.toHaveBeenCalled();
  });
});

describe('StaticCanvas draw configuration', () => {
  // Regression: the defaults (`gridEnabled=false`, `gridSize=20`,
  // `shouldCacheIgnoreZoom=false`) live in this component's parameter
  // destructuring, not in the renderer. Changing them here silently changes the
  // grid pitch the app draws at.
  it('applies the documented defaults for the optional props', () => {
    render(<StaticCanvas elements={[createElement('el-1')]} viewport={viewport()} theme="light" />);
    drawFrame();

    expect(lastConfig()).toMatchObject({
      gridEnabled: false,
      gridSize: 20,
      shouldCacheIgnoreZoom: false,
      theme: 'light',
    });
  });

  // Regression: every optional prop reaches the draw config verbatim. The draw
  // callback is stable across renders and reads from `propsRef`, so a prop left
  // out of that ref would be read from a stale object forever -- not merely
  // dropped once.
  it('forwards the explicit overrides into the draw config', () => {
    render(
      <StaticCanvas
        elements={[createElement('el-1')]}
        visibleElements={[createElement('el-2')]}
        viewport={viewport({ x: 12, y: 34, zoom: 2.5 })}
        gridEnabled
        gridSize={40}
        theme="dark"
        shouldCacheIgnoreZoom
      />
    );
    drawFrame();

    expect(lastConfig()).toMatchObject({
      gridEnabled: true,
      gridSize: 40,
      shouldCacheIgnoreZoom: true,
      theme: 'dark',
      zoom: 2.5,
    });
    expect(lastDrawViewport()).toMatchObject({ x: 12, y: 34, zoom: 2.5 });
  });

  // Regression: the device pixel ratio is read from `window` at resize time and
  // forwarded as `dpr`. Hard-coding 1 blurs the static layer on any retina
  // display.
  it('forwards the device pixel ratio into the draw config', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    render(<StaticCanvas elements={[createElement('el-1')]} viewport={viewport()} theme="light" />);
    drawFrame();

    expect(lastConfig()).toMatchObject({ dpr: 2 });
  });
});
