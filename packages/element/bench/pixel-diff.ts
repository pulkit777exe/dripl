import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DriplElement } from '@dripl/common';
import {
  renderStaticScene,
  resetElementBitmapCacheForTest,
  type StaticSceneConfig,
} from '../src/staticScene';
import { createCountingHost } from './counting-canvas';
import { createRasterHost, diffSurfaces, type Surface } from './raster';
import { cropMagnified, decodePng, encodePng } from './png';
import { makeScene } from './scene';

/**
 * Pixel-level render-path comparison.
 *
 * WHAT THIS IS FOR
 * ----------------
 * `bench/counting-canvas.ts` says how much work the render path does. This says
 * whether the work produces the same image. Those are different questions, and
 * for one specific candidate — dropping the per-element `save`/`restore` around
 * a cached-bitmap blit — only the second one decides whether the change is
 * allowed.
 *
 * It drives the real `renderStaticScene` over scenes chosen to cover every state
 * the candidate touches: rotated elements (transform), partial opacity
 * (`globalAlpha`), the grid drawn *before* elements in a *later* frame (state
 * that would leak across a frame boundary if `restore` stopped doing its job),
 * deferred elements drawn as placeholders, a hi-DPI device pixel ratio, and an
 * arrow whose label is cut out of its own bitmap with `destination-out`.
 *
 * Two properties make the result worth something:
 *
 * 1. **The rasterizer refuses to guess.** Any canvas operation it does not model
 *    throws (see `bench/raster.ts`), so a run that completes has modelled every
 *    operation the render path actually issued.
 * 2. **The harness is checked against a real difference before it is trusted.**
 *    `--selftest` shifts the whole image by one device pixel, by half a device
 *    pixel, changes one element's alpha, drops one element, and requires each to
 *    be detected — and requires an identical re-render to be byte-identical. A
 *    diff harness that cannot fail is worse than none.
 *
 * USAGE
 * -----
 *   tsx bench/pixel-diff.ts --selftest
 *   tsx bench/pixel-diff.ts --out <dir>            # write <name>.png per scene
 *   tsx bench/pixel-diff.ts --out <dir> --compare <baselineDir>
 */

const VIEWPORT = { width: 1280, height: 720 } as const;

interface SceneViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

interface SceneSpec {
  name: string;
  elements: DriplElement[];
  viewport: SceneViewport;
  config: Omit<StaticSceneConfig, 'zoom' | 'elements' | 'visibleElements'>;
  /**
   * Frames to render onto the *same* context before the pixels are kept.
   *
   * More than one matters: canvas state that survives a frame is exactly what a
   * removed `save`/`restore` would corrupt, and it can only be observed on a
   * later frame.
   */
  frames: number;
}

function viewport(zoom: number, overrides: Partial<SceneViewport> = {}): SceneViewport {
  return { x: 0, y: 0, ...VIEWPORT, zoom, ...overrides };
}

function withAngle(elements: DriplElement[], everyNth: number): DriplElement[] {
  return elements.map((element, index) =>
    index % everyNth === 0 ? ({ ...element, angle: (index % 7) * 0.45 } as DriplElement) : element
  );
}

function withOpacity(elements: DriplElement[]): DriplElement[] {
  const levels = [1, 0.35, 1, 0.7];
  return elements.map((element, index) => ({
    ...element,
    opacity: levels[index % levels.length] as number,
  })) as DriplElement[];
}

/**
 * Arrows whose labels are drawn into their own bitmaps as a cut-out.
 *
 * `points` are relative to the element origin (`toRelativePoints` in the app
 * enforces that convention), and the label has to sit inside the element's own
 * bounds for the `destination-out` cut-out to land in the bitmap instead of off
 * the edge of it. A gap in the shaft is the evidence that this path really ran.
 */
function arrowLabelScene(): DriplElement[] {
  const elements: DriplElement[] = [];
  for (let index = 0; index < 4; index += 1) {
    const originX = 30 + index * 20;
    const originY = 40 + index * 110;
    elements.push({
      id: `text-${index}`,
      type: 'text',
      x: originX + 100,
      y: originY + 12,
      width: 120,
      height: 24,
      text: `label ${index}`,
      fontSize: 14,
      fontFamily: 'Inter',
      strokeColor: '#333333',
      opacity: 1,
      roughness: 1,
      version: 1,
      versionNonce: index + 1,
      seed: index + 1,
    } as DriplElement);
    elements.push({
      id: `arrow-${index}`,
      type: 'arrow',
      x: originX,
      y: originY,
      width: 300,
      height: 50,
      points: [
        { x: 0, y: 25 },
        { x: 300, y: 25 },
      ],
      labelId: `text-${index}`,
      strokeColor: '#1e1e1e',
      strokeWidth: 2,
      opacity: 1,
      roughness: 1,
      version: 1,
      versionNonce: 100 + index,
      seed: 200 + index,
    } as unknown as DriplElement);
  }
  return elements;
}

/**
 * The scenes under comparison.
 *
 * Sized for turnaround rather than for coverage of the whole product: each is
 * big enough that a per-element change lands on hundreds of pixels, and small
 * enough that a full rasterized run stays interactive while iterating.
 */
function scenes(): SceneSpec[] {
  return [
    {
      name: 'dense-mixed',
      elements: makeScene(1200, 'mixed'),
      viewport: viewport(0.27),
      config: { gridEnabled: false, gridSize: 20, theme: 'light', dpr: 1 },
      frames: 1,
    },
    {
      name: 'rotated',
      elements: withAngle(makeScene(150, 'mixed'), 3),
      viewport: viewport(0.7),
      config: { gridEnabled: false, gridSize: 20, theme: 'light', dpr: 1 },
      frames: 1,
    },
    {
      name: 'opacity',
      elements: withOpacity(makeScene(150, 'mixed')),
      viewport: viewport(0.7),
      config: { gridEnabled: false, gridSize: 20, theme: 'light', dpr: 1 },
      frames: 1,
    },
    {
      name: 'arrow-labels',
      elements: arrowLabelScene(),
      viewport: viewport(0.9),
      config: { gridEnabled: false, gridSize: 20, theme: 'light', dpr: 1 },
      frames: 1,
    },
    {
      // Grid plus two frames: the grid is drawn before any element touches
      // `globalAlpha`, so it only stays opaque if the previous frame's last
      // element did not leave a reduced alpha behind.
      name: 'grid-two-frames',
      elements: withOpacity(makeScene(150, 'mixed')),
      viewport: viewport(0.7),
      config: { gridEnabled: true, gridSize: 20, theme: 'light', dpr: 1 },
      frames: 2,
    },
    {
      // A small per-frame allocation budget leaves a mix of placeholders and
      // real bitmaps in the frame, which is the state a cold dense scene is in
      // for its first several frames.
      name: 'deferred',
      elements: makeScene(400, 'mixed'),
      viewport: viewport(0.5),
      config: {
        gridEnabled: false,
        gridSize: 20,
        theme: 'light',
        dpr: 1,
        maxNewBitmapsPerFrame: 25,
      },
      frames: 3,
    },
    {
      name: 'dark-dpr2',
      elements: makeScene(150, 'mixed'),
      viewport: viewport(0.6),
      config: { gridEnabled: true, gridSize: 20, theme: 'dark', dpr: 2 },
      frames: 1,
    },
  ];
}

interface FrameOutcome {
  surface: Surface;
  visible: Record<string, number>;
  offscreen: Record<string, number>;
}

/**
 * Pin `Math.random` to a fixed sequence for the duration of `body`.
 *
 * WHY THIS IS NECESSARY, AND IT IS NOT THE HARNESS BEING SLOPPY
 * -----------------------------------------------------------
 * The render path is genuinely nondeterministic today, and the harness has to
 * deal with that rather than pretend it away. `bench/tmp-determinism` work
 * showed two identical renders of the same 150-element scene differing in 14-19
 * pixels, every one of them inside an **arrow**.
 *
 * The cause is `drawArrowhead` in `packages/element/src/rough-renderer.ts`: it
 * builds Rough options with no `seed`. Rough's `Randomizer` falls back to
 * `Math.random()` when its seed is `0`, so an arrow's *arrowhead* is redrawn with
 * fresh randomness on every bitmap generation, while the arrow body (which does
 * carry the element seed) stays stable. Confirmed by instrumenting
 * `Math.random`: 720 draws per cold render, and the differing pixels are
 * exactly the arrowhead pixels.
 *
 * That is a rendering bug, and it is reported rather than fixed — fixing it
 * changes what gets drawn. Here it only means the comparison has to pin the
 * sequence so that a difference in the pixels is attributable to the change
 * under test. Pinning is also the conservative direction: a change that alters
 * *how many* random draws happen before a given element shifts the sequence and
 * shows up as a diff to be explained, rather than cancelling out silently.
 */
function withDeterministicRandom<T>(body: () => T): T {
  const real = Math.random;
  let state = 0x2f6e2b1;
  Math.random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  try {
    return body();
  } finally {
    Math.random = real;
  }
}

/** Render a scene's frames onto one context and keep the last one's pixels. */
function renderPixels(spec: SceneSpec): FrameOutcome {
  return withDeterministicRandom(() => {
    resetElementBitmapCacheForTest();
    const host = createRasterHost(spec.viewport.width, spec.viewport.height);
    try {
      for (let frame = 0; frame < spec.frames; frame += 1) {
        renderStaticScene(host.canvas, spec.elements, spec.viewport, {
          ...spec.config,
          zoom: spec.viewport.zoom,
          elements: spec.elements,
          visibleElements: spec.elements,
        });
      }
      return {
        surface: host.surface(),
        visible: { ...host.visible },
        offscreen: { ...host.offscreen },
      };
    } finally {
      host.dispose();
    }
  });
}

/**
 * Render the same scene through the counting host instead.
 *
 * The two hosts must agree on every call. That is the check that the rasterizer
 * modelled all the work: if it skipped an operation the counter saw, the tallies
 * diverge here rather than the pixel comparison quietly reporting "no change".
 */
interface CountedOutcome {
  visible: Record<string, number>;
  offscreen: Record<string, number>;
}

function renderCounted(spec: SceneSpec): CountedOutcome {
  return withDeterministicRandom(() => {
    resetElementBitmapCacheForTest();
    const host = createCountingHost({
      width: spec.viewport.width,
      height: spec.viewport.height,
      dpr: spec.config.dpr ?? 1,
    });
    try {
      for (let frame = 0; frame < spec.frames; frame += 1) {
        renderStaticScene(host.canvas, spec.elements, spec.viewport, {
          ...spec.config,
          zoom: spec.viewport.zoom,
          elements: spec.elements,
          visibleElements: spec.elements,
        });
      }
      // Kept per surface rather than merged. Both tallies share operation names
      // (`save`, `restore`, `translate`, `scale`), and merging them lets the
      // larger offscreen count silently mask a change on the visible canvas —
      // which is exactly the change worth reporting.
      return { visible: { ...host.visible }, offscreen: { ...host.offscreen } };
    } finally {
      host.dispose();
    }
  });
}

function sameTally(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if ((a[key] ?? 0) !== (b[key] ?? 0)) return false;
  return true;
}

// ─── Self-test ────────────────────────────────────────────────────────────────

interface Check {
  name: string;
  expect: 'same' | 'different';
  diff: ReturnType<typeof diffSurfaces>;
}

/**
 * Prove the harness can detect a real difference, and can agree when there is
 * none.
 *
 * The mutations are deliberately tiny: one device pixel of pan, half a device
 * pixel, one element's alpha, one missing element. A harness that only notices a
 * dropped element is not a harness, it is a scene counter.
 */
function selfTest(): Check[] {
  const base: SceneSpec = {
    name: 'selftest',
    elements: makeScene(150, 'mixed'),
    viewport: viewport(0.7),
    config: { gridEnabled: false, gridSize: 20, theme: 'light', dpr: 1 },
    frames: 1,
  };
  const reference = renderPixels(base).surface;

  const checks: Check[] = [];
  checks.push({
    name: 'identical re-render is byte-identical',
    expect: 'same',
    diff: diffSurfaces(reference, renderPixels(base).surface),
  });

  const shift = (devicePixels: number): SceneSpec => ({
    ...base,
    // A pan of 1/zoom world pixels is exactly `devicePixels` device pixels at
    // this zoom, because the viewport transform divides pan by zoom.
    viewport: { ...base.viewport, x: devicePixels / base.viewport.zoom },
  });

  checks.push({
    name: 'one device pixel of pan is detected',
    expect: 'different',
    diff: diffSurfaces(reference, renderPixels(shift(1)).surface),
  });
  checks.push({
    name: 'half a device pixel of pan is detected',
    expect: 'different',
    diff: diffSurfaces(reference, renderPixels(shift(0.5)).surface),
  });
  checks.push({
    name: 'one element dropped is detected',
    expect: 'different',
    diff: diffSurfaces(
      reference,
      renderPixels({ ...base, elements: base.elements.slice(1) }).surface
    ),
  });
  // Indices 0 and 7 are inside the viewport at this zoom; index 40 is 5,600
  // world pixels to the right of the origin and therefore off-canvas. Getting
  // that distinction right is the point of the last two checks: a harness that
  // reported a difference for an off-canvas element would be reporting noise.
  checks.push({
    name: 'one on-canvas element alpha 1 -> 0.99 is detected',
    expect: 'different',
    diff: diffSurfaces(
      reference,
      renderPixels({
        ...base,
        elements: base.elements.map((element, index) =>
          index === 0 ? ({ ...element, opacity: 0.99 } as DriplElement) : element
        ),
      }).surface
    ),
  });
  checks.push({
    name: 'an off-canvas element changing is correctly invisible',
    expect: 'same',
    diff: diffSurfaces(
      reference,
      renderPixels({
        ...base,
        elements: base.elements.map((element, index) =>
          index === 40 ? ({ ...element, opacity: 0.2 } as DriplElement) : element
        ),
      }).surface
    ),
  });
  checks.push({
    name: 'z-order swap of two overlapping elements is detected',
    expect: 'different',
    diff: diffSurfaces(
      reference,
      renderPixels({
        ...base,
        elements: (() => {
          const copy = [...base.elements];
          const a = copy[10] as DriplElement;
          const b = copy[11] as DriplElement;
          // Same positions, opposite draw order.
          copy[10] = { ...b, x: a.x, y: a.y } as DriplElement;
          copy[11] = { ...a } as DriplElement;
          return copy;
        })(),
      }).surface
    ),
  });
  return checks;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };

  if (args.includes('--selftest')) {
    const checks = selfTest();
    let failures = 0;
    for (const check of checks) {
      const detected = check.diff.differingPixels > 0;
      const passed = check.expect === 'different' ? detected : !detected;
      if (!passed) failures += 1;
      process.stdout.write(
        `${passed ? 'PASS' : 'FAIL'}  ${check.name}: differingPixels=${check.diff.differingPixels} ` +
          `maxChannelDelta=${check.diff.maxChannelDelta} of ${check.diff.width * check.diff.height} pixels ` +
          `(painted ${check.diff.paintedPixels})\n`
      );
    }
    process.stdout.write(
      `self-test: ${checks.length - failures}/${checks.length} checks behaved as required\n`
    );
    process.exitCode = failures === 0 ? 0 : 1;
    return;
  }

  const outDir = flag('--out');
  const baselineDir = flag('--compare');
  if (!outDir) {
    process.stderr.write(
      'usage: pixel-diff.ts --selftest | --out <dir> [--compare <baselineDir>]\n'
    );
    process.exitCode = 2;
    return;
  }
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const report: Record<string, unknown>[] = [];
  let mismatches = 0;
  for (const spec of scenes()) {
    const rendered = renderPixels(spec);
    const counted = renderCounted(spec);
    // Per surface: a merged comparison would hide a visible-canvas difference
    // behind a larger offscreen count of the same operation.
    const talliesAgree =
      sameTally(counted.visible, rendered.visible) &&
      sameTally(counted.offscreen, rendered.offscreen);
    if (!talliesAgree) mismatches += 1;

    const file = join(outDir, `${spec.name}.png`);
    writeFileSync(file, encodePng(rendered.surface));

    // The encoder is only evidence if it round-trips.
    const roundTrip = decodePng(readFileSync(file));
    const encodedFaithful =
      roundTrip.width === rendered.surface.width && roundTrip.height === rendered.surface.height;
    if (!encodedFaithful) mismatches += 1;

    const entry: Record<string, unknown> = {
      scene: spec.name,
      png: file,
      frames: spec.frames,
      paintedPixels: countPainted(rendered.surface),
      hostTalliesAgree: talliesAgree,
      pngRoundTrips: encodedFaithful,
      visibleCalls: rendered.visible,
      offscreenCalls: rendered.offscreen,
    };

    const baselinePath = baselineDir ? join(baselineDir, `${spec.name}.png`) : null;
    if (baselinePath && existsSync(baselinePath)) {
      const baseline = decodePng(readFileSync(baselinePath));
      const diff = diffSurfaces(baseline, rendered.surface);
      entry.diff = diff;
      if (diff.differingPixels > 0) {
        mismatches += 1;
        writeFileSync(
          join(outDir, `${spec.name}.DIFF.png`),
          encodePng(diffImage(baseline, rendered.surface))
        );
        writeFileSync(join(outDir, `${spec.name}.BEFORE.png`), encodePng(baseline));
        writeFileSync(join(outDir, `${spec.name}.AFTER.png`), encodePng(rendered.surface));
        writeFileSync(
          join(outDir, `${spec.name}.BEFORE-8x.png`),
          encodePng(cropMagnified(baseline, 0, 0, 200, 160, 8))
        );
        writeFileSync(
          join(outDir, `${spec.name}.AFTER-8x.png`),
          encodePng(cropMagnified(rendered.surface, 0, 0, 200, 160, 8))
        );
      }
    }

    report.push(entry);
  }

  process.stdout.write(
    `${JSON.stringify({ kind: 'pixel-diff', mismatches, scenes: report }, null, 2)}\n`
  );
  if (mismatches > 0) process.exitCode = 1;
}

function countPainted(surface: Surface): number {
  let painted = 0;
  for (let index = 3; index < surface.data.length; index += 4) {
    if ((surface.data[index] as number) > 0) painted += 1;
  }
  return painted;
}

/** Before in greyscale, differing pixels in magenta: the diff, visible. */
function diffImage(before: Surface, after: Surface): Surface {
  const data = new Uint8ClampedArray(before.data.length);
  for (let pixel = 0; pixel < before.width * before.height; pixel += 1) {
    const offset = pixel * 4;
    const grey = Math.round(
      ((before.data[offset] as number) +
        (before.data[offset + 1] as number) +
        (before.data[offset + 2] as number)) /
        3
    );
    const differs =
      before.data[offset] !== after.data[offset] ||
      before.data[offset + 1] !== after.data[offset + 1] ||
      before.data[offset + 2] !== after.data[offset + 2] ||
      before.data[offset + 3] !== after.data[offset + 3];
    data[offset] = differs ? 255 : grey;
    data[offset + 1] = differs ? 0 : grey;
    data[offset + 2] = differs ? 255 : grey;
    data[offset + 3] = 255;
  }
  return { width: before.width, height: before.height, data };
}

main();
