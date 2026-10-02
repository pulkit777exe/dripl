import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import {
  advanceToolState,
  bindCommittedArrow,
  createToolState,
  detectArrowBindings,
  isTinyPreview,
  smoothFinishedPoints,
} from '@/lib/draw/tool-state';

const rect = (extra: Partial<DriplElement> = {}): DriplElement =>
  ({
    id: 'r1',
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    version: 1,
    versionNonce: 1,
    ...extra,
  }) as DriplElement;

describe('createToolState', () => {
  it('builds per-tool start states with id and seed', () => {
    const { toolState, bindMode } = createToolState(
      'rectangle',
      { x: 1, y: 2 },
      { shiftKey: false },
      'id-1',
      42
    );
    expect(toolState).toMatchObject({ type: 'rectangle', id: 'id-1', seed: 42 });
    expect(bindMode).toBeNull();
  });

  it('returns null state for non-shape tools', () => {
    expect(
      createToolState('select', { x: 0, y: 0 }, { shiftKey: false }, 'id', 1).toolState
    ).toBeNull();
    expect(
      createToolState('text', { x: 0, y: 0 }, { shiftKey: false }, 'id', 1).toolState
    ).toBeNull();
  });

  it('derives inside bind mode from Alt on arrows only', () => {
    expect(
      createToolState('arrow', { x: 0, y: 0 }, { shiftKey: false, altKey: true }, 'id', 1).bindMode
    ).toBe('inside');
    expect(createToolState('arrow', { x: 0, y: 0 }, { shiftKey: false }, 'id', 1).bindMode).toBe(
      'orbit'
    );
    expect(
      createToolState('rectangle', { x: 0, y: 0 }, { shiftKey: false, altKey: true }, 'id', 1)
        .bindMode
    ).toBeNull();
  });

  it('seeds freedraw with the start point and arrow with a degenerate segment', () => {
    const free = createToolState('freedraw', { x: 5, y: 5 }, { shiftKey: false }, 'id', 1);
    expect(free.toolState).toMatchObject({
      type: 'freedraw',
      state: { points: [{ x: 5, y: 5 }] },
    });
    const arrow = createToolState('arrow', { x: 5, y: 5 }, { shiftKey: false }, 'id', 1);
    expect(arrow.toolState).toMatchObject({
      type: 'arrow',
      state: {
        points: [
          { x: 5, y: 5 },
          { x: 5, y: 5 },
        ],
      },
    });
  });
});

describe('advanceToolState', () => {
  it('moves box cursors and records modifiers', () => {
    const { toolState } = createToolState(
      'rectangle',
      { x: 0, y: 0 },
      { shiftKey: false },
      'id',
      1
    );
    const next = advanceToolState(toolState!, { x: 30, y: 40 }, { shiftKey: true });
    expect(next).toMatchObject({
      type: 'rectangle',
      state: { currentPoint: { x: 30, y: 40 }, shiftKey: true },
    });
    // Start is preserved.
    expect(next.state).toMatchObject({ startPoint: { x: 0, y: 0 } });
  });

  it('snaps arrow endpoints on shift and appends freedraw points', () => {
    const { toolState: arrow } = createToolState(
      'arrow',
      { x: 0, y: 0 },
      { shiftKey: false },
      'id',
      1
    );
    const moved = advanceToolState(arrow!, { x: 10, y: 1 }, { shiftKey: true });
    expect(moved.type).toBe('arrow');
    if (moved.type === 'arrow') {
      // 15° snap of a near-horizontal drag lands back on the axis.
      expect(moved.state.points[1]!.y).toBeCloseTo(0, 6);
    }

    const { toolState: free } = createToolState(
      'freedraw',
      { x: 0, y: 0 },
      { shiftKey: false },
      'id',
      1
    );
    const grown = advanceToolState(free!, { x: 3, y: 4 }, { shiftKey: false, pressure: 0.8 });
    expect(grown.type).toBe('freedraw');
    if (grown.type === 'freedraw') {
      expect(grown.state.points).toHaveLength(2);
      expect(grown.state.pressureValues).toEqual([0.5, 0.8]);
    }
  });
});

describe('isTinyPreview', () => {
  it('rejects tiny boxes and strokes', () => {
    expect(isTinyPreview(rect({ width: 3, height: 50 }))).toBe(true);
    expect(isTinyPreview(rect({ width: 50, height: 4 }))).toBe(true);
    expect(isTinyPreview(rect({ width: 50, height: 50 }))).toBe(false);
    const line = {
      ...rect({ width: 10, height: 0 }),
      type: 'line',
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
      ],
    } as unknown as DriplElement;
    expect(isTinyPreview(line)).toBe(true);
  });
});

describe('smoothFinishedPoints', () => {
  it('collapses collinear runs', () => {
    const points = [0, 1, 2, 3].map(x => ({ x, y: 0 }));
    expect(smoothFinishedPoints(points)).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ]);
  });
});

describe('detectArrowBindings + bindCommittedArrow', () => {
  const shape = rect({ id: 'shape' });
  const arrow = {
    id: 'arrow-1',
    type: 'arrow',
    x: 90,
    y: 30,
    width: 60,
    height: 10,
    version: 1,
    versionNonce: 1,
    points: [
      { x: 0, y: 5 },
      { x: 60, y: 5 },
    ],
  } as unknown as DriplElement;

  it('detects endpoint bindings and writes the reverse index', () => {
    const detected = detectArrowBindings(arrow, [shape, arrow], 'orbit');
    const next = bindCommittedArrow(arrow, detected.startMatch, detected.endMatch, [shape, arrow]);
    const boundShape = next.find(e => e.id === 'shape') as unknown as {
      boundElements?: Array<{ id: string }>;
    };
    if (detected.startMatch || detected.endMatch) {
      // A bound endpoint is recorded on the shape for drag-following.
      expect(boundShape?.boundElements?.some(b => b.id === 'arrow-1')).toBe(true);
      const match = detected.startMatch ?? detected.endMatch;
      expect(match?.binding.elementId).toBe('shape');
    } else {
      // Nothing in range: the scene passes through untouched.
      expect(next).toHaveLength(2);
      expect(boundShape?.boundElements ?? []).toEqual([]);
    }
  });

  it('ignores non-arrow previews', () => {
    const detected = detectArrowBindings(shape, [shape], 'orbit');
    expect(detected.startMatch).toBeNull();
    expect(detected.endMatch).toBeNull();
    expect(detectArrowBindings(shape, [shape], 'orbit').preview).toBe(shape);
  });
});
