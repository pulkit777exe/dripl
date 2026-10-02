# Performance evidence

This file records two separate kinds of evidence:

1. [Synthetic microbenchmark](#synthetic-microbenchmark) — isolated Node operations on generated data.
2. [Browser capture](#browser-capture) — real Chromium measurements of the canvas frame and input path.

The two are not comparable. The microbenchmark is not a browser claim, and the
browser capture is not a full end-to-end latency or production claim.

---

## Synthetic microbenchmark

**Run date:** 2026-09-25  
**Command:** `pnpm benchmark:canvas`  
**Runtime:** Node v24.19.0, Linux workspace

**Provenance:** These numbers are from the current synthetic benchmark run in
this working tree.

The benchmark is intentionally a **microbenchmark**, not a browser FPS or end-to-end latency claim. It exercises the spatial-index query, geometry-bound calculation, version reconciliation, and element mutation paths with 10,000 synthetic rectangles.

| Measurement                  | Iterations |    Median |       Min |       Max |
| ---------------------------- | ---------: | --------: | --------: | --------: |
| RBush viewport query (10k)   |         20 | 0.0169 ms | 0.0151 ms | 0.0539 ms |
| Element bounds (10k)         |         20 | 0.4710 ms | 0.3627 ms | 0.7479 ms |
| Version reconciliation (10k) |         20 | 0.0656 ms | 0.0497 ms | 0.1798 ms |
| Mutate element (1k)          |         20 | 0.3327 ms | 0.0813 ms | 0.4345 ms |

These numbers describe only the isolated JavaScript operations on synthetic data. They do **not** establish browser frame rate, canvas paint time, WebSocket latency, database latency, or behavior under a real scene.

---

## Browser capture

**Run date:** 2026-09-25  
**Command:**

```bash
RUN_PERF_E2E=true E2E_PORT=3111 PERF_SCENE_SIZES=1000,5000 \
  pnpm --filter dripl-app test:e2e e2e/performance.spec.ts
```

Note the argument form: `pnpm --filter dripl-app test:e2e -- <spec>` forwards the
literal `--` to Playwright, which then runs the whole suite instead of the one
spec.

**Environment (exact, and limited):**

| Property  | Value                                                                          |
| --------- | ------------------------------------------------------------------------------ |
| Browser   | Headless Chromium 153.0.8010.12 (Playwright build 1243)                        |
| App build | Next.js 16.3.6 **development** server (`next dev --turbopack`)                 |
| Viewport  | 1280×720 CSS px, `devicePixelRatio` 1                                          |
| Scene     | Generated grid of `rectangle` elements seeded through the local storage format |
| Host      | Single Linux machine, no GPU-specific tuning, no throttling control            |

**These numbers are not FPS claims and not production numbers.** Specifically:

- Headless Chromium drives `requestAnimationFrame` from a virtual frame source.
  The frame-cadence figures below describe main-thread cadence in headless, not
  a display's refresh rate, and the median frame delta is not stable enough
  across runs to be reported as a frame rate.
- The app runs as a development build, with React dev-mode overhead and no
  minification. A production build is expected to be faster.
- `performance.measure` durations are quantized (observed `0.0 ms` / `0.1 ms`
  steps), so sub-0.1 ms differences are not meaningful here.
- Scenes are uniform rectangles. Real scenes with text, images, arrows, and
  bindings are heavier per element.
- One machine, one run configuration. These are not distributions.

### Measured results

Durations are milliseconds per instrumented frame callback. `n` is the number of
sampled frames in that phase.

| Scene | Phase    | `canvas:interactive:frame` median / p95 | `canvas:pointer-move` median / p95 | `canvas:static:frame` median / p95 | Long tasks | Long animation frames |
| ----- | -------- | --------------------------------------- | ---------------------------------- | ---------------------------------- | ---------: | --------------------: |
| 1,000 | zoom-out | 0.00 / 0.10                             | 0.80 / 0.80                        | 0.90 / 3.10                        |          0 |                     0 |
| 1,000 | pan      | 0.00 / 0.10                             | 0.30 / 0.60                        | 0.50 / 1.50                        |          0 |                     0 |
| 1,000 | freehand | 0.10 / 0.30                             | 0.30 / 1.10                        | 0.10 / 1.10                        |          0 |                     0 |
| 5,000 | zoom-out | 0.00 / 0.10                             | 0.20 / 0.20                        | 1.50 / 9.10                        |          0 |                     0 |
| 5,000 | pan      | 0.00 / 0.10                             | 0.60 / 1.00                        | 4.30 / 75.80                       |          7 |                     1 |
| 5,000 | freehand | 0.00 / 0.10                             | 0.30 / 0.50                        | 0.00 / 19.20                       |          0 |                     0 |

Frame cadence during those phases (headless virtual frame source, see the
caveats above): median frame delta 16.7 ms, with 4–15 intervals above 33 ms per
phase, and a worst observed single-frame stall of 133 ms at 5,000 elements.

### Retracted: a "bitmap policy" optimization that did not survive scrutiny

This section previously reported that drawing small elements directly, instead
of blitting cached bitmaps, cut the worst freehand static frame from 11.2–15.6 ms
to 0.3–0.4 ms. **That result was not real and the claim is withdrawn.**

Two independent mistakes produced it:

1. **Stale build.** The app imports `@dripl/element/*` from the package's built
   `dist/`, not its source. Editing `packages/element/src` changes nothing in the
   browser until the package is rebuilt, so an early A/B ran the _same_ code in
   both arms.
2. **Non-interleaved arms.** Even after fixing that, the arms were measured as
   "all of A, then all of B", minutes apart. On this machine that is not a valid
   comparison.

The noise floor, measured by running **identical code** four times:

| Metric (identical build)                | Observed range   |
| --------------------------------------- | ---------------- |
| load phase (cold, ~60 visible elements) | 9.10 – 22.70 ms  |
| pan `canvas:static:frame` p95           | 12.10 – 65.10 ms |
| freehand `canvas:static:frame` max      | 16.80 – 75.70 ms |

The load phase is a control that the bitmap policy cannot affect, and it varied
by 2.5× across identical runs. Any effect smaller than that is unmeasurable here.

A correctly-run interleaved A/B (source switched **and** rebuilt between arms,
arms alternating) then showed no difference at all:

| Phase           | Policy active    | Policy disabled  |
| --------------- | ---------------- | ---------------- |
| pan median      | 2.20 / 3.00 ms   | 2.10 / 3.00 ms   |
| freehand median | 0.10 / 0.10 ms   | 0.10 / 0.10 ms   |
| freehand max    | 45.00 / 34.50 ms | 16.80 / 30.10 ms |

Medians are identical and the tail does not separate the arms — the "active" arm
was worse in both rounds. The optimization was therefore **reverted** rather than
kept on the strength of a number that could not be reproduced. Reverting also
removed a policy that would have pushed free-draw paths and hachure-filled shapes
into per-frame geometry regeneration, a risk that was never measured.

Two things from the attempt did survive, because they are verifiable without a
stopwatch:

- `createRoughCanvas` no longer resizes a module-level scratch canvas that the
  function never draws into. That was dead work, provable by reading the function.
- Deterministic seeding for seedless elements, below.

### Fixed: the worst dense-scene frame is now bounded, with the cost attributed first

Before changing anything, the frame was attributed internally. `renderStaticScene`
now reports `setupMs` / `generateMs` / `blitMs` / `directMs` (development only,
and only when a caller asks for stats, because attribution costs clock reads per
element). At 10,000 elements, the worst frame looked like this:

| Bucket                            |    Time | Per element |
| --------------------------------- | ------: | ----------: |
| build new bitmaps (300)           | 22.8 ms |      ~76 us |
| blit already-cached bitmaps (540) |  0.9 ms |     ~1.7 us |
| clear + camera transform          |  0.0 ms |           - |

So **96% of the frame was Rough.js path generation**, and a generation costs
~40x a blit. That both explains why the bitmap cache is worth having and
identifies the real target.

It also invalidated the first attempt at this fix. The budget originally deferred
elements to a direct Rough.js draw, which re-runs the same generation, so it
moved the cost rather than removing it. Deferred elements now draw a cheap
placeholder (filled and stroked bounding box, honouring opacity and rotation), and
the budget dropped from 400 to 100, which is ~7.6 ms of generation at the
measured per-bitmap cost.

Measured on the pan phase at 10,000 elements, one run per arm:

|                                   |         Before |                After |
| --------------------------------- | -------------: | -------------------: |
| worst static frame                |       24.10 ms |         **14.20 ms** |
| worst frame, generation only      |        22.8 ms |          **11.8 ms** |
| max bitmaps in one frame          | 300 (uncapped) | **100 (at the cap)** |
| elements deferred to placeholders |              0 |                  408 |
| static frame median               |        1.80 ms |              6.30 ms |
| static layer ink                  |         29,899 |               28,963 |

The last two rows deserve the same attention as the first two. The **median
rose**, because the work is now spread over 16 frames instead of 13 - which is
what amortization means. The tail fell. The ~3% ink difference is the
placeholder drawing a crisp rectangle where a sketch was drawn before; content is
not missing, and the E2E spec asserts the static layer is never blank.

The bound is enforced, not hoped for: `e2e/performance.spec.ts` fails if any
frame exceeds the cap, and `staticScene.budget.test.ts` drives the deferred path
directly, asserting allocation stops at the budget, every candidate is still
drawn, and successive frames converge until nothing is deferred.

Remaining: a ~14 ms worst frame is still uncomfortable against a 16.7 ms budget
on a slower machine. Generation is inherent to first paint of newly exposed
elements and does not go away with scene size.

### The bound was re-checked at 50,000 elements, not just 10,000

A cap that holds at one scene size is a guess. Persistence now accepts up to
50,000 elements, so the harness can seed a scene 5x denser than the one the cap
was originally tuned against.

Getting there exposed a harness ceiling that looked like an application bug: the
seeding step wrote the full element array into localStorage _as well as_ into
IndexedDB, so a 50,000-element run died inside `page.evaluate` with
`QuotaExceededError` before the canvas ever mounted. The scene is seeded into
IndexedDB by design; the localStorage copy is now preferences only, which is
what the function's own comment always claimed.

At 50,000 elements on the same machine and browser:

| Phase    | Worst static frame | Generation in that frame | Max bitmaps/frame | Deferred |            Bitmap cache |
| -------- | -----------------: | -----------------------: | ----------------: | -------: | ----------------------: |
| zoom-out |           13.80 ms |                   7.2 ms |                62 |        0 |   980 entries / 40.4 MB |
| pan      |           13.40 ms |                  10.6 ms |  100 (at the cap) |      300 | 1,280 entries / 52.7 MB |
| freehand |            8.40 ms |                   1.5 ms |                 1 |        0 | 1,281 entries / 55.2 MB |

The cap held, the byte bound held (55.2 MB against a 128 MB limit), and static
layer ink stayed non-zero in every phase, so nothing was dropped.

Worth being precise about what this does and does not show. Zooming to fit
bounds how many elements are on screen regardless of scene size, so a bigger
scene does not mean more pixels of work per frame - at 50,000 the visible count
(918) is close to the 10,000 case (858). What the larger scene does exercise is
everything keyed to scene size rather than screen size: the spatial index, the
persistence round-trip, and the bitmap cache. It confirms the bound is not
tuned to one scene, and it confirms the cache stays inside its byte budget at
five times the element count. It does **not** measure a screen packed with more
elements, which would need a denser layout at a fixed zoom.

### Scene sizes above 5,000 are now measurable

The cap that blocked this is gone. `MAX_PERSISTED_ELEMENTS` in
`apps/dripl-app/lib/canvas-db.ts` is 50,000, and the performance spec seeds
through IndexedDB (the app's primary local store) rather than localStorage, so
byte budgets no longer limit scene size. The spec asserts the persisted element
count after load, so a scene that fails to round-trip fails the run rather than
silently measuring fewer elements.

### Fixed with this harness: wheel-pan inertia blanked the canvas

The spec asserts the static layer is never blank at the end of a phase while the
scene has elements. That assertion failed on a 10,000-element scene, with
**all three canvas layers at zero ink** after the pan phase.

The cause was not rendering. `useCanvasWheel` fed wheel deltas into a velocity
loop that decayed by only 0.95 per frame. A single 200-unit wheel notch started
at ~300 px/frame, which glides roughly 6,000 px over about two seconds. At zoom
0.1 on a scene 14,000 px wide that carries the viewport far off the content, and
the canvas goes blank. The same loop was the source of the `applyMomentum`
attributions earlier in this file (135 ms, 112 ms, 91 ms).

Wheel and trackpad now pan directly by the delta, and shift+wheel reads
`deltaY || deltaX`.

After the fix, at 10,000 elements:

|                                        |                       Before |  After |
| -------------------------------------- | ---------------------------: | -----: |
| static layer ink after pan             |                    0 (blank) | 29,886 |
| static frames during freehand          | 21, of which 16 drew nothing |      1 |
| max bitmaps generated in one pan frame |                          570 |    320 |

The freehand change is a consequence rather than a tuned number: with no
momentum loop running, the static layer is no longer invalidated frame after
frame for a viewport that has stopped moving. **No frame-time improvement is
claimed here**, because frame times on this machine are not separable from noise.

### Where the remaining static-frame time goes

`renderStaticScene` now reports per-frame counters (`StaticSceneFrameStats`,
surfaced in development as `window.__driplStaticFrames`), because timing alone
cannot separate "allocated thousands of bitmaps" from "blitted thousands of
them". At 10,000 elements:

| Phase       | max elements drawn | max bitmaps generated | static frame median / p95 |
| ----------- | -----------------: | --------------------: | ------------------------- |
| load (cold) |                 80 |                    80 | 9.00 / 9.00 ms            |
| zoom-out    |                945 |                    60 | 1.20 / 9.00 ms            |
| pan         |                891 |                   320 | 1.50 / 23.70 ms           |
| freehand    |                861 |                     1 | 6.20 / 6.20 ms            |

Two things this settles:

- **Culling is working.** About 900 elements are drawn, and a hand calculation
  for the zoom-to-fit viewport gives 1,000–1,700, so the count is in range. An
  earlier suspicion that culling was dropping elements was checked and is not
  supported.
- **The expensive frames allocate.** Frames that allocate hundreds of bitmaps
  are the expensive ones, while the interactive layer stays at a 0.00 ms median
  regardless of scene size. This is the O(visible) cost, and amortizing it
  remains open.

### Change implemented: element canvas size cap

A missing cap turned out to be a genuine robustness gap rather than a
performance one. Every element's offscreen canvas is now capped at
`AREA_LIMIT = 16777216` and `WIDTH_HEIGHT_LIMIT = 32767`, reducing the resolution
instead of refusing to cache. Dripl had no cap at all, so a 40,000 x 40,000
element would request a ~1.6 billion pixel surface.

`computeElementCanvasSize` in `packages/element/src/staticScene.ts` now applies
the same two limits, and the cache entry records the resolution actually used so
`drawImage` still stretches the bitmap over the element's full logical size.

Verified in the browser:

| Element size (dpr 1) | Result                                     |
| -------------------- | ------------------------------------------ |
| 40,000 x 40,000      | renders, no error, capped to 4,096 x 4,096 |
| 8,000 x 8,000        | renders, area capped under 16,777,216      |
| 2,000 x 2,000        | renders, uncapped (4,040 px per axis)      |

And verified as a **non-regression** on ordinary scenes: a 40-element scene
renders to exactly 49,110 ink pixels, bit-for-bit identical to the value measured
before the `drawImage` math changed. Nine unit tests pin the caps, the
aspect-ratio preservation, and the degenerate-input cases.

The honest summary of this line of work: the cap is a correctness fix that is
deterministically verifiable. The performance claim was noise, and is withdrawn.

### Deterministic rendering for seedless elements

`seed` is optional in the element schema, and elements drawn in the app always get
one. Imported, legacy, or hand-authored scenes can arrive without one, and
Rough.js then picks a random seed on every generation, so an element's sketch
changes each time its bitmap is regenerated.

`resolveElementSeed` in `packages/element/src/rough-renderer.ts` now derives a
stable seed from the element id in that case. Verified in the browser on a
seedless scene over three fresh page loads, after rebuilding the package:

| Scene                   | Ink across 3 fresh page loads |
| ----------------------- | ----------------------------- |
| explicit seeds          | 49,702 / 49,702 / 49,702      |
| no seed, before the fix | 49,461 / 50,354 / 49,863      |
| no seed, after the fix  | 49,110 / 49,110 / 49,110      |

`rough-determinism.test.ts` pins the same property at the unit level. This also
makes pixel-exact browser assertions possible, which the jitter previously made
impossible.

### Run-to-run variance

The table is **one representative run**, not a stable distribution. Repeating the
same command four times at 5,000 elements produced these ranges for
`canvas:static:frame`:

| Phase    | Observed median range | Observed worst frame | Observed long tasks |
| -------- | --------------------- | -------------------- | ------------------- |
| zoom-out | 1.20 – 1.50 ms        | 8.50 – 11.70 ms      | 0 – 3               |
| pan      | 0.90 – 4.30 ms        | 4.20 – 75.80 ms      | 0 – 8               |
| freehand | 0.00 – 0.10 ms        | 2.00 – 19.20 ms      | 0 – 37              |

Read the shape, not the digits. The stable findings are that
`canvas:interactive:frame` and `canvas:pointer-move` stay flat and sub-millisecond
across every run, and that `canvas:static:frame` produces occasional large
outliers whose size tracks the visible element count. The outlier count and the
long-task count are not reproducible, which is itself the signal: the cost is
conditional on cache state, not on steady-state work per frame.

### What the capture shows

1. **The interactive and input paths scale flat.** With a 5× larger scene, the
   interactive frame callback stayed at a 0.00 ms median / 0.10 ms p95 and
   pointer-move handling stayed under a 1.0 ms median. Viewport culling,
   candidate-only hit testing, and lazy ID maps are doing their job at these
   scene sizes.

2. **The static layer is the remaining cost, and it scales with the visible
   set.** `canvas:static:frame` is the only measure that grows with scene size:
   at 1,000 elements a pan costs a 0.50 ms median, at 5,000 elements a pan costs
   a 0.90–4.30 ms median across runs, with worst frames between 4.20 ms and
   75.80 ms. The 5,000-element zoom-out phase (where nearly every element is on
   screen) has a 1.20–1.50 ms median against 0.50–0.90 ms at 1,000 elements. This
   is inherent to redrawing visible elements; the per-element offscreen bitmap
   cache keeps each redraw a blit, but the number of blits is still proportional
   to what is visible.

3. **A cold full redraw is the largest single frame in the trace.** The worst
   static frame seen at 5,000 elements (75.80 ms, not reproducible across runs)
   is attributed by the Long Animation Frame observer to the render loop itself,
   and is consistent with building per-element bitmaps for a large visible set
   for the first time. This is the clearest remaining frame-budget risk, and it
   is load/zoom-shaped, not steady-state interaction work.

4. **Local persistence cap is 50,000 elements, not 5,000 (corrected 2026-09-27).**
   An earlier revision of this section claimed the capture could not seed more
   than 5,000 elements through the local path. That was true of the old
   `localStorage`-inclusive seeding path, which hit the ~5 MB quota. The
   harness now seeds preferences-only into `localStorage` and the scene into
   IndexedDB (`MAX_PERSISTED_ELEMENTS = 50_000` in
   `apps/dripl-app/lib/canvas-db.ts`), and the 10k/50k runs reported above
   were measured through that path.

5. **A real zoom bug was found and fixed with this harness.** See the next
   section; the pre-fix behaviour is not represented in the table above.

### Bug found by this capture: interrupted zoom animations

The Long Animation Frame attribution showed a 135 ms script inside
`useCanvasWheel.applyMomentum` and a 99 ms `animate` frame. The root cause was
in `AnimationController`:

- `stop(key)` set `active = false` but left the entry in the animations map.
- `start(key, …)` returns early when the key is already present.

A burst of ctrl+wheel zoom calls therefore ran `stop()` then `start()` under the
same `smooth-zoom` key, and every `start()` after the first was a silent no-op.
Two consequences:

- The zoom animation stopped running. **After two quick wheel-zoom events,
  zooming stopped responding** — no zoom and no pan change were applied.
- `smoothZoom` sets `shouldCacheIgnoreZoom` when it starts and clears it when the
  animation completes. With the animation dead, the flag was left `true`
  permanently, which makes `getOrCreateElementCanvas` reuse a cached element
  bitmap even when the element's version changed.

`stop()` now releases the animation's slot, and a queued frame from a replaced
animation can no longer step its replacement. `apps/dripl-app/src/__tests__/animationController.test.ts`
covers the restart, the stale-frame case, and the flag being restored after an
interrupted zoom burst; the flag test fails against the pre-fix controller.

After the fix, the same zoom-out phase samples 64–68 static frames instead of
2–3, which is the animation running rather than being cancelled on the second
wheel event.

### End-to-end suite state

`pnpm --filter dripl-app test:e2e` passes: 18 passed, 1 skipped. The skipped test
is this performance spec, which is opt-in by design.

Six `google-oauth` tests were failing before the run above, and could not have
passed in the current configuration: they hardcoded `http://localhost:3000` and
scoped cookies to `domain: 'localhost'`, while the suite runs against
`http://127.0.0.1:<E2E_PORT>`. The state cookies were therefore never sent to the
callback route, so three tests that meant to assert `missing_code` and cookie
clearing were actually asserting the missing-state path. They now derive the
cookie domain from the configured `baseURL` and use relative request URLs.

The callback tests still have no real Google credentials. They exercise
rejection paths against the live Google token endpoint, not a successful sign-in.

### Harness infrastructure bugs fixed to get any browser data at all

No browser evidence was possible before these, so they are part of the record:

- `apps/dripl-app/playwright.config.ts` started the app with
  `pnpm dev -- --port <port>`. The extra `--` was forwarded to Next as a
  positional argument, so the dev server failed with
  `Invalid project directory provided ... /--port`. It now passes `--port` directly.
- The Playwright `baseURL` uses `127.0.0.1`, which Next.js 16 treats as a
  cross-origin dev resource host. Dev resources were blocked, the page
  **never hydrated** (no React fiber attached, zero `<canvas>` elements, the UI
  stuck on "Loading canvas…"), and no effect in the app ever ran. `next.config.mjs`
  now sets `allowedDevOrigins: ['127.0.0.1']`.

### Reproducing

```bash
# One scene size
RUN_PERF_E2E=true pnpm --filter dripl-app test:e2e e2e/performance.spec.ts

# Choose scene sizes (the harness seeds the scene into IndexedDB, capped at
# 50,000 elements by MAX_PERSISTED_ELEMENTS in apps/dripl-app/lib/canvas-db.ts)
RUN_PERF_E2E=true PERF_SCENE_SIZES=1000,5000 \
  pnpm --filter dripl-app test:e2e e2e/performance.spec.ts
```

The spec attaches a raw JSON snapshot per phase to the Playwright report and
prints a summary to stdout. It deliberately asserts only that the expected
measures exist; it does not enforce a universal frame-rate threshold, because a
threshold that is meaningful on a developer's machine is not meaningful on CI.

---

## Still not established

The browser capture above does not cover, and no claim is made about:

- Production builds, real displays, high-DPI screens, touch input, or mobile.
- Real-world scenes: text, images, arrows, bindings, frames, and large text blocks.
- Collaboration under load: two or more clients, WebSocket latency, remote delta
  application cost, and conflict handling. No browser run involved a second client.
- Memory over a long session, and memory growth from caches.
- WebSocket, HTTP, PostgreSQL, or Redis latency of any kind.
