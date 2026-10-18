import { expect, test, type Page } from '@playwright/test';
import {
  canvasBox,
  drawRectangle,
  expectElementCount,
  openFreshCanvas,
  persistedElements,
} from './helpers/canvas';

/**
 * Proof that a dragged element *renders* where it moved to.
 *
 * `mutateElement` no longer rebuilds a cached bitmap when only the element's
 * position changed — it hands the bitmap to the new element object instead
 * (see `carryForwardElementCache`; `packages/element/bench/drag-path.bench.ts`
 * measures the win at zero rebuilds per frame for any selection size). Whether
 * that is correct is a question about pixels, and every other spec is blind to
 * it: IndexedDB and the Zustand store would keep reporting the right `x`/`y`
 * while the canvas painted the element at its old coordinates, so a stale
 * renderer would pass the entire persistence suite.
 *
 * Deliberately relative rather than golden: what is asserted is that the ink's
 * bounding box travels the drag vector and keeps its size. That is immune to
 * DPR, antialiasing and theme — the axes that make screenshot diffs flaky —
 * while still failing on either real failure mode: a bitmap left behind at the
 * old position, or one drawn at both.
 */

interface InkBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Backing-store width, so device pixels can be converted to CSS pixels. */
  width: number;
}

/**
 * Bounding box of the drawn ink on the static scene canvas.
 *
 * The threshold takes hand-drawn strokes (`#1e1e1e` against white) and nothing
 * else: the grid — off by default, and at `rgba(0,0,0,0.07)` when on — composites
 * to ~236, and the selection accent is blue. Measuring the scene layer
 * specifically (`data-layer="static"`) matters because the interactive and
 * laser overlays sit above it; an empty overlay would find no ink at all, which
 * is why a canvas without ink is an error rather than an empty measurement.
 */
async function inkBounds(page: Page): Promise<InkBounds> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-layer="static"]');
    if (!canvas) throw new Error('scene canvas not found');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('scene canvas has no 2D context');
    // Throws if a cross-origin image was drawn into it. Nothing here draws one,
    // so reaching that would mean the harness picked the wrong canvas.
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let y = 0; y < canvas.height; y += 1) {
      const row = y * canvas.width;
      for (let x = 0; x < canvas.width; x += 1) {
        const i = (row + x) * 4;
        // Indexed reads are `number | undefined` under `noUncheckedIndexedAccess`
        // even though this buffer is known dense; the fallbacks are white.
        if ((data[i + 3] ?? 0) < 40) continue;
        if ((data[i] ?? 255) >= 160 || (data[i + 1] ?? 255) >= 160 || (data[i + 2] ?? 255) >= 160) {
          continue;
        }
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    if (!Number.isFinite(minX)) throw new Error('scene canvas shows no ink to measure');
    return { minX, minY, maxX, maxY, width: canvas.width };
  });
}

/** Device pixels converted to CSS pixels, so assertions can name the drag. */
function inCssPx(bounds: InkBounds, canvasWidth: number) {
  const scale = canvasWidth / bounds.width;
  return {
    x: bounds.minX * scale,
    y: bounds.minY * scale,
    width: (bounds.maxX - bounds.minX) * scale,
    height: (bounds.maxY - bounds.minY) * scale,
  };
}

test.describe('drag rendering', () => {
  test('renders a dragged rectangle at its new position', async ({ page }) => {
    await openFreshCanvas(page);
    await drawRectangle(page);
    await expectElementCount(page, 1);

    const box = await canvasBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const DRAG_X = 80;
    const DRAG_Y = 60;

    // Press on the *stroke*, not the centre: `getElementAtPosition` tests only
    // the outline for unfilled shapes (`shouldTestInside`), and this rectangle
    // has a transparent background, so the middle of it is deliberately
    // dead space — a press there starts a marquee instead of a move.
    const grabX = cx;
    const grabY = cy - 60; // top edge of the 160x120 draw, at the canvas centre

    // The scene before the move. Escape normalises the selection first:
    // whether a freshly drawn element is left selected is app behaviour, and
    // its handles would enter the ink box.
    await page.keyboard.press('Escape');
    const beforeElement = (await persistedElements(page))[0];
    expect(beforeElement).toBeDefined();
    const before = inCssPx(await inkBounds(page), box.width);

    // The press selects and arms the drag; the move above the click threshold
    // executes it, one `mutateElement` per frame — which is precisely the path
    // that now carries the bitmap instead of rebuilding it.
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(grabX + DRAG_X, grabY + DRAG_Y, { steps: 10 });
    await page.mouse.up();

    // The store is asserted separately from the pixels so a failure says which
    // half broke: gesture versus renderer. Persistence is debounced (500 ms).
    await expect
      .poll(async () => (await persistedElements(page))[0]?.x, { timeout: 10_000 })
      .toBe((beforeElement?.x ?? 0) + DRAG_X);

    await page.keyboard.press('Escape');
    // Let the frame that paints the settled position reach the canvas.
    await page.waitForTimeout(300);
    const after = inCssPx(await inkBounds(page), box.width);

    const dx = after.x + after.width / 2 - (before.x + before.width / 2);
    const dy = after.y + after.height / 2 - (before.y + before.height / 2);

    // The element moved by the drag vector — not half of it (a bitmap painted
    // at both the old and the new position would halve this and double the
    // next assertion), and not at all (a bitmap left behind).
    expect(Math.abs(dx - DRAG_X)).toBeLessThanOrEqual(15);
    expect(Math.abs(dy - DRAG_Y)).toBeLessThanOrEqual(15);

    // The same ink at the same size: a stale or duplicated bitmap changes one
    // of the two dimensions far more than antialiasing can.
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(15);
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(15);
  });
});
