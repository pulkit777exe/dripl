import { beforeEach, describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { createMockCanvasContext } from '@dripl/test-utils';

import {
  renderStaticScene,
  resetElementBitmapCacheForTest,
  type StaticSceneViewport,
} from '../staticScene';

/**
 * Frame clipping: elements grouped into a frame (`groupId: "frame-<id>"`,
 * assigned by `applyFrameGrouping` for fully-contained elements) must be
 * clipped to the frame rect, so content cannot spill past the border.
 *
 * jsdom has no canvas backend, so element bitmaps report `failed` here — but
 * the clip is established before any of that, which is exactly what this
 * suite observes through a recording context.
 */

interface RecordedCall {
  method: string;
  args: unknown[];
}

function recordingContext(): { ctx: CanvasRenderingContext2D; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const base = createMockCanvasContext() as unknown as Record<string, unknown>;
  const ctx = new Proxy(base, {
    get(target, property) {
      if (property === '__calls') return calls;
      if (property in target) {
        const value = target[property as string];
        if (typeof value === 'function') {
          return (...args: unknown[]) => {
            calls.push({ method: property as string, args });
            return (value as (...a: unknown[]) => unknown)(...args);
          };
        }
        return value;
      }
      if (typeof property === 'string' && property.startsWith('measure')) {
        return () => ({ width: 0 });
      }
      return (...args: unknown[]) => {
        calls.push({ method: property as string, args });
        return undefined;
      };
    },
    set(target, property, value) {
      (target as Record<string | symbol, unknown>)[property] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function hostCanvas(ctx: CanvasRenderingContext2D): HTMLCanvasElement {
  return {
    getContext: () => ctx,
    width: 800,
    height: 600,
    style: {},
  } as unknown as HTMLCanvasElement;
}

const VIEWPORT: StaticSceneViewport = { x: 0, y: 0, width: 800, height: 600, zoom: 1 };

function rect(id: string, overrides: Partial<DriplElement> = {}): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 0,
    opacity: 1,
    roughness: 0,
    version: 1,
    versionNonce: 1,
    ...overrides,
  } as DriplElement;
}

function render(elements: DriplElement[]): RecordedCall[] {
  const { ctx, calls } = recordingContext();
  renderStaticScene(hostCanvas(ctx), elements, VIEWPORT, {
    gridEnabled: false,
    gridSize: 20,
    zoom: 1,
    theme: 'light',
    dpr: 1,
    elements,
  });
  return calls;
}

const frame = rect('frame-1', { type: 'frame', x: 100, y: 100, width: 200, height: 200 });
const member = () =>
  rect('child', { x: 150, y: 150, width: 50, height: 50, groupId: 'frame-frame-1' });

beforeEach(() => {
  resetElementBitmapCacheForTest();
});

describe('frame clipping', () => {
  it('clips a grouped member to its frame rect', () => {
    const calls = render([frame, member()]);
    const clips = calls.filter(c => c.method === 'clip');
    expect(clips).toHaveLength(1);
    const rects = calls.filter(c => c.method === 'rect');
    // Stroke width 0: the frame box is exactly 100,100 200x200.
    expect(rects).toContainEqual({ method: 'rect', args: [100, 100, 200, 200] });
  });

  it('balances the clip save with a restore', () => {
    const calls = render([frame, member()]);
    const saves = calls.filter(c => c.method === 'save').length;
    const restores = calls.filter(c => c.method === 'restore').length;
    expect(restores).toBe(saves);
    expect(saves).toBeGreaterThan(0);
  });

  it('does not clip the frame itself or ungrouped elements', () => {
    const outsider = rect('outsider', { x: 400, y: 400, width: 50, height: 50 });
    const calls = render([frame, member(), outsider]);
    expect(calls.filter(c => c.method === 'clip')).toHaveLength(1);
  });

  it('does not clip when the frame is absent or deleted', () => {
    expect(render([member()]).filter(c => c.method === 'clip')).toHaveLength(0);
    expect(
      render([{ ...frame, isDeleted: true }, member()]).filter(c => c.method === 'clip')
    ).toHaveLength(0);
  });

  it('does not clip regular (non-frame) groups', () => {
    const grouped = rect('g', { x: 150, y: 150, width: 50, height: 50, groupId: 'some-uuid' });
    const calls = render([frame, grouped]);
    expect(calls.filter(c => c.method === 'clip')).toHaveLength(0);
  });
});
