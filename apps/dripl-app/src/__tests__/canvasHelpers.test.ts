import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyStrokeStyle,
  computeBoundingBox,
  createCanvas,
  downloadBlob,
} from '../../utils/canvas-helpers';
import { createRecordingContext } from './helpers/canvas-recorder';

/**
 * `canvas-helpers.ts` is four small pure helpers, but every one of them is a
 * silent failure when it is wrong: a wrong dash pattern makes a "dashed" stroke
 * render solid, an inverted min/max makes marquee selection wrap around the
 * origin, and a `downloadBlob` that removes the anchor before clicking it
 * downloads nothing at all. Nothing here renders, so the assertions are on the
 * exact values passed to the canvas / DOM APIs.
 */

describe('applyStrokeStyle', () => {
  // Regression: the two non-solid patterns are what distinguishes a dashed
  // stroke from a dotted one. Collapsing either branch onto the other makes two
  // visually distinct element styles render identically, and there is no
  // browser output to notice -- only the setLineDash argument differs.
  it('maps dashed and dotted to two different dash patterns', () => {
    const dashed = createRecordingContext();
    applyStrokeStyle(dashed.ctx, 'dashed');
    const dotted = createRecordingContext();
    applyStrokeStyle(dotted.ctx, 'dotted');

    expect(dashed.style().lineDash).toEqual([10, 5]);
    expect(dotted.style().lineDash).toEqual([2, 3]);
    // The two patterns must not be the same tuple in a different order.
    expect(dashed.style().lineDash).not.toEqual(dotted.style().lineDash);
  });

  // Regression: `setLineDash([])` is not a no-op -- it clears whatever pattern
  // is already on the context. This test primes a non-empty pattern first, so a
  // version of `applyStrokeStyle` that simply did nothing for the solid case
  // would still be caught. The recording context starts with `lineDash: []`,
  // so asserting `[]` against a fresh context would pass vacuously.
  it('clears a previously set dash pattern for a solid stroke style', () => {
    const rec = createRecordingContext();
    applyStrokeStyle(rec.ctx, 'dashed');
    expect(rec.style().lineDash).toEqual([10, 5]);

    applyStrokeStyle(rec.ctx, 'solid');

    expect(rec.style().lineDash).toEqual([]);
    // Exactly one call: a second setLineDash([]) would be harmless but means the
    // branch is doing the work twice.
    expect(rec.countOf('setLineDash')).toBe(2);
  });

  // Regression: `strokeStyle` is `string | undefined` and real elements
  // frequently leave it unset. Omitting it must take the same solid branch as
  // an explicit 'solid', not fall through and leave the previous dash in place.
  it('treats an undefined stroke style as solid and clears the dash pattern', () => {
    const rec = createRecordingContext();
    applyStrokeStyle(rec.ctx, 'dotted');
    expect(rec.style().lineDash).toEqual([2, 3]);

    applyStrokeStyle(rec.ctx, undefined);

    expect(rec.style().lineDash).toEqual([]);
    expect(rec.countOf('setLineDash')).toBe(2);
  });

  // Regression: any unrecognised style string must take the solid branch too.
  // If the `else` were narrowed to `=== 'solid'`, a typo'd style would silently
  // keep whatever dash was on the context.
  it('treats an unrecognised stroke style as solid', () => {
    const rec = createRecordingContext();
    applyStrokeStyle(rec.ctx, 'dashed');

    applyStrokeStyle(rec.ctx, 'solidd');

    expect(rec.style().lineDash).toEqual([]);
  });

  // Regression: `setLineDash` mutates renderer state that later strokes read.
  // Calling it zero times, or twice for one style, desynchronises the recorded
  // style from what was actually drawn.
  it('issues exactly one setLineDash call per invocation for every style', () => {
    for (const style of ['dashed', 'dotted', 'solid', undefined] as const) {
      const rec = createRecordingContext();
      applyStrokeStyle(rec.ctx, style);
      expect(rec.countOf('setLineDash')).toBe(1);
    }
  });
});

describe('computeBoundingBox', () => {
  // Regression: the box is what marquee selection and fit-to-content zoom
  // measure against. Getting min/max inverted makes the union smaller than its
  // parts, which reads as "nothing is inside the selection".
  it('returns the union of the element rectangles', () => {
    const box = computeBoundingBox([
      { x: 10, y: 20, width: 30, height: 40 },
      { x: 100, y: 5, width: 10, height: 10 },
      { x: -50, y: 200, width: 60, height: 20 },
    ]);

    expect(box).toEqual({ minX: -50, minY: 5, maxX: 110, maxY: 220 });
  });

  // Regression: the same union must also come out right for a single element,
  // which is where a hard-coded zero origin or an off-by-one in maxX would hide.
  it('returns the element itself for a single rectangle', () => {
    const box = computeBoundingBox([{ x: 7, y: 9, width: 3, height: 5 }]);

    expect(box).toEqual({ minX: 7, minY: 9, maxX: 10, maxY: 14 });
  });

  // Regression: every input must be inside the reported box. Asserted as a
  // property over all elements rather than a hand-counted expectation, so the
  // test cannot drift from the fixture.
  it('produces a box that contains every input rectangle', () => {
    const elements = [
      { x: -25, y: -10, width: 40, height: 5 },
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 300, y: 250, width: 50, height: 50 },
    ];

    const box = computeBoundingBox(elements);

    for (const el of elements) {
      expect(box.minX).toBeLessThanOrEqual(el.x);
      expect(box.minY).toBeLessThanOrEqual(el.y);
      expect(box.maxX).toBeGreaterThanOrEqual(el.x + el.width);
      expect(box.maxY).toBeGreaterThanOrEqual(el.y + el.height);
    }
  });

  // Regression: the accumulators start at Infinity/-Infinity and are returned
  // verbatim when there is nothing to accumulate. Seeding them with 0 instead
  // would report a box from the canvas origin for an empty selection and make
  // "fit to selection" jump to (0,0).
  it('reports the untouched sentinels for an empty element list', () => {
    const box = computeBoundingBox([]);

    expect(box).toEqual({
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    });
  });

  // Regression: maxX/maxY are computed as `x + width`, never as
  // `Math.max(el.x, el.x + el.width)`. That is deliberate: a zero-width element
  // contributes exactly its x. Pinning the formula stops someone "fixing" it
  // into a max() and silently widening every collapsed selection.
  it('measures max from x + width so a zero-width element contributes its x', () => {
    const box = computeBoundingBox([
      { x: 100, y: 100, width: 0, height: 0 },
      { x: 20, y: 20, width: 10, height: 10 },
    ]);

    expect(box.maxX).toBe(100);
    expect(box.maxY).toBe(100);
    expect(box.minX).toBe(20);
    expect(box.minY).toBe(20);
  });

  // Regression: min/max are asymmetric -- min tracks the origin, max tracks the
  // far edge. Swapping Math.min and Math.max collapses the box to the origin of
  // the first element and every zoom-to-selection breaks.
  it('tracks the origin with min and the far edge with max', () => {
    const box = computeBoundingBox([{ x: 40, y: 60, width: 10, height: 20 }]);

    expect(box.minX).toBe(40);
    expect(box.minY).toBe(60);
    expect(box.maxX).toBe(50);
    expect(box.maxY).toBe(80);
    expect(box.minX).toBeLessThan(box.maxX);
    expect(box.minY).toBeLessThan(box.maxY);
  });
});

describe('createCanvas', () => {
  // Regression: jsdom has no 2D context, so the fallback branch is what runs
  // here. `createCanvas` must hand back exactly the object `getContext('2d')`
  // produced for *that* canvas -- returning a context from a throwaway element,
  // or substituting one of its own, would desynchronise the buffer and the
  // context the caller then draws with.
  it('returns the very context getContext yielded for the canvas it created', () => {
    const sentinel = {} as CanvasRenderingContext2D;
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(sentinel);

    const { canvas, ctx } = createCanvas(320, 240);

    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext).toHaveBeenCalledWith('2d');
    expect(ctx).toBe(sentinel);
  });

  // Regression: a runtime with no 2D support yields null, and that null must
  // reach the caller rather than being papered over -- it is the only signal
  // that a canvas was created but is unusable.
  it('passes a null context straight through when the runtime has no 2d support', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    const { ctx } = createCanvas(8, 8);

    expect(getContext).toHaveBeenCalledWith('2d');
    expect(ctx).toBeNull();
  });

  // Regression: the fallback branch sets width/height through the element
  // properties rather than the width/height attributes. A swapped
  // `canvas.height = width` would produce a 240x320 buffer.
  it('sets both dimensions on the fallback canvas', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    const { canvas } = createCanvas(11, 22);

    // `createCanvas` returns a union, so narrow it the way a consumer reading
    // the DOM attributes has to.
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('expected the HTMLCanvasElement fallback branch');
    }
    expect(canvas.getAttribute('width')).toBe('11');
    expect(canvas.getAttribute('height')).toBe('22');
    expect(canvas.width).toBe(11);
    expect(canvas.height).toBe(22);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Regression: the OffscreenCanvas branch is preferred when available and
  // returns the *offscreen* context from that same canvas.
  it('uses OffscreenCanvas when the runtime provides it', () => {
    const sentinel = {} as CanvasRenderingContext2D;
    class FakeOffscreenCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext(id: string): CanvasRenderingContext2D | null {
        return id === '2d' ? sentinel : null;
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const htmlGetContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');

    const { canvas, ctx } = createCanvas(64, 48);

    expect(canvas).toBeInstanceOf(FakeOffscreenCanvas);
    expect(ctx).toBe(sentinel);
    // The OffscreenCanvas branch must not touch the DOM fallback at all.
    expect(htmlGetContext).not.toHaveBeenCalled();
    expect(canvas).not.toBeInstanceOf(HTMLCanvasElement);
  });

  // Regression: constructing OffscreenCanvas with swapped arguments would give a
  // 48x64 buffer, which every consumer reads as width x height.
  it('passes width and height to OffscreenCanvas in order', () => {
    const seen: Array<[number, number]> = [];
    class RecordingOffscreenCanvas {
      constructor(width: number, height: number) {
        seen.push([width, height]);
      }
      getContext(): null {
        return null;
      }
    }
    vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas);

    const { ctx } = createCanvas(128, 256);

    expect(seen).toEqual([[128, 256]]);
    expect(ctx).toBeNull();
  });
});

describe('downloadBlob', () => {
  interface ClickRecord {
    href: string;
    download: string;
    inDocumentAtClick: boolean;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Intercepts the anchor click rather than letting jsdom navigate, and records
   * the three things the helper's ordering guarantees depend on: the anchor was
   * attached to the document at the moment it was clicked, and revokeObjectURL
   * happened after the click.
   */
  function installDownloadProbe(objectUrl: string) {
    const order: string[] = [];
    const clicks: ClickRecord[] = [];
    const revoked: string[] = [];
    const anchors: HTMLAnchorElement[] = [];

    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      order.push('create');
      return objectUrl;
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {
      order.push('revoke');
      revoked.push(objectUrl);
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      order.push('click');
      anchors.push(this);
      clicks.push({
        href: this.href,
        download: this.download,
        inDocumentAtClick: document.body.contains(this),
      });
    });

    return {
      create,
      revoke,
      click,
      order,
      clicks,
      revoked,
      anchors,
    };
  }

  // Regression: `downloadBlob` builds an <a download> and clicks it. Losing
  // either attribute turns an export into a navigation to the blob URL.
  it('clicks an anchor carrying the blob url and the requested filename', () => {
    const probe = installDownloadProbe('blob:dripl-1');
    const blob = new Blob(['payload'], { type: 'text/plain' });

    downloadBlob(blob, 'scene.json');

    expect(probe.create).toHaveBeenCalledTimes(1);
    expect(probe.create).toHaveBeenCalledWith(blob);
    expect(probe.clicks).toEqual([
      { href: 'blob:dripl-1', download: 'scene.json', inDocumentAtClick: true },
    ]);
  });

  // Regression: a detached anchor does not trigger a download in real browsers,
  // so the append must happen before the click. Removing the anchor first is a
  // silent no-op export, and nothing downstream reports an error.
  it('removes the anchor from the document again once the click has been issued', () => {
    const probe = installDownloadProbe('blob:dripl-2');

    downloadBlob(new Blob(['x']), 'a.txt');

    expect(probe.clicks).toHaveLength(1);
    expect(probe.clicks[0]!.inDocumentAtClick).toBe(true);
    expect(probe.anchors).toHaveLength(1);
    expect(document.body.contains(probe.anchors[0]!)).toBe(false);
    expect(document.body.querySelector('a[download]')).toBeNull();
  });

  // Regression: the object URL is a live handle on the blob. Revoking it before
  // the click would race the browser's own read of it; never revoking it leaks
  // the blob for the lifetime of the document. The order is what is asserted.
  it('revokes the object url only after the anchor has been clicked', () => {
    const probe = installDownloadProbe('blob:dripl-3');

    downloadBlob(new Blob(['x']), 'a.txt');

    expect(probe.order).toEqual(['create', 'click', 'revoke']);
    expect(probe.revoked).toEqual(['blob:dripl-3']);
    // The url that was revoked is the same one handed to the anchor.
    expect(probe.clicks[0]!.href).toBe(probe.revoked[0]);
  });

  // Regression: each call mints and revokes its own url. Reusing one url across
  // calls would let a second download read the first call's revoked blob.
  it('mints a fresh object url per call', () => {
    const urls = ['blob:dripl-a', 'blob:dripl-b'];
    let index = 0;
    const revoked: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => urls[index++]!);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
      revoked.push(url);
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadBlob(new Blob(['one']), 'one.txt');
    downloadBlob(new Blob(['two']), 'two.txt');

    expect(revoked).toEqual(['blob:dripl-a', 'blob:dripl-b']);
  });
});
