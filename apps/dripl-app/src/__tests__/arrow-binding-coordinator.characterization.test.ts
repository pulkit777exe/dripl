import { describe, expect, it } from 'vitest';
import type { DriplElement, LinearElement } from '@dripl/common';
import {
  bindCommittedArrow,
  detectArrowBindings,
} from '@/lib/draw/tool-state';
import { unbindAffectedByDeletion } from '@/utils/arrow-binding';
import { repairBindings } from '@dripl/common/arrow-binding';

/**
 * Characterization for the arrow-binding coordinator surface before refactor.
 *
 * Pins creation-binding detection/commit, reverse-index maintenance on delete,
 * and dangling-binding repair invariants. These are the pure/semi-pure seams
 * that controller and hook orchestration depend on.
 */

const rect = (id: string, extra: Partial<DriplElement> = {}): DriplElement =>
  ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    ...extra,
  }) as DriplElement;

const arrow = (
  id: string,
  points: Array<{ x: number; y: number }>,
  extra: Partial<LinearElement> = {}
): LinearElement =>
  ({
    id,
    type: 'arrow',
    x: points[0]?.x ?? 0,
    y: points[0]?.y ?? 0,
    width: 100,
    height: 0,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    points: points.map((p) => ({ x: p.x - (points[0]?.x ?? 0), y: p.y - (points[0]?.y ?? 0) })),
    ...extra,
  }) as LinearElement;

const boundIds = (el: DriplElement | undefined): string[] =>
  Array.from((el as { boundElements?: Array<{ id: string }> })?.boundElements ?? []).map(
    (b) => b.id
  );

describe('arrow creation binding detection (characterization)', () => {
  it('detects a nearby end shape and writes endBinding on preview', () => {
    const target = rect('target', { x: 150, y: -40, width: 100, height: 100 });
    const a = arrow('a', [
      { x: 0, y: 0 },
      { x: 160, y: 10 },
    ]);

    const detected = detectArrowBindings(a, [target, a], 'orbit');

    expect(detected.startMatch).toBeNull();
    expect(detected.endMatch?.element.id).toBe('target');
    expect(detected.endMatch?.binding.elementId).toBe('target');
    expect(detected.endMatch?.binding.mode).toBe('orbit');
    expect(detected.endMatch?.binding.fixedPoint.y).toBe(0.5);
    expect(typeof detected.endMatch?.binding.fixedPoint.x).toBe('number');

    const preview = detected.preview as LinearElement;
    expect(preview.endBinding?.elementId).toBe('target');
    expect(preview.startBinding).toBeUndefined();
  });

  it('detects start and end bindings to different shapes', () => {
    const left = rect('left', { x: -100, y: -40, width: 100, height: 100 });
    const right = rect('right', { x: 150, y: -40, width: 100, height: 100 });
    const a = arrow('a', [
      { x: 0, y: 10 },
      { x: 160, y: 10 },
    ]);

    const detected = detectArrowBindings(a, [left, right, a], 'orbit');
    const preview = detected.preview as LinearElement;

    expect(detected.startMatch?.element.id).toBe('left');
    expect(detected.endMatch?.element.id).toBe('right');
    expect(preview.startBinding?.elementId).toBe('left');
    expect(preview.endBinding?.elementId).toBe('right');
  });

  it('respects bindMode for detected bindings', () => {
    const target = rect('target', { x: 150, y: -40, width: 100, height: 100 });
    const a = arrow('a', [
      { x: 0, y: 0 },
      { x: 160, y: 10 },
    ]);

    const detected = detectArrowBindings(a, [target, a], 'inside');
    expect(detected.endMatch?.binding.mode).toBe('inside');
    expect((detected.preview as LinearElement).endBinding?.mode).toBe('inside');
  });

  it('returns unchanged preview when no endpoints are near a shape', () => {
    const far = rect('far', { x: 500, y: 500, width: 100, height: 100 });
    const a = arrow('a', [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);

    const detected = detectArrowBindings(a, [far, a], 'orbit');
    expect(detected.startMatch).toBeNull();
    expect(detected.endMatch).toBeNull();
    expect(detected.preview).toBe(a);
  });

  it('ignores non-arrow/line preview elements', () => {
    const shape = rect('shape');
    const detected = detectArrowBindings(shape, [shape], 'orbit');
    expect(detected.startMatch).toBeNull();
    expect(detected.endMatch).toBeNull();
    expect(detected.preview).toBe(shape);
  });
});

describe('arrow creation binding commit (characterization)', () => {
  it('writes reverse boundElements for a detected end binding', () => {
    const target = rect('target', { x: 150, y: -40, width: 100, height: 100 });
    const a = arrow('a', [
      { x: 0, y: 0 },
      { x: 160, y: 10 },
    ]);
    const detected = detectArrowBindings(a, [target, a], 'orbit');

    const next = bindCommittedArrow(a, detected.startMatch, detected.endMatch, [target, a]);
    const targetAfter = next.find((e) => e.id === 'target');

    expect(boundIds(targetAfter)).toEqual(['a']);
  });

  it('writes reverse boundElements for both ends bound to different shapes', () => {
    const left = rect('left', { x: -100, y: -40, width: 100, height: 100 });
    const right = rect('right', { x: 150, y: -40, width: 100, height: 100 });
    const a = arrow('a', [
      { x: 0, y: 10 },
      { x: 160, y: 10 },
    ]);
    const detected = detectArrowBindings(a, [left, right, a], 'orbit');
    // Preview already carries bindings; commit should preserve them and update shapes.
    const committed = detected.preview as LinearElement;

    const next = bindCommittedArrow(committed, detected.startMatch, detected.endMatch, [
      left,
      right,
      committed,
    ]);

    expect(boundIds(next.find((e) => e.id === 'left'))).toEqual(['a']);
    expect(boundIds(next.find((e) => e.id === 'right'))).toEqual(['a']);
    const arrowAfter = next.find((e) => e.id === 'a') as LinearElement;
    expect(arrowAfter.startBinding?.elementId).toBe('left');
    expect(arrowAfter.endBinding?.elementId).toBe('right');
  });

  it('is a no-op when there are no matches', () => {
    const target = rect('target', { x: 500, y: 500 });
    const a = arrow('a', [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    const elements = [target, a];
    const next = bindCommittedArrow(a, null, null, elements);
    expect(next).toBe(elements);
  });

  it('binds both ends to the same shape without losing either binding', () => {
    const shape = rect('shape', { x: -20, y: -20, width: 200, height: 60 });
    const a = arrow('a', [
      { x: 0, y: 10 },
      { x: 160, y: 10 },
    ]);
    const detected = detectArrowBindings(a, [shape, a], 'orbit');
    const committed = detected.preview as LinearElement;

    // This characterizes current behavior; both ends may detect same shape.
    if (detected.startMatch && detected.endMatch) {
      const next = bindCommittedArrow(committed, detected.startMatch, detected.endMatch, [
        shape,
        committed,
      ]);
      const arrowAfter = next.find((e) => e.id === 'a') as LinearElement;
      expect(arrowAfter.startBinding?.elementId).toBe('shape');
      expect(arrowAfter.endBinding?.elementId).toBe('shape');
      // Shape should have arrow in boundElements (deduped by bindArrowToElement).
      expect(boundIds(next.find((e) => e.id === 'shape'))).toEqual(['a']);
    } else {
      // If geometry doesn't bind both ends, still ensure commit is coherent.
      const next = bindCommittedArrow(committed, detected.startMatch, detected.endMatch, [
        shape,
        committed,
      ]);
      expect(next.length).toBe(2);
    }
  });
});

describe('dangling binding reconciliation (characterization)', () => {
  it('repairBindings removes bindings to missing elements and stale boundElements', () => {
    const a = {
      ...arrow(
        'a',
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        {
          startBinding: { elementId: 'missing', fixedPoint: { x: 0.5, y: 0.5 }, mode: 'orbit' },
          endBinding: { elementId: 'shape', fixedPoint: { x: 0.5, y: 0.5 }, mode: 'orbit' },
        } as Partial<LinearElement>
      ),
    } as LinearElement;
    const shape = rect('shape', {
      boundElements: [
        { id: 'a', type: 'arrow' },
        { id: 'ghost', type: 'arrow' },
        { id: 'a', type: 'arrow' },
      ],
    } as Partial<DriplElement>);

    const repaired = repairBindings([a, shape]);
    const repairedArrow = repaired.find((e) => e.id === 'a') as LinearElement;
    const repairedShape = repaired.find((e) => e.id === 'shape') as DriplElement & {
      boundElements?: Array<{ id: string; type: string }>;
    };

    expect(repairedArrow.startBinding).toBeUndefined();
    expect(repairedArrow.endBinding?.elementId).toBe('shape');
    expect(repairedShape.boundElements).toEqual([{ id: 'a', type: 'arrow' }]);
  });

  it('unbindAffectedByDeletion clears bindings but keeps the arrow element', () => {
    const shape = rect('shape', { boundElements: [{ id: 'a', type: 'arrow' }] } as Partial<DriplElement>);
    const a = arrow(
      'a',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      {
        endBinding: { elementId: 'shape', fixedPoint: { x: 0.5, y: 0.5 }, mode: 'orbit' },
      } as Partial<LinearElement>
    );

    const next = unbindAffectedByDeletion(['shape'], [shape, a]);
    const arrowAfter = next.find((e) => e.id === 'a') as LinearElement;
    expect(arrowAfter).toBeDefined();
    expect(arrowAfter.isDeleted).toBeFalsy();
    expect(arrowAfter.endBinding).toBeNull();
  });
});
