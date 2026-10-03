import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import { useCanvasViewport } from '@/hooks/canvas/useCanvasViewport';
import { canvasToScreen, type Viewport } from '@/utils/canvas-coordinates';
import { DEFAULT_ZOOM_SETTINGS } from '@/utils/zoomUtils';
import type { DriplElement } from '@dripl/common';

function rect(id: string, x: number, y: number, width: number, height: number): DriplElement {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    width,
    height,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    // Zero stroke width keeps getElementBounds equal to the declared frame,
    // so the expected zoom below can be derived by hand.
    strokeWidth: 0,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
  } as DriplElement;
}

/** jsdom reports 0 for every layout box, so the container needs stubbing. */
function container(width: number, height: number) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: height });
  return { current: el } as React.RefObject<HTMLDivElement>;
}

/** The hook also has to cope with a container that is not attached yet. */
const DETACHED: React.RefObject<HTMLDivElement | null> = { current: null };

function seed(elements: DriplElement[]) {
  useCanvasStore.setState({
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    zoom: 1,
    panX: 0,
    panY: 0,
    past: [],
    future: [],
  });
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
}

const PADDING = 64;

function viewport(zoom: number, panX: number, panY: number, width = 800, height = 600): Viewport {
  return { x: panX, y: panY, zoom, width, height };
}

describe('useCanvasViewport.fitAllToScreen', () => {
  beforeEach(() => {
    seed([]);
  });

  it('centres the scene content in the container', () => {
    seed([rect('a', 100, 100, 200, 150), rect('b', 400, 300, 100, 100)]);
    const ref = container(800, 600);
    const { result } = renderHook(() => useCanvasViewport(ref));

    act(() => {
      result.current.fitAllToScreen();
    });

    const state = useCanvasStore.getState();
    // Content spans x 100..500 (400 wide), y 100..400 (300 tall).
    // Usable box after padding: 800-128 = 672 by 600-128 = 472.
    // zoom = min(672/400, 472/300) = min(1.68, 1.5733…) = 472/300.
    const expectedZoom = 472 / 300;
    expect(state.zoom).toBeCloseTo(expectedZoom, 10);
    // The content centre (300, 250) must land on the container centre (400, 300).
    const centre = canvasToScreen(300, 250, viewport(state.zoom, state.panX, state.panY));
    expect(centre.x).toBeCloseTo(400, 8);
    expect(centre.y).toBeCloseTo(300, 8);
  });

  it('fits the tight axis and centres on the loose one', () => {
    // A 1000-wide, 10-tall strip: width is the binding constraint.
    seed([rect('a', 0, 0, 1000, 10)]);
    const ref = container(800, 600);
    const { result } = renderHook(() => useCanvasViewport(ref));

    act(() => {
      result.current.fitAllToScreen();
    });

    const state = useCanvasStore.getState();
    expect(state.zoom).toBeCloseTo(672 / 1000, 10);
    const left = canvasToScreen(0, 5, viewport(state.zoom, state.panX, state.panY));
    const right = canvasToScreen(1000, 5, viewport(state.zoom, state.panX, state.panY));
    // Horizontally the strip is padded on both sides by exactly PADDING.
    expect(left.x).toBeCloseTo(PADDING, 8);
    expect(right.x).toBeCloseTo(800 - PADDING, 8);
    // Vertically it is centred, since height had slack.
    expect(left.y).toBeCloseTo(300, 8);
  });

  it('clamps to maxZoom when the content is a single pixel', () => {
    seed([rect('a', 0, 0, 1, 1)]);
    const ref = container(800, 600);
    const { result } = renderHook(() => useCanvasViewport(ref));

    act(() => {
      result.current.fitAllToScreen();
    });

    expect(useCanvasStore.getState().zoom).toBe(DEFAULT_ZOOM_SETTINGS.maxZoom);
  });

  it('clamps to minZoom when the content dwarfs the viewport', () => {
    seed([rect('a', 0, 0, 100_000, 100_000)]);
    const ref = container(800, 600);
    const { result } = renderHook(() => useCanvasViewport(ref));

    act(() => {
      result.current.fitAllToScreen();
    });

    expect(useCanvasStore.getState().zoom).toBe(DEFAULT_ZOOM_SETTINGS.minZoom);
  });

  it('leaves the viewport untouched for an empty scene or a missing container', () => {
    seed([]);
    const ref = container(800, 600);
    const { result } = renderHook(() => useCanvasViewport(ref));

    act(() => {
      result.current.fitAllToScreen();
    });
    expect(useCanvasStore.getState()).toMatchObject({ zoom: 1, panX: 0, panY: 0 });

    const { result: detached } = renderHook(() => useCanvasViewport(DETACHED));
    act(() => {
      detached.current.fitAllToScreen();
    });
    expect(useCanvasStore.getState()).toMatchObject({ zoom: 1, panX: 0, panY: 0 });
  });
});

describe('useCanvasViewport.fitElementsToScreen', () => {
  beforeEach(() => {
    seed([]);
  });

  it('fits only the named elements and centres them', () => {
    // 'far' is 4000px away and must not affect the fit.
    seed([
      rect('near-a', 0, 0, 200, 200),
      rect('near-b', 200, 200, 200, 200),
      rect('far', 9000, 9000, 100, 100),
    ]);
    const ref = container(800, 600);
    const { result } = renderHook(() => useCanvasViewport(ref));

    act(() => {
      result.current.fitElementsToScreen(['near-a', 'near-b']);
    });

    const state = useCanvasStore.getState();
    // Content 400x400 → zoom = min(672/400, 472/400) = 472/400.
    expect(state.zoom).toBeCloseTo(472 / 400, 10);
    const centre = canvasToScreen(200, 200, viewport(state.zoom, state.panX, state.panY));
    expect(centre.x).toBeCloseTo(400, 8);
    expect(centre.y).toBeCloseTo(300, 8);
  });

  it('ignores unknown ids, an empty id list, and a missing container', () => {
    seed([rect('a', 0, 0, 100, 100)]);
    const ref = container(800, 600);
    const { result } = renderHook(() => useCanvasViewport(ref));

    act(() => {
      result.current.fitElementsToScreen([]);
    });
    expect(useCanvasStore.getState().zoom).toBe(1);

    act(() => {
      result.current.fitElementsToScreen(['nope']);
    });
    expect(useCanvasStore.getState().zoom).toBe(1);

    const { result: detached } = renderHook(() => useCanvasViewport(DETACHED));
    act(() => {
      detached.current.fitElementsToScreen(['a']);
    });
    expect(useCanvasStore.getState().zoom).toBe(1);
  });
});
