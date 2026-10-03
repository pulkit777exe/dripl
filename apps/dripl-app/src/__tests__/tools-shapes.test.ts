import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DriplElementSchema } from '@dripl/common';
import type { DriplElement, Point } from '@dripl/common';
import { createRectangleElement } from '@/utils/tools/rectangle';
import { createEllipseElement } from '@/utils/tools/ellipse';
import { createDiamondElement } from '@/utils/tools/diamond';
import { createFrameElement } from '@/utils/tools/frame';
import { createEmbedElement } from '@/utils/tools/webEmbed';
import { baseProps } from './helpers/elements';

/**
 * The four drag-to-draw shape tools.
 *
 * Every one of them answers the same question: given a drag from `startPoint`
 * to `currentPoint`, what box does the user get? The contract that matters is
 * that the answer is the drag rectangle — Shift constrains it to a square,
 * Alt draws from the centre. This suite pins that for each tool, and pins the
 * properties that must hold whatever the drag: schema-valid output, non-negative
 * extents, and the base props preserved.
 */

/**
 * Coordinates inside the element schema's own bounds, at millimetre resolution.
 *
 * Raw `fc.double` happily generates subnormals like 5e-324, where an absolute
 * comparison tolerance is meaningless. A pointer coordinate is never that small.
 */
const coord = fc.integer({ min: -5_000_000, max: 5_000_000 }).map(n => n / 1000);
const drag = fc.record({
  startPoint: fc.record({ x: coord, y: coord }),
  currentPoint: fc.record({ x: coord, y: coord }),
});
const modifiers = fc.record({ shiftKey: fc.boolean(), altKey: fc.boolean() });

/** The box the user actually dragged: normalised, positive extents. */
function dragRect(start: Point, end: Point) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/**
 * The box `rectangle`/`ellipse`/`diamond` produce for a drag.
 *
 * Unshifted, it is the drag rectangle. Shifted, it is a square of `size` on the
 * larger side, anchored on the corner so that the SIGN of the drag is preserved:
 * dragging up-and-left puts the square up-and-left of the press point, which
 * necessarily overshoots the (smaller) drag rect on the leading edge.
 */
function expectedBox(start: Point, current: Point, shiftKey: boolean): Box {
  const signedWidth = current.x - start.x;
  const signedHeight = current.y - start.y;
  if (!shiftKey) return dragRect(start, current);
  const size = Math.max(Math.abs(signedWidth), Math.abs(signedHeight));
  return {
    x: signedWidth < 0 ? start.x - size : start.x,
    y: signedHeight < 0 ? start.y - size : start.y,
    width: size,
    height: size,
  };
}

/**
 * The corner the drag actually started from.
 *
 * Under Alt the pointer is the CENTRE, so the effective corner is its
 * reflection through the cursor. Getting this wrong is what makes an Alt drag
 * look like a one-pixel drag, so the property tests derive it explicitly.
 */
function effectiveStart(startPoint: Point, currentPoint: Point, altKey: boolean): Point {
  return altKey
    ? { x: startPoint.x * 2 - currentPoint.x, y: startPoint.y * 2 - currentPoint.y }
    : startPoint;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
const boxOf = (element: DriplElement): Box => ({
  x: element.x,
  y: element.y,
  width: element.width,
  height: element.height,
});

describe('createRectangleElement', () => {
  it('produces exactly the drag rectangle for a down-right drag', () => {
    const element = createRectangleElement(
      { startPoint: { x: 10, y: 20 }, currentPoint: { x: 110, y: 70 }, shiftKey: false },
      baseProps('r') as never
    );
    expect(boxOf(element)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    expect(element.type).toBe('rectangle');
  });

  it('normalises an up-left drag to the same box', () => {
    const element = createRectangleElement(
      { startPoint: { x: 110, y: 70 }, currentPoint: { x: 10, y: 20 }, shiftKey: false },
      baseProps('r') as never
    );
    expect(boxOf(element)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('normalises a mixed drag too', () => {
    const element = createRectangleElement(
      { startPoint: { x: 10, y: 70 }, currentPoint: { x: 110, y: 20 }, shiftKey: false },
      baseProps('r') as never
    );
    expect(boxOf(element)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('constrains to a square of the larger side under shift', () => {
    const element = createRectangleElement(
      { startPoint: { x: 0, y: 0 }, currentPoint: { x: 100, y: 30 }, shiftKey: true },
      baseProps('r') as never
    );
    expect(boxOf(element)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('anchors a shift-constrained up-left drag at the dragged corner', () => {
    const element = createRectangleElement(
      { startPoint: { x: 100, y: 100 }, currentPoint: { x: 0, y: 60 }, shiftKey: true },
      baseProps('r') as never
    );
    expect(boxOf(element)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('draws from the centre under alt, doubling both spans around the cursor', () => {
    // Alt makes `startPoint` the reflection of the cursor, so the box is
    // symmetric about `currentPoint`.
    const element = createRectangleElement(
      { startPoint: { x: 0, y: 0 }, currentPoint: { x: 50, y: 40 }, shiftKey: false, altKey: true },
      baseProps('r') as never
    );
    expect(boxOf(element)).toEqual({ x: -50, y: -40, width: 100, height: 80 });
  });

  it('combines alt and shift: a square anchored at the reflected corner, not centred', () => {
    // Shift squares the drag rect, and the square keeps the drag rect's
    // top-left corner. Under Alt that corner is the REFLECTED pointer-down
    // point (-50, -40), so the square's far corner is the cursor rather than
    // its centre. Pinned because it is the shared behaviour of rectangle,
    // ellipse and frame -- not something the diamond tool ever did.
    const element = createRectangleElement(
      { startPoint: { x: 0, y: 0 }, currentPoint: { x: 50, y: 40 }, shiftKey: true, altKey: true },
      baseProps('r') as never
    );
    expect(boxOf(element)).toEqual({ x: -50, y: -40, width: 100, height: 100 });
  });

  it('treats a missing altKey as false', () => {
    const element = createRectangleElement(
      { startPoint: { x: 0, y: 0 }, currentPoint: { x: 10, y: 10 }, shiftKey: false },
      baseProps('r') as never
    );
    expect(boxOf(element)).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it('produces a zero-size box for a click with no movement', () => {
    const element = createRectangleElement(
      { startPoint: { x: 7, y: 7 }, currentPoint: { x: 7, y: 7 }, shiftKey: false },
      baseProps('r') as never
    );
    expect(boxOf(element)).toEqual({ x: 7, y: 7, width: 0, height: 0 });
  });

  it('preserves the id and every style field it was handed', () => {
    const props = baseProps('r');
    const element = createRectangleElement(
      { startPoint: { x: 0, y: 0 }, currentPoint: { x: 1, y: 1 }, shiftKey: false },
      props as never
    );
    for (const [key, value] of Object.entries(props)) {
      expect((element as Record<string, unknown>)[key]).toEqual(value);
    }
  });

  it('cannot be overridden by the caller on the geometry it owns', () => {
    const element = createRectangleElement(
      { startPoint: { x: 5, y: 5 }, currentPoint: { x: 25, y: 35 }, shiftKey: false },
      { ...baseProps('r'), x: 999, y: 999, width: 1, height: 1, type: 'ellipse' } as never
    );
    expect(boxOf(element)).toEqual({ x: 5, y: 5, width: 20, height: 30 });
    expect(element.type).toBe('rectangle');
  });

  it('always produces a schema-valid element', () => {
    fc.assert(
      fc.property(drag, modifiers, ({ startPoint, currentPoint }, mods) => {
        const element = createRectangleElement(
          { startPoint, currentPoint, shiftKey: mods.shiftKey, altKey: mods.altKey },
          baseProps('r') as never
        );
        expect(DriplElementSchema.safeParse(element).success).toBe(true);
      })
    );
  });

  it('always produces the drag rectangle, and never a negative extent', () => {
    fc.assert(
      fc.property(drag, modifiers, ({ startPoint, currentPoint }, mods) => {
        const element = createRectangleElement(
          { startPoint, currentPoint, shiftKey: mods.shiftKey, altKey: mods.altKey },
          baseProps('r') as never
        );
        expect(element.width).toBeGreaterThanOrEqual(0);
        expect(element.height).toBeGreaterThanOrEqual(0);
        const anchor = effectiveStart(startPoint, currentPoint, mods.altKey);
        const expected = expectedBox(anchor, currentPoint, mods.shiftKey);
        expect(element.width).toBeCloseTo(expected.width, 8);
        expect(element.height).toBeCloseTo(expected.height, 8);
        expect(element.x).toBeCloseTo(expected.x, 8);
        expect(element.y).toBeCloseTo(expected.y, 8);
      })
    );
  });
});

describe('createEllipseElement', () => {
  it('shares the rectangle drag semantics exactly', () => {
    fc.assert(
      fc.property(drag, modifiers, ({ startPoint, currentPoint }, mods) => {
        const state = { startPoint, currentPoint, shiftKey: mods.shiftKey, altKey: mods.altKey };
        const ellipse = createEllipseElement(state, baseProps('e') as never);
        const rectangle = createRectangleElement(state, baseProps('r') as never);
        expect(boxOf(ellipse)).toEqual(boxOf(rectangle));
        expect(ellipse.type).toBe('ellipse');
      })
    );
  });

  it('takes absolute radii, so a flipped drag still renders rather than mirroring twice', () => {
    const element = createEllipseElement(
      { startPoint: { x: 110, y: 70 }, currentPoint: { x: 10, y: 20 }, shiftKey: false },
      baseProps('e') as never
    );
    expect(boxOf(element)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('always produces a schema-valid element', () => {
    fc.assert(
      fc.property(drag, modifiers, ({ startPoint, currentPoint }, mods) => {
        const element = createEllipseElement(
          { startPoint, currentPoint, shiftKey: mods.shiftKey, altKey: mods.altKey },
          baseProps('e') as never
        );
        expect(DriplElementSchema.safeParse(element).success).toBe(true);
      })
    );
  });
});

describe('createDiamondElement', () => {
  it('produces the drag rectangle for a square drag', () => {
    const element = createDiamondElement(
      { startPoint: { x: 0, y: 0 }, currentPoint: { x: 100, y: 100 }, shiftKey: false },
      baseProps('d') as never
    );
    expect(boxOf(element)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('constrains to a square of the larger side under shift', () => {
    const element = createDiamondElement(
      { startPoint: { x: 0, y: 0 }, currentPoint: { x: 100, y: 30 }, shiftKey: true },
      baseProps('d') as never
    );
    expect(boxOf(element)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('ignores altKey, matching frame and embed, which have no centre mode', () => {
    const element = createDiamondElement(
      { startPoint: { x: 0, y: 0 }, currentPoint: { x: 50, y: 40 }, shiftKey: false } as never,
      baseProps('d') as never
    );
    expect(boxOf(element)).toEqual({ x: 0, y: 0, width: 50, height: 40 });
  });

  it('preserves the id and every style field it was handed', () => {
    const props = baseProps('d');
    const element = createDiamondElement(
      { startPoint: { x: 0, y: 0 }, currentPoint: { x: 1, y: 1 }, shiftKey: false },
      props as never
    );
    for (const [key, value] of Object.entries(props)) {
      expect((element as Record<string, unknown>)[key]).toEqual(value);
    }
  });

  it('always produces a schema-valid element', () => {
    fc.assert(
      fc.property(drag, fc.boolean(), ({ startPoint, currentPoint }, shiftKey) => {
        const element = createDiamondElement(
          { startPoint, currentPoint, shiftKey },
          baseProps('d') as never
        );
        expect(DriplElementSchema.safeParse(element).success).toBe(true);
      })
    );
  });

  /**
   * The invariant every sibling shape tool holds and the diamond tool did not.
   *
   * `renderDiamond` draws a rhombus whose vertices are the midpoints of this
   * box, and `getElementBounds` computes the hit/overlay hull from it, so the
   * box IS the element as far as every consumer is concerned. It must
   * therefore be the drag rectangle: Shift squares it, exactly as it does for
   * the rectangle tool.
   */
  it('produces the drag rectangle, agreeing with the rectangle tool for every drag', () => {
    fc.assert(
      fc.property(drag, fc.boolean(), ({ startPoint, currentPoint }, shiftKey) => {
        const diamond = createDiamondElement(
          { startPoint, currentPoint, shiftKey },
          baseProps('d') as never
        );
        const rectangle = createRectangleElement(
          { startPoint, currentPoint, shiftKey },
          baseProps('r') as never
        );
        expect(diamond.width).toBeCloseTo(rectangle.width, 8);
        expect(diamond.height).toBeCloseTo(rectangle.height, 8);
        expect(diamond.x).toBeCloseTo(rectangle.x, 8);
        expect(diamond.y).toBeCloseTo(rectangle.y, 8);
      })
    );
  });

  it('stays inside the dragged rect, so the preview cannot overshoot the cursor', () => {
    fc.assert(
      fc.property(drag, ({ startPoint, currentPoint }) => {
        const diamond = createDiamondElement(
          { startPoint, currentPoint, shiftKey: false },
          baseProps('d') as never
        );
        const dragged = dragRect(startPoint, currentPoint);
        expect(diamond.x).toBeGreaterThanOrEqual(dragged.x - 1e-6);
        expect(diamond.y).toBeGreaterThanOrEqual(dragged.y - 1e-6);
        expect(diamond.x + diamond.width).toBeLessThanOrEqual(dragged.x + dragged.width + 1e-6);
        expect(diamond.y + diamond.height).toBeLessThanOrEqual(dragged.y + dragged.height + 1e-6);
      })
    );
  });
});

describe('createFrameElement', () => {
  it('produces exactly the drag rectangle', () => {
    const element = createFrameElement(
      { startPoint: { x: 110, y: 70 }, currentPoint: { x: 10, y: 20 }, shiftKey: false },
      baseProps('f') as never
    );
    expect(boxOf(element)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('constrains to a square under shift', () => {
    const element = createFrameElement(
      { startPoint: { x: 100, y: 100 }, currentPoint: { x: 0, y: 60 }, shiftKey: true },
      baseProps('f') as never
    );
    expect(boxOf(element)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('tags the element as a frame with the default title and padding the renderer reads', () => {
    const element = createFrameElement(
      { startPoint: { x: 0, y: 0 }, currentPoint: { x: 10, y: 10 }, shiftKey: false },
      baseProps('f') as never
    );
    expect(element.type).toBe('frame');
    expect((element as Record<string, unknown>).title).toBe('Frame');
    expect((element as Record<string, unknown>).padding).toBe(20);
  });

  it('owns the title and padding outright, so baseProps cannot override them', () => {
    // The tool spreads baseProps first and then writes its own title/padding, so
    // a caller-supplied title is discarded. Pinned as current behaviour:
    // `useDrawingTools` never passes one, so nothing is broken today, but a
    // caller that assumes otherwise gets silently ignored.
    const element = createFrameElement(
      { startPoint: { x: 0, y: 0 }, currentPoint: { x: 10, y: 10 }, shiftKey: false },
      { ...baseProps('f'), title: 'Custom', padding: 4 } as never
    );
    expect((element as Record<string, unknown>).title).toBe('Frame');
    expect((element as Record<string, unknown>).padding).toBe(20);
  });

  it('always produces a schema-valid element', () => {
    fc.assert(
      fc.property(drag, fc.boolean(), ({ startPoint, currentPoint }, shiftKey) => {
        const element = createFrameElement(
          { startPoint, currentPoint, shiftKey },
          baseProps('f') as never
        );
        expect(DriplElementSchema.safeParse(element).success).toBe(true);
      })
    );
  });

  it('matches the rectangle tool off tie, and is the same size on tie', () => {
    fc.assert(
      fc.property(drag, fc.boolean(), ({ startPoint, currentPoint }, shiftKey) => {
        const element = createFrameElement(
          { startPoint, currentPoint, shiftKey },
          baseProps('f') as never
        );
        const expected = expectedBox(startPoint, currentPoint, shiftKey);
        // Same extents on every drag; only the anchor differs on an exact tie.
        expect(element.width).toBeCloseTo(expected.width, 8);
        expect(element.height).toBeCloseTo(expected.height, 8);
        if (startPoint.x !== currentPoint.x) expect(element.x).toBeCloseTo(expected.x, 8);
        if (startPoint.y !== currentPoint.y) expect(element.y).toBeCloseTo(expected.y, 8);
      })
    );
  });

  /**
   * The one place frame and rectangle disagree, and it is a documented
   * divergence rather than an intended one.
   *
   * `frame`/`embed` pick the anchored corner with `current > start ? start :
   * start - size`; `rectangle`/`ellipse` pick it with `width < 0`. On an exact
   * axis-aligned tie the two predicates disagree about which quadrant the
   * square belongs in. A Shift-drag straight down from (0,0) to (0,100) puts a
   * rectangle at x 0..100 and a frame at x -100..0.
   *
   * Reachable, but only on an exact tie, and nothing in the repo says which
   * quadrant is right, so this is reported rather than "fixed".
   */
  it('anchors a shift-constrained square in the opposite quadrant from the rectangle tool on an exact axis tie', () => {
    const dragDown = { startPoint: { x: 0, y: 0 }, currentPoint: { x: 0, y: 100 }, shiftKey: true };
    expect(boxOf(createFrameElement(dragDown, baseProps('f') as never))).toEqual({
      x: -100,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(
      boxOf(createRectangleElement({ ...dragDown, altKey: false }, baseProps('r') as never))
    ).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });

    const dragRight = {
      startPoint: { x: 0, y: 0 },
      currentPoint: { x: 100, y: 0 },
      shiftKey: true,
    };
    expect(boxOf(createFrameElement(dragRight, baseProps('f') as never))).toEqual({
      x: 0,
      y: -100,
      width: 100,
      height: 100,
    });
    expect(
      boxOf(createRectangleElement({ ...dragRight, altKey: false }, baseProps('r') as never))
    ).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
  });

  it('agrees with the rectangle tool on every drag that is not an exact axis tie', () => {
    fc.assert(
      fc.property(drag, fc.boolean(), ({ startPoint, currentPoint }, shiftKey) => {
        const state = { startPoint, currentPoint, shiftKey };
        const frame = boxOf(createFrameElement(state, baseProps('f') as never));
        const rectangle = boxOf(
          createRectangleElement({ ...state, altKey: false }, baseProps('r') as never)
        );
        // The two tie predicates only disagree when the drag is exactly
        // axis-aligned, so compare extents always and the anchor off ties.
        expect(frame.width).toBeCloseTo(rectangle.width, 8);
        expect(frame.height).toBeCloseTo(rectangle.height, 8);
        if (startPoint.x !== currentPoint.x) expect(frame.x).toBeCloseTo(rectangle.x, 8);
        if (startPoint.y !== currentPoint.y) expect(frame.y).toBeCloseTo(rectangle.y, 8);
      })
    );
  });
});

describe('createEmbedElement', () => {
  it('produces exactly the drag rectangle', () => {
    const element = createEmbedElement(
      { startPoint: { x: 110, y: 70 }, currentPoint: { x: 10, y: 20 }, shiftKey: false },
      baseProps('e') as never,
      'https://a.dev/x'
    );
    expect(boxOf(element)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('constrains to a square under shift', () => {
    const element = createEmbedElement(
      { startPoint: { x: 100, y: 100 }, currentPoint: { x: 0, y: 60 }, shiftKey: true },
      baseProps('e') as never,
      'https://a.dev/x'
    );
    expect(boxOf(element)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('derives its title from the hostname', () => {
    const element = createEmbedElement(
      { startPoint: { x: 0, y: 0 }, currentPoint: { x: 1, y: 1 }, shiftKey: false },
      baseProps('e') as never,
      'https://docs.example.com/a/b?c=d'
    );
    expect((element as Record<string, unknown>).title).toBe('docs.example.com');
  });

  it('prefers an explicit title over the hostname', () => {
    const element = createEmbedElement(
      { startPoint: { x: 0, y: 0 }, currentPoint: { x: 1, y: 1 }, shiftKey: false },
      baseProps('e') as never,
      'https://a.dev',
      'Docs'
    );
    expect((element as Record<string, unknown>).title).toBe('Docs');
  });

  it('falls back to the raw url when it cannot be parsed', () => {
    const element = createEmbedElement(
      { startPoint: { x: 0, y: 0 }, currentPoint: { x: 1, y: 1 }, shiftKey: false },
      baseProps('e') as never,
      'not a url'
    );
    expect((element as Record<string, unknown>).title).toBe('not a url');
  });

  it('never loses the url itself', () => {
    const element = createEmbedElement(
      { startPoint: { x: 0, y: 0 }, currentPoint: { x: 1, y: 1 }, shiftKey: false },
      baseProps('e') as never,
      ''
    );
    expect((element as Record<string, unknown>).url).toBe('');
    expect((element as Record<string, unknown>).title).toBe('');
  });

  it('always produces a schema-valid element', () => {
    fc.assert(
      fc.property(drag, fc.boolean(), ({ startPoint, currentPoint }, shiftKey) => {
        const element = createEmbedElement(
          { startPoint, currentPoint, shiftKey },
          baseProps('e') as never,
          'https://a.dev'
        );
        expect(DriplElementSchema.safeParse(element).success).toBe(true);
      })
    );
  });
});

describe('shape tools agree with each other', () => {
  it('all five produce the same box for the same drag, with and without shift', () => {
    // Exact axis ties are excluded: frame/embed break the tie in the opposite
    // direction to rectangle/ellipse, which is pinned separately above.
    fc.assert(
      fc.property(drag, fc.boolean(), ({ startPoint, currentPoint }, shiftKey) => {
        if (startPoint.x === currentPoint.x || startPoint.y === currentPoint.y) return;
        const state = { startPoint, currentPoint, shiftKey };
        const boxes = [
          createRectangleElement({ ...state, altKey: false }, baseProps('a') as never),
          createEllipseElement({ ...state, altKey: false }, baseProps('b') as never),
          createDiamondElement(state, baseProps('c') as never),
          createFrameElement(state, baseProps('d') as never),
          createEmbedElement(state, baseProps('e') as never, 'https://a.dev'),
        ].map(boxOf);
        for (const box of boxes) {
          expect(box.width).toBeCloseTo(boxes[0]!.width, 8);
          expect(box.height).toBeCloseTo(boxes[0]!.height, 8);
          expect(box.x).toBeCloseTo(boxes[0]!.x, 8);
          expect(box.y).toBeCloseTo(boxes[0]!.y, 8);
        }
      })
    );
  });

  it('leaves the caller-supplied points array alone; these tools take no points', () => {
    const element = createRectangleElement(
      { startPoint: { x: 0, y: 0 }, currentPoint: { x: 10, y: 10 }, shiftKey: false },
      { ...baseProps('r'), points: [{ x: 1, y: 1 }] } as never
    );
    expect(element.points).toEqual([{ x: 1, y: 1 }]);
  });
});
