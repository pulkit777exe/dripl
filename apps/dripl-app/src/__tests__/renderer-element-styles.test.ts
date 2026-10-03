import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { DriplElement, Point } from '@dripl/common';
import {
  applyStrokeAndFill,
  getFillColor,
  getOpacity,
  getPathPoints,
  getRoughPasses,
  getRoughness,
  getStrokeColor,
  getStrokeWidth,
  rotateAroundElementCenter,
  roughJitterOffset,
  strokeCurrentPath,
} from '@/renderer/elementStyles';
import { createRecordingContext, translates, rotates } from './helpers/canvas-recorder';
import { bareElement } from './helpers/elements';

/**
 * `renderer/elementStyles.ts` is the single place every shape renderer reads
 * stroke/fill/width/opacity/roughness and every hand-drawn pass goes through,
 * so a defect here is a defect on every element type at once.
 */

const coord = fc.double({ min: -10_000, max: 10_000, noNaN: true });

describe('getStrokeColor', () => {
  it('defaults to black when the element has no stroke colour', () => {
    expect(getStrokeColor(bareElement('a'))).toBe('#000000');
  });

  it('returns the element colour when set', () => {
    expect(getStrokeColor(bareElement('a', { strokeColor: '#ff0000' }))).toBe('#ff0000');
  });

  it('is nullish-coalescing, so an empty string is preserved rather than defaulted', () => {
    // `??` not `||`: an intentionally blank stroke must survive to the canvas.
    expect(getStrokeColor(bareElement('a', { strokeColor: '' }))).toBe('');
  });

  it('defaults an explicit undefined back to black', () => {
    expect(getStrokeColor(bareElement('a', { strokeColor: undefined }))).toBe('#000000');
  });
});

describe('getFillColor', () => {
  it('prefers fillColor when it is a string', () => {
    expect(
      getFillColor(bareElement('a', { fillColor: '#00ff00', backgroundColor: '#0000ff' }))
    ).toBe('#00ff00');
  });

  it('falls back to backgroundColor when fillColor is absent', () => {
    expect(getFillColor(bareElement('a', { backgroundColor: '#0000ff' }))).toBe('#0000ff');
  });

  it('falls back to backgroundColor when fillColor is present but not a string', () => {
    // The schema types these as strings, but a scene from an older client can
    // carry anything; a number must not be handed to ctx.fillStyle.
    expect(
      getFillColor(bareElement('a', { fillColor: 7, backgroundColor: '#0000ff' } as never))
    ).toBe('#0000ff');
  });

  it('is transparent when neither field is present', () => {
    expect(getFillColor(bareElement('a'))).toBe('transparent');
  });

  it('treats the literal string "transparent" as no fill, which every shape renderer keys on', () => {
    expect(getFillColor(bareElement('a', { fillColor: 'transparent' }))).toBe('transparent');
    expect(getFillColor(bareElement('a', { backgroundColor: 'transparent' }))).toBe('transparent');
  });
});

describe('getStrokeWidth', () => {
  it('defaults to 2', () => {
    expect(getStrokeWidth(bareElement('a'))).toBe(2);
  });

  it('clamps a zero width up to the 0.5 hairline instead of drawing nothing', () => {
    expect(getStrokeWidth(bareElement('a', { strokeWidth: 0 }))).toBe(0.5);
  });

  it('clamps a negative width to the same hairline', () => {
    expect(getStrokeWidth(bareElement('a', { strokeWidth: -12 }))).toBe(0.5);
  });

  it('passes an in-range width through unchanged', () => {
    expect(getStrokeWidth(bareElement('a', { strokeWidth: 7 }))).toBe(7);
  });

  it('does not clamp the top end', () => {
    expect(getStrokeWidth(bareElement('a', { strokeWidth: 400 }))).toBe(400);
  });
});

describe('getOpacity', () => {
  it('defaults to fully opaque', () => {
    expect(getOpacity(bareElement('a'))).toBe(1);
  });

  it('clamps above 1 down to 1', () => {
    expect(getOpacity(bareElement('a', { opacity: 4 }))).toBe(1);
  });

  it('clamps below 0 up to 0', () => {
    expect(getOpacity(bareElement('a', { opacity: -0.5 }))).toBe(0);
  });

  it('passes an in-range opacity through', () => {
    expect(getOpacity(bareElement('a', { opacity: 0.35 }))).toBe(0.35);
  });
});

describe('getRoughness', () => {
  it('defaults to 1', () => {
    expect(getRoughness(bareElement('a'))).toBe(1);
  });

  it('clamps to the documented 0..2 band', () => {
    expect(getRoughness(bareElement('a', { roughness: -3 }))).toBe(0);
    expect(getRoughness(bareElement('a', { roughness: 9 }))).toBe(2);
  });

  it('passes an in-range roughness through', () => {
    expect(getRoughness(bareElement('a', { roughness: 0.5 }))).toBe(0.5);
  });
});

describe('getRoughPasses', () => {
  it('collapses to a single clean stroke at or below roughness 0.1', () => {
    expect(getRoughPasses(bareElement('a', { roughness: 0 }))).toBe(1);
    expect(getRoughPasses(bareElement('a', { roughness: 0.1 }))).toBe(1);
  });

  it('grows with roughness and saturates at 5', () => {
    // 1 + round(roughness * 2), capped at 5.
    expect(getRoughPasses(bareElement('a', { roughness: 0.25 }))).toBe(2);
    expect(getRoughPasses(bareElement('a', { roughness: 0.5 }))).toBe(2);
    expect(getRoughPasses(bareElement('a', { roughness: 1 }))).toBe(3);
    expect(getRoughPasses(bareElement('a', { roughness: 1.5 }))).toBe(4);
    expect(getRoughPasses(bareElement('a', { roughness: 2 }))).toBe(5);
  });

  it('never asks for zero passes, which would make the element invisible', () => {
    // A pass count of 0 means strokeCurrentPath's loop body never runs and the
    // element has no outline at all. Assert the floor for every representable
    // roughness, including the clamped extremes.
    fc.assert(
      fc.property(fc.double({ min: -100, max: 100, noNaN: true }), roughness => {
        const passes = getRoughPasses(bareElement('a', { roughness }));
        expect(passes).toBeGreaterThanOrEqual(1);
        expect(passes).toBeLessThanOrEqual(5);
        expect(Number.isInteger(passes)).toBe(true);
      }),
      { numRuns: 500 }
    );
  });
});

describe('roughJitterOffset', () => {
  it('is exactly zero on the first pass, so pass 0 is the un-jittered outline', () => {
    fc.assert(
      fc.property(fc.double({ min: -100, max: 100, noNaN: true }), zoom => {
        expect(roughJitterOffset(0, zoom)).toBe(0);
      })
    );
  });

  it('alternates sign by pass parity', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.double({ min: 0.05, max: 8, noNaN: true }),
        (pass, zoom) => {
          const offset = roughJitterOffset(pass, zoom);
          if (pass % 2 === 0) expect(offset).toBeGreaterThan(0);
          else expect(offset).toBeLessThan(0);
        }
      )
    );
  });

  it('increases in magnitude with the pass index', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.double({ min: 0.05, max: 8, noNaN: true }),
        (pass, zoom) => {
          expect(Math.abs(roughJitterOffset(pass + 1, zoom))).toBeGreaterThan(
            Math.abs(roughJitterOffset(pass, zoom))
          );
        }
      )
    );
  });

  it('shrinks as zoom grows, so the wobble is a constant size on screen', () => {
    // Amplitude is 0.7 / zoom, so doubling the zoom halves the world-space
    // offset and the stroke stays the same size in pixels.
    expect(Math.abs(roughJitterOffset(1, 2))).toBeCloseTo(
      2 * Math.abs(roughJitterOffset(1, 4)),
      10
    );
  });

  it('clamps zoom at 0.1 so a fully zoomed-out viewport cannot produce Infinity', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), pass => {
        const floored = roughJitterOffset(pass, 0.1);
        expect(floored).toBe(roughJitterOffset(pass, 0.05));
        expect(floored).toBe(roughJitterOffset(pass, 0));
        expect(floored).toBe(roughJitterOffset(pass, -3));
        expect(Number.isFinite(floored)).toBe(true);
      })
    );
  });
});

describe('getPathPoints', () => {
  it('returns an empty array when the element has no points array', () => {
    expect(getPathPoints(bareElement('a'))).toEqual([]);
  });

  it('returns an empty array when points is not an array', () => {
    expect(getPathPoints(bareElement('a', { points: 'nope' } as never))).toEqual([]);
  });

  it('translates stored relative points into world coordinates', () => {
    const element = bareElement('a', {
      type: 'line',
      x: 30,
      y: 40,
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 7 },
      ],
    });
    expect(getPathPoints(element)).toEqual([
      { x: 30, y: 40 },
      { x: 35, y: 47 },
    ]);
  });

  it('drops entries that are not finite x/y pairs rather than emitting NaN coordinates', () => {
    // `PointSchema` in @dripl/common is `z.number().finite()`, so a NaN
    // coordinate is not a valid Point and must not survive into a canvas path,
    // where it would be silently ignored and break the rest of the path.
    const element = bareElement('a', {
      x: 10,
      y: 10,
      points: [
        { x: 0, y: 0 },
        null,
        { x: Number.NaN, y: 1 },
        { x: 1, y: Number.POSITIVE_INFINITY },
        { x: 1, y: 'two' },
        { x: 2, y: 2 },
      ],
    } as never);
    expect(getPathPoints(element)).toEqual([
      { x: 10, y: 10 },
      { x: 12, y: 12 },
    ]);
  });

  it('produces only finite coordinates for arbitrary well-formed input', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ x: coord, y: coord }), { minLength: 0, maxLength: 12 }),
        pts => {
          for (const point of getPathPoints(bareElement('a', { x: 3, y: -7, points: pts }))) {
            expect(Number.isFinite(point.x)).toBe(true);
            expect(Number.isFinite(point.y)).toBe(true);
          }
        }
      )
    );
  });

  it('returns fresh objects, so a caller cannot mutate the element through the result', () => {
    const element = bareElement('a', { x: 0, y: 0, points: [{ x: 1, y: 2 }] });
    const points = getPathPoints(element);
    points[0]!.x = 999;
    expect((element.points as Point[])[0]!.x).toBe(1);
  });

  it('round-trips: world point minus the element origin is the stored relative point', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ x: coord, y: coord }), { minLength: 1, maxLength: 12 }),
        pts => {
          const element = bareElement('a', { x: 137, y: -42, points: pts });
          const world = getPathPoints(element);
          expect(world).toHaveLength(pts.length);
          world.forEach((point, i) => {
            expect(point.x).toBe(pts[i]!.x + 137);
            expect(point.y).toBe(pts[i]!.y - 42);
          });
        }
      )
    );
  });
});

describe('applyStrokeAndFill', () => {
  it('writes all five style fields the shape renderers depend on', () => {
    const rec = createRecordingContext();
    applyStrokeAndFill(
      rec.ctx,
      bareElement('a', {
        strokeColor: '#123456',
        fillColor: '#abcdef',
        strokeWidth: 5,
      })
    );
    const style = rec.style();
    expect(style.strokeStyle).toBe('#123456');
    expect(style.fillStyle).toBe('#abcdef');
    expect(style.lineWidth).toBe(5);
    expect(style.lineCap).toBe('round');
    expect(style.lineJoin).toBe('round');
  });

  it('applies the same clamped values the individual getters report', () => {
    const rec = createRecordingContext();
    const element = bareElement('a', { strokeWidth: 0, fillColor: 'transparent' });
    applyStrokeAndFill(rec.ctx, element);
    expect(rec.style().lineWidth).toBe(getStrokeWidth(element));
    expect(rec.style().fillStyle).toBe(getFillColor(element));
    expect(rec.style().strokeStyle).toBe(getStrokeColor(element));
  });
});

describe('strokeCurrentPath', () => {
  it('draws exactly getRoughPasses strokes, each in its own path', () => {
    const rec = createRecordingContext();
    const element = bareElement('a', { roughness: 2 });
    strokeCurrentPath(rec.ctx, element, () => {}, 1);
    expect(rec.countOf('beginPath')).toBe(5);
    expect(rec.countOf('stroke')).toBe(5);
  });

  it('rebuilds the path on every pass so jitter does not accumulate', () => {
    const rec = createRecordingContext();
    strokeCurrentPath(rec.ctx, bareElement('a', { roughness: 1 }), () => {}, 1);
    expect(rec.countOf('beginPath')).toBe(3);
    // Each beginPath must be immediately followed by exactly one draw + stroke.
    expect(rec.ops.map(op => op.method)).toEqual([
      'beginPath',
      'stroke',
      'beginPath',
      'stroke',
      'beginPath',
      'stroke',
    ]);
  });

  it('offsets y by the negation of x, so the wobble is a constant diagonal', () => {
    const seen: Array<[number, number]> = [];
    const rec = createRecordingContext();
    strokeCurrentPath(
      rec.ctx,
      bareElement('a', { roughness: 1 }),
      (offsetX, offsetY) => seen.push([offsetX, offsetY]),
      1
    );
    seen.forEach(([offsetX, offsetY]) => {
      expect(offsetY).toBe(-offsetX);
    });
    // Pass 0 is the un-jittered outline; `-offset` makes its y component
    // negative zero, which is numerically 0.
    expect(Math.abs(seen[0]![0])).toBe(0);
    expect(Math.abs(seen[0]![1])).toBe(0);
  });

  it('hands each pass the jitter offset for its own pass index', () => {
    const seen: number[] = [];
    const rec = createRecordingContext();
    strokeCurrentPath(
      rec.ctx,
      bareElement('a', { roughness: 2 }),
      offsetX => seen.push(offsetX),
      1
    );
    for (let pass = 0; pass < seen.length; pass += 1) {
      expect(seen[pass]).toBe(roughJitterOffset(pass, 1));
    }
  });
});

describe('rotateAroundElementCenter', () => {
  it('does not touch the transform when there is no rotation', () => {
    const rec = createRecordingContext();
    rotateAroundElementCenter(rec.ctx, bareElement('a'));
    expect(rec.ops).toHaveLength(0);
  });

  it('does not touch the transform for an explicit zero angle', () => {
    const rec = createRecordingContext();
    rotateAroundElementCenter(rec.ctx, bareElement('a', { angle: 0 }));
    expect(rec.ops).toHaveLength(0);
  });

  it('rotates about the element centre and translates back, in that order', () => {
    const rec = createRecordingContext();
    // x=10 y=20 w=30 h=40 -> centre (25, 40)
    rotateAroundElementCenter(
      rec.ctx,
      bareElement('a', { x: 10, y: 20, width: 30, height: 40, angle: 0.5 })
    );
    expect(rec.ops.map(op => op.method)).toEqual(['translate', 'rotate', 'translate']);
    expect(translates(rec)).toEqual([
      [25, 40],
      [-25, -40],
    ]);
    expect(rotates(rec)).toEqual([0.5]);
  });

  it('uses the angle verbatim, in radians, without converting degrees', () => {
    const rec = createRecordingContext();
    rotateAroundElementCenter(rec.ctx, bareElement('a', { angle: Math.PI / 2 }));
    expect(rotates(rec)).toEqual([Math.PI / 2]);
  });
});

describe('module-wide clamping invariants', () => {
  it('holds for arbitrary element payloads, which is what a scene import can produce', () => {
    fc.assert(
      fc.property(
        fc.record({
          strokeWidth: fc.double({ min: -50, max: 50, noNaN: true }),
          opacity: fc.double({ min: -5, max: 5, noNaN: true }),
          roughness: fc.double({ min: -5, max: 5, noNaN: true }),
        }),
        fields => {
          const element: DriplElement = bareElement('a', fields);
          expect(getStrokeWidth(element)).toBeGreaterThanOrEqual(0.5);
          expect(getOpacity(element)).toBeGreaterThanOrEqual(0);
          expect(getOpacity(element)).toBeLessThanOrEqual(1);
          expect(getRoughness(element)).toBeGreaterThanOrEqual(0);
          expect(getRoughness(element)).toBeLessThanOrEqual(2);
          expect(getStrokeColor(element)).toBeTypeOf('string');
          expect(getFillColor(element)).toBeTypeOf('string');
        }
      ),
      { numRuns: 300 }
    );
  });
});
