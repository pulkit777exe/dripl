import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { createMockCanvasContext } from '@dripl/test-utils';

import { createRoughCanvas } from '../rough-renderer';
import {
  renderStaticScene,
  resetElementBitmapCacheForTest,
  type StaticSceneFrameStats,
} from '../staticScene';

function arrow(overrides: Partial<DriplElement> = {}): DriplElement {
  return {
    id: 'arrow-1',
    type: 'arrow',
    x: 10,
    y: 10,
    width: 100,
    height: 0,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 0,
    version: 1,
    versionNonce: 1,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    arrowHeads: { start: 'none', end: 'none' },
    ...overrides,
  } as DriplElement;
}

function label(overrides: Partial<DriplElement> = {}): DriplElement {
  return {
    id: 'label-1',
    type: 'text',
    x: 40,
    y: 4,
    width: 40,
    height: 16,
    text: 'hi',
    originalText: 'hi',
    fontSize: 12,
    fontFamily: 'Arial',
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 1,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    ...overrides,
  } as DriplElement;
}

/**
 * A context tolerant of any method Rough.js reaches for, recording the transform
 * calls so a rotation applied at blit time can be told apart from one baked into
 * the bitmap.
 */
function recordingCanvas(): { canvas: HTMLCanvasElement; ops: string[]; args: unknown[][] } {
  const ops: string[] = [];
  const args: unknown[][] = [];
  const base = createMockCanvasContext() as unknown as Record<string, unknown>;
  const ctx = new Proxy(base, {
    get(target, property) {
      if (property === 'translate' || property === 'rotate' || property === 'drawImage') {
        return (...values: unknown[]) => {
          ops.push(property);
          args.push(values);
        };
      }
      if (property in target) return target[property as string];
      return () => undefined;
    },
  }) as unknown as CanvasRenderingContext2D;

  return {
    canvas: {
      getContext: () => ctx,
      width: 800,
      height: 600,
      style: {},
    } as unknown as HTMLCanvasElement,
    ops,
    args,
  };
}

function renderFrame(elements: DriplElement[]): StaticSceneFrameStats {
  const { canvas } = recordingCanvas();
  let stats: StaticSceneFrameStats | null = null;
  renderStaticScene(
    canvas,
    elements,
    { x: 0, y: 0, width: 800, height: 600, zoom: 1 },
    {
      gridEnabled: false,
      gridSize: 20,
      zoom: 1,
      theme: 'light',
      dpr: 1,
      elements,
      onFrameStats: s => {
        stats = s;
      },
    }
  );
  return stats as unknown as StaticSceneFrameStats;
}

beforeEach(() => {
  resetElementBitmapCacheForTest();

  // jsdom has no `OffscreenCanvas` and no canvas backend, so the per-element
  // bitmap would be allocated through `document.createElement('canvas')`, whose
  // `getContext` returns null and fails the whole element. Stubbing the offscreen
  // class with a tolerant context is what lets a bitmap actually be produced.
  class StubOffscreenCanvas {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext(): CanvasRenderingContext2D {
      const base = createMockCanvasContext() as unknown as Record<string, unknown>;
      return new Proxy(base, {
        get(target, property) {
          if (property in target) return target[property as string];
          return () => undefined;
        },
      }) as unknown as CanvasRenderingContext2D;
    }
  }
  vi.stubGlobal('OffscreenCanvas', StubOffscreenCanvas);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('dependency recording through a real render', () => {
  // `dependencyVersions` is the producer half of the lazy invalidation: it
  // records which versions the owner's bitmap embedded. Tested end-to-end
  // rather than through the `...ForTest` handle, because the two halves only
  // agree if they are wired together the way the render path wires them.

  it('reuses an owner bitmap when nothing it depends on moved', () => {
    const owner = arrow({ labelId: 'label-1' });
    const scene = [owner, label()];

    const first = renderFrame(scene);
    expect(first.bitmapsGenerated).toBe(2);

    const second = renderFrame(scene);
    // Both the label and the arrow that cuts a hole for it are reused, which
    // means the arrow found its recorded label version and accepted it.
    expect(second.bitmapsGenerated).toBe(0);
    expect(second.bitmapsReused).toBe(2);
  });

  it('rebuilds the owner when its label moves, and only the owner', () => {
    const owner = arrow({ labelId: 'label-1' });
    const scene = [owner, label()];

    expect(renderFrame(scene).bitmapsGenerated).toBe(2);

    // The label is edited. It is a different element object, so its own bitmap
    // is a cache miss; the arrow's bitmap is a hit on its own version but must
    // miss on the recorded dependency.
    const movedLabel = { ...label(), version: 2 };
    const nextScene = [owner, movedLabel];
    const stats = renderFrame(nextScene);

    expect(stats.bitmapsGenerated).toBe(2);
  });

  it('records a missing dependency as -1 so adding it later forces a rebuild', () => {
    // The owner references a label that is not in the scene yet, so nothing can
    // be recorded against a real version. Once the label appears, the owner's
    // bitmap must be rebuilt rather than reused with no cutout.
    const owner = arrow({ labelId: 'label-1' });
    const withoutLabel = renderFrame([owner]);
    expect(withoutLabel.bitmapsGenerated).toBe(1);

    const withLabel = renderFrame([owner, label()]);
    expect(withLabel.bitmapsGenerated).toBe(2);
  });

  it('does not record anything for an element with no dependencies', () => {
    const plain = arrow();
    expect(renderFrame([plain]).bitmapsGenerated).toBe(1);
    expect(renderFrame([plain]).bitmapsGenerated).toBe(0);
  });
});

describe('rotation is applied at blit time, not baked into the bitmap', () => {
  it('rotates the cached bitmap about the element centre', () => {
    const rotated = arrow({ x: 20, y: 30, width: 100, height: 50, angle: Math.PI / 3 });
    const { canvas, ops, args } = recordingCanvas();
    renderStaticScene(
      canvas,
      [rotated],
      { x: 0, y: 0, width: 800, height: 600, zoom: 1 },
      {
        gridEnabled: false,
        gridSize: 20,
        zoom: 1,
        theme: 'light',
        dpr: 1,
        elements: [rotated],
      }
    );

    // The camera bootstrap also translates; the rotation is identified by the
    // rotate call itself.
    expect(ops).toContain('rotate');
    const rotateIndex = ops.indexOf('rotate');
    expect(args[rotateIndex]?.[0]).toBeCloseTo(Math.PI / 3, 9);

    // Immediately preceded and followed by a translate to the centre and back,
    // which is the rotate-about-a-point idiom.
    const before = args[rotateIndex - 1] as number[];
    const after = args[rotateIndex + 1] as number[];
    expect(before?.[0]).toBeCloseTo(70, 6);
    expect(before?.[1]).toBeCloseTo(55, 6);
    expect(after?.[0]).toBeCloseTo(-70, 6);
    expect(after?.[1]).toBeCloseTo(-55, 6);
  });

  it('does not rotate an element with no angle', () => {
    const { canvas, ops } = recordingCanvas();
    renderStaticScene(
      canvas,
      [arrow()],
      { x: 0, y: 0, width: 800, height: 600, zoom: 1 },
      {
        gridEnabled: false,
        gridSize: 20,
        zoom: 1,
        theme: 'light',
        dpr: 1,
        elements: [arrow()],
      }
    );
    expect(ops).not.toContain('rotate');
  });
});

describe('createRoughCanvas', () => {
  it('reports failure instead of throwing when Rough.js cannot bind a canvas', () => {
    // Every element bitmap goes through this, and `generateElementCanvas` does
    // not guard the call, so a throw here would take down the whole frame rather
    // than one element.
    const errors: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });

    expect(createRoughCanvas(null as unknown as HTMLCanvasElement)).toBeNull();
    expect(errors).toHaveLength(1);
    // The payload is a structured record, not a bare string.
    expect(String(errors[0]?.[0])).toContain('rough_canvas_init_failed');
  });

  it('returns a canvas for a usable element', () => {
    const canvas = { getContext: () => createMockCanvasContext() } as unknown as HTMLCanvasElement;
    expect(createRoughCanvas(canvas)).not.toBeNull();
  });
});
