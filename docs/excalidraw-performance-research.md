# Excalidraw canvas-interaction performance — pinned-source research and a prioritized plan for Dripl

**Status:** research note. The research pass itself was read-only; the later code follow-up is recorded in the amendment below.
**Date:** 2026-09-25
**Dripl baseline:** the current dirty working tree on `main` (see §1.3).

> **Post-research amendment — 2026-09-25:** The research pass itself did not
> modify application code. After the source comparison, a focused performance
> follow-up was applied to the same dirty working tree: transient updates are
> batched, changed IDs drive the spatial index during gestures, bound-arrow
> lookup is reused during a gesture, the spatial index keeps a stable
> scene-order map, candidate-only z-order hit testing and a
> version/geometry-keyed bounds cache were added, viewport-only visible-element
> arrays are reused, redundant static culling/label lookups are avoided,
> coalesced pointer work is bounded, and inbound collaboration updates no longer
> overwrite an actively edited element.
> These changes do not change the §3 and §7 source baseline: those sections
> remain the pre-follow-up reading of Excalidraw, and the line references there
> still describe Excalidraw rather than Dripl.
>
> **A browser run has since been performed**, using the development-only
> observer and the opt-in Playwright spec added alongside it. The measured
> results, the exact environment and its limits, and a zoom bug the capture
> exposed are recorded in [`docs/performance-benchmark.md`](./performance-benchmark.md).
> Headless Chromium with a virtual frame source, uniform rectangle scenes, and
> a development build are the boundaries of that evidence: it is not a
> production, multi-client, or display-representative measurement.

---

## 0. How to read this document

Every substantive statement carries one of three labels. Do not mix them.

| Label                | Meaning                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **[FACT]**           | Directly readable in a cited primary source, at the cited line. Verifiable by opening the link.                                           |
| **[MEASUREMENT]**    | A number produced by a command in this repository or in a script quoted here, with its scope stated. Synthetic unless a browser is named. |
| **[RECOMMENDATION]** | My judgement. Not a source claim, not a measurement.                                                                                      |
| **[UNVERIFIED]**     | Something a primary source _claims_ but that supplies no reproducible data for. Explicitly not treated as evidence.                       |

Two kinds of primary source are used, and they are never mixed:

1. **Excalidraw source**, pinned to commit `a2ec2889babf7d2295469c6d90ebe77fae57df84`, which is the commit `v0.18.1` points at. `packages/excalidraw/package.json` reports version `0.18.1`. All line links are permalinks to that SHA, so they cannot drift.
2. **Platform specifications** (W3C / WHATWG / MDN) for claims about what the browser guarantees.

Every GitHub issue, PR, or blog post encountered is treated as **[UNVERIFIED]** and is not used to support any recommendation. See §6.

---

## 1. Scope, method, and non-goals

### 1.1 Question

How does Excalidraw keep canvas interaction smooth, where does the current Dripl
implementation fall short of that, and what should be fixed first?

### 1.2 What was actually done

- Extracted the official repository archive at the pinned SHA and read the
  rendering, culling, caching, input, history, collaboration, and worker paths
  line by line.
- Read the corresponding Dripl files in the current working tree.
- Re-ran the two microbenchmarks quoted in §5.
- Fetched and confirmed the platform specifications cited in §5.4 and §7.

### 1.3 What was **not** done — read this before quoting any number here

- **No browser was run. No frame rate, frame time, paint time, input latency,
  long-task count, or WebSocket latency was measured.** None of those numbers
  appear anywhere in this document, and none may be inferred from it.
- No Excalidraw profile was captured. Every Excalidraw statement below is a
  statement about _what its code does_, never about _how fast it runs_.
- The Dripl working tree is dirty and contains unrelated in-progress user work.
  It is treated as the implementation baseline for the measurements below.
  The later performance follow-up is listed in the amendment above.
- `pnpm lint` and `pnpm build` were not run for the research-only Markdown
  comparison. They must be rerun after the code follow-up.

### 1.4 A structural note about the pinned source

At `v0.18.1` the Excalidraw package has been substantially restructured relative
to the versions most blog posts describe. State is held in a `Scene` object with
`Map`-based element storage, the render loop is split across three canvas
components and three renderer modules, and editor state has moved toward a
Jotai store. Any secondary source that describes `actionManager.tsx`, an
`array` element store, or a single-canvas renderer is describing a **different
version** and must not be used to reason about `v0.18.1`.

---

## 2. Excalidraw source facts (pinned to `a2ec288`)

### 2.1 Frame-budget vocabulary

A display refresh at 60 Hz allows ~16.7 ms per frame; at 120 Hz, ~8.3 ms.
**[FACT]** `requestAnimationFrame` callbacks are invoked once per frame, before
the next repaint, and are not invoked when the document is not being rendered.
Source: WHATWG HTML, "Run the animation frame callbacks"
([spec](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-requestanimationframe))
and MDN, `Window.requestAnimationFrame`
([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)).

Everything below is about staying inside those budgets. **[RECOMMENDATION]**
This is why the _interesting_ axis for canvas work is not "how fast is one
element" but "how much work happens between two frames".

### 2.2 Scheduling

**Three separate canvases, three separately throttled renderers.** **[FACT]**

- static scene: [`renderer/staticScene.ts:460-480`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/renderer/staticScene.ts#L460-L480)
- interactive scene: [`renderer/interactiveScene.ts:1205-1231`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/renderer/interactiveScene.ts#L1205-L1231)
- new-element (draft) scene: [`renderer/renderNewElementScene.ts:49-66`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/renderer/renderNewElementScene.ts#L49-L66)

All three are wrapped in `throttleRAF`. **[FACT]**

**`throttleRAF` is a keep-latest, drop-intermediate, optional-trailing throttle.** **[FACT]**
[`utils.ts:147-197`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/utils.ts#L147-L197).
It stores only the most recent argument tuple (`lastArgs`). If a call arrives
while a frame is already scheduled and `trailing` is not set, the argument is
overwritten and the previous one is discarded. It exposes `.flush()` and
`.cancel()`. All three renderers pass `{ trailing: true }`, so the last update
in a burst is never lost.

**Throttling is opt-in and the hosted app turns it on.** **[FACT]**
[`reactUtils.ts:33-62`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/reactUtils.ts#L33-L62)
gates on `window.EXCALIDRAW_THROTTLE_RENDER` and additionally refuses to throttle
on React < 18. The official app sets it to `true` at
[`excalidraw-app/App.tsx:138`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/App.tsx#L138).
The static canvas passes the flag through at
[`canvases/StaticCanvas.tsx:68-80`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/canvases/StaticCanvas.tsx#L68-L80).
So: embedders that do not set the flag get synchronous renders; the first-party
experience is frame-throttled. **[RECOMMENDATION]** If Dripl ever needs to match
the hosted app's behavior, it needs a similar escape hatch, but Dripl's
always-on dirty scheduling (§3.1) is a stricter default than Excalidraw's
opt-in.

**Canvas dimension writes are guarded to avoid flicker.** **[FACT]**
[`canvases/StaticCanvas.tsx:57-66`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/canvases/StaticCanvas.tsx#L57-L66)
only assigns `canvas.width` / `canvas.height` when the scaled value differs,
with an explicit comment that assigning resets the canvas and would flicker
when a frame is skipped by throttling. **[RECOMMENDATION]** This is a small,
high-value pattern: a skipped frame must not cost a full canvas clear plus a
full repaint.

**A generic RAF-driven loop primitive exists but is not the render path.**
**[FACT]** [`animation-frame-handler.ts:8-78`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/animation-frame-handler.ts#L8-L78)
is a keyed, self-rescheduling frame loop with `start` / `stop`, used for
continuous effects (trails, zoom animation) rather than for scene painting.

### 2.3 Canvas layer separation

- The interactive canvas is a real `HTMLCanvasElement` on the app instance:
  [`App.tsx:565`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L565),
  attached by ref at
  [`App.tsx:10205-10227`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L10205-L10227).
- `NewElementCanvas` is imported separately at
  [`App.tsx:437`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L437).
- The static canvas is adopted into the DOM imperatively rather than rendered
  as JSX: [`canvases/StaticCanvas.tsx:44-46`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/canvases/StaticCanvas.tsx#L44-L46)
  (`wrapper.replaceChildren(canvas)`).

**The consequence that matters:** the in-progress element is painted on its own
canvas. Overdrawing a draft rectangle therefore costs a small clear plus one
element, not a repaint of the scene. **[RECOMMENDATION]** This is the single
most valuable structural idea in the whole file, and Dripl already has an
equivalent (see §3.1).

**The static layer is memoized on prop identity, including the visible-element
array identity.** **[FACT]**
[`canvases/StaticCanvas.tsx:115-139`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/canvases/StaticCanvas.tsx#L115-L139)
returns `false` (i.e. re-render) if `sceneNonce`, `scale`, `elementsMap`, or
`visibleElements` differ by reference, then shallow-compares a whitelist of 25
`AppState` fields and the render config. Crucially,
[`StaticCanvas.tsx:126`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/canvases/StaticCanvas.tsx#L126)
is an **identity** comparison on `visibleElements`. If the scene did not change
and the viewport did not change, the static layer is not re-rendered at all.
See §3.3 for why this is the one place Dripl is clearly behind.

### 2.4 Culling — and the important caveat

**Culling in Excalidraw is a full linear scan, not a spatial query.** **[FACT]**
[`scene/Renderer.ts:42-64`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/scene/Renderer.ts#L42-L64):

```ts
const visibleElements: NonDeletedExcalidrawElement[] = [];
for (const element of elementsMap.values()) {
  if (
    isElementInViewport(
      element,
      width,
      height,
      { zoom, offsetLeft, offsetTop, scrollX, scrollY },
      elementsMap
    )
  ) {
    visibleElements.push(element);
  }
}
return visibleElements;
```

It iterates every non-deleted element on every recomputation. The per-element
test is `isElementInViewport`
([`element/sizeHelpers.ts:21-51`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/element/sizeHelpers.ts#L21-L51)),
which converts two viewport corners to scene coordinates and does four
comparisons against element bounds.

**This is the point most secondary writing gets wrong.** **[RECOMMENDATION]**
"Dozens of thousands of elements" in Excalidraw is not backed by spatial
indexing for culling. It is backed by (a) a fast O(N) bounds comparison, (b)
per-element bitmap caches so that a visible element is a `drawImage` rather
than a redraw, and (c) accepting that the O(N) pass itself is cheap relative to
what it replaces. Anyone benchmarking this should benchmark the _bitmap cache
hit rate_, not the culling loop.

**The O(N) result is memoized, and that memoization is the real mechanism.**
**[FACT]** `getRenderableElements` is wrapped in `memoize` at
[`scene/Renderer.ts:106`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/scene/Renderer.ts#L106).
`memoize` ([`utils.ts:956-992`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/utils.ts#L956-L992))
is a single-slot cache: it compares the previous argument tuple key-by-key and
returns the **previous result object** if every key is `===`. It also exposes
`.clear()`, called from `Renderer.destroy()`
([`Renderer.ts:162-166`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/scene/Renderer.ts#L162-L166)).

So the O(N) culling scan runs when `elementsMap`, `zoom`, `scrollX`, `scrollY`,
`width`, or `height` changes by identity — i.e. on every pan, zoom, resize, and
scene mutation — and is skipped otherwise. **[FACT]** The source is explicit
about the one common case that always busts it:
[`Renderer.ts:129-130`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/scene/Renderer.ts#L129-L130)
— _"note: first render of newElement will always bust the cache (we'd have to
prefilter elements outside of this function)"_ — `newElementId` is part of the
memo key, so every version bump of the in-progress element re-runs the scan.

**`getNonDeletedElements()` is a cached field, not a filter.** **[FACT]**
[`scene/Scene.ts:188-190`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/scene/Scene.ts#L188-L190)
returns a stored reference, recomputed on scene replacement at
[`Scene.ts:308`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/scene/Scene.ts#L308).

### 2.5 Hit testing — also a full scan

**Excalidraw does not use a spatial index for hit testing either.** **[FACT]**
[`App.tsx:5037-5083`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L5037-L5083):

```ts
const elements = (…).filter((el) => this.hitElement(x, y, el))
  .filter((element) => { /* containing-frame check */ })
  .filter((el) => { /* iframes moved to the end */ })
  .concat(iframeLikes);
```

Three chained `.filter()` passes over every non-deleted element, each
allocating a new array, with per-element geometry work in `hitElement`
([`App.tsx:5089+`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L5089)).
`getElementAtPosition` calls this and then post-processes the hits
([`App.tsx:4983-5035`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L4983-L5035)).
There is no early exit and no candidate set.

**[RECOMMENDATION]** This is the clearest structural difference between the two
codebases, and it is in Dripl's favour. See §3.4.

### 2.6 Caches

All keyed by element **object identity** in `WeakMap`s, so a replaced element
gets a fresh entry and an unreferenced element is collected for free. **[FACT]**

| Cache                        | Location                                                                                                                                                                                  | Key / invalidation                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rough.js `Drawable` shapes   | [`scene/ShapeCache.ts:15`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/scene/ShapeCache.ts#L15)                            | element object; regenerated on export, and generating a shape explicitly deletes the element's bitmap ([`ShapeCache.ts:68`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/scene/ShapeCache.ts#L68))                                                                                                                                                              |
| Per-element offscreen bitmap | [`renderer/renderElement.ts:525-528`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/renderer/renderElement.ts#L525-L528)     | element object; regenerated when zoom value changes (unless `shouldCacheIgnoreZoom`), theme changes, bound-text version changes, image crop changes, containing-frame opacity changes, or an arrow's label-bearing angle changes — enumerated at [`renderElement.ts:549-563`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/renderer/renderElement.ts#L549-L563) |
| Element bounds               | [`element/bounds.ts:72-101`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/element/bounds.ts#L72-L101)                       | element object **+ `version`**; explicitly skipped for bound-text elements with a `// we don't invalidate cache… Fix TBA` note                                                                                                                                                                                                                                                                                                |
| Free-draw `Path2D`           | [`renderer/renderElement.ts:1005-1016`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/renderer/renderElement.ts#L1005-L1016) | element object; avoids re-running the stroke simplification                                                                                                                                                                                                                                                                                                                                                                   |
| Selected-element sets        | [`scene/Scene.ts:155-163`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/scene/Scene.ts#L155-L163)                           | keyed by a `SelectionHash` string, invalidated wholesale on selection or element change                                                                                                                                                                                                                                                                                                                                       |
| Link-badge bitmaps           | [`renderer/staticScene.ts:140-146`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/renderer/staticScene.ts#L140-L146)         | two fixed slots, regenerated on zoom change                                                                                                                                                                                                                                                                                                                                                                                   |
| Decoded images               | [`App.tsx:590`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L590)                                       | `Map` keyed by `fileId`, populated by [`element/image.ts:29-76`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/element/image.ts#L29-L76)                                                                                                                                                                                                                         |

Two things worth pulling out:

- **Every element's offscreen canvas is size-capped.** **[FACT]**
  `cappedElementCanvasSize` in [`renderer/renderElement.ts:160-199`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/renderer/renderElement.ts#L160-L199)
  bounds every element bitmap by `AREA_LIMIT = 16777216` (annotated in-source as
  roughly the Safari mobile canvas area limit) and `WIDTH_HEIGHT_LIMIT = 32767`
  (the Safari per-axis limit, per MDN). When a limit is exceeded it reduces the
  resolution via a `scale` factor and **keeps caching**, rather than skipping the
  cache. **[FACT]** Dripl had no equivalent cap, so a 40,000 x 40,000 element
  would have requested a ~1.6 billion pixel surface. `computeElementCanvasSize`
  in `packages/element/src/staticScene.ts` now applies the same two limits, and
  the cache entry records the resolution used so `drawImage` still covers the
  element's full logical size. Verified in a browser at 40,000, 8,000, and
  2,000 px, with ordinary scenes rendering bit-for-bit identically.
- **The bounds cache is version-keyed, the others are identity-keyed.** **[FACT]**
  That asymmetry exists because the bounds cache is the one place where a
  stale value would be silently wrong, and a `version` check is the cheapest
  guard available. **[RECOMMENDATION]** Worth mirroring: it is a real
  correctness guard, not just a speed trick.
- **The decoded-image map is unbounded.** **[FACT]** No eviction, no size
  cap. **[RECOMMENDATION]** Dripl's LRU with `maxSize: 100`
  (`packages/element/src/image-cache.ts:15`, eviction at `:108`) is the better
  default. This is a case where Dripl should not copy Excalidraw.

### 2.7 Pointer input

**Move events are throttled to one processed event per frame, and flushed on
pointer-up.** **[FACT]**

- `withBatchedUpdatesThrottled` wraps a handler in `throttleRAF` **and** in
  `unstable_batchedUpdates`: [`reactUtils.ts:22-31`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/reactUtils.ts#L22-L31).
  Both halves matter: the RAF cap bounds render frequency, and the batching
  collapses the store update plus its React subscribers into one commit.
- The pointer-down path installs the throttled handler and stashes it for
  teardown: [`App.tsx:6631-6652`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L6631-L6652),
  typed at [`types.ts:747`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/types.ts#L747).
- Pointer-up flushes the pending move _before_ committing, so the final
  position is never dropped: [`App.tsx:8798-8805`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L8798-L8805).
  Additional flush sites at [`App.tsx:6867`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L6867)
  and [`App.tsx:6993`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L6993).

**`getCoalescedEvents()` is not used anywhere in the pinned tree.** **[FACT]**
A repository-wide search across `packages/` and `excalidraw-app/` returns no
hits. The API is specified — see
[W3C Pointer Events Level 4, §Coalesced events](https://www.w3.org/TR/pointerevents4/)
— but Excalidraw v0.18.1 does not consume it. **[RECOMMENDATION]** Dripl
already does (§3.2); this is a place where Dripl is ahead and should stay
ahead.

**Pathfinding runs inline, on the main thread, with a no-op short-circuit.**
**[FACT]** Elbow arrows are rerouted inside `mutateElement`
([`element/mutateElement.ts:39-71`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/element/mutateElement.ts#L39-L71)),
which is on the per-move critical path. The search is A\* over a grid with a
binary min-heap on the f-score
([`element/elbowArrow.ts:1496-1516`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/element/elbowArrow.ts#L1496-L1516),
`BinaryHeap` used only here). The cost control is an early return:
[`elbowArrow.ts:1065-1077`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/element/elbowArrow.ts#L1065-L1077)
— _"Short circuit on no-op to avoid huge performance hit"_ — plus a separate
branch for a pure-normalization update at `:1056-1063`.

**[RECOMMENDATION]** The lesson is "avoid the work, don't move it". Deferring
pathfinding to a worker would add serialization cost and a frame of latency to
a gesture that must feel direct. Short-circuiting on no-op is cheaper and
simpler, and it is why the same architecture is fine for Dripl's
`updateBoundArrows`.

### 2.8 Collaboration batching

- **Cursor position: 33 ms throttle ≈ 30 fps.**
  **[FACT]** [`excalidraw-app/app_constants.ts:8`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/app_constants.ts#L8)
  — `export const CURSOR_SYNC_TIMEOUT = 33; // ~30fps` — applied at
  [`Collab.tsx:881-892`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/collab/Collab.tsx#L881-L892).
- **Cursor payloads are marked volatile so the server can drop them under
  pressure.** **[FACT]**
  [`collab/Portal.tsx:86-95`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/collab/Portal.tsx#L86-L95)
  routes on a `volatile` flag; mouse-location sends pass `true`
  ([`Portal.tsx:196`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/collab/Portal.tsx#L196),
  `:220`, `:243`) and the dedicated channel name is at
  [`app_constants.ts:16`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/app_constants.ts#L16).
- **A full-scene recovery broadcast every 20 s, in addition to incremental
  updates.** **[FACT]**
  `SYNC_FULL_SCENE_INTERVAL_MS = 20000`
  ([`app_constants.ts:6`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/app_constants.ts#L6)),
  driving `queueBroadcastAllElements`
  ([`Collab.tsx:927-939`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/collab/Collab.tsx#L927-L939)),
  which is scheduled opportunistically by `broadcastElements`
  ([`Collab.tsx:911-920`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/collab/Collab.tsx#L911-L920)).
  Firebase persistence is throttled on the same 20 s interval with
  `leading: false` ([`Collab.tsx:941-953`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/collab/Collab.tsx#L941-L953)).
- **Inbound updates are filtered, not blindly applied, and a local in-progress
  edit always wins.** **[FACT]** `shouldDiscardRemoteElement`
  ([`data/reconcile.ts:19-40`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/data/reconcile.ts#L19-L40))
  returns `true` — discard the incoming copy — when **either** the local element
  is the one being edited (`local.id` matches `editingTextElement`, `resizingElement`,
  or `newElement`) **or** `local.version > remote.version` **or** the versions
  are equal and `local.versionNonce` is lower. The comment at `:33-34` states
  the tie-break intent: "resolve conflicting edits deterministically by taking
  the one with the lowest versionNonce".

  **[RECOMMENDATION]** The "local drag wins" rule matters more than the version
  arithmetic. It is the one place in the collaboration path where the user
  experience is protected structurally rather than by luck, and it is cheap to
  state in Dripl: while an element is being dragged, resized, or drawn, ignore
  remote updates to that element. The source also carries a
  `// TODO: Is this still valid?` on the `newElement` clause at `:30`, since
  the selection pseudo-element is never in the elements array — so do not treat
  the pinned behaviour as a specification.

  The receive path additionally sets the broadcast-version watermark _before_
  applying, explicitly to avoid echoing the scene back
  ([`Collab.tsx:733-754`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/collab/Collab.tsx#L733-L754)),
  and applies with `CaptureUpdateAction.NEVER` so the arrival is not re-broadcast
  ([`Collab.tsx:771-780`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/collab/Collab.tsx#L771-L780)).

- **Idle/active state transitions are timed.** **[FACT]**
  `IDLE_THRESHOLD = 60_000`, `ACTIVE_THRESHOLD = 3_000`
  ([`packages/excalidraw/constants.ts:267-269`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/constants.ts#L267-L269)).

**[RECOMMENDATION]** The 20-second full-scene heartbeat is the most directly
transferable idea in this section, and it is orthogonal to the CRDT question
Dripl is separately tracking. A periodic full-state resync is a cheap way to
bound divergence without claiming convergence.

### 2.9 History

**History stores per-element forward and inverse property deltas, not
snapshots.** **[FACT]**

- `Delta` holds a `deleted` and an `inserted` partial
  ([`change.ts:60-64`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/change.ts#L60-L64))
  and computes the differing top-level keys
  ([`change.ts:88-123`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/change.ts#L88-L123)).
  That method carries a candid cost note at `:104-108`: _"O(n^3) here for
  elements, but it's not as bad as it looks: we do this only on store
  recordings, not on every frame (not for ephemerals); we do this only on
  previously detected changed elements; we do shallow compare only on the first
  level of properties."_
- `ElementsChange` holds three `Map`s of deltas — `added`, `removed`, `updated`
  ([`change.ts:807-812`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/change.ts#L807-L812)) —
  and only recomputes a delta when `versionNonce` differs
  ([`change.ts:946-952`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/change.ts#L946-L952)).
- Inversion is a field swap, not a recomputation
  ([`history.ts:173-178`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/history.ts#L173-L178),
  [`change.ts:437-439`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/change.ts#L437-L439)).
- Applying a change allocates one new `Map` over the element set
  ([`change.ts:1072-1076`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/change.ts#L1072-L1076))
  but only writes the changed elements into it.
- **History entries are rebased against remote state.**
  **[FACT]** `HistoryEntry.applyLatestChanges`
  ([`history.ts:200+`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/history.ts#L200))
  and `ElementsChange.applyLatestChanges`
  ([`change.ts:1040-1070`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/change.ts#L1040-L1070))
  rewrite pending deltas against the newest element versions, and
  `resolveConflicts` runs at apply time
  ([`change.ts:1096`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/change.ts#L1096)).

**[RECOMMENDATION]** The "rebase local history against remote state" idea is
sound, but it is entangled with Excalidraw's reconciliation model. Adopting the
_delta_ representation without the rebase is still a clear win over snapshots
and is independent of the CRDT decision Dripl is tracking separately.

### 2.10 Workers — the negative result

**The only worker in the pinned tree is a font subsetter.**
**[FACT]** `WorkerPool` is defined at
[`workers.ts:22-152`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/workers.ts#L22-L152)
and its **only** consumer is
[`subset/subset-main.ts:33`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/subset/subset-main.ts#L33)
— the `harfbuzz` / `woff2` pipeline under
[`packages/excalidraw/subset/`](https://github.com/excalidraw/excalidraw/tree/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/subset).
A repository-wide search finds no worker for rendering, layout, hit testing,
geometry, or serialization.

**[RECOMMENDATION]** Worth stating plainly because it inverts a common
assumption: **you do not need a render worker to make a canvas smooth.** The
main thread work is bounded by caching and by not doing O(N) work per frame —
not by getting it off the main thread. Moving canvas rasterization to a worker
would mean serializing geometry, reimplementing Rough.js output handling, and
adding a frame of latency. `[FACT]` The `Queue` primitive that does exist
([`queue.ts:13-46`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/queue.ts#L13-L46))
is a serial async job runner, not a scheduler for render work.

---

## 3. Dripl baseline

Line references are to the current working tree.

### 3.1 Scheduling and layers — Dripl is ahead

**[FACT]** `useCanvasRenderLoop`
(`apps/dripl-app/hooks/canvas/useCanvasRenderLoop.ts:14-62`) keeps the render
callback in a ref, holds at most one in-flight `requestAnimationFrame`, skips
the frame if the dirty flag was cleared, and re-arms only if the render itself
marked the surface dirty again (`:42-44`). The docstring at `:8-12` states the
intent: a permanent RAF loop "keeps the main thread awake even when the scene
is idle". This is **stricter** than Excalidraw's opt-in throttle and is the
right default.

**[FACT]** Two canvases: `StaticCanvas` and `InteractiveCanvas`, with the draft
element isolated in the interactive layer. Dripl matches Excalidraw's central
structural idea without needing a third canvas, because Rough.js is fast
enough for a single draft element.

**[FACT]** `StaticCanvas.tsx:118-146` guards `dpr` and resize handling
explicitly (`:122`, `:146`).

### 3.2 Pointer input — Dripl is ahead

**[FACT]** `InteractiveCanvas.tsx:308-335` coalesces to one pending RAF, and
when `preservePointerSamples` is on it expands the event via
`getCoalescedEvents()` (`:314`), appends the latest sample if the coalesced
list did not already end at it (`:318-321`), and replays every sample in order
inside the frame (`:330-333`). Otherwise it keeps only the latest (`:324`).
Flushes happen on pointer-down (`:343`) and pointer-up (`:353`).

This is strictly more information than Excalidraw v0.18.1 processes, which
takes one event per frame and never reads coalesced samples.

### 3.3 Caching — broadly comparable, one clear gap

**[FACT]**

| Cache                    | Location                                                                                                                       | Notes                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Offscreen element bitmap | `packages/element/src/staticScene.ts:47`                                                                                       | `WeakMap` keyed by element object — matches Excalidraw                                         |
| Rough drawables          | `packages/element/src/shape-cache.ts`                                                                                          | present                                                                                        |
| Explicit invalidation    | `staticScene.ts:106` (`invalidateElementCache`), mirrored in `canvasSlice.ts:57,65,79,253,587,729` and `historySlice.ts:30,54` | id-keyed, plus a parallel id map at `staticScene.ts:50`                                        |
| Decoded images           | `packages/element/src/image-cache.ts:15,28,108`                                                                                | LRU, `maxSize: 100`, with access-order eviction — **better** than Excalidraw's unbounded `Map` |

**The gap: no version-keyed bounds cache.** **[FACT]** Excalidraw guards bounds
with `element.version` (`element/bounds.ts:81-101`); Dripl's RBush entries are
keyed by id and refreshed only via the `spatialVersion`-driven diff.

**The bigger gap: `visibleElements` never keeps its identity.** **[FACT]**
`RoughCanvas.tsx:425-447` builds a new array every time via
`.map().filter().sort()` on line 443-446, and its dependency list is
`[elements, spatialIndex, viewport]` — so pan, zoom, _and_ every element
mutation all produce a fresh array. `StaticCanvas`'s memo
(`StaticCanvas.tsx:22-33`) compares `prev.elements === next.elements` **and**
`prev.visibleElements === next.visibleElements` by identity. Because
`updateElementTransient` replaces the array on every move
(`canvasSlice.ts:215`), the static layer re-renders on **every** transient
pointer move, even for a single moved rectangle that is already visible and
whose bitmap is cached. Excalidraw avoids this via the `memoize` +
identity-comparison path described in §2.3/§2.4.

### 3.4 Spatial index — Dripl is ahead on the query, behind on maintenance

**[FACT]** `RoughCanvas.tsx` holds an RBush (`:66`, `:315`) with an incremental
update path that diffs `added` / `removed` / `updated` (`:327-340`), applies them
individually, and only rebuilds wholesale when churn exceeds 40 % of the scene
(`:342-358`). Culling (`:425-447`) and both hit-test entry points
(`:478-531`, `:537+`) query it. This is strictly better than Excalidraw's linear
scan in §2.4 and §2.5.

**But the diff itself is O(N), and it re-runs on every move.**
**[FACT]** `spatialIndex` is keyed on `spatialVersion`
(`RoughCanvas.tsx:320`). `updateElementTransient` increments `spatialVersion`
on every call (`canvasSlice.ts:224`). The diff therefore does, per transient
move: `new Set(elements.map(...))` (`:325`), `elements.filter` for added
(`:327`), `elements.filter` for updated (`:329-340`), and a spread-plus-filter
over the previous id set (`:328`) — four full passes before any query is
answered.

**Hit testing is O(N) in the z-order loop even though the candidate set is
indexed.** **[FACT]** `getElementAtPosition` queries the tree (`:483-488`),
builds a `Set` of candidate ids (`:489`), then iterates the **entire** element
array from the top down (`:490`) doing a `Set.has` per element, with no early
exit until a hit is found. `getElementsAtPosition` does the same
(`:541-552`) and cannot early-exit at all by construction.

### 3.5 The per-move drag path — the largest suspected cost

**[FACT]** On every transient pointer move of a drag or resize, Dripl does all
of the following:

| Work                                       | Location                                              | Complexity                           |
| ------------------------------------------ | ----------------------------------------------------- | ------------------------------------ |
| Full `Map` rebuild over all elements       | `useCanvasPointerEvents.ts:87` (`updateBoundArrows`)  | O(N)                                 |
| Full reverse `boundElements` index rebuild | `useCanvasPointerEvents.ts:91-105`                    | O(N) + allocations                   |
| Full `Map` rebuild over all elements       | `useCanvasPointerEvents.ts:170` (`updateBoundLabels`) | O(N)                                 |
| Full array copy per updated element        | `canvasSlice.ts:215`                                  | O(N) each                            |
| Spatial index diff (four passes)           | `RoughCanvas.tsx:325-340`                             | O(N) each, per `spatialVersion` bump |
| Visible-set recomputation                  | `RoughCanvas.tsx:425-447`                             | O(N) + O(k log k)                    |

`updateBoundArrows` is called at `useCanvasPointerEvents.ts:962` and `:1012`,
`updateBoundLabels` at `:963` and `:981`, and each of those calls
`updateElementTransient` per changed arrow
(`useCanvasPointerEvents.ts:160`). So dragging one shape bound to five arrows
performs roughly ten full-array copies and ten full index diffs, all inside a
single frame.

**[RECOMMENDATION]** The comment at `useCanvasPointerEvents.ts:107` — _"Only
process arrows that are bound to moved shapes (O(k) where k = number of bound
arrows)"_ — is accurate about the _inner_ loop and misleading about the
function. The two index builds above it are O(N) regardless of `k`. This is
the highest-value thing to fix, and the comment is a good reason it was missed.

### 3.6 History — Dripl is behind

**[FACT]** History stores up to `MAX_HISTORY = 100` full element-array snapshots
(`lib/store/helpers.ts:5`), `cloneElements` deep-copies each
(`helpers.ts:135`), and the byte budget is a flat estimate of
`snapshot.length * 250` against `MAX_HISTORY_BYTES = 10 MB`
(`helpers.ts:6`, `:125-128`, `:142-157`).

`undo` and `redo` each invalidate **every** restored element's bitmap cache and
rebuild the full id map: `historySlice.ts:30,34` and `:54,58`.

Compare §2.9: Excalidraw stores per-element property deltas, so an undo entry
costs `O(changed)`, not `O(scene)`.

### 3.7 Collaboration

**[FACT]** Scene deltas are coalesced on a 50 ms timer
(`useCollaboration.ts:372-377`); cursor updates are gated at 50 ms
(`useCollaboration.ts:385`).

**[FACT]** The reason for the coalescing is recorded in-tree at
`useCollaboration.ts:369-371`: JSON is the authoritative protocol and the
previous immediate path "could send two large messages per frame and exceed the
30-message/s server budget". That is a real, documented constraint and it
should not be traded away casually.

**[FACT]** No periodic full-state resync heartbeat exists, and no volatile /
droppable channel marking exists on the client side. Both exist in Excalidraw
(§2.8).

**[FACT] There is no "local in-progress edit wins" rule.** The inbound handler
(`RoughCanvas.tsx:213-230`) accepts a remote element whenever
`shouldAcceptElement(el, current)` passes — a version/nonce comparison — and
never consults `activeGestureLocksRef` (populated at `RoughCanvas.tsx:236` for
the duration of a drag) or any draft-element state. A remote update can
therefore land on the element the user is currently dragging. Excalidraw
discards those unconditionally (§2.8).

### 3.8 Existing performance instrumentation — partial, and measuring the wrong layer

**[FACT]** Dripl already has a User Timing helper module,
`apps/dripl-app/utils/performance.ts`:

- `perfMark` / `perfMeasure` (`:43-57`), gated behind
  `process.env.NODE_ENV !== 'production'` (`:38-41`), so it costs nothing in a
  production build.
- `useRenderTiming(componentName)` (`:59-68`) — a hook wrapper. **Exported but
  never called.**
- `reportPerf()` (`:70-82`) — groups and logs entries whose name ends in
  `:render`. **Exported but never called.**

**[FACT]** Exactly one call site is wired: `RoughCanvas` brackets its own
function body with `perfMark('RoughCanvas:render:start')` at `:73` and
`perfMark/perfMeasure('RoughCanvas:render', …)` at `:870-871`.

**[RECOMMENDATION]** So the scaffolding exists but the coverage is not useful
for this investigation, for two reasons:

1. **Wrong layer.** `:73`–`:870` measures _React's render of the `RoughCanvas`
   component_ — hook calls, `useMemo` bodies, and prop construction. It does not
   measure the canvas work in `renderFrame` (the `drawImage`/`clearRect` loop)
   or the O(N) bookkeeping in §3.5, which happens either inside those `useMemo`
   bodies or inside the pointer handler before React re-renders at all.
   `useCanvasRenderLoop` (`useCanvasRenderLoop.ts:14-62`) has no marks.
2. **No reporter.** `reportPerf` is never invoked, so even the one measure that
   is recorded is never surfaced. Someone must open DevTools and run
   `performance.getEntriesByType('measure')` by hand.

**[RECOMMENDATION]** The fix is to extend what exists, not to add a parallel
system: keep `perfMark`/`perfMeasure`, add a `PerformanceObserver` for
`longtask` / `event` / `long-animation-frame` (§5.4), bracket `renderFrame` and
the drag path, and call `reportPerf` behind a dev-only key. The gap is
measurement coverage, not tooling.

### 3.8b Absent upstream (checked, not assumed)

These are **[FACT]** negative results, recorded because each is a plausible thing
to assume exists, and building against the assumption would be a false positive:

- **No dirty-flag render system.** Searching `dirtyFlags` across
  `packages/excalidraw` at this commit returns nothing. Static-canvas
  re-rendering is driven by `React.memo` prop comparison in
  [`canvases/StaticCanvas.tsx:115-139`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/canvases/StaticCanvas.tsx#L115-L139),
  not by per-layer invalidation flags.
- **No level-of-detail or large-scene guard.** `renderer/staticScene.ts` paints
  every entry of `visibleElements` on every pass
  ([`staticScene.ts:258`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/renderer/staticScene.ts#L258),
  [`:279-281`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/renderer/staticScene.ts#L279-L281)),
  and no `MAX_ELEMENTS`-style constant exists in the package. A slow frame on a
  very dense scene is therefore **inherent to the upstream design**, not a Dripl
  regression. **[RECOMMENDATION]** Do not chase parity here. Beating upstream on
  dense scenes means amortizing the redraw, which upstream does not attempt.
- **Throttling cannot make a single redraw cheaper.**
  `renderStaticSceneThrottled` is `throttleRAF(..., { trailing: true })`
  ([`staticScene.ts:459-465`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/renderer/staticScene.ts#L459-L465)),
  which coalesces repeated calls within a frame. It is not a remedy for an
  expensive frame. Dripl's always-on dirty scheduling in `useCanvasRenderLoop`
  already coalesces at least as strictly, so there is nothing to port.
- **One shared `RoughGenerator`, not one per canvas.**
  [`scene/ShapeCache.ts:14`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/scene/ShapeCache.ts#L14)
  holds a single generator for the app, and the canvas-bound `RoughCanvas` is
  created once in
  [`App.tsx:710`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L710).
  Dripl already matches this: `getGenerator()` returns one shared
  `rough.generator()`. **[FACT]** No work needed.

### 3.9 Follow-up implementation status

The focused follow-up changed the following hot-path details after the source
comparison:

- `updateElementsTransient` applies a gesture's changed elements in one array
  copy and one spatial revision; bound-arrow and label updates are collected
  into a second batch instead of one state update per dependent element.
- Transient batches publish changed IDs with a matching revision, allowing the
  spatial index to update only those extents during a gesture. Non-transient
  scene mutations still use the conservative full diff.
- The reverse `boundElements` index is built once per gesture and the existing
  `elementsById` map is reused. Bound-arrow point updates no longer mutate a
  state element in place before reconciliation.
- Spatial scene order is retained in the index, and a viewport-only recompute
  can reuse the previous `visibleElements` array when the ordered ID sequence is
  unchanged. Element mutations still intentionally invalidate the scene.
- Hit testing now orders only the RBush candidate set and uses the store's ID
  map for container lookup instead of scanning the complete scene array for
  z-order resolution.
- `getElementBounds` now has a version/geometry-keyed `WeakMap` cache, avoiding
  repeated rotated-corner and path-bounds work while preserving the immutable
  element update path.
- The static layer no longer depends on selection state, skips a second bounds
  test for spatial candidates, and uses cached ID lookup for arrow labels.
  Interactive overlays use a lazy ID map for selection, locks, and bindings.
- Static and interactive frame callbacks, plus pointer-move batches, now emit
  development-only User Timing measures. A best-effort observer collects long
  tasks, event timing, and long-animation-frame entries, including the
  per-script attribution that makes a slow frame attributable; an opt-in
  Playwright spec exercises zoom-out, pan, and freehand over seeded scenes,
  samples frame cadence, and attaches the raw snapshot per phase.
- Coalesced pointer samples are bounded per frame and the pending queue is
  bounded, preserving the latest point instead of allowing a blocked frame to
  turn into an unbounded burst of scene updates.
- Inbound collaboration deltas skip IDs in the active gesture-lock set and the
  current draft, and no longer mark a broadcast as suppressed when every remote
  change was rejected.

These are source-level changes, not measured improvements. The remaining
`O(N)` spatial diff, z-order hit-test scan, full-scene history snapshots, and
missing browser telemetry are still open.

### 3.10 Smoothness recipe for Dripl

These are **[RECOMMENDATION]**s derived from the source architecture, not
browser measurements:

1. **Input should become visible on the next animation frame.** Keep selection,
   cursors, marquee, and the draft element on the interactive layer; do not wait
   for persistence or collaboration acknowledgements.
2. **A drag should change only the gesture's visual state first.** Apply the
   primary element and its dependent labels/arrows in one state batch, then let
   the dirty-only renderer repaint visible candidates.
3. **Pan and zoom should reuse cached pixels.** Avoid rebuilding Rough.js or
   bounds for every visible element during a camera gesture. After the gesture,
   settle to a high-quality representation if needed.
4. **Freehand should preserve input fidelity without turning every sample into
   a scene commit.** Coalesced pointer samples are useful for the path, but the
   renderer should consume a bounded per-frame sample budget.
5. **Collaboration cursors should be disposable.** A slow or reconnecting peer
   must not delay local drawing; scene durability and recovery remain separate
   concerns.
6. **The editor should degrade by reducing work, not by freezing.** If a frame
   misses its budget, skip nonessential overlay work and keep the last valid
   canvas rather than launching a worker or forcing a synchronous full repaint.

The acceptance test is still a browser trace: compare input-to-paint, long
tasks, dropped frames, and memory across the scenarios in §5.4.

---

## 4. Side-by-side contrast

| Axis                        | Excalidraw `v0.18.1`                                    | Dripl (current tree)                                                   | Better             |
| --------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------ |
| Frame scheduling            | `throttleRAF` × 3, opt-in flag                          | dirty-only, one in-flight RAF, never idle-loops                        | **Dripl**          |
| Layer separation            | static / interactive / draft                            | static / interactive                                                   | tie                |
| Canvas resize guard         | explicit, with flicker rationale                        | explicit                                                               | tie                |
| Culling                     | O(N) linear scan, single-slot memoized                  | RBush `search`, incremental maintenance                                | **Dripl**          |
| Culling memoization         | identity-stable result array                            | new array every recomputation                                          | **Excalidraw**     |
| Hit testing                 | O(N), 3 chained filters, no index                       | indexed candidates, but O(N) z-order scan                              | **Dripl** (partly) |
| Shape cache                 | `WeakMap` by element                                    | `WeakMap` by element                                                   | tie                |
| Element bitmap cache        | `WeakMap` by element, zoom/theme/crop-aware             | `WeakMap` by element + id map                                          | tie                |
| Bounds cache                | `WeakMap` by element **+ `version`**                    | id-keyed, refreshed by version bump                                    | **Excalidraw**     |
| Free-draw `Path2D` cache    | yes                                                     | not present                                                            | **Excalidraw**     |
| Image cache                 | unbounded `Map` by `fileId`                             | LRU, `maxSize: 100`                                                    | **Dripl**          |
| Pointer move                | 1 event/frame, flushed on up                            | 1 RAF, all coalesced samples, flushed on up/down                       | **Dripl**          |
| React batching              | `unstable_batchedUpdates` inside the throttle           | n/a (Zustand + refs)                                                   | tie                |
| Per-move O(N) work          | not present on the pointer path                         | ~10 full passes per bound-arrow drag                                   | **Excalidraw**     |
| Pathfinding                 | A\* + binary heap, inline, no-op short-circuit          | inline, no short-circuit                                               | **Excalidraw**     |
| History representation      | per-element forward/inverse deltas                      | ≤100 full `structuredClone` snapshots                                  | **Excalidraw**     |
| History vs. remote          | rebased against latest remote state                     | not rebased                                                            | **Excalidraw**     |
| Undo cache impact           | none beyond changed elements                            | invalidates every element's bitmap                                     | **Excalidraw**     |
| Cursor cadence              | 33 ms (~30 fps)                                         | 50 ms (20 fps)                                                         | **Excalidraw**     |
| Cursor droppability         | volatile channel                                        | none                                                                   | **Excalidraw**     |
| Full-state resync           | every 20 s                                              | none                                                                   | **Excalidraw**     |
| Inbound version filter      | `version` + `versionNonce`                              | version reconciliation exists                                          | tie                |
| Local in-progress edit wins | yes — discards on `editingText`/`resizing`/`newElement` | **no** — no gesture-lock check on inbound                              | **Excalidraw**     |
| Render workers              | none (font subsetter only)                              | none (files deleted)                                                   | tie                |
| Perf instrumentation        | n/a                                                     | User Timing module exists; one measure wired, wrong layer, no reporter | —                  |

**Dripl's structural position is stronger than Excalidraw's on the fundamentals —
spatial indexing, input fidelity, idle behavior, memory bounds — and weaker on
the per-frame work discipline and on history representation.** The weaknesses
are all fixable without adopting Excalidraw's architecture.

---

## 5. Measurements

### 5.1 What the numbers below are

**[MEASUREMENT]** Two Node.js microbenchmarks, run on this machine:

```
Run date:  2026-09-25
Runtime:    Node v24.19.0, Linux workspace
Dataset:    10,000 synthetic rectangles on a 100 × 100 grid, 100 × 70 px
Warmup:     3–5 untimed iterations, then 20 timed, median reported
```

They isolate individual JavaScript operations. **They contain no canvas, no
compositor, no React, and no network.** They cannot be converted into frame
rates, and are not converted into frame rates anywhere below.

### 5.2 Existing harness — `pnpm benchmark:canvas`

`scripts/benchmarks/canvas-performance.ts`. Fresh run, verbatim output:

| Measurement                  | Iterations |    Median |       Min |       Max |
| ---------------------------- | ---------: | --------: | --------: | --------: |
| RBush viewport query (10k)   |         20 | 0.0613 ms | 0.0400 ms | 0.1014 ms |
| Element bounds (10k)         |         20 | 0.6298 ms | 0.5067 ms | 1.0109 ms |
| Version reconciliation (10k) |         20 | 0.1524 ms | 0.0896 ms | 0.2416 ms |
| Mutate element (1k)          |         20 | 0.5982 ms | 0.1314 ms | 1.0005 ms |

A post-follow-up verification rerun of `pnpm benchmark:canvas` produced
`0.0169 ms` RBush query, `0.4710 ms` bounds, `0.0656 ms` reconciliation, and
`0.3327 ms` mutation medians. It remains synthetic and is recorded in
[`docs/performance-benchmark.md`](./performance-benchmark.md); it is not a
before/after causal measurement.

**[MEASUREMENT]** Two readings worth keeping:

- The RBush query is ~10× cheaper than a bare `getElementBounds` pass over the
  same 10k elements. That quantifies the _upside_ of Dripl's indexing choice.
- The single mutation measured here is one element. The per-move costs in §3.5
  are not single mutations, and this table does not cover them — which is why
  the second benchmark exists.

### 5.3 Targeted benchmark for the §3.5 per-move path

**[MEASUREMENT]** A separate script modelling only the primitive operations
Dripl performs once per transient move, same 10k synthetic dataset:

| Operation modelled                          | Where it comes from                     |    Median |       Min |       Max |
| ------------------------------------------- | --------------------------------------- | --------: | --------: | --------: |
| `state.elements.map()` full-array copy      | `canvasSlice.ts:215`                    | 0.2276 ms | 0.1883 ms | 1.1430 ms |
| `new Set(elements.map(id))`                 | `RoughCanvas.tsx:325`                   | 1.3843 ms | 1.0696 ms | 2.4603 ms |
| `new Map(elements.map([id, el]))`           | `useCanvasPointerEvents.ts:87` / `:170` | 1.2231 ms | 1.1706 ms | 2.4495 ms |
| Index diff (2 × `filter` + `Set` + spread)  | `RoughCanvas.tsx:325-340`               | 2.3361 ms | 2.1200 ms | 3.3183 ms |
| Reverse `boundElements` index rebuild       | `useCanvasPointerEvents.ts:91-105`      | 0.0960 ms | 0.0869 ms | 0.9233 ms |
| O(N) reverse z-order scan, `Set` membership | `RoughCanvas.tsx:490` / `:549`          | 0.1132 ms | 0.1073 ms | 0.1898 ms |

Two honest caveats on this table:

- **The `boundElements` rebuild number is a floor, not a typical value.** The
  fixture elements carry no `boundElements`, so the inner loop never allocates
  a `Set` per shape. A realistic scene with bound arrows will be slower.
- **These are not additive into a frame time.** The operations share
  intermediates in the real code path, and the real code path also does
  `mutateElement`, geometry, and React work that is not modelled.

What the numbers do support: **[MEASUREMENT]** the index diff alone
(2.34 ms median at 10k) is a substantial fraction of a 16.7 ms frame budget,
and it is pure bookkeeping that contributes nothing to what the user sees.

### 5.4 How to get the measurements that are actually missing

**[RECOMMENDATION]** Dripl already has a User Timing module
(`apps/dripl-app/utils/performance.ts`, §3.8), so this is an extension job, not
a greenfield one. Three gaps to close:

1. **Bracket the right layer.** The one wired measure spans the `RoughCanvas`
   React render (`RoughCanvas.tsx:73`, `:870-871`). Add marks inside
   `useCanvasRenderLoop`'s callback (`useCanvasRenderLoop.ts:29-45`) and around
   the `renderFrame` body, plus around the per-move work in §3.5.
2. **Add `PerformanceObserver`.** Three primary sources already define the
   entries needed, and none of them is a User Timing mark:

   - `type: "longtask"`
     ([W3C Long Tasks API](https://www.w3.org/TR/longtasks/)) attributes
     blocking main-thread time to a task and its script attribution.
   - `type: "event"` with `durationThreshold: 0`
     ([W3C Event Timing](https://www.w3.org/TR/event-timing/)) gives
     per-interaction processing latency, which is the number users feel.
   - `type: "long-animation-frame"`
     ([MDN, PerformanceObserver](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver))
     covers the multi-frame blocking case that long tasks miss.

3. **Make the output reachable.** `reportPerf()` exists but is never called
   (`utils/performance.ts:70-82`). Wire it behind a dev-only key so a
   before/after comparison does not require hand-editing the console.

**[RECOMMENDATION]** The harness should drive a scripted interaction
(drag-one-rectangle, drag-a-shape-with-5-bound-arrows, pan, zoom, freehand a
100-point stroke) against a 1k / 5k / 10k / 20k scene, record
`interaction-to-next-paint`, long-task counts, and the render-phase measures,
and run before and after each change in §7. Until that exists, §7 is a ranked
hypothesis list, and this document should be read that way.

---

## 6. Sources considered and rejected as evidence

Listed so the next person does not re-derive them. All are **[UNVERIFIED]** and
none influenced a recommendation.

- **Excalidraw issue #10512** — reports O(N) work on pan/zoom. Directionally
  consistent with §2.4, and I independently confirmed the O(N) loop in the
  pinned source, so the note adds nothing. It supplies no controlled
  measurements, so it is not quoted as any.
- **Excalidraw's elbow-arrow engineering write-up** —
  `https://excalidraw.com/blog/2026-01-21-elbow-arrows/`. States a design target
  in the region of ≥120 Hz interaction with roughly 50 rerouted arrows. That is
  a **target**, not a published benchmark: there is no harness, no dataset, and
  no result table. Additionally the page is client-side rendered — a plain HTTP
  fetch returns the site shell, not the article body — so the figures are not
  machine-verifiable from the repository. No number from it is used anywhere in
  this document.
- **Release notes, blog posts, conference talks, and third-party
  "how Excalidraw works" articles.** Superseded by the pinned source, and most
  describe pre-`v0.18.1` architecture (§1.4).

---

## 7. Prioritized plan for Dripl

Ordered by expected value per unit of risk. **Ranks are provisional until §5.4
exists.**

### P0 — Measure the right layer (blocks validation of everything below)

**Status: done, with stated limits.** `utils/performance.ts` was extended rather
than duplicated: the render loop brackets each static and interactive frame with
`perfMark`/`perfMeasure`, pointer-move batches are measured, and
`utils/performance-observers.ts` observes `longtask`, `event`, and
`long-animation-frame` (including per-script attribution) behind a dev-only
`window.__driplPerformance` handle. `e2e/performance.spec.ts` drives zoom, pan,
and freehand over seeded scenes and records a baseline in
[`docs/performance-benchmark.md`](./performance-benchmark.md), separated from the
synthetic table.

Two of the four scene sizes in the plan were unreachable at the time of
writing: local persistence sliced every load path to 5,000 elements, so 10k
and 20k could not be seeded through it at all. (Superseded — the harness now
seeds into IndexedDB with a 50,000-element cap and 10k/50k runs are recorded
in [`docs/performance-benchmark.md`](./performance-benchmark.md).) The run is
also a development build in headless Chromium, so
it establishes _which layer costs what at 1k and 5k_ and nothing more. It also
found a genuine bug (below), which is the concrete argument for doing this work
first rather than optimizing blind.

### P0 follow-up — interrupted zoom animations (fixed)

`AnimationController.stop()` deactivated an animation without releasing its map
entry, and `start()` treats a present key as "already running". Every
`smoothZoom` call after the first in a wheel burst was therefore a silent no-op:
the zoom animation stopped running, and `shouldCacheIgnoreZoom` — set on start,
cleared only when the animation completes — stayed `true` for the rest of the
session, allowing stale per-element bitmaps to be reused for changed elements.
Long Animation Frame attribution (`applyMomentum` 135 ms, `animate` 99 ms) is
what surfaced it. Fixed in `utils/animationController.ts`, covered by
`src/__tests__/animationController.test.ts`.

### P1 — Remove O(N) work from the transient drag path

**Status: done.** All three items below are implemented, and the browser capture
corroborates the result rather than leaving it as a code-reading inference: across
a 5× scene increase, `canvas:interactive:frame` held a 0.00 ms median and
pointer-move handling a ≤0.60 ms median. Item (3) was implemented as changed IDs
plus a matching spatial revision on transient batches, so the conservative full
diff still applies to every other mutation.

Three contained changes, all in the code paths identified in §3.5:

1. **Hoist the derived binding index out of the pointer handler.** Build
   `boundArrowsByShape` once, in the store, updated on commit rather than
   rebuilt per move. `useCanvasPointerEvents.ts:87-105` then becomes a lookup
   plus an O(k) loop — which is what its own comment at `:107` already claims.
2. **Reuse `state.elementsById` instead of rebuilding a `Map`.** It is already
   maintained in the store; `updateBoundArrows` (`:87`) and `updateBoundLabels`
   (`:170`) duplicate it per move. The same applies to `elements.find(...)` at
   `:515`.
3. **Stop bumping `spatialVersion` for moves that do not change extents, and
   make the diff O(changed) rather than O(N).** `RoughCanvas.tsx:325-340`
   needs `added` / `removed` / `updated`, and derives them by scanning the whole
   scene because the store does not say what changed. If the store recorded
   `changedIds` per commit, the diff becomes proportional to the change set.
   Note the interaction: RBush entries store element bounds, so a _translation_
   does require a tree update — but an `O(changed)` update of `changed` items
   is strictly cheaper than the current four `O(N)` passes regardless.

_Expected effect:_ removes ~2.3 ms of pure bookkeeping per index bump at 10k,
plus ~0.23 ms per updated element. **[RECOMMENDATION]** Start with (1) and (2),
which are mechanical, then measure before attempting (3), which touches the
index's correctness invariants.

### P2 — Make `visibleElements` identity-stable

`RoughCanvas.tsx:425-447` should return the _previous_ array when the
visible-id sequence is unchanged. Two steps: memoize the `order` map on
`elements` identity alone (it currently rebuilds on every call at `:441`), and
keep a `useRef` of the last result, comparing id sequences before returning a
new one. Then relax `StaticCanvas`'s memo (`StaticCanvas.tsx:22-33`) to depend
on `visibleElements` identity rather than also requiring
`prev.elements === next.elements`.

_Why:_ this is the §2.3/§2.4 mechanism Dripl does not have, and it is the one
that turns "already cached, already visible" moves into free. It also makes the
`DualCanvas.tsx:56-57` comment — _"panning/zooming only touches the interactive
canvas"_ — true for moves, which it currently is not.

### P3 — Bound the z-order loop in hit testing

Add a monotonically increasing `zIndex` ordinal to each element (or reuse the
existing array position via a `version`-keyed lookup). Then sort only the RBush
_candidates_ — typically single digits — by that ordinal and take the top hit,
replacing the full reverse scan at `RoughCanvas.tsx:490` and `:549`. Marquee
selection and the `:515` container lookup benefit from the same ordinal.

_Expected effect:_ hit testing goes from O(N) to O(log N + k log k). **[FACT]**
Excalidraw does not do this at all (§2.5), so this is a place where Dripl
differentiates rather than catches up.

### P4 — Adopt Excalidraw's cheapest collaboration wins

- Cursor cadence 50 ms → 33 ms (`useCollaboration.ts:385`; target
  `app_constants.ts:8`). One-line, reversible, and the existing 30-message/s
  budget comment at `:369-371` still holds because cursor sends are a separate
  message type from scene deltas — **verify that against `ws-server`'s rate
  limiter before changing it.**
- **Add the "local in-progress edit wins" rule.** In the inbound handler
  (`RoughCanvas.tsx:213-230`), skip remote updates for ids in
  `activeGestureLocksRef` (`:236`) and for the current draft element. This is
  the cheapest user-visible correctness win in the document: it is a few lines,
  it has no performance cost, and without it a collaborator's move can yank an
  element out from under an in-progress drag. **[FACT]** Excalidraw
  discards unconditionally on `editingTextElement` / `resizingElement` /
  `newElement` (`data/reconcile.ts:19-40`).
- Mark cursor payloads droppable server-side, mirroring the volatile-channel
  idea. **[FACT]** This is a `ws-server` change (§2.8), so it is out of scope
  for the canvas client and belongs with the existing collaboration workstream.
- Consider a periodic full-state resync heartbeat. **[RECOMMENDATION]** Cheap,
  orthogonal to CRDT, and bounds divergence — but sequence it after the
  collaboration decision already in flight rather than opening a third track.

### P5 — Move history from snapshots to deltas

Replace `cloneElements` snapshots (`helpers.ts:135`) with per-element
forward/inverse property deltas, keeping a snapshot only as a periodic
checkpoint. Removes the `O(scene)` cost of `pushHistory` and the
whole-scene cache invalidation at `historySlice.ts:30,54`. **[FACT]** This is
the largest single asymptotic gap to Excalidraw (§2.9), but it touches
undo/redo correctness and the 10 MB budget enforcement, and it is a bigger job
than P1–P3.

### P6 — Small, low-risk correctness and parity items

- Add a version-keyed bounds cache alongside the RBush, mirroring
  `element/bounds.ts:81-101`. Guards against a stale-extent class of bug rather
  than only saving time.
- Add a free-draw `Path2D` cache, mirroring `renderElement.ts:1005-1016`.
- Fix the `DualCanvas.tsx:56-57` comment, which is wrong today (§3.3). Do this
  regardless of whether P2 lands, so the next person is not misled.

### Explicitly not recommended

- **A render/layout worker.** **[FACT]** Excalidraw ships none (§2.10). The
  wins are in caching and in not doing O(N) per frame.
- **A spatial index for hit testing to replace RBush.** Dripl already has one.
- **Copying Excalidraw's unbounded image cache.** Dripl's LRU is better (§2.6).
- **A frame-budget claim of any kind** until §5.4 produces browser data.

---

## 8. Source index

**Excalidraw** — all links pinned to `a2ec2889babf7d2295469c6d90ebe77fae57df84`
(= tag `v0.18.1`, `packages/excalidraw/package.json` version `0.18.1`):

- Scheduling — [`utils.ts:147-197`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/utils.ts#L147-L197) · [`reactUtils.ts:22-62`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/reactUtils.ts#L22-L62) · [`excalidraw-app/App.tsx:138`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/App.tsx#L138) · [`animation-frame-handler.ts:8-78`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/animation-frame-handler.ts#L8-L78) · [`queue.ts:13-46`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/queue.ts#L13-L46)
- Renderers — [`staticScene.ts:140-146`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/renderer/staticScene.ts#L140-L146) · [`staticScene.ts:460-480`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/renderer/staticScene.ts#L460-L480) · [`interactiveScene.ts:1205-1231`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/renderer/interactiveScene.ts#L1205-L1231) · [`renderNewElementScene.ts:49-66`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/renderer/renderNewElementScene.ts#L49-L66)
- Canvases — [`canvases/StaticCanvas.tsx:44-46`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/canvases/StaticCanvas.tsx#L44-L46) · [`:57-66`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/canvases/StaticCanvas.tsx#L57-L66) · [`:68-80`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/canvases/StaticCanvas.tsx#L68-L80) · [`:115-139`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/canvases/StaticCanvas.tsx#L115-L139) · [`App.tsx:565`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L565) · [`App.tsx:437`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L437) · [`App.tsx:10205-10227`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L10205-L10227)
- Culling & scene — [`scene/Renderer.ts:42-64`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/scene/Renderer.ts#L42-L64) · [`:106`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/scene/Renderer.ts#L106) · [`:129-130`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/scene/Renderer.ts#L129-L130) · [`:162-166`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/scene/Renderer.ts#L162-L166) · [`utils.ts:956-992`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/utils.ts#L956-L992) · [`element/sizeHelpers.ts:21-51`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/element/sizeHelpers.ts#L21-L51) · [`scene/Scene.ts:155-163`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/scene/Scene.ts#L155-L163) · [`:188-190`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/scene/Scene.ts#L188-L190) · [`:308`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/scene/Scene.ts#L308)
- Hit testing — [`App.tsx:4983-5035`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L4983-L5035) · [`:5037-5083`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L5037-L5083) · [`:5089+`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L5089)
- Caches — [`scene/ShapeCache.ts:15,68`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/scene/ShapeCache.ts#L15) · [`renderer/renderElement.ts:525-528`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/renderer/renderElement.ts#L525-L528) · [`:549-563`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/renderer/renderElement.ts#L549-L563) · [`:1005-1016`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/renderer/renderElement.ts#L1005-L1016) · [`element/bounds.ts:72-101`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/element/bounds.ts#L72-L101) · [`element/image.ts:29-76`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/element/image.ts#L29-L76) · [`App.tsx:590`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L590)
- Pointer input — [`App.tsx:6631-6652`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L6631-L6652) · [`:6867`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L6867) · [`:6993`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L6993) · [`:8798-8805`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/components/App.tsx#L8798-L8805) · [`types.ts:747`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/types.ts#L747)
- Pathfinding — [`element/mutateElement.ts:39-71`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/element/mutateElement.ts#L39-L71) · [`element/elbowArrow.ts:1056-1077`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/element/elbowArrow.ts#L1056-L1077) · [`:1496-1516`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/element/elbowArrow.ts#L1496-L1516)
- Collaboration — [`app_constants.ts:6,8,16`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/app_constants.ts#L6) · [`collab/Collab.tsx:733-754`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/collab/Collab.tsx#L733-L754) · [`:771-780`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/collab/Collab.tsx#L771-L780) · [`:881-892`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/collab/Collab.tsx#L881-L892) · [`:911-920`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/collab/Collab.tsx#L911-L920) · [`:927-953`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/collab/Collab.tsx#L927-L953) · [`collab/Portal.tsx:86-95,196,220,243`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/collab/Portal.tsx#L86-L95) · [`data/reconcile.ts:19-40`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/data/reconcile.ts#L19-L40) · [`constants.ts:267-269`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/constants.ts#L267-L269)
- History — [`change.ts:60-64,88-123,437-439,807-812,946-952,1040-1104`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/change.ts#L60-L64) · [`history.ts:160-200`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/history.ts#L160-L200)
- Workers — [`workers.ts:22-152`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/workers.ts#L22-L152) · [`subset/subset-main.ts:33`](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/subset/subset-main.ts#L33) · [`packages/excalidraw/subset/`](https://github.com/excalidraw/excalidraw/tree/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/subset)

**Platform specifications:**

- [WHATWG HTML — `requestAnimationFrame`](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-requestanimationframe)
- [MDN — `Window.requestAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
- [W3C — Pointer Events Level 4 (coalesced events)](https://www.w3.org/TR/pointerevents4/)
- [W3C — Long Tasks API](https://www.w3.org/TR/longtasks/)
- [W3C — Event Timing](https://www.w3.org/TR/event-timing/)
- [MDN — `PerformanceObserver`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver)

**Dripl files referenced** (current working tree):

`apps/dripl-app/hooks/canvas/useCanvasRenderLoop.ts` ·
`apps/dripl-app/hooks/canvas/useCanvasPointerEvents.ts` ·
`apps/dripl-app/components/canvas/RoughCanvas.tsx` ·
`apps/dripl-app/components/canvas/StaticCanvas.tsx` ·
`apps/dripl-app/components/canvas/InteractiveCanvas.tsx` ·
`apps/dripl-app/components/canvas/DualCanvas.tsx` ·
`apps/dripl-app/hooks/useCollaboration.ts` ·
`apps/dripl-app/lib/store/canvasSlice.ts` ·
`apps/dripl-app/lib/store/historySlice.ts` ·
`apps/dripl-app/lib/store/helpers.ts` ·
`apps/dripl-app/utils/performance.ts` ·
`packages/element/src/staticScene.ts` ·
`packages/element/src/shape-cache.ts` ·
`packages/element/src/image-cache.ts` ·
`docs/performance-benchmark.md` ·
`scripts/benchmarks/canvas-performance.ts`

---

## 9. One-paragraph summary

Excalidraw v0.18.1 earns its smoothness on interaction from four things:
frame-throttled renderers on three separate canvases, aggressive identity-keyed
caches (Rough shapes, per-element bitmaps, bounds, free-draw `Path2D`), a
single-slot memo that keeps the visible-element array _reference-stable_ so the
static layer is not re-rendered at all, and per-element deltas for history. It
does **not** use spatial indexing for either culling or hit testing, does
**not** use a render worker, and does **not** read coalesced pointer samples.
Dripl already beats it on spatial indexing, pointer fidelity, idle-frame
discipline, and image-cache bounds. Dripl loses on two things: it does several
full `O(N)` passes _per transient pointer move_ (§3.5), and it keeps 100 full
scene snapshots for history. A third, non-performance gap is worth more than
either: a collaborator's remote update can currently land on the element you are
mid-drag, because the inbound handler never checks gesture state (§3.7). Before
fixing any of them, extend the existing but misaimed instrumentation in
`utils/performance.ts` — no browser measurement of Dripl exists today, and the
ranking above is derived from source reading plus synthetic Node microbenchmarks,
not from observed frame behaviour.
