import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ZOOM_SETTINGS,
  normalizeWheelDelta,
  wheelZoomFactor,
  zoomToCursor,
} from '@/utils/zoomUtils';

const { minZoom, maxZoom } = DEFAULT_ZOOM_SETTINGS;

describe('wheelZoomFactor', () => {
  it('steps roughly 1.16x per mouse notch', () => {
    expect(wheelZoomFactor(-100)).toBeCloseTo(1.162, 2);
    expect(wheelZoomFactor(100)).toBeCloseTo(0.861, 2);
  });

  it('is symmetric: equal and opposite deltas cancel out', () => {
    expect(wheelZoomFactor(-60) * wheelZoomFactor(60)).toBeCloseTo(1, 10);
  });

  it('scales with magnitude for smooth trackpad gestures', () => {
    const small = wheelZoomFactor(-5);
    const large = wheelZoomFactor(-50);
    expect(small).toBeGreaterThan(1);
    expect(large).toBeGreaterThan(small);
    expect(small).toBeLessThan(1.01);
  });

  it('clamps a fast flick to a sane per-event step', () => {
    expect(wheelZoomFactor(-10_000)).toBeLessThan(1.26);
    expect(wheelZoomFactor(10_000)).toBeGreaterThan(0.79);
  });

  it('returns ~1 for sub-pixel noise', () => {
    expect(wheelZoomFactor(0.4)).toBeCloseTo(1, 2);
  });
});

describe('zoomToCursor', () => {
  it('keeps the world point under the cursor fixed', () => {
    const view = { zoom: 1, panX: 100, panY: 50 };
    const screenX = 400;
    const screenY: number = 300;
    const beforeX = (screenX - view.panX) / view.zoom;
    const beforeY = (screenY - view.panY) / view.zoom;
    const next = zoomToCursor(view, screenX, screenY, 1.5, minZoom, maxZoom);
    expect(next.zoom).toBeCloseTo(1.5, 10);
    expect((screenX - next.panX) / next.zoom).toBeCloseTo(beforeX, 9);
    expect((screenY - next.panY) / next.zoom).toBeCloseTo(beforeY, 9);
  });

  it('holds the anchor across a zoom-in/zoom-out round trip', () => {
    const view = { zoom: 2, panX: -30, panY: 70 };
    const screenX = 123;
    const screenY = 456;
    const worldX = (screenX - view.panX) / view.zoom;
    const worldY = (screenY - view.panY) / view.zoom;
    const zoomed = zoomToCursor(view, screenX, screenY, 1.7, minZoom, maxZoom);
    const back = zoomToCursor(zoomed, screenX, screenY, 1 / 1.7, minZoom, maxZoom);
    expect(back.zoom).toBeCloseTo(view.zoom, 9);
    expect(back.panX).toBeCloseTo(view.panX, 9);
    expect(back.panY).toBeCloseTo(view.panY, 9);
    expect((screenX - back.panX) / back.zoom).toBeCloseTo(worldX, 9);
    expect((screenY - back.panY) / back.zoom).toBeCloseTo(worldY, 9);
  });

  it('clamps the zoom before computing the pan anchor', () => {
    // At max zoom the cursor must not drift: the anchor has to be computed
    // for the clamped zoom, not for the requested one.
    const view = { zoom: maxZoom, panX: 0, panY: 0 };
    const next = zoomToCursor(view, 400, 300, 2, minZoom, maxZoom);
    expect(next.zoom).toBe(maxZoom);
    expect(next.panX).toBe(0);
    expect(next.panY).toBe(0);
    const low = zoomToCursor(
      { zoom: minZoom, panX: 10, panY: 20 },
      400,
      300,
      0.01,
      minZoom,
      maxZoom
    );
    expect(low.zoom).toBe(minZoom);
    const worldX = (400 - 10) / minZoom;
    expect((400 - low.panX) / low.zoom).toBeCloseTo(worldX, 9);
  });

  it('is the identity at factor 1', () => {
    const view = { zoom: 1.5, panX: -20, panY: 30 };
    expect(zoomToCursor(view, 100, 100, 1, minZoom, maxZoom)).toEqual(view);
  });
});

describe('normalizeWheelDelta', () => {
  const lineEvent = { deltaX: 3, deltaY: 2, deltaMode: 1 } as WheelEvent;
  const pageEvent = { deltaX: 1, deltaY: 1, deltaMode: 2 } as WheelEvent;
  const pixelEvent = { deltaX: 10, deltaY: 100, deltaMode: 0 } as WheelEvent;

  it('converts line deltas to pixels', () => {
    expect(normalizeWheelDelta(lineEvent)).toEqual({ dx: 48, dy: 32 });
  });

  it('converts page deltas to pixels', () => {
    expect(normalizeWheelDelta(pageEvent)).toEqual({ dx: 600, dy: 600 });
  });

  it('passes pixel deltas through, including horizontal', () => {
    expect(normalizeWheelDelta(pixelEvent)).toEqual({ dx: 10, dy: 100 });
  });
});
