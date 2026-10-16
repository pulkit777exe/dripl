import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import {
  groupResizeMapping,
  groupRotateMapping,
  normalizeRotationDelta,
  unionFrame,
  type GroupFrame,
} from '@/lib/canvas/group-transform';

function rect(id: string, x: number, y: number, w: number, h: number): DriplElement {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    width: w,
    height: h,
    strokeColor: '#000',
    backgroundColor: 'transparent',
    strokeWidth: 0,
    opacity: 1,
    version: 1,
    versionNonce: 1,
  } as DriplElement;
}

function frameOf(elements: DriplElement[]): GroupFrame {
  const frame = unionFrame(elements);
  if (!frame) throw new Error('no frame');
  return frame;
}

describe('unionFrame', () => {
  it('unions member bounds and skips deleted members', () => {
    const frame = frameOf([
      rect('a', 0, 0, 10, 10),
      rect('b', 20, 30, 10, 10),
      { ...rect('c', 100, 100, 10, 10), isDeleted: true },
    ]);
    expect(frame).toEqual({ x: 0, y: 0, width: 30, height: 40 });
  });

  it('returns null for an empty or fully deleted selection', () => {
    expect(unionFrame([])).toBeNull();
    expect(unionFrame([{ ...rect('a', 0, 0, 10, 10), isDeleted: true }])).toBeNull();
  });
});

describe('groupResizeMapping', () => {
  const members = [rect('a', 0, 0, 10, 10), rect('b', 20, 0, 10, 10)];
  const frame: GroupFrame = { x: 0, y: 0, width: 30, height: 10 };

  it('scales every member about the corner opposite the handle', () => {
    // se drag +30 wide: frame 30->60 wide, 10->10 tall; fixed corner (0,0).
    const next = groupResizeMapping(new Map(members.map(e => [e.id, e])), frame, 'se', 30, 0, {
      shiftKey: false,
      altKey: false,
    });
    expect(next.get('a')).toMatchObject({ x: 0, y: 0, width: 20, height: 10 });
    // b's origin (20,0) doubles to (40,0) with the sheet.
    expect(next.get('b')).toMatchObject({ x: 40, y: 0, width: 20, height: 10 });
  });

  it('mirrors about the opposite corner for nw', () => {
    const next = groupResizeMapping(new Map(members.map(e => [e.id, e])), frame, 'nw', -30, 0, {
      shiftKey: false,
      altKey: false,
    });
    // Frame grows to x -30..30 (width 60); fixed corner (30,10).
    expect(next.get('a')).toMatchObject({ x: -30, y: 0, width: 20, height: 10 });
    expect(next.get('b')).toMatchObject({ x: 10, y: 0, width: 20, height: 10 });
  });

  it('scales about the center with Alt', () => {
    const next = groupResizeMapping(new Map(members.map(e => [e.id, e])), frame, 'se', 15, 0, {
      shiftKey: false,
      altKey: true,
    });
    // Width 30->60 about center x=15: a.x = 15 + (0-15)*2 = -15.
    expect(next.get('a')).toMatchObject({ x: -15, width: 20 });
    expect(next.get('b')).toMatchObject({ x: 25, width: 20 });
  });

  it('locks aspect with Shift', () => {
    const next = groupResizeMapping(new Map(members.map(e => [e.id, e])), frame, 'se', 30, 0, {
      shiftKey: true,
      altKey: false,
    });
    // Aspect 3: base 60 -> 60x20.
    expect(next.get('a')).toMatchObject({ width: 20, height: 20 });
  });

  it('scales linear points about each member origin', () => {
    const arrow = {
      ...rect('c', 0, 0, 10, 0),
      type: 'arrow',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    } as unknown as DriplElement;
    const next = groupResizeMapping(new Map([[arrow.id, arrow]]), frame, 'se', 30, 0, {
      shiftKey: false,
      altKey: false,
    });
    expect(next.get('c')).toMatchObject({
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
    });
  });

  it('never inverts or zeroes an axis', () => {
    const next = groupResizeMapping(
      new Map(members.map(e => [e.id, e])),
      frame,
      'se',
      -1000,
      -1000,
      {
        shiftKey: false,
        altKey: false,
      }
    );
    for (const el of next.values()) {
      expect(el.width).toBeGreaterThan(0);
      expect(el.height).toBeGreaterThan(0);
    }
  });
});

describe('groupRotateMapping', () => {
  it('orbits centers about the group center and advances angles', () => {
    const members = [rect('a', 0, 0, 10, 10), rect('b', 20, 0, 10, 10)];
    const next = groupRotateMapping(
      new Map(members.map(e => [e.id, e])),
      { x: 15, y: 5 },
      Math.PI / 2
    );
    // a's center (5,5) orbits to (15,-5); box preserved, angle +90°.
    expect(next.get('a')).toMatchObject({ x: 10, y: -10, width: 10, height: 10 });
    expect(next.get('a')!.angle).toBeCloseTo(Math.PI / 2, 10);
    // b's center (25,5) orbits to (15,15).
    expect(next.get('b')).toMatchObject({ x: 10, y: 10 });
  });

  it('is the identity for a zero delta', () => {
    const members = [rect('a', 4, 6, 10, 12)];
    const next = groupRotateMapping(new Map(members.map(e => [e.id, e])), { x: 0, y: 0 }, 0);
    expect(next.get('a')).toMatchObject({ x: 4, y: 6, angle: 0 });
  });
});

describe('normalizeRotationDelta', () => {
  it('wraps pointer wrap-around into (-PI, PI]', () => {
    expect(normalizeRotationDelta(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 10);
    expect(normalizeRotationDelta(-Math.PI - 0.1)).toBeCloseTo(Math.PI - 0.1, 10);
    expect(normalizeRotationDelta(0.5)).toBe(0.5);
  });
});
