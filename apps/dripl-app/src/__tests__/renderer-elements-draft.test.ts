import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { renderElement } from '@/renderer/elements';
import { createRecordingContext, type RecordingContext } from './helpers/canvas-recorder';
import { bareElement, linear } from './helpers/elements';

/**
 * Draft-layer delegation (Excalidraw `renderNewElementScene` parity).
 *
 * When the context belongs to a real canvas, shape previews must go through
 * the shared Rough.js draft path — same generator, options and seed as the
 * committed bitmap — so committing changes nothing visually. The shared
 * module is mocked here so the test pins the *dispatch contract* (which types
 * delegate, what happens without a canvas or when Rough.js fails) while the
 * real Rough.js mapping stays covered in `@dripl/element`.
 */

const draftState = vi.hoisted(() => ({
  draftCalls: [] as DriplElement[],
  canvasToReturn: 'stub' as 'stub' | null,
  throwOnDraw: false,
}));

vi.mock('@dripl/element/image-cache', () => ({
  imageCache: {
    get: () => undefined,
    load: () => Promise.resolve(undefined),
  },
}));

vi.mock('@dripl/element/rough-renderer', () => ({
  createRoughCanvas: () => draftState.canvasToReturn,
  renderDraftElement: (_rc: unknown, _ctx: unknown, element: DriplElement) => {
    if (draftState.throwOnDraw) throw new Error('rough failed');
    draftState.draftCalls.push(element);
  },
}));

/** Recording context WITH a canvas, i.e. the production configuration. */
function ctxWithCanvas(): RecordingContext {
  const rec = createRecordingContext();
  (rec.ctx as unknown as { canvas: object }).canvas = {};
  return rec;
}

let rec: RecordingContext;
beforeEach(() => {
  rec = ctxWithCanvas();
  draftState.draftCalls.length = 0;
  draftState.canvasToReturn = 'stub';
  draftState.throwOnDraw = false;
});

describe('draft delegation with a real canvas', () => {
  it.each(['rectangle', 'ellipse', 'diamond', 'line', 'arrow', 'freedraw'] as const)(
    'routes %s through the shared Rough.js draft path, not the legacy path',
    type => {
      const element =
        type === 'line' || type === 'arrow' || type === 'freedraw'
          ? linear('a', type, [
              { x: 0, y: 0 },
              { x: 10, y: 10 },
            ])
          : bareElement('a', { type });
      renderElement(rec.ctx, element, 1);
      expect(draftState.draftCalls).toHaveLength(1);
      expect(draftState.draftCalls[0]).toBe(element);
      // Legacy canvas geometry must not be emitted alongside the Rough.js draw.
      expect(rec.countOf('rect')).toBe(0);
      expect(rec.countOf('ellipse')).toBe(0);
    }
  );

  it.each(['text', 'image', 'frame', 'embed'] as const)(
    'keeps %s on the legacy path (they do not use Rough.js)',
    type => {
      const element = bareElement('a', {
        type,
        text: 'hi',
        src: 'https://x.dev/a.png',
        url: 'https://x.dev',
      } as never);
      renderElement(rec.ctx, element, 1);
      expect(draftState.draftCalls).toHaveLength(0);
    }
  );

  it('draws nothing for a deleted element, not even a draft call', () => {
    renderElement(rec.ctx, bareElement('a', { isDeleted: true }), 1);
    expect(draftState.draftCalls).toHaveLength(0);
    expect(rec.ops).toHaveLength(0);
  });

  it('falls back to the legacy rectangle when Rough.js cannot bind', () => {
    draftState.canvasToReturn = null;
    renderElement(rec.ctx, bareElement('a', { x: 3, y: 4, width: 5, height: 6, roughness: 0 }), 1);
    expect(draftState.draftCalls).toHaveLength(0);
    expect(rec.argLists('rect')).toEqual([[3, 4, 5, 6]]);
  });

  it('falls back to the legacy path when the draft draw throws', () => {
    draftState.throwOnDraw = true;
    renderElement(rec.ctx, bareElement('a', { x: 3, y: 4, width: 5, height: 6 }), 1);
    expect(rec.countOf('rect')).toBeGreaterThan(0);
  });

  it('still falls back for a context without a canvas (headless/unit-test env)', () => {
    const headless = createRecordingContext();
    renderElement(headless.ctx, bareElement('a', { x: 1, y: 2, width: 3, height: 4 }), 1);
    expect(draftState.draftCalls).toHaveLength(0);
    expect(headless.countOf('rect')).toBeGreaterThan(0);
  });
});
