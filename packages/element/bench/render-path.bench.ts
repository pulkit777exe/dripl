import { performance } from 'node:perf_hooks';
import type { DriplElement } from '@dripl/common';
import { getElementBounds } from '@dripl/math/intersection';
import {
  getElementBitmapCacheStatsForTest,
  invalidateElementCache,
  renderStaticScene,
  resetElementBitmapCacheForTest,
  type StaticSceneConfig,
  type StaticSceneFrameStats,
} from '../src/staticScene';
import { createCountingHost, tallyTotal, type CallTally } from './counting-canvas';
import { makeScene, withVersion, type SceneMix } from './scene';

/**
 * Count-based render-path benchmark.
 *
 * Runs `renderStaticScene` against the counting canvas host and reports, per
 * frame, how many 2D-context calls landed on the visible surface, how many
 * landed inside per-element bitmap generation, and how many backing stores were
 * allocated. Those are the numbers that survive a change of machine; the
 * millisecond column is reported alongside them only so its own noise floor is
 * visible, never on its own as a claim.
 *
 * Run it with `pnpm --filter @dripl/element bench:render`.
 */

const VIEWPORT = { width: 1280, height: 720 } as const;
const CULL_PADDING = 20;

interface SceneViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

interface FrameMeasurement {
  label: string;
  candidates: number;
  elementsDrawn: number;
  bitmapsGenerated: number;
  bitmapsReused: number;
  bitmapsDeferred: number;
  elementsSkipped: number;
  /** Calls on the on-screen context: blits, clear, grid, transforms. */
  visibleCalls: number;
  /** `drawImage` on the on-screen context, i.e. cached-bitmap blits. */
  visibleBlits: number;
  /** Calls issued inside per-element offscreen canvases (Rough.js drawing). */
  offscreenCalls: number;
  /** Backing stores allocated this frame. */
  offscreenCanvases: number;
  /** `width * height` summed over backing stores allocated this frame. */
  offscreenPixels: number;
  /** Cache totals after the frame. */
  cacheEntries: number;
  cacheTrackedBytes: number;
  /** Wall clock for the frame, milliseconds. Secondary evidence only. */
  ms: number;
  /** Offscreen call breakdown, for attributing generation cost by method. */
  offscreenBreakdown: CallTally;
  /** Visible-surface call breakdown, for attributing per-blit cost by method. */
  visibleBreakdown: CallTally;
}

/**
 * Viewport culling, done here rather than through RBush.
 *
 * `renderStaticScene` takes the candidate list as an argument, so the harness
 * only has to produce it. RBush lives in `apps/dripl-app` and is not a
 * dependency of this package; importing it would mean adding a dependency to
 * make a benchmark run, which is exactly what this exercise rules out. A linear
 * scan over the scene once per viewport change is cheap and, more importantly,
 * is *outside* the measured window: the per-frame path under test never sees it.
 * The RBush query itself is already recorded — 0.0169 ms median over 10,000
 * elements — in `docs/performance-benchmark.md`.
 */
function cull(elements: readonly DriplElement[], viewport: SceneViewport): DriplElement[] {
  const zoom = Math.max(viewport.zoom, 1e-4);
  const left = -viewport.x / zoom - CULL_PADDING;
  const top = -viewport.y / zoom - CULL_PADDING;
  const right = left + viewport.width / zoom + CULL_PADDING * 2;
  const bottom = top + viewport.height / zoom + CULL_PADDING * 2;

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

function baseConfig(zoom: number, overrides: Partial<StaticSceneConfig> = {}): StaticSceneConfig {
  return {
    gridEnabled: false,
    gridSize: 20,
    zoom,
    theme: 'light',
    dpr: 1,
    ...overrides,
  };
}

function measureFrame(input: {
  label: string;
  canvas: HTMLCanvasElement;
  host: ReturnType<typeof createCountingHost>;
  elements: DriplElement[];
  visible: DriplElement[];
  viewport: SceneViewport;
  config: StaticSceneConfig;
}): FrameMeasurement {
  const { host, canvas, elements, visible, viewport, label } = input;
  host.reset();

  let stats: StaticSceneFrameStats | null = null;
  const startedAt = performance.now();
  renderStaticScene(canvas, elements, viewport, {
    ...input.config,
    elements,
    visibleElements: visible,
    onFrameStats: frame => {
      stats = frame;
    },
  });
  const ms = performance.now() - startedAt;

  const frame = stats as StaticSceneFrameStats | null;
  const cache = getElementBitmapCacheStatsForTest();
  return {
    label,
    candidates: frame?.candidates ?? -1,
    elementsDrawn: frame?.elementsDrawn ?? -1,
    bitmapsGenerated: frame?.bitmapsGenerated ?? -1,
    bitmapsReused: frame?.bitmapsReused ?? -1,
    bitmapsDeferred: frame?.bitmapsDeferred ?? -1,
    elementsSkipped: frame?.elementsSkipped ?? -1,
    visibleCalls: tallyTotal(host.visible),
    visibleBlits: host.visible.drawImage ?? 0,
    offscreenCalls: tallyTotal(host.offscreen),
    offscreenCanvases: host.offscreenCanvases,
    offscreenPixels: host.offscreenPixels,
    cacheEntries: cache.entries,
    cacheTrackedBytes: cache.trackedBytes,
    ms,
    offscreenBreakdown: { ...host.offscreen },
    visibleBreakdown: { ...host.visible },
  };
}

interface ScenarioResult {
  name: string;
  frames: FrameMeasurement[];
}

/**
 * The five frame shapes the editor actually produces.
 *
 * `docs/performance-benchmark.md` records that "frames that allocate hundreds of
 * bitmaps are the expensive ones, while the interactive layer stays at a 0.00 ms
 * median". These scenarios are the count-level version of that observation, one
 * per phase in the browser capture.
 */
function runScenarios(input: {
  elementCount: number;
  zoom: number;
  mix: SceneMix;
  zoomFrames: number;
  maxConvergenceFrames: number;
}): ScenarioResult[] {
  const host = createCountingHost(VIEWPORT);
  try {
    const elements = makeScene(input.elementCount, input.mix);
    const viewport: SceneViewport = { x: 0, y: 0, ...VIEWPORT, zoom: input.zoom };
    const visible = cull(elements, viewport);
    const config = baseConfig(input.zoom);

    // Cold: nothing cached, so every candidate allocates a backing store.
    resetElementBitmapCacheForTest();
    const cold = measureFrame({
      label: 'cold',
      canvas: host.canvas,
      host,
      elements,
      visible,
      viewport,
      config,
    });

    // Convergence: the per-frame allocation budget caps generation at 100, so a
    // 945-candidate cold scene needs several frames before the last element has
    // a bitmap. Frames in between are a mixture of real blits and placeholders.
    const convergence: FrameMeasurement[] = [];
    for (let attempt = 0; attempt < input.maxConvergenceFrames; attempt += 1) {
      const frame = measureFrame({
        label: `converge-${attempt}`,
        canvas: host.canvas,
        host,
        elements,
        visible,
        viewport,
        config,
      });
      convergence.push(frame);
      if (frame.bitmapsDeferred === 0) break;
    }

    // Steady state: the frame after convergence. Everything is a cached blit, so
    // this is the shape of every frame that does not expose new elements.
    const steady = measureFrame({
      label: 'steady',
      canvas: host.canvas,
      host,
      elements,
      visible,
      viewport,
      config,
    });

    // Pan: 100 screen pixels down. The overlap is already cached; the newly
    // exposed row is not.
    const panned: SceneViewport = { ...viewport, y: viewport.y + 100 };
    const pan = measureFrame({
      label: 'pan',
      canvas: host.canvas,
      host,
      elements,
      visible: cull(elements, panned),
      viewport: panned,
      config: baseConfig(input.zoom),
    });

    // Drag: one element's version bumped, so exactly one bitmap is regenerated.
    // `mutateElement` drops the previous object by id before the frame runs, so
    // this is one regeneration rather than two live cache entries.
    const draggedId = elements[0]?.id as string;
    const original = elements[0] as DriplElement;
    const dragged = withVersion(original, (original.version ?? 1) + 1, 3);
    invalidateElementCache(draggedId);
    const drag = measureFrame({
      label: 'drag-1',
      canvas: host.canvas,
      host,
      elements: [dragged, ...elements.slice(1)],
      visible: visible.map(element => (element.id === draggedId ? dragged : element)),
      viewport,
      config,
    });

    // Smooth zoom: the animation runs with `shouldCacheIgnoreZoom`, so a cached
    // bitmap is reused across frames even though the zoom changes underneath.
    resetElementBitmapCacheForTest();
    const zoomFrames: FrameMeasurement[] = [];
    for (let frame = 0; frame < input.zoomFrames; frame += 1) {
      const frameZoom = input.zoom * (1 + frame * 0.02);
      const frameViewport: SceneViewport = { ...viewport, zoom: frameZoom };
      zoomFrames.push(
        measureFrame({
          label: `zoom-${frame}`,
          canvas: host.canvas,
          host,
          elements,
          visible: cull(elements, frameViewport),
          viewport: frameViewport,
          config: baseConfig(frameZoom, { shouldCacheIgnoreZoom: true }),
        })
      );
    }

    return [
      { name: 'frames', frames: [cold, ...convergence, steady, pan, drag] },
      { name: 'zoom-animation', frames: zoomFrames },
    ];
  } finally {
    host.dispose();
  }
}

function summarise(frames: FrameMeasurement[]): Record<string, unknown> {
  const msValues = frames.map(frame => frame.ms).sort((a, b) => a - b);
  const pick = (q: number): number =>
    msValues[Math.min(msValues.length - 1, Math.floor(msValues.length * q))] ?? 0;
  const sum = (key: keyof FrameMeasurement): number =>
    frames.reduce((total, frame) => total + (frame[key] as number), 0);

  return {
    frames: frames.length,
    candidatesFirstFrame: frames[0]?.candidates ?? 0,
    elementsDrawnMax: Math.max(...frames.map(frame => frame.elementsDrawn)),
    bitmapsGeneratedTotal: sum('bitmapsGenerated'),
    bitmapsReusedTotal: sum('bitmapsReused'),
    bitmapsDeferredTotal: sum('bitmapsDeferred'),
    visibleCallsTotal: sum('visibleCalls'),
    visibleBlitsTotal: sum('visibleBlits'),
    offscreenCallsTotal: sum('offscreenCalls'),
    offscreenCanvasesTotal: sum('offscreenCanvases'),
    offscreenPixelsTotal: sum('offscreenPixels'),
    cacheEntriesFinal: frames[frames.length - 1]?.cacheEntries ?? 0,
    cacheTrackedBytesFinal: frames[frames.length - 1]?.cacheTrackedBytes ?? 0,
    msPerFrame: {
      min: Number(pick(0).toFixed(3)),
      median: Number(pick(0.5).toFixed(3)),
      p95: Number(pick(0.95).toFixed(3)),
      max: Number((msValues[msValues.length - 1] ?? 0).toFixed(3)),
    },
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const readNumber = (flag: string, fallback: number): number => {
    const index = args.indexOf(flag);
    if (index === -1) return fallback;
    const value = Number(args[index + 1]);
    return Number.isFinite(value) ? value : fallback;
  };

  const elementCount = readNumber('--elements', 10_000);
  const zoom = readNumber('--zoom', 0.27);
  const zoomFrames = readNumber('--zoom-frames', 12);
  const maxConvergenceFrames = readNumber('--max-convergence', 40);
  const repeats = readNumber('--repeats', 1);
  const mix: SceneMix = args.includes('--rectangles') ? 'rectangles' : 'mixed';

  const runs: Record<string, unknown>[] = [];
  for (let run = 0; run < repeats; run += 1) {
    for (const scenario of runScenarios({
      elementCount,
      zoom,
      mix,
      zoomFrames,
      maxConvergenceFrames,
    })) {
      runs.push({
        run,
        scenario: scenario.name,
        summary: summarise(scenario.frames),
        frames: scenario.frames.map(frame => ({
          label: frame.label,
          candidates: frame.candidates,
          drawn: frame.elementsDrawn,
          generated: frame.bitmapsGenerated,
          reused: frame.bitmapsReused,
          deferred: frame.bitmapsDeferred,
          visibleCalls: frame.visibleCalls,
          blits: frame.visibleBlits,
          offscreenCalls: frame.offscreenCalls,
          offscreenCanvases: frame.offscreenCanvases,
          ms: Number(frame.ms.toFixed(3)),
        })),
        breakdownFirstFrame: {
          visible: scenario.frames[0]?.visibleBreakdown,
          offscreen: scenario.frames[0]?.offscreenBreakdown,
        },
        breakdownSteadyFrame: (() => {
          const frame =
            scenario.frames.find(candidate => candidate.label === 'steady') ??
            scenario.frames[scenario.frames.length - 1];
          return { visible: frame?.visibleBreakdown, offscreen: frame?.offscreenBreakdown };
        })(),
      });
    }
  }

  // This is a CLI reporter, not application code, so it writes to stdout
  // directly rather than through the app logging boundary.
  process.stdout.write(
    `${JSON.stringify(
      {
        kind: 'render-path-count-benchmark',
        node: process.version,
        elementCount,
        zoom,
        mix,
        zoomFrames,
        maxConvergenceFrames,
        repeats,
        note:
          'Counts are the primary signal and are exactly reproducible. msPerFrame is ' +
          'reported only so its own run-to-run spread stays visible; it is not a frame-budget ' +
          'claim and says nothing about a browser.',
        runs,
      },
      null,
      2
    )}\n`
  );
}

main();
