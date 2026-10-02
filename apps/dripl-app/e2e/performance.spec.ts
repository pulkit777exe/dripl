import { expect, test, type Page, type TestInfo } from '@playwright/test';

/**
 * Benchmark reporting goes to the runner's stdout rather than the app logging
 * boundary: this file is a CLI reporter, not application code.
 */
const writeStdout = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

type BrowserPerformanceSample = {
  type: string;
  name: string;
  startTime: number;
  duration: number;
  attribution?: Array<{
    name: string;
    sourceURL: string;
    sourceFunctionName: string;
    duration: number;
  }>;
};

type BrowserPerformanceSnapshot = {
  samples: BrowserPerformanceSample[];
  measures: BrowserPerformanceSample[];
};

type PerformanceWindow = Window & {
  __driplPerformance?: {
    snapshot: () => BrowserPerformanceSnapshot;
    clear: () => void;
  };
};

type FrameCadence = {
  frames: number;
  medianDeltaMs: number;
  p95DeltaMs: number;
  maxDeltaMs: number;
  over20ms: number;
  over33ms: number;
};

type FrameWindow = Window & {
  __driplFrames?: number[];
  __driplSampling?: boolean;
};

type StaticFrameStats = {
  candidates: number;
  elementsDrawn: number;
  bitmapsGenerated: number;
  bitmapsReused: number;
  elementsSkipped: number;
  bitmapsDeferred: number;
  setupMs?: number;
  generateMs?: number;
  blitMs?: number;
  directMs?: number;
};

type StatsWindow = Window & {
  __driplStaticFrames?: StaticFrameStats[];
  __driplInvalidateCalls?: number;
  __driplResetInvalidate?: () => void;
  __driplBitmapCache?: { entries: number; trackedBytes: number };
};

type StaticFrameSummary = {
  frames: number;
  maxDrawn: number;
  maxBitmapsNew: number;
  totalBitmapsNew: number;
  totalBitmapsDeferred: number;
  framesDrawingNothing: number;
};

async function clearStaticFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as StatsWindow;
    target.__driplStaticFrames = [];
    target.__driplResetInvalidate?.();
  });
}

/**
 * Cache-invalidation calls since the last reset. This used to include an
 * O(scene) scan per call, so the count is the direct measure of the work removed.
 */
/**
 * Attribute the worst frame in a phase by its internal time buckets. This is
 * how a slow frame becomes a specific thing to fix rather than a guess: a frame
 * that spent its time in `generateMs` is a bitmap-allocation problem, one that
 * spent it in `blitMs` is a draw-call problem.
 */
async function describeWorstFrame(page: Page): Promise<string> {
  const worst = await page.evaluate(() => {
    const frames = (window as StatsWindow).__driplStaticFrames ?? [];
    if (frames.length === 0) return null;
    let worstFrame = frames[0]!;
    let worstCost = -1;
    for (const frame of frames) {
      const cost =
        (frame.setupMs ?? 0) +
        (frame.generateMs ?? 0) +
        (frame.blitMs ?? 0) +
        (frame.directMs ?? 0);
      if (cost > worstCost) {
        worstCost = cost;
        worstFrame = frame;
      }
    }
    return {
      drawn: worstFrame.elementsDrawn,
      newBitmaps: worstFrame.bitmapsGenerated,
      reused: worstFrame.bitmapsReused,
      setupMs: worstFrame.setupMs ?? 0,
      generateMs: worstFrame.generateMs ?? 0,
      blitMs: worstFrame.blitMs ?? 0,
      directMs: worstFrame.directMs ?? 0,
    };
  });
  if (!worst) return '';
  return (
    `    worst frame: drawn=${worst.drawn} newBitmaps=${worst.newBitmaps} ` +
    `reused=${worst.reused} | setup=${worst.setupMs.toFixed(1)}ms ` +
    `generate=${worst.generateMs.toFixed(1)}ms blit=${worst.blitMs.toFixed(1)}ms ` +
    `direct=${worst.directMs.toFixed(1)}ms`
  );
}

async function readInvalidateCalls(page: Page): Promise<number> {
  return page.evaluate(() => (window as StatsWindow).__driplInvalidateCalls ?? 0);
}

/** Entries and bytes currently held by the element bitmap cache. */
async function readBitmapCache(page: Page): Promise<{ entries: number; trackedBytes: number }> {
  return page.evaluate(
    () => (window as StatsWindow).__driplBitmapCache ?? { entries: 0, trackedBytes: 0 }
  );
}

/**
 * Summarize the per-frame render counters. `maxDrawn` versus the expected
 * visible count is what would reveal viewport culling dropping elements;
 * `maxBitmapsNew` distinguishes bitmap allocation from bitmap blitting as the
 * dominant cost.
 */
async function summarizeStaticFrames(page: Page): Promise<StaticFrameSummary | null> {
  return page.evaluate(() => {
    const frames = (window as StatsWindow).__driplStaticFrames ?? [];
    if (frames.length === 0) return null;
    return {
      frames: frames.length,
      maxDrawn: Math.max(...frames.map(f => f.elementsDrawn)),
      maxBitmapsNew: Math.max(...frames.map(f => f.bitmapsGenerated)),
      totalBitmapsNew: frames.reduce((sum, f) => sum + f.bitmapsGenerated, 0),
      totalBitmapsDeferred: frames.reduce((sum, f) => sum + f.bitmapsDeferred, 0),
      framesDrawingNothing: frames.filter(f => f.elementsDrawn === 0).length,
    };
  });
}

function describeStaticFrames(summary: StaticFrameSummary | null): string {
  if (!summary) return '';
  return (
    `    static frames: n=${summary.frames} maxDrawn=${summary.maxDrawn} ` +
    `maxBitmapsNew=${summary.maxBitmapsNew} totalBitmapsNew=${summary.totalBitmapsNew} ` +
    `deferred=${summary.totalBitmapsDeferred} emptyFrames=${summary.framesDrawingNothing}`
  );
}

/**
 * Ink on each canvas layer, by DOM order. A static frame that draws zero
 * elements clears its canvas, so a zero-`drawn` counter is only safe if the
 * layer still holds content. This checks the end state rather than trusting the
 * counter.
 */
async function layerInk(page: Page): Promise<Array<{ index: number; ink: number }>> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('canvas')).map((canvas, index) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return { index, ink: -1 };
      const { width, height } = canvas;
      if (!width || !height) return { index, ink: -1 };
      const data = ctx.getImageData(0, 0, width, height).data;
      let ink = 0;
      for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 8) ink += 1;
      return { index, ink };
    })
  );
}

const SCENE_SIZES = (process.env.PERF_SCENE_SIZES ?? '1000,5000')
  .split(',')
  .map(value => Number(value.trim()))
  .filter(value => Number.isInteger(value) && value > 0);

// Mirrors DEFAULT_MAX_NEW_BITMAPS_PER_FRAME in
// packages/element/src/staticScene.ts, which the app does not override.
const MAX_NEW_BITMAPS_PER_FRAME = 100;

// Mirrors DEFAULT_ZOOM_SETTINGS in apps/dripl-app/utils/zoomUtils.ts.
const MIN_ZOOM = 0.1;
const ZOOM_FACTOR = 1.1;
const ZOOM_OUT_FACTOR = 1 / ZOOM_FACTOR;

/**
 * Build a persisted local scene. Rectangles are laid out on a predictable grid
 * so a scene size maps to a known on-screen area, which keeps the
 * zoom-to-fit phase comparable between runs.
 */
/**
 * Preferences-only localStorage payload.
 *
 * The scene itself is seeded into IndexedDB. This used to embed the full
 * element array in localStorage as well, which quietly capped the harness at
 * whatever fits the ~5 MB localStorage quota: a 50,000-element run died inside
 * `page.evaluate` with QuotaExceededError before the canvas ever mounted, and
 * the failure looked like an application bug. Seeding only preferences here
 * matches what the function's own comment claimed and removes the ceiling.
 */
function buildScene(): string {
  return JSON.stringify({
    userPreferences: {
      theme: 'light',
      zoom: 1,
      panX: 0,
      panY: 0,
      currentStrokeColor: '#1e1e1e',
      currentBackgroundColor: 'transparent',
      currentStrokeWidth: 2,
      currentRoughness: 1,
      currentStrokeStyle: 'solid',
      currentFillStyle: 'hachure',
      activeTool: 'select',
    },
    elementStates: { elements: [] },
  });
}

/** The element list, as the app stores it. */
function buildElements(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `perf-element-${index}`,
    type: 'rectangle',
    x: (index % 100) * 140,
    y: Math.floor(index / 100) * 100,
    width: 100,
    height: 70,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    locked: false,
    version: 1,
    versionNonce: 1,
  }));
}

/** How many elements the app currently has persisted for the local room. */
async function persistedElementCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dripl-canvas', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise<{ elements?: unknown[] } | undefined>((resolve, reject) => {
      const tx = db.transaction('canvas-rooms', 'readonly');
      const get = tx.objectStore('canvas-rooms').get('local-canvas');
      get.onsuccess = () => resolve(get.result as { elements?: unknown[] } | undefined);
      get.onerror = () => reject(get.error);
    });
    db.close();
    return Array.isArray(record?.elements) ? record.elements.length : 0;
  });
}

/**
 * Seed the scene on a page that does not mount the canvas, then open the
 * canvas. The scene goes into IndexedDB, which is the app's primary local store
 * and is not bound by the localStorage byte budget, so scene sizes above what
 * localStorage can hold are still measurable.
 */
async function openSeededCanvas(page: Page, count: number): Promise<void> {
  await page.goto('/login');
  await page.evaluate(
    async ({ elements, payload }) => {
      localStorage.setItem('dripl:local-canvas', payload);

      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('dripl-canvas', 1);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('canvas-rooms')) {
            db.createObjectStore('canvas-rooms', { keyPath: 'roomId' });
          }
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('canvas-rooms', 'readwrite');
          tx.objectStore('canvas-rooms').put({
            roomId: 'local-canvas',
            elements,
            lastModified: Date.now(),
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { elements: buildElements(count), payload: buildScene() }
  );

  await page.goto('/canvas');
  await page.waitForFunction(
    () => Boolean((window as PerformanceWindow).__driplPerformance?.snapshot().measures.length),
    undefined,
    { timeout: 60_000 }
  );
  // The bootstrap re-saves what it loaded, so this asserts both that the full
  // scene was restored and that it round-trips through local persistence.
  await expect.poll(() => persistedElementCount(page), { timeout: 30_000 }).toBe(count);
}

async function canvasBox(page: Page) {
  const canvas = page.locator('canvas').last();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('canvas has no layout box');
  return box;
}

function summarize(snapshot: BrowserPerformanceSnapshot, name: string): string {
  const durations = snapshot.measures
    .filter(measure => measure.name === name)
    .map(measure => measure.duration)
    .sort((a, b) => a - b);
  if (durations.length === 0) return `    ${name}: no samples`;
  const at = (fraction: number) =>
    durations[Math.min(durations.length - 1, Math.floor(durations.length * fraction))] ?? 0;
  return (
    `    ${name}: n=${durations.length} median=${at(0.5).toFixed(2)}ms ` +
    `p95=${at(0.95).toFixed(2)}ms max=${durations[durations.length - 1]!.toFixed(2)}ms`
  );
}

function describeSnapshot(snapshot: BrowserPerformanceSnapshot): string {
  const attribution = snapshot.samples
    .filter(sample => sample.type === 'long-animation-frame')
    .flatMap(sample => sample.attribution ?? [])
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 3)
    .map(
      script =>
        `      ${script.sourceFunctionName || script.name || 'anonymous'} ` +
        `${script.duration.toFixed(1)}ms (${script.sourceURL.split('/').pop() ?? ''})`
    );

  return [
    ...[...new Set(snapshot.measures.map(measure => measure.name))].map(name =>
      summarize(snapshot, name)
    ),
    `    observer samples: ${snapshot.samples.length}, long tasks: ${
      snapshot.samples.filter(sample => sample.type === 'longtask').length
    }, long animation frames: ${
      snapshot.samples.filter(sample => sample.type === 'long-animation-frame').length
    }`,
    ...(attribution.length > 0
      ? [`    slowest attributed scripts:\n${attribution.join('\n')}`]
      : []),
  ].join('\n');
}

/** Zoom out until the scene is small enough that most elements are visible. */
async function zoomToFit(page: Page, centerX: number, centerY: number): Promise<void> {
  await page.mouse.move(centerX, centerY);
  await page.keyboard.down('Control');
  let zoom = 1;
  while (zoom > MIN_ZOOM) {
    await page.mouse.wheel(0, 120);
    zoom *= ZOOM_OUT_FACTOR;
    // Wheel zoom applies synchronously per event (no animation to settle);
    // the pause keeps each step's frame work attributable instead of piling
    // events into one frame.
    await page.waitForTimeout(40);
  }
  await page.keyboard.up('Control');
  await page.waitForTimeout(250);
}

/**
 * Sample requestAnimationFrame cadence while a phase runs. Headless Chromium
 * uses a virtual frame source, so this is evidence about main-thread cadence,
 * not a real display's refresh rate.
 */
async function startFrameSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const frameWindow = window as FrameWindow;
    frameWindow.__driplFrames = [];
    frameWindow.__driplSampling = true;
    const tick = (time: number) => {
      if (!frameWindow.__driplSampling) return;
      frameWindow.__driplFrames?.push(time);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopFrameSampler(page: Page): Promise<FrameCadence> {
  return page.evaluate(() => {
    const frameWindow = window as FrameWindow;
    frameWindow.__driplSampling = false;
    const times = frameWindow.__driplFrames ?? [];
    const deltas = times
      .slice(1)
      .map((time, index) => time - (times[index] as number))
      .sort((a, b) => a - b);
    const at = (fraction: number) =>
      deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * fraction))] ?? 0;
    return {
      frames: times.length,
      medianDeltaMs: Number(at(0.5).toFixed(2)),
      p95DeltaMs: Number(at(0.95).toFixed(2)),
      maxDeltaMs: Number((deltas[deltas.length - 1] ?? 0).toFixed(2)),
      over20ms: deltas.filter(delta => delta > 20).length,
      over33ms: deltas.filter(delta => delta > 33).length,
    };
  });
}

type Phase = 'load' | 'zoom-out' | 'pan' | 'freehand';

async function runPhase(page: Page, phase: Phase, centerX: number, centerY: number): Promise<void> {
  await page.evaluate(() => (window as PerformanceWindow).__driplPerformance?.clear());

  if (phase === 'zoom-out') {
    await zoomToFit(page, centerX, centerY);
    return;
  }

  if (phase === 'pan') {
    await page.mouse.move(centerX - 160, centerY);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(centerX + 160, centerY + 60, { steps: 12 });
    await page.mouse.up({ button: 'middle' });
    await page.waitForTimeout(300);
    return;
  }

  await page.keyboard.press('p');
  await page.mouse.move(centerX - 90, centerY + 90);
  await page.mouse.down();
  await page.mouse.move(centerX + 90, centerY + 10, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

const PHASES: Phase[] = ['load', 'zoom-out', 'pan', 'freehand'];

test.describe('canvas performance evidence', () => {
  test.skip(
    !process.env.RUN_PERF_E2E,
    'Set RUN_PERF_E2E=true to collect browser performance evidence.'
  );

  test('records frame and input work for pan, zoom, and freehand', async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(240_000);

    for (const count of SCENE_SIZES) {
      await openSeededCanvas(page, count);

      const result: Record<string, unknown> = { sceneElements: count };
      writeStdout(`scene=${count} elements (headless Chromium, dev build)`);

      // The load phase is measured first and without clearing: these are the
      // very first static frames after a fresh scene, with an empty bitmap
      // cache. That cold redraw is the cost that used to scale with scene size.
      const loadSnapshot = await page.evaluate(() =>
        (window as PerformanceWindow).__driplPerformance?.snapshot()
      );
      if (!loadSnapshot) throw new Error('performance snapshot unavailable');
      const loadStatic = loadSnapshot.measures
        .filter(measure => measure.name === 'canvas:static:frame')
        .map(measure => measure.duration);
      const loadStats = await summarizeStaticFrames(page);
      writeStdout(
        `  phase=load (cold, empty cache)\n${describeSnapshot(loadSnapshot)}\n` +
          `    cold static frames: n=${loadStatic.length} ` +
          `max=${(loadStatic.length ? Math.max(...loadStatic) : 0).toFixed(2)}ms\n` +
          describeStaticFrames(loadStats)
      );
      result.load = loadSnapshot;

      const box = await canvasBox(page);
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;

      for (const phase of PHASES) {
        if (phase === 'load') continue;
        await clearStaticFrames(page);
        await startFrameSampler(page);
        await runPhase(page, phase, centerX, centerY);
        const cadence = await stopFrameSampler(page);
        const snapshot = await page.evaluate(() =>
          (window as PerformanceWindow).__driplPerformance?.snapshot()
        );
        if (!snapshot) throw new Error('performance snapshot unavailable');
        const frameStats = await summarizeStaticFrames(page);
        const ink = await layerInk(page);
        const invalidations = await readInvalidateCalls(page);
        const bitmapCache = await readBitmapCache(page);
        result[phase] = { snapshot, cadence, frameStats, ink, invalidations, bitmapCache };
        writeStdout(
          `  phase=${phase}\n${describeSnapshot(snapshot)}\n` +
            `    frame cadence: frames=${cadence.frames} median=${cadence.medianDeltaMs}ms ` +
            `p95=${cadence.p95DeltaMs}ms max=${cadence.maxDeltaMs}ms ` +
            `over20ms=${cadence.over20ms} over33ms=${cadence.over33ms}\n` +
            describeStaticFrames(frameStats) +
            `\n${await describeWorstFrame(page)}` +
            `\n    cache invalidations: ${invalidations}` +
            `\n    bitmap cache: entries=${bitmapCache.entries} ` +
            `bytes=${(bitmapCache.trackedBytes / (1024 * 1024)).toFixed(1)}MB` +
            `\n    layer ink: ${ink.map(l => `#${l.index}=${l.ink}`).join(' ')}`
        );

        // The static layer must never end a phase blank while the scene has
        // elements, so this guards the zero-`drawn` frames seen during gestures.
        if (frameStats && frameStats.maxDrawn > 0) {
          expect(ink[0]?.ink ?? -1, 'static layer blanked with a non-empty scene').toBeGreaterThan(
            0
          );
        }

        // The per-frame allocation budget must actually bound per-frame work.
        // This is a structural guarantee, not a timing claim: whatever the
        // machine is doing, no single frame may allocate more bitmaps than the
        // configured budget.
        if (frameStats) {
          expect(
            frameStats.maxBitmapsNew,
            'a single static frame exceeded the bitmap allocation budget'
          ).toBeLessThanOrEqual(MAX_NEW_BITMAPS_PER_FRAME);
        }

        // Deferred elements are drawn directly, so a phase that deferred work
        // must still have drawn a comparable number of elements.
        if (frameStats && frameStats.totalBitmapsDeferred > 0) {
          expect(frameStats.maxDrawn).toBeGreaterThan(frameStats.totalBitmapsDeferred / 10);
        }

        expect(snapshot.measures.some(measure => measure.name === 'canvas:static:frame')).toBe(
          true
        );
        await testInfo.attach(`canvas-performance-${count}-${phase}.json`, {
          body: JSON.stringify(result, null, 2),
          contentType: 'application/json',
        });
      }
    }
  });
});
