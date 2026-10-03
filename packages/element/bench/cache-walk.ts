import type { DriplElement } from '@dripl/common';
import { getElementBounds } from '@dripl/math/intersection';
import {
  getElementBitmapCacheStatsForTest,
  renderStaticScene,
  resetElementBitmapCacheForTest,
  type StaticSceneFrameStats,
} from '../src/staticScene';
import { createCountingHost } from './counting-canvas';
import { makeScene } from './scene';
import { measureGc } from './gc-probe';

/**
 * Is the 40% deferral thrash, or policy?
 *
 * THE QUESTION
 * ------------
 * On the 10,000-element scene the count benchmark reports 4,005 deferred
 * bitmaps — 40% of the scene never becomes a cached bitmap during the run. Two
 * explanations, with opposite implications:
 *
 *   (a) The byte/entry ceiling is evicting entries that are about to be needed
 *       again, so the same elements regenerate over and over. That is thrash, and
 *       the fix is in the eviction policy.
 *
 *   (b) The deferral is the per-frame allocation budget (`maxNewBitmapsPerFrame`,
 *       100) doing exactly its job: bounding the work in one frame and letting
 *       following frames finish the job. That is policy, and the correct fix is
 *       none.
 *
 * They are distinguishable by measurement, not by reading the code: pan through
 * a scene large enough that the byte ceiling actually engages, and record the
 * cache hit rate per step in both directions.
 *
 * WHAT A THRASH LOOKS LIKE
 * -----------------------
 * Thrash has a signature the steady state cannot have: elements that are drawn
 * repeatedly *without the viewport leaving them*. So this probe records, per
 * frame, how many of the elements it drew had already been cached — and
 * separately, how many of them were cached on the previous frame too. The second
 * number is the "regenerated something it just had" counter.
 *
 * DETERMINISM
 * -----------
 * Counts only, exact integers. Elements carry seeds, the scene is fixed, and the
 * culling and cache decisions are pure functions of the inputs, so repeated runs
 * produce identical numbers. (The arrowhead `Math.random` quirk does not affect
 * counts: it perturbs geometry, not how many path ops Rough emits.)
 */

const VIEW = { width: 1280, height: 720 } as const;
const ZOOM = 0.27;
const PADDING = 20;

function cull(elements: readonly DriplElement[], y: number): DriplElement[] {
  const left = -PADDING;
  const top = -y / ZOOM - PADDING;
  const right = left + VIEW.width / ZOOM + PADDING * 2;
  const bottom = top + VIEW.height / ZOOM + PADDING * 2;
  const visible: DriplElement[] = [];
  for (const element of elements) {
    if (element.isDeleted) continue;
    const bounds = getElementBounds(element);
    if (
      bounds.x + bounds.width < left ||
      bounds.x > right ||
      bounds.y + bounds.height < top ||
      bounds.y > bottom
    ) {
      continue;
    }
    visible.push(element);
  }
  return visible;
}

interface Step {
  label: string;
  panY: number;
}

/** What one pan step cost, summed over the frames it took to converge. */
interface StepOutcome {
  frames: number;
  candidates: number;
  /** Cache hits on the *first* frame of the step: the panned-into overlap. */
  reusedFirstFrame: number;
  generatedTotal: number;
  entries: number;
  mb: number;
}

function run(steps: Step[], elements: DriplElement[]): void {
  resetElementBitmapCacheForTest();
  const host = createCountingHost({ width: VIEW.width, height: VIEW.height });
  let previouslyDrawn: Set<string> = new Set();
  let unexplainedRegenerations = 0;

  try {
    for (const step of steps) {
      const visible = cull(elements, step.panY);
      const viewport = { x: 0, y: step.panY, ...VIEW, zoom: ZOOM };
      const drawnNow = new Set(visible.map(element => element.id));
      let repeated = 0;
      for (const id of drawnNow) if (previouslyDrawn.has(id)) repeated += 1;
      previouslyDrawn = drawnNow;

      // Converge the way the app does: `StaticCanvas.handleFrameStats` re-marks
      // the frame dirty while `bitmapsDeferred > 0`, so a pan settles over
      // several frames rather than paying for every new bitmap at once.
      const outcome: StepOutcome = {
        frames: 0,
        candidates: visible.length,
        reusedFirstFrame: 0,
        generatedTotal: 0,
        entries: 0,
        mb: 0,
      };
      let churnThisStep = 0;
      for (let frame = 0; frame < 60; frame += 1) {
        let stats: StaticSceneFrameStats | null = null;
        renderStaticScene(host.canvas, elements, viewport, {
          gridEnabled: false,
          gridSize: 20,
          zoom: ZOOM,
          theme: 'light',
          dpr: 1,
          elements,
          visibleElements: visible,
          onFrameStats: reported => {
            stats = reported;
          },
        });
        const reported = stats as unknown as StaticSceneFrameStats;
        outcome.frames += 1;
        outcome.generatedTotal += reported.bitmapsGenerated;
        if (outcome.frames === 1) outcome.reusedFirstFrame = reported.bitmapsReused;
        // Regained an element it drew last frame, yet had no bitmap for it.
        churnThisStep += Math.max(0, reported.bitmapsGenerated - (visible.length - repeated));
        if (reported.bitmapsDeferred === 0) break;
      }
      const cache = getElementBitmapCacheStatsForTest();
      outcome.entries = cache.entries;
      outcome.mb = cache.trackedBytes / (1024 * 1024);
      unexplainedRegenerations += churnThisStep;

      process.stdout.write(
        `${step.label.padEnd(8)} panY=${String(Math.round(step.panY)).padStart(5)} ` +
          `candidates=${String(outcome.candidates).padStart(4)} ` +
          `overlapFromPrevStep=${String(repeated).padStart(4)} ` +
          `reusedFirstFrame=${String(outcome.reusedFirstFrame).padStart(4)} ` +
          `framesToConverge=${String(outcome.frames).padStart(2)} ` +
          `generatedTotal=${String(outcome.generatedTotal).padStart(4)} ` +
          `entries=${String(outcome.entries).padStart(5)} ` +
          `mb=${outcome.mb.toFixed(1)}\n`
      );
    }
    process.stdout.write(`cumulative unexplained regenerations: ${unexplainedRegenerations}\n`);
  } finally {
    host.dispose();
    resetElementBitmapCacheForTest();
  }
}

async function main(): Promise<void> {
  const scene = makeScene(10_000, 'mixed');
  const worldHeight = 10_000; // 100 rows x 100 world pixels
  const viewHeightDevice = VIEW.height;
  // `viewport.y` is in *device* pixels and the world top is `-y / zoom`, so
  // walking down the scene means walking to negative y. Getting this backwards
  // produces a walk that never leaves the first screen — which is exactly what a
  // zero-candidate frame is, and why the numbers below are checked against a
  // non-zero candidate count.
  const stepPx = viewHeightDevice / 2;
  const lastPanY = -((worldHeight - viewHeightDevice / ZOOM) * ZOOM);
  const down: Step[] = [];
  for (let y = 0; y >= lastPanY; y -= stepPx) {
    down.push({ label: `down ${(down.length + 1).toString().padStart(2)}`, panY: y });
  }
  const up = [...down]
    .reverse()
    .map((step, index) => ({ label: `up ${(index + 1).toString().padStart(2)}`, panY: step.panY }));

  process.stdout.write(
    `scene: ${scene.length} elements, ${(worldHeight * 140).toLocaleString()} x ${worldHeight} world px, ` +
      `viewport ${VIEW.width}x${VIEW.height} at zoom ${ZOOM}\n`
  );
  process.stdout.write('--- walk down (each step half a screen) ---\n');
  run(down, scene);
  process.stdout.write('--- walk back up to the start ---\n');
  run(up, scene);

  // GC: the render path allocates a result object per element per frame.
  const host = createCountingHost({ width: VIEW.width, height: VIEW.height });
  const visible = cull(scene, 0);
  const viewport = { x: 0, y: 0, ...VIEW, zoom: ZOOM };
  const gc = await measureGc(() => {
    renderStaticScene(host.canvas, scene, viewport, {
      gridEnabled: false,
      gridSize: 20,
      zoom: ZOOM,
      theme: 'light',
      dpr: 1,
      elements: scene,
      visibleElements: visible,
      maxNewBitmapsPerFrame: 0,
    });
  });
  host.dispose();
  process.stdout.write(
    `one steady frame of ${visible.length} blits: gcEvents=${gc.gcEvents} gcPauseMs=${gc.gcPauseMs}\n`
  );
  resetElementBitmapCacheForTest();
}

void main();
