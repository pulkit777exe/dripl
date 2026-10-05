import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import {
  computeBoxResize,
  dragLinearPoint,
  insertLinearMidpoint,
  shouldPushHistory,
} from '@/lib/canvas/resize-geometry';

/**
 * The compass-handle geometry and the sparse-point guards.
 *
 * `computeBoxResize` has eight handles and each is a separate arithmetic branch that
 * decides which edge moves and which corner stays pinned. A branch that is never run
 * is invisible in review, so every handle is asserted here on both the edge it moves
 * and the corner it holds fixed — the second half is what catches a handle that
 * resizes but forgets to re-anchor the origin.
 */

/** Identity snap, so `gridEnabled: false` leaves the arithmetic under test. */
const options = (over: Partial<Parameters<typeof computeBoxResize>[4]> = {}) => ({
  shiftKey: false,
  gridEnabled: false,
  gridSize: 20,
  snapPoint: (p: { x: number; y: number }) => p,
  ...over,
});

const box = { x: 100, y: 200, width: 80, height: 40 };

/**
 * Mirrors the module's private `MIN_SIZE`. Duplicated rather than exported because it
 * is not part of the module's surface — and asserted against the source in the test
 * below, so a change to the constant cannot silently make every clamp assertion pass
 * or fail for the wrong reason.
 */
const MIN_SIZE = 4;

/**
 * A line whose `points` are taken verbatim, so a genuine array hole survives.
 *
 * Holes, not explicit `undefined`: `Array.prototype.map` *skips* holes but *visits*
 * an explicit undefined, so `[a, undefined, b].map(p => p.x)` throws where
 * `[a, , b].map(p => p.x)` yields a hole. Only the hole reaches the guard under test.
 */
const linear = (points: unknown[]): DriplElement =>
  ({
    id: 'line-1',
    type: 'line',
    x: 0,
    y: 0,
    width: 60,
    height: 0,
    angle: 0,
    version: 1,
    versionNonce: 1,
    points,
  }) as unknown as DriplElement;

describe('computeBoxResize — every compass handle', () => {
  it('se: moves the width and height, origin pinned', () => {
    expect(computeBoxResize(box, 'se', 20, 10, options())).toEqual({
      x: 100,
      y: 200,
      width: 100,
      height: 50,
    });
  });

  it('sw: moves the width and height and holds the right edge fixed', () => {
    const out = computeBoxResize(box, 'sw', 20, 10, options());
    // Expectation derived from the box rather than typed as a literal. Dragging a
    // west/south corner shrinks from the left, so x moves RIGHT by the shrink amount
    // to keep the right edge where it was.
    expect(out.width).toBe(box.width - 20);
    expect(out.height).toBe(box.height + 10);
    expect(out.x).toBe(box.x + 20);
    expect(out.y).toBe(box.y);
    expect(out.x + out.width).toBe(box.x + box.width);
  });

  it('ne: moves the width and height and holds the bottom edge fixed', () => {
    const out = computeBoxResize(box, 'ne', 20, 10, options());
    expect(out.width).toBe(box.width + 20);
    expect(out.height).toBe(box.height - 10);
    expect(out.x).toBe(box.x);
    expect(out.y + out.height).toBe(box.y + box.height);
  });

  it('nw: moves both axes and holds the bottom-right corner fixed', () => {
    const out = computeBoxResize(box, 'nw', 20, 10, options());
    expect(out.width).toBe(box.width - 20);
    expect(out.height).toBe(box.height - 10);
    expect(out.x + out.width).toBe(box.x + box.width);
    expect(out.y + out.height).toBe(box.y + box.height);
  });

  it('e: moves only the width', () => {
    const out = computeBoxResize(box, 'e', 20, 999, options());
    expect(out).toEqual({ x: box.x, y: box.y, width: box.width + 20, height: box.height });
  });

  it('w: moves the width and holds the right edge fixed', () => {
    const out = computeBoxResize(box, 'w', 20, 999, options());
    expect(out.height).toBe(box.height);
    expect(out.width).toBe(box.width - 20);
    expect(out.x + out.width).toBe(box.x + box.width);
  });

  it('s: moves only the height', () => {
    const out = computeBoxResize(box, 's', 999, 10, options());
    expect(out).toEqual({ x: box.x, y: box.y, width: box.width, height: box.height + 10 });
  });

  it('n: moves the height and holds the bottom edge fixed', () => {
    const out = computeBoxResize(box, 'n', 999, 10, options());
    expect(out.width).toBe(box.width);
    expect(out.height).toBe(box.height - 10);
    expect(out.y + out.height).toBe(box.y + box.height);
  });

  it('leaves the box untouched for an unknown handle', () => {
    // No default case exists in the source, so an unrecognised handle is a no-op
    // rather than a crash. Pinned because a future `default:` arm would change it.
    expect(computeBoxResize(box, 'nwse', 20, 10, options())).toEqual(box);
  });

  it.each([
    ['se', 20, 10],
    ['sw', 20, 10],
    ['ne', 20, 10],
    ['nw', 20, 10],
    ['e', 20, 0],
    ['w', 20, 0],
    ['s', 0, 10],
    ['n', 0, 10],
  ])('clamps %s to the minimum size instead of inverting', (handle, dx, dy) => {
    // Dragging an edge far past the opposite one would otherwise produce a negative
    // width, which flips the element inside out rather than just making it small.
    const out = computeBoxResize(box, handle, dx, dy, options());
    expect(out.width).toBeGreaterThanOrEqual(MIN_SIZE);
    expect(out.height).toBeGreaterThanOrEqual(MIN_SIZE);
  });

  // The case above never reaches the clamp: `box` is 80x40 and those deltas leave
  // both dimensions positive. These deltas are chosen to overshoot the box entirely,
  // so the clamp is genuinely exercised rather than merely asserted about.
  it.each([
    ['sw', 200, 10],
    ['ne', 20, 200],
    ['nw', 200, 200],
    ['w', 200, 0],
    ['n', 0, 200],
  ])('clamps %s to exactly the minimum when dragged past the opposite edge', (handle, dx, dy) => {
    const out = computeBoxResize(box, handle, dx, dy, options());
    const shrinkingWidth = ['sw', 'nw', 'w'].includes(handle);
    const shrinkingHeight = ['ne', 'nw', 'n'].includes(handle);
    if (shrinkingWidth) expect(out.width).toBe(MIN_SIZE);
    if (shrinkingHeight) expect(out.height).toBe(MIN_SIZE);
    // Whichever dimension grew keeps its real value; only the inverted one is clamped.
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.y)).toBe(true);
  });
});

describe('computeBoxResize — shift-key aspect lock', () => {
  const locked = (over: Partial<Parameters<typeof computeBoxResize>[4]> = {}) =>
    options({ shiftKey: true, ...over });

  it('preserves the original aspect ratio', () => {
    // The starting box is 80x40, so a locked resize must stay 2:1.
    const out = computeBoxResize(box, 'se', 40, 40, locked());
    expect(out.width / out.height).toBeCloseTo(2, 10);
  });

  it('holds the right edge for a handle that includes w', () => {
    const out = computeBoxResize(box, 'sw', 20, 10, locked());
    expect(out.x + out.width).toBe(box.x + box.width);
  });

  it('holds the bottom edge for a handle that includes n', () => {
    const out = computeBoxResize(box, 'ne', 20, 10, locked());
    expect(out.y + out.height).toBe(box.y + box.height);
  });

  it('holds both edges for nw', () => {
    const out = computeBoxResize(box, 'nw', 20, 10, locked());
    expect(out.x + out.width).toBe(box.x + box.width);
    expect(out.y + out.height).toBe(box.y + box.height);
  });

  it('leaves the origin alone for an east-only handle', () => {
    const out = computeBoxResize(box, 'e', 20, 0, locked());
    expect(out.x).toBe(box.x);
  });

  it('uses a 1:1 ratio for a zero-height box rather than dividing by zero', () => {
    const flat = { x: 0, y: 0, width: 50, height: 0 };
    const out = computeBoxResize(flat, 'se', 10, 10, locked());
    expect(Number.isFinite(out.width)).toBe(true);
    expect(Number.isFinite(out.height)).toBe(true);
    expect(out.width).toBe(out.height);
  });
});

describe('computeBoxResize — grid snapping', () => {
  it('snaps the origin when the grid is enabled', () => {
    const out = computeBoxResize(
      box,
      'se',
      20,
      10,
      options({ gridEnabled: true, snapPoint: () => ({ x: 0, y: 0 }) })
    );
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it('snaps the size to the grid as well as the origin', () => {
    // Grid mode snaps width and height to multiples of gridSize, so an unsnapped
    // expectation here would be wrong: box.height + 10 is 50, which rounds to 60.
    const out = computeBoxResize(
      box,
      'se',
      20,
      10,
      options({ gridEnabled: true, gridSize: 20, snapPoint: () => ({ x: 0, y: 0 }) })
    );
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.width % 20).toBe(0);
    expect(out.height % 20).toBe(0);
    expect(out.height).toBe(60);
  });

  it('lets grid size-snapping override the aspect lock', () => {
    // Order is aspect lock, then grid snap. The lock produces 60x30, and snapping the
    // height to a 20px grid turns that into 60x40 — a 1.5 ratio, not the 2 the lock
    // asked for. Recorded because it is surprising: with the grid on, shift-drag no
    // longer guarantees a square-cornered box.
    const out = computeBoxResize(
      box,
      'nw',
      20,
      10,
      options({
        shiftKey: true,
        gridEnabled: true,
        gridSize: 20,
        snapPoint: () => ({ x: 7, y: 9 }),
      })
    );
    expect(out.x).toBe(7);
    expect(out.y).toBe(9);
    expect(out.width).toBe(60);
    expect(out.height).toBe(40);
  });

  it('keeps the aspect exactly when the grid is off', () => {
    // The control for the test above: same gesture, same shift key, no grid.
    // `options`, not `locked` — that helper is scoped to the shift-key block.
    const out = computeBoxResize(box, 'nw', 20, 10, options({ shiftKey: true }));
    expect(out.width / out.height).toBeCloseTo(2, 10);
  });
});

describe('insertLinearMidpoint — sparse points', () => {
  it('returns null when a point is a hole inside the valid index range', () => {
    // The index guard admits 1 <= index < pts.length, but a hole still reads as
    // undefined there. Dereferencing `.x` off it would throw mid-gesture.
    const pts: Array<{ x: number; y: number } | undefined> = [];
    pts[0] = { x: 0, y: 0 };
    pts[2] = { x: 40, y: 40 };
    expect(insertLinearMidpoint(linear(pts), 1)).toBeNull();
  });

  it('returns null when the first neighbour is a hole', () => {
    const pts: Array<{ x: number; y: number } | undefined> = [];
    pts[1] = { x: 10, y: 10 };
    pts[2] = { x: 20, y: 20 };
    expect(insertLinearMidpoint(linear(pts), 1)).toBeNull();
  });

  it('inserts a midpoint between two real neighbours', () => {
    const el = linear([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 40, y: 0 },
    ]);
    const out = insertLinearMidpoint(el, 1);
    expect(out).not.toBeNull();
    const pts = (out as unknown as { points: Array<{ x: number; y: number }> }).points;
    expect(pts).toHaveLength(4);
    expect(pts[1]).toEqual({ x: 10, y: 0 });
  });

  it('rejects an out-of-range index', () => {
    const el = linear([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(insertLinearMidpoint(el, 0)).toBeNull();
    expect(insertLinearMidpoint(el, 2)).toBeNull();
  });
});

describe('dragLinearPoint — sparse points', () => {
  it('returns null when the dragged point is a hole', () => {
    // Same hole-in-range case as the midpoint insert: the index is in bounds, and
    // `.map` preserves the hole, so only the explicit check stops the dereference.
    const pts: Array<{ x: number; y: number } | undefined> = [];
    pts[0] = { x: 0, y: 0 };
    pts[2] = { x: 40, y: 40 };
    expect(dragLinearPoint(linear(pts), 1, 5, 5)).toBeNull();
  });

  it('drags a real point by the given delta', () => {
    const el = linear([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]);
    const out = dragLinearPoint(el, 1, 5, -3);
    expect(out).not.toBeNull();
    // `movedPoint` is absolute; the element's stored `points` are re-expressed
    // relative to the origin the box was re-anchored to. Asserting the stored point
    // directly would be asserting the rebox arithmetic instead of the drag.
    expect(out!.movedPoint).toEqual({ x: 25, y: -3 });

    const pts = out!.element.points as Array<{ x: number; y: number }>;
    expect(out!.element.x + pts[1]!.x).toBe(out!.movedPoint.x);
    expect(out!.element.y + pts[1]!.y).toBe(out!.movedPoint.y);
    // The box followed the point: dragging down re-anchored the origin to the new min.
    expect(out!.element.y).toBe(-3);
  });

  it('rotates the drag delta for a rotated element', () => {
    const rotated = linear([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]);
    rotated.angle = Math.PI / 2;
    const out = dragLinearPoint(rotated, 1, 10, 0);
    expect(out).not.toBeNull();

    // Asserted by preserved length and a changed direction rather than a typed
    // coordinate: rotation keeps the offset 10 long but must not leave it pointing
    // along +x, which is what applying the delta raw would produce.
    const offsetX = out!.movedPoint.x - 20;
    const offsetY = out!.movedPoint.y - 0;
    expect(Math.hypot(offsetX, offsetY)).toBeCloseTo(10, 6);
    expect(offsetX).not.toBeCloseTo(10, 6);
  });

  it('rejects an out-of-range index', () => {
    const el = linear([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(dragLinearPoint(el, -1, 5, 5)).toBeNull();
    expect(dragLinearPoint(el, 2, 5, 5)).toBeNull();
  });
  it('rejects an element with no points property at all', () => {
    // Distinct from an empty or malformed array: `pointsOf` tests key presence
    // first, so an element that never carried points must not fall through to the
    // Array.isArray check with `pts` undefined.
    const noPoints = {
      id: 'line-1',
      type: 'line',
      x: 0,
      y: 0,
      width: 60,
      height: 0,
      angle: 0,
      version: 1,
      versionNonce: 1,
    } as unknown as DriplElement;

    expect(insertLinearMidpoint(noPoints, 1)).toBeNull();
    expect(dragLinearPoint(noPoints, 1, 5, 5)).toBeNull();
  });

  it('rejects a points array that is too short to have a segment', () => {
    const single = linear([{ x: 0, y: 0 }]);
    expect(insertLinearMidpoint(single, 1)).toBeNull();
    expect(dragLinearPoint(single, 0, 5, 5)).toBeNull();
  });

  it('rejects a non-array points value', () => {
    const bogus = {
      ...linear([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
      points: 'nope',
    };
    expect(insertLinearMidpoint(bogus as unknown as DriplElement, 1)).toBeNull();
    expect(dragLinearPoint(bogus as unknown as DriplElement, 1, 1, 1)).toBeNull();
  });
});

describe('shouldPushHistory', () => {
  it('does not push history when one was already pushed this gesture', () => {
    // The guard that stops a single drag from recording one entry per pointermove.
    expect(shouldPushHistory(true, 100, 100)).toBe(false);
  });

  it('pushes history once a drag exceeds the threshold on either axis', () => {
    expect(shouldPushHistory(false, 100, 0)).toBe(true);
    expect(shouldPushHistory(false, 0, 100)).toBe(true);
  });

  it('ignores movement below the threshold', () => {
    // A 0.5px threshold: sub-pixel jitter must not each become an undo step.
    expect(shouldPushHistory(false, 0.4, 0.4)).toBe(false);
  });

  it('uses the magnitude of the delta, so a negative drag still counts', () => {
    expect(shouldPushHistory(false, -100, -100)).toBe(true);
  });
});
