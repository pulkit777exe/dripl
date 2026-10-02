import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import {
  computeBoxResize,
  dragLinearPoint,
  insertLinearMidpoint,
  shouldPushHistory,
} from '@/lib/canvas/resize-geometry';

const line = (extra: Partial<DriplElement> = {}): DriplElement =>
  ({
    id: 'line-1',
    type: 'line',
    x: 10,
    y: 20,
    width: 60,
    height: 0,
    angle: 0,
    version: 1,
    versionNonce: 1,
    points: [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
    ],
    ...extra,
  }) as DriplElement;

const noSnap = {
  shiftKey: false,
  gridEnabled: false,
  gridSize: 10,
  snapPoint: (p: { x: number; y: number }) => p,
};

describe('shouldPushHistory', () => {
  it('fires once past half a pixel', () => {
    expect(shouldPushHistory(false, 0.4, 0.4)).toBe(false);
    expect(shouldPushHistory(false, 0.6, 0)).toBe(true);
    expect(shouldPushHistory(true, 100, 100)).toBe(false);
  });
});

describe('insertLinearMidpoint', () => {
  it('inserts the segment midpoint and tightens the frame', () => {
    const out = insertLinearMidpoint(line(), 1);
    expect(out).not.toBeNull();
    const pts = (out as DriplElement & { points: Array<{ x: number; y: number }> }).points;
    expect(pts).toHaveLength(3);
    // Absolute midpoint (40,20) re-anchored to the unchanged origin.
    expect(pts[1]).toEqual({ x: 30, y: 0 });
    expect(out!.x).toBe(10);
    expect(out!.width).toBe(60);
  });

  it('rejects out-of-range indexes and point-less elements', () => {
    expect(insertLinearMidpoint(line(), 0)).toBeNull();
    expect(insertLinearMidpoint(line(), 2)).toBeNull();
    expect(insertLinearMidpoint({ ...line(), points: [] }, 1)).toBeNull();
    expect(
      insertLinearMidpoint({ ...line(), points: undefined } as unknown as DriplElement, 1)
    ).toBeNull();
  });
});

describe('dragLinearPoint', () => {
  it('moves the point and reboxes the frame', () => {
    const result = dragLinearPoint(line(), 1, 30, 10);
    expect(result).not.toBeNull();
    const { element, movedPoint } = result!;
    expect(movedPoint).toEqual({ x: 100, y: 30 });
    expect(element.x).toBe(10);
    expect(element.width).toBe(90);
    const pts = (element as DriplElement & { points: Array<{ x: number; y: number }> }).points;
    expect(pts[1]).toEqual({ x: 90, y: 10 });
  });

  it('maps the delta into local space for rotated elements', () => {
    const rotated = line({ angle: Math.PI / 2 });
    const result = dragLinearPoint(rotated, 1, 10, 0);
    expect(result).not.toBeNull();
    // A +x canvas drag on a 90°-rotated element moves the point in -y locally.
    expect(result!.movedPoint.x).toBeCloseTo(70, 8);
    expect(result!.movedPoint.y).toBeCloseTo(10, 8);
  });

  it('rejects bad indexes and point-less elements', () => {
    expect(dragLinearPoint(line(), 5, 1, 1)).toBeNull();
    expect(dragLinearPoint(line(), -1, 1, 1)).toBeNull();
    expect(dragLinearPoint({ ...line(), points: [] }, 0, 1, 1)).toBeNull();
  });
});

describe('computeBoxResize', () => {
  const box = { x: 10, y: 20, width: 100, height: 80 };

  it('expands south-east', () => {
    expect(computeBoxResize(box, 'se', 15, 25, noSnap)).toEqual({
      x: 10,
      y: 20,
      width: 115,
      height: 105,
    });
  });

  it('moves the origin for north-west', () => {
    expect(computeBoxResize(box, 'nw', 10, 20, noSnap)).toEqual({
      x: 20,
      y: 40,
      width: 90,
      height: 60,
    });
  });

  it('clamps at the 4px minimum', () => {
    expect(computeBoxResize(box, 'e', -500, 0, noSnap).width).toBe(4);
    expect(computeBoxResize(box, 'n', 0, 500, noSnap).height).toBe(4);
  });

  it('locks aspect on shift from the gesture-start ratio', () => {
    const out = computeBoxResize(box, 'se', 60, 10, { ...noSnap, shiftKey: true });
    expect(out.width).toBe(out.height * (100 / 80));
  });

  it('snaps origin and size to the grid', () => {
    const out = computeBoxResize(box, 'se', 7, 13, {
      ...noSnap,
      gridEnabled: true,
      gridSize: 10,
      snapPoint: p => ({ x: Math.round(p.x / 10) * 10, y: Math.round(p.y / 10) * 10 }),
    });
    expect(out).toEqual({ x: 10, y: 20, width: 110, height: 90 });
  });

  it('leaves unknown handles untouched', () => {
    expect(computeBoxResize(box, 'bogus', 50, 50, noSnap)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 80,
    });
  });
});
