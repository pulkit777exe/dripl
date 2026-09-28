import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { DriplElement } from '@dripl/common';
import { useCanvasStore } from '@/lib/store';
import { useSpatialIndex, type SpatialIndexState } from '@/hooks/canvas/useSpatialIndex';
import type { Viewport } from '@/utils/canvas-coordinates';

let counter = 0;
function rect(
  x: number,
  y: number,
  w = 50,
  h = 50,
  extra: Partial<DriplElement> = {}
): DriplElement {
  counter += 1;
  return {
    id: `el-${counter}`,
    type: 'rectangle',
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    version: 1,
    versionNonce: 1,
    ...extra,
  } as DriplElement;
}

const VIEWPORT: Viewport = { x: 0, y: 0, width: 800, height: 600, zoom: 1 };

import { useEffect } from 'react';

const box: {
  current: { spatialIndex: SpatialIndexState; visibleElements: DriplElement[] } | null;
} = {
  current: null,
};

function Probe({ viewport }: { viewport: Viewport }) {
  const elements = useCanvasStore(s => s.elements);
  const result = useSpatialIndex(elements, viewport);
  // Capture via effect: writing a module value during render violates
  // react-hooks/immutability, and RTL flushes effects synchronously.
  useEffect(() => {
    box.current = result;
  });
  return null;
}

function show(viewport: Viewport = VIEWPORT) {
  render(<Probe viewport={viewport} />);
  const out = box.current;
  if (!out) throw new Error('probe did not render');
  return out;
}

describe('useSpatialIndex', () => {
  beforeEach(() => {
    counter = 0;
    useCanvasStore.getState().setElements([]);
  });

  it('returns every element when the viewport covers the scene', () => {
    const a = rect(100, 100);
    const b = rect(700, 500);
    useCanvasStore.getState().setElements([a, b]);
    const { visibleElements, spatialIndex } = show();
    expect(visibleElements.map(e => e.id).sort()).toEqual([a.id, b.id].sort());
    expect(spatialIndex.elementIds.size).toBe(2);
  });

  it('culls off-screen elements', () => {
    const a = rect(100, 100);
    const b = rect(5000, 5000);
    useCanvasStore.getState().setElements([a, b]);
    const { visibleElements } = show();
    expect(visibleElements.map(e => e.id)).toEqual([a.id]);
  });

  it('keeps the visible array identical across rerenders with unchanged input', () => {
    const a = rect(100, 100);
    useCanvasStore.getState().setElements([a]);
    const { rerender } = render(<Probe viewport={VIEWPORT} />);
    const first = box.current?.visibleElements;
    rerender(<Probe viewport={VIEWPORT} />);
    expect(box.current?.visibleElements).toBe(first);
  });

  it('reflects moved elements after a version bump', () => {
    const a = rect(100, 100);
    useCanvasStore.getState().setElements([a]);
    expect(show().visibleElements.map(e => e.id)).toEqual([a.id]);
    useCanvasStore.getState().setElements([{ ...a, x: 5000, y: 5000, version: 2 }]);
    expect(show().visibleElements).toEqual([]);
  });

  it('excludes deleted elements', () => {
    const a = rect(100, 100, 50, 50, { isDeleted: true });
    useCanvasStore.getState().setElements([a]);
    expect(show().visibleElements).toEqual([]);
  });

  it('returns an empty array for an empty scene', () => {
    useCanvasStore.getState().setElements([]);
    expect(show().visibleElements).toEqual([]);
  });
});
