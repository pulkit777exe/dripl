import { performance } from 'node:perf_hooks';
import type { DriplElement } from '@dripl/common';
import { mutateElement } from '../src/mutateElement';
import {
  DEFAULT_MAX_NEW_BITMAPS_PER_FRAME,
  renderStaticScene,
  resetElementBitmapCacheForTest,
  type StaticSceneConfig,
  type StaticSceneFrameStats,
} from '../src/staticScene';
import { makeScene } from './scene';
import { createCountingHost } from './counting-canvas';

/**
 * Drag-path benchmark: what a frame costs while elements are being moved.
 *
 * This isolates one question — during a pure translation, does the renderer
 * reuse the per-element bitmap or rebuild it? The answer is visible directly in
 * the counters, which survive machine noise far better than milliseconds:
 *
 *   - `bitmapsGenerated` regenerating per dragged element per frame is the bug.
 *     The bitmap is rasterized in the element's own local coordinates
 *     (`ctx.translate(-element.x, -element.y)`), and `x`/`y` are applied again
 *     at blit time, so a move cannot change a single pixel of it.
 *   - `bitmapsReused` staying at N while `bitmapsGenerated` stays at 0 is the
 *     fix, and it is what makes dragging a large selection cheap.
 *
 * **The cache is warmed to completion first, and that matters.** A frame builds
 * at most `DEFAULT_MAX_NEW_BITMAPS_PER_FRAME` new bitmaps and defers the rest,
 * so a single cold frame leaves most of a 1,000-element scene unbuilt. Measured
 * that way, `bitmapsGenerated` counts the *budget catching up* rather than the
 * drag: the first version of this harness reported 46 rebuilds per frame for a
 * one-element drag on a 1,000-element scene, which is (1000 - 100) / 20 frames
 * of catch-up and not a single rebuild caused by moving. Rows below are taken
 * only once a frame generates nothing and defers nothing, so every rebuild they
 * report is attributable to the mutation that preceded it.
 *
 * The millisecond column is printed only so its own noise floor is visible; the
 * claim rests on the counts.
 *
 * Run it with `pnpm --filter @dripl/element bench:drag`.
 */

const VIEWPORT = { width: 1280, height: 720 } as const;
const CELLS = 100;

interface SceneViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

/** Elements per frame actually dragged — a marquee over part of the scene. */
const DRAGGED_PER_FRAME = [1, 10, 100];

function sceneViewport(): SceneViewport {
  return { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height, zoom: 1 };
}

function baseConfig(): StaticSceneConfig {
  return { gridEnabled: false, gridSize: 20, zoom: 1, theme: 'light', dpr: 1 };
}

interface FrameResult {
  bitmapsGenerated: number;
  bitmapsReused: number;
  bitmapsDeferred: number;
  ms: number;
}

function renderFrame(canvas: HTMLCanvasElement, elements: DriplElement[]): FrameResult {
  let stats: StaticSceneFrameStats | null = null;
  const startedAt = performance.now();
  renderStaticScene(canvas, elements, sceneViewport(), {
    ...baseConfig(),
    elements,
    visibleElements: elements,
    onFrameStats: frame => {
      stats = frame;
    },
  });
  const ms = performance.now() - startedAt;
  const frame = stats as StaticSceneFrameStats | null;
  return {
    bitmapsGenerated: frame?.bitmapsGenerated ?? -1,
    bitmapsReused: frame?.bitmapsReused ?? -1,
    bitmapsDeferred: frame?.bitmapsDeferred ?? -1,
    ms,
  };
}

/**
 * Render until a frame neither builds nor defers anything: every element the
 * viewport can draw now has a bitmap.
 *
 * The cap is a guard, not a budget — a scene that cannot settle within it would
 * mean bitmaps are being dropped as fast as they are built, and silently
 * measuring that as drag cost would be exactly the confusion this loop exists
 * to prevent. Hitting it throws rather than reporting numbers built on a cache
 * that never warmed.
 */
function warmCache(canvas: HTMLCanvasElement, elements: DriplElement[]): number {
  const cap = Math.ceil(elements.length / DEFAULT_MAX_NEW_BITMAPS_PER_FRAME) + 25;
  for (let pass = 1; pass <= cap; pass += 1) {
    const frame = renderFrame(canvas, elements);
    if (frame.bitmapsGenerated === 0 && frame.bitmapsDeferred === 0) return pass;
  }
  throw new Error(`cache did not settle within ${cap} frames`);
}

/**
 * Simulate one drag frame: translate the first `count` elements by a sub-pixel
 * delta, exactly as `updateElementsTransient` does — same `mutateElement` call,
 * same in-place x/y update, no geometry change.
 *
 * A sub-pixel step keeps the elements inside the viewport for every frame of the
 * run, so the counters reflect cache behaviour and not culling.
 */
function translate(elements: DriplElement[], count: number, step: number): DriplElement[] {
  const next = elements.slice();
  for (let index = 0; index < count; index += 1) {
    const element = next[index];
    if (!element) continue;
    next[index] = mutateElement(element, {
      x: (element.x ?? 0) + step,
      y: (element.y ?? 0) + step,
    });
  }
  return next;
}

/** Bench output goes to stdout directly — `console` is linted out of this repo. */
function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

function run(totalElements: number): void {
  const host = createCountingHost(VIEWPORT);
  const canvas = host.canvas;
  say(
    `\nscene: ${totalElements} elements (${CELLS}-wide grid, viewport ${VIEWPORT.width}x${VIEWPORT.height})`
  );
  say('dragged/frame | gen/frame | reuse/frame | defer/frame | ms/frame | verdict');

  for (const dragged of DRAGGED_PER_FRAME) {
    // Fresh scene and cold cache per row: this measures steady-state drag cost,
    // not the one-off cost of building every bitmap in the scene.
    resetElementBitmapCacheForTest();
    let elements = makeScene(totalElements, 'mixed');
    // Build the whole cache first, so every rebuild counted below is caused by
    // the drag and not by the generation budget catching up. See the header.
    const warmPasses = warmCache(canvas, elements);
    if (warmPasses > 1 && dragged === DRAGGED_PER_FRAME[0]) {
      say(`  (cache warmed to completion in ${warmPasses} frames before measuring)`);
    }

    let generated = 0;
    let reused = 0;
    let deferred = 0;
    let ms = 0;
    const frames = 20;

    for (let frame = 0; frame < frames; frame += 1) {
      elements = translate(elements, dragged, 0.25);
      const result = renderFrame(canvas, elements);
      generated += result.bitmapsGenerated;
      reused += result.bitmapsReused;
      deferred += result.bitmapsDeferred;
      ms += result.ms;
    }

    const genPerFrame = generated / frames;
    const reusePerFrame = reused / frames;
    const deferredPerFrame = deferred / frames;
    const msPerFrame = ms / frames;
    // The invariant that matters: a translation must not rebuild any bitmap.
    const verdict =
      genPerFrame === 0 && deferredPerFrame === 0
        ? 'ok — bitmap reused'
        : `WASTEFUL — ${genPerFrame} rebuilt/frame`;
    say(
      `${String(dragged).padStart(13)} | ${genPerFrame.toFixed(1).padStart(9)} | ${reusePerFrame
        .toFixed(1)
        .padStart(11)} | ${deferredPerFrame.toFixed(1).padStart(11)} | ${msPerFrame
        .toFixed(2)
        .padStart(7)} | ${verdict}`
    );
  }
}

say('drag-path: cost of a frame while elements are being translated');
say('counts are the claim; the ms column only shows its own noise floor');
run(200);
run(1000);
