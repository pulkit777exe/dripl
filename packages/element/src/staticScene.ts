import type { DriplElement } from '@dripl/common';
import { createRoughCanvas, renderRoughElement } from './rough-renderer';
import { imageCache } from './image-cache';
import { getElementBounds } from '@dripl/math/intersection';

export interface StaticSceneViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

export interface StaticSceneConfig {
  gridEnabled: boolean;
  gridSize: number;
  zoom: number;
  theme: 'light' | 'dark';
  dpr: number;
  shouldCacheIgnoreZoom?: boolean;
  /** The complete scene, used for relationships such as arrow labels. */
  elements?: DriplElement[];
  /**
   * The subset that intersects the current viewport. Supplying this from the
   * caller's spatial index avoids scanning the complete scene on every frame.
   */
  visibleElements?: readonly DriplElement[];
  /** Called after an asynchronous image finishes loading or fails. */
  onAssetLoad?: () => void;
  /**
   * Upper bound on per-element bitmaps allocated in a single frame.
   *
   * A cold frame in a dense scene allocates one backing store per visible
   * element, and that allocation is the largest single frame cost measured at
   * 10,000 elements. Elements past the budget are drawn directly for that frame
   * and get their bitmap on a later one, so the frame is always complete.
   */
  maxNewBitmapsPerFrame?: number;
  /**
   * Per-frame counters, for diagnosing where static-frame time goes. Emitted on
   * every render, so callers should keep the handler trivial and dev-only.
   */
  onFrameStats?: (stats: StaticSceneFrameStats) => void;
}

/**
 * What a single static frame actually did.
 *
 * `bitmapsGenerated` is the number of per-element offscreen canvases allocated
 * during the frame; `elementsDrawn` is how many elements were blitted. These
 * separate the two candidate costs of a slow frame, which timing alone cannot
 * distinguish: allocating thousands of canvases is expensive, and blitting
 * thousands of them is separately expensive.
 */
export interface StaticSceneFrameStats {
  /** Elements considered after viewport culling. */
  candidates: number;
  /** Elements actually drawn. */
  elementsDrawn: number;
  /** New per-element offscreen canvases allocated during this frame. */
  bitmapsGenerated: number;
  /** Cache hits, i.e. elements whose bitmap already existed. */
  bitmapsReused: number;
  /** Elements skipped because rendering was not possible (e.g. no context). */
  elementsSkipped: number;
  /**
   * Elements drawn directly because the frame's bitmap budget was already spent.
   * They still appear in this frame; they simply get their cached bitmap later.
   */
  bitmapsDeferred: number;
  /**
   * Milliseconds attributed within the frame. Only populated when a caller asks
   * for stats, because attributing costs clock reads per element and that is not
   * free on the hot path.
   */
  setupMs?: number;
  /** Time spent building new per-element bitmaps. */
  generateMs?: number;
  /** Time spent blitting already-cached bitmaps. */
  blitMs?: number;
  /** Time spent drawing deferred elements directly. */
  directMs?: number;
}

// ─── Element canvas cache ────────────────────────────────────────────────────
// Each cached entry stores:
//   canvas  – the offscreen canvas with the rendered element
//   version – element.version at the time of rendering.
//             If element.version changes, the entry is regenerated in O(1).
//
// Uses WeakMap keyed by element object reference for automatic GC.
type CanvasLike = HTMLCanvasElement | OffscreenCanvas;

interface CacheEntry {
  canvas: CanvasLike;
  version: number;
  theme: 'light' | 'dark';
  /**
   * Device pixels per CSS pixel the bitmap was rasterized at. Equals `dpr`,
   * except when the bitmap was downscaled to fit a browser canvas limit, in
   * which case the draw path divides by this to recover the logical size.
   */
  pixelsPerUnit: number;
  /**
   * Versions of the elements drawn *into* this bitmap (bound text, labels).
   *
   * An owner's bitmap embeds its label, so it goes stale when the label
   * changes. The previous approach walked every cached element on every
   * mutation to find those owners, which made each drag frame O(scene size).
   * Recording the versions instead makes invalidation O(1) and lets the owner
   * notice on its own next draw.
   */
  dependencyVersions: ReadonlyMap<string, number> | null;
}

const elementCanvasCache = new WeakMap<DriplElement, CacheEntry>();

/**
 * Memory ceiling for cached element bitmaps.
 *
 * Each entry is a real backing store (`width * height * 4` bytes), so a large
 * scene can ask for hundreds of megabytes: a 100x70 element with padding is
 * about 43 KB, which is ~430 MB for 10,000 elements. Local persistence accepts
 * up to 50,000 elements, so unbounded growth here would reach multiple gigabytes
 * and take the tab down. Bounding the cache is deliberate.
 *
 * Eviction is by insertion order and only drops the bitmap, so a later frame
 * regenerates it. That is a deliberate trade: a working set larger than the
 * budget regenerates instead of thrashing memory.
 */
const ELEMENT_BITMAP_CACHE_BYTE_BUDGET = 128 * 1024 * 1024;
const ELEMENT_BITMAP_CACHE_ENTRY_LIMIT = 20_000;

/** Insertion-ordered strong refs, used only to find eviction candidates. */
const bitmapOrder: Set<DriplElement> = new Set();
let cachedBitmapBytes = 0;

function bitmapBytes(canvas: CanvasLike): number {
  // OffscreenCanvas and HTMLCanvasElement both expose width/height.
  return Math.max(0, canvas.width * canvas.height * 4);
}

function evictBitmapsToFit(): void {
  while (
    (cachedBitmapBytes > ELEMENT_BITMAP_CACHE_BYTE_BUDGET ||
      bitmapOrder.size > ELEMENT_BITMAP_CACHE_ENTRY_LIMIT) &&
    bitmapOrder.size > 0
  ) {
    const oldest = bitmapOrder.values().next();
    if (oldest.done) break;
    const element = oldest.value;
    bitmapOrder.delete(element);
    const entry = elementCanvasCache.get(element);
    if (entry) {
      cachedBitmapBytes -= bitmapBytes(entry.canvas);
      elementCanvasCache.delete(element);
    }
    if (cachedBitmapBytes < 0) cachedBitmapBytes = 0;
  }
}

// Parallel ID→element map for string-keyed invalidation
const elementIdMap = new Map<string, DriplElement>();

/** Reused id→element lookup, keyed on the scene array it was built from. */
const elementIdLookupCache = new WeakMap<readonly DriplElement[], Map<string, DriplElement>>();

function sceneById(
  elements: readonly DriplElement[] | undefined,
  id: string
): DriplElement | undefined {
  if (!elements) return undefined;
  let lookup = elementIdLookupCache.get(elements);
  if (!lookup) {
    lookup = new Map(elements.map(element => [element.id, element]));
    elementIdLookupCache.set(elements, lookup);
  }
  return lookup.get(id);
}

/**
 * Ids of elements whose content is drawn into `element`'s own bitmap.
 *
 * Labels are rendered into their owner's canvas (an arrow cuts out space for its
 * label, a shape embeds bound text), so the owner's bitmap is only valid while
 * these versions are unchanged.
 */
function collectDependencyIds(element: DriplElement): string[] {
  const ids: string[] = [];
  // Typed defensively: these fields are optional and the element union widens
  // them, so a runtime check is the honest filter.
  const add = (value: unknown): void => {
    if (typeof value !== 'string' || !value) return;
    // Ids are de-duplicated because `dependenciesUnchanged` compares the size of
    // the recorded *Map* against this list's length. A repeated id collapses in
    // the Map but not here, so a single duplicate — which an imported `.dripl`
    // file can carry in `boundElements`, since that path copies the array
    // verbatim — made the two disagree permanently and forced the owner's bitmap
    // to be regenerated on every frame.
    if (!ids.includes(value)) ids.push(value);
  };
  add(element.labelId);
  add(element.boundElementId);
  if (element.boundElements) {
    for (const bound of element.boundElements) {
      if (bound) add(bound.id);
    }
  }
  return ids;
}

function dependencyVersions(
  element: DriplElement,
  elements: readonly DriplElement[] | undefined
): Map<string, number> | null {
  const ids = collectDependencyIds(element);
  if (ids.length === 0) return null;
  const versions = new Map<string, number>();
  for (const id of ids) {
    // A missing dependency is recorded as -1, so that adding it later counts as
    // a change and forces a rebuild.
    versions.set(id, sceneById(elements, id)?.version ?? -1);
  }
  return versions;
}

function dependenciesUnchanged(
  recorded: ReadonlyMap<string, number> | null,
  element: DriplElement,
  elements: readonly DriplElement[] | undefined
): boolean {
  if (!recorded || recorded.size === 0) return true;
  if (recorded.size !== collectDependencyIds(element).length) return false;
  for (const [id, version] of recorded) {
    if ((sceneById(elements, id)?.version ?? -1) !== version) return false;
  }
  return true;
}

// ─── Per-element offscreen canvas sizing ─────────────────────────────────────
//
// Every element is rasterized into its own offscreen canvas, so its dimensions
// have to stay inside what a browser will actually allocate. Without a cap, an
// element of 40,000 x 40,000 world pixels asks for a ~1.6 billion pixel
// surface, which is a multi-gigabyte allocation that fails or renders blank.
//
// Both caps are applied by reducing the resolution (scale) rather than
// refusing to cache the element at all. The values are the browser's own
// ceilings: AREA_LIMIT is approximately Safari's mobile canvas area limit,
// and the axis limit is the Safari per-axis canvas limit documented on MDN.
const ELEMENT_CANVAS_AREA_LIMIT = 16_777_216;
const ELEMENT_CANVAS_AXIS_LIMIT = 32_767;

/**
 * Default number of per-element bitmaps a single frame may allocate.
 *
 * Building one bitmap measured ~76 us at 10,000 elements (Rough.js path
 * generation dominates; a cached blit is ~1.7 us). At 100 that is ~7.6 ms of a
 * 16.7 ms frame, leaving room for the rest of the work. The previous value of
 * 400 allowed a single frame to spend 22.8 ms purely on generation.
 */
export const DEFAULT_MAX_NEW_BITMAPS_PER_FRAME = 100;

export interface ElementCanvasSize {
  /** Backing-store width in device pixels. */
  width: number;
  /** Backing-store height in device pixels. */
  height: number;
  /**
   * Resolution multiplier actually applied. Below 1 when the element had to be
   * downscaled to fit a limit; the caller must draw with this factor so the
   * element still lands at the right size and position.
   */
  scale: number;
}

/**
 * Resolve the backing-store size for an element's offscreen canvas, capped to
 * what a browser will allocate.
 *
 * Exported for tests: the limits are a correctness guard, not a tuning knob, so
 * they are pinned directly rather than inferred from rendered output.
 */
export function computeElementCanvasSize(
  elementWidth: number,
  elementHeight: number,
  dpr: number,
  padding: number
): ElementCanvasSize {
  const ratio = dpr > 0 ? dpr : 1;
  let width = (Math.max(elementWidth, 1) + padding * 2) * ratio;
  let height = (Math.max(elementHeight, 1) + padding * 2) * ratio;
  let scale = 1;

  if (width > ELEMENT_CANVAS_AXIS_LIMIT || height > ELEMENT_CANVAS_AXIS_LIMIT) {
    scale = Math.min(ELEMENT_CANVAS_AXIS_LIMIT / width, ELEMENT_CANVAS_AXIS_LIMIT / height);
    width *= scale;
    height *= scale;
  }

  if (width * height > ELEMENT_CANVAS_AREA_LIMIT) {
    scale = Math.sqrt(ELEMENT_CANVAS_AREA_LIMIT / (width * height));
    width *= scale;
    height *= scale;
  }

  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
    scale,
  };
}

/**
 * Return the element's version number for cache invalidation.
 * Falls back to 0 for legacy elements that don't have a version yet.
 * O(1) — no serialization required.
 */
function getElementVersion(el: DriplElement): number {
  return el.version ?? 0;
}

// Test-only handles for the dependency logic. Cache invalidation runs once per
// mutated element per frame, so this is pinned directly rather than only through
// rendered output.
export const collectDependencyIdsForTest = collectDependencyIds;
export const dependenciesUnchangedForTest = dependenciesUnchanged;

// Test-only probes. The point of the lazy dependency check is that invalidating
// one element no longer drops its dependents' bitmaps eagerly, so a test has to
// observe the cache directly rather than infer it from rendered output.
export function hasCachedBitmapForTest(element: DriplElement): boolean {
  return elementCanvasCache.has(element);
}

/**
 * Insert a cache entry without allocating a real canvas. The stub exposes only
 * the `width`/`height` the byte accounting reads.
 */
export function seedCacheEntryForTest(element: DriplElement, width = 120, height = 90): void {
  // Re-seeding an element replaces its entry, so the byte total has to subtract
  // the one being replaced exactly as `getOrCreateElementCanvas` does. Adding
  // unconditionally let a double-seeded element report twice its real cost,
  // which would make the ceiling tests above it measure the wrong thing.
  const replaced = elementCanvasCache.get(element);
  if (replaced) cachedBitmapBytes -= bitmapBytes(replaced.canvas);
  if (cachedBitmapBytes < 0) cachedBitmapBytes = 0;
  elementCanvasCache.set(element, {
    canvas: { width, height } as unknown as CacheEntry['canvas'],
    version: element.version ?? 0,
    theme: 'light',
    pixelsPerUnit: 1,
    dependencyVersions: null,
  });
  elementIdMap.set(element.id, element);
  bitmapOrder.add(element);
  cachedBitmapBytes += width * height * 4;
  evictBitmapsToFit();
}

/** Current size of the element bitmap cache, for tests and diagnostics. */
export function getElementBitmapCacheStatsForTest(): {
  entries: number;
  trackedBytes: number;
} {
  return { entries: bitmapOrder.size, trackedBytes: cachedBitmapBytes };
}

/**
 * Run the eviction pass directly. Exposed so the byte ceiling can be tested
 * without allocating hundreds of megabytes of real canvas.
 */
export function evictBitmapsToFitForTest(): void {
  evictBitmapsToFit();
}

/**
 * Reset all cache accounting. The cache is module-global and shared across test
 * files in a worker, so tests need an explicit reset rather than relying on
 * element ids they happened to create.
 */
export function resetElementBitmapCacheForTest(): void {
  // WeakMap has no `clear`, so rebuild it rather than pretending.
  for (const element of [...bitmapOrder]) dropCachedBitmap(element);
  elementIdMap.clear();
  bitmapOrder.clear();
  cachedBitmapBytes = 0;
}

export const ELEMENT_BITMAP_CACHE_LIMITS = {
  byteBudget: ELEMENT_BITMAP_CACHE_BYTE_BUDGET,
  entryLimit: ELEMENT_BITMAP_CACHE_ENTRY_LIMIT,
} as const;

// Dev-only counter for the eliminated eager scan. `invalidateElementCache` used
// to walk every cached element on every mutation; this makes the remaining work
// observable so a regression to O(scene) is visible rather than invisible.
let invalidateCallCount = 0;

export function getInvalidateCallCount(): number {
  return invalidateCallCount;
}

export function resetInvalidateCallCount(): void {
  invalidateCallCount = 0;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function renderStaticScene(
  canvas: HTMLCanvasElement,
  elements: DriplElement[],
  viewport: StaticSceneViewport,
  config: StaticSceneConfig
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const frameStartedAt =
    typeof config.onFrameStats === 'function' && typeof performance !== 'undefined'
      ? performance.now()
      : 0;

  // 1. Size + clear the canvas, establish the camera transform.
  bootstrapCanvas(ctx, canvas, viewport, config);

  // 2. Optional grid (drawn in world-space, behind elements).
  if (config.gridEnabled) {
    drawGrid(ctx, viewport, config);
  }

  const shouldCacheIgnoreZoom = config.shouldCacheIgnoreZoom ?? false;

  // Pass elements to config for arrow label rendering
  const configWithElements = { ...config, elements };

  // 3. Draw only the viewport candidates supplied by the caller when an
  // index is available. The full scene remains in `config.elements` so
  // relationship-aware renderers (for example arrow labels) still work.
  const hasSpatialCandidates = config.visibleElements !== undefined;
  const drawableElements = config.visibleElements ?? elements;

  const stats: StaticSceneFrameStats = {
    candidates: 0,
    elementsDrawn: 0,
    bitmapsGenerated: 0,
    bitmapsReused: 0,
    elementsSkipped: 0,
    bitmapsDeferred: 0,
  };

  // Attribution is opt-in: it needs clock reads around every element, which is
  // not free. Only pay for it when somebody is listening.
  const timed = typeof config.onFrameStats === 'function';
  const clock = (): number => (timed && typeof performance !== 'undefined' ? performance.now() : 0);
  if (timed) stats.setupMs = clock() - frameStartedAt;

  // Allocation budget for this frame. Building a bitmap costs ~76 us against
  // ~1.7 us for a blit, so an unbounded cold frame spends nearly all its time
  // generating. Elements past the budget get a placeholder instead.
  let newBitmapsRemaining = config.maxNewBitmapsPerFrame ?? DEFAULT_MAX_NEW_BITMAPS_PER_FRAME;

  // Canvas state that outlives an element. Every element sets the alpha it draws
  // with, so nothing *inside* this frame can be surprised by the previous
  // element's value -- but the context is reused across frames, and the grid is
  // drawn at the top of a frame before any element touches alpha. So the entry
  // value is captured here and restored at the end, which is what the
  // per-element `save`/`restore` pair used to buy. One read and at most one write
  // per frame, against two calls per element.
  const entryAlpha = ctx.globalAlpha;

  for (const element of drawableElements) {
    if (element.isDeleted) continue;

    // The spatial index already applied viewport culling. Rechecking every
    // candidate here would recalculate the same bounds a second time. Keep
    // the linear fallback for callers that do not provide an index.
    if (!hasSpatialCandidates && !isElementVisible(element, viewport, config.zoom)) continue;

    stats.candidates += 1;
    const startedAt = clock();
    const result = drawElement(
      ctx,
      element,
      viewport,
      configWithElements,
      shouldCacheIgnoreZoom,
      newBitmapsRemaining
    );
    if (result.status === 'deferred') {
      // The budget is spent. Draw a cheap placeholder so the frame is complete
      // and cheap, and let a following frame build the real bitmap.
      drawElementPlaceholder(ctx, element, config);
      stats.bitmapsDeferred += 1;
      stats.elementsDrawn += 1;
      if (timed) stats.directMs = (stats.directMs ?? 0) + (clock() - startedAt);
      continue;
    }
    if (result.status === 'failed') {
      stats.elementsSkipped += 1;
      continue;
    }
    stats.elementsDrawn += 1;
    // Reported by the cache itself. Inferring this from `has()` before the
    // call would miscount a stale entry that got regenerated as a reuse.
    if (result.generated) {
      stats.bitmapsGenerated += 1;
      newBitmapsRemaining -= 1;
      if (timed) stats.generateMs = (stats.generateMs ?? 0) + (clock() - startedAt);
    } else {
      stats.bitmapsReused += 1;
      if (timed) stats.blitMs = (stats.blitMs ?? 0) + (clock() - startedAt);
    }
  }

  // See `entryAlpha` above: hand the context back the way it was found, so the
  // next frame's grid and any caller-supplied state are unaffected.
  if (ctx.globalAlpha !== entryAlpha) ctx.globalAlpha = entryAlpha;

  config.onFrameStats?.(stats);
}

/**
 * Invalidate element canvas cache by element ID.
 * Removes the cached offscreen canvas so the next render recomputes it.
 *
 * Elements that draw a label into their own bitmap (an arrow's cutout, a
 * shape's bound text) are *not* visited here. That used to mean walking every
 * cached element on every mutation, which is O(scene) per drag frame, and
 * `mutateElement` calls this on every update. Those owners now record the
 * versions they depend on and rebuild themselves on their next draw. This
 * function is therefore O(1).
 */
export function invalidateElementCache(elementId: string): void {
  invalidateCallCount += 1;
  const element = elementIdMap.get(elementId);
  if (element !== undefined) {
    dropCachedBitmap(element);
    elementIdMap.delete(elementId);
  }
}

/** Remove an element's bitmap and keep the byte accounting honest. */
function dropCachedBitmap(element: DriplElement): void {
  const entry = elementCanvasCache.get(element);
  if (entry) cachedBitmapBytes -= bitmapBytes(entry.canvas);
  if (cachedBitmapBytes < 0) cachedBitmapBytes = 0;
  elementCanvasCache.delete(element);
  bitmapOrder.delete(element);
}

export const dropCachedBitmapForTest = dropCachedBitmap;

/**
 * Drop every strong reference the cache holds.
 *
 * Deliberately has no production caller, and that is the settled answer rather
 * than an oversight. The claim that its absence leaks was investigated against
 * the cache's three structures — a `WeakMap` keyed on the element, a strong
 * id→element map, and the strong insertion order that eviction needs — by
 * observation (`bench/cache-retention.ts`), not by inspection:
 *
 * - Replacing an element *object* without bumping its version — what
 *   `bringForward` does to the whole scene, and what a remote delta carrying an
 *   unchanged version does — did retain the superseded object and its bitmap,
 *   because nothing invalidates by id and `bitmapOrder` holds strong references.
 *   Five such rounds left 3,270 entries and 81 MB of a 128 MB budget holding
 *   objects the scene could no longer draw. That is fixed at the point it
 *   happens, in `getOrCreateElementCanvas`, by dropping the superseded object when
 *   the same id is cached again.
 * - Every other path was already self-correcting: `invalidateElementCache` prunes
 *   by id, and both branches of the store's `setElements` and both directions of
 *   undo/redo call it for the ids involved.
 *
 * So the cache is bounded and self-correcting without a flush, and a flush wired
 * to a guess about which path might leak would trade a self-healing cache for a
 * cliff: every element's bitmap rebuilt from scratch on the next frame. Kept as
 * the escape hatch for the case nothing else covers — a scene torn down wholesale,
 * such as navigating away from a board — and as the subject of the test that pins
 * what it empties.
 */
export function clearStaticSceneCache(): void {
  // WeakMap entries are reclaimed with their element objects. The parallel
  // strong ID map does retain removed elements, so clear that index when a
  // scene is replaced or the editor navigates away.
  elementIdMap.clear();
  // The eviction order holds strong references too, and the byte total has to
  // follow the entries that are actually dropped, so reset both here.
  bitmapOrder.clear();
  cachedBitmapBytes = 0;
}

// ─── Canvas bootstrap ────────────────────────────────────────────────────────

function bootstrapCanvas(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  viewport: StaticSceneViewport,
  config: StaticSceneConfig
): void {
  const { dpr } = config;
  const bufferW = Math.round(viewport.width * dpr);
  const bufferH = Math.round(viewport.height * dpr);

  // Only resize the backing store when dimensions change (prevents flicker).
  if (canvas.width !== bufferW || canvas.height !== bufferH) {
    canvas.width = bufferW;
    canvas.height = bufferH;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
  }

  // Reset ALL transforms before doing anything else.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, bufferW, bufferH);

  // Camera transform stack (applied in reverse order because it's a matrix):
  //   1. Scale by DPR   → crisp pixels on hi-DPI screens
  //   2. Scale by zoom  → world-space zoom
  //   3. Translate by   → pan / scroll
  //
  // Resulting transform: pixel = world * zoom * dpr + pan * dpr
  ctx.scale(dpr, dpr);
  ctx.scale(config.zoom, config.zoom);
  ctx.translate(viewport.x / config.zoom, viewport.y / config.zoom);
}

// ─── Grid ────────────────────────────────────────────────────────────────────

function drawGrid(
  ctx: CanvasRenderingContext2D,
  viewport: StaticSceneViewport,
  config: StaticSceneConfig
): void {
  const { gridSize } = config;
  const zoom = config.zoom;

  // World-space visible area
  const worldLeft = -viewport.x / zoom;
  const worldTop = -viewport.y / zoom;
  const worldRight = worldLeft + viewport.width / zoom;
  const worldBottom = worldTop + viewport.height / zoom;

  ctx.save();
  ctx.strokeStyle = config.theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
  // Keep lines 1 CSS pixel wide regardless of zoom
  ctx.lineWidth = 1 / zoom;

  // Snap start to grid
  const startX = Math.floor(worldLeft / gridSize) * gridSize;
  const startY = Math.floor(worldTop / gridSize) * gridSize;

  ctx.beginPath();
  for (let wx = startX; wx <= worldRight; wx += gridSize) {
    ctx.moveTo(wx, worldTop);
    ctx.lineTo(wx, worldBottom);
  }
  for (let wy = startY; wy <= worldBottom; wy += gridSize) {
    ctx.moveTo(worldLeft, wy);
    ctx.lineTo(worldRight, wy);
  }
  ctx.stroke();
  ctx.restore();
}

// ─── StaticSceneViewport culling ─────────────────────────────────────────────────────────

function isElementVisible(el: DriplElement, viewport: StaticSceneViewport, zoom: number): boolean {
  const padding = 20; // a little slack for stroke width / shadows
  const worldLeft = -viewport.x / zoom - padding;
  const worldTop = -viewport.y / zoom - padding;
  const worldRight = worldLeft + viewport.width / zoom + padding * 2;
  const worldBottom = worldTop + viewport.height / zoom + padding * 2;

  // Use axis-aligned bounding box that accounts for rotation
  const bounds = getElementBounds(el);
  const elLeft = bounds.x;
  const elTop = bounds.y;
  const elRight = bounds.x + bounds.width;
  const elBottom = bounds.y + bounds.height;

  return !(
    elRight < worldLeft ||
    elLeft > worldRight ||
    elBottom < worldTop ||
    elTop > worldBottom
  );
}

// ─── Per-element rendering ────────────────────────────────────────────────────

function drawElement(
  ctx: CanvasRenderingContext2D,
  element: DriplElement,
  _viewport: StaticSceneViewport,
  config: StaticSceneConfig,
  shouldCacheIgnoreZoom: boolean = false,
  newBitmapsRemaining = Number.POSITIVE_INFINITY
): { status: 'drawn'; generated: boolean } | { status: 'deferred' } | { status: 'failed' } {
  // Image elements are drawn directly — no offscreen canvas needed.
  if (element.type === 'image') {
    drawImageElement(ctx, element, config);
    // Images are decoded through `imageCache`, not a per-element canvas, so
    // nothing was allocated here.
    return { status: 'drawn', generated: false };
  }

  // For everything else, get (or generate) the offscreen element canvas.
  const result = getOrCreateElementCanvas(
    element,
    config,
    shouldCacheIgnoreZoom,
    newBitmapsRemaining
  );
  if (result.status !== 'ready') return result;
  const { entry, generated } = result;
  const offscreen = entry.canvas;

  // Opacity — apply before drawing so it composites correctly.
  const opacity = typeof element.opacity === 'number' ? element.opacity : 1;

  // The only canvas state this draw mutates is `globalAlpha`, plus the transform
  // when the element is rotated. So the `save`/`restore` pair is needed *only*
  // when there is a transform to undo.
  //
  // Measured on a 10,000-element scene: `save` + `restore` were exactly two
  // calls per blit — 66.5% of every call a steady frame makes on the visible
  // canvas — while `setTransform`, `scale` and `translate` were called once per
  // frame between them. For an unrotated element the pair guarded nothing but
  // the alpha, which the line below sets anyway and `renderStaticScene` restores
  // once per frame. Rotated elements keep the pair: the transform really does
  // need undoing, and `restore` is how it is undone without composing a matrix by
  // hand (which would not be bit-identical to what the context accumulates).
  const rotated = element.angle;
  if (rotated) ctx.save();
  ctx.globalAlpha = opacity;

  // Apply rotation at draw time. The cached bitmap is generated in local
  // element coordinates, so rotating it here avoids the previous double
  // transform from the static and Rough renderers.
  if (rotated) {
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(rotated);
    ctx.translate(-cx, -cy);
  }

  const PADDING = 10; // must match generateElementCanvas

  // Divide by the resolution the bitmap was actually rasterized at, not by the
  // nominal dpr: a bitmap downscaled to fit a browser canvas limit still has to
  // be stretched back over the element's full logical size.
  ctx.drawImage(
    offscreen,
    element.x - PADDING,
    element.y - PADDING,
    offscreen.width / entry.pixelsPerUnit,
    offscreen.height / entry.pixelsPerUnit
  );

  if (rotated) ctx.restore();
  return { status: 'drawn', generated };
}

/** The element's fill colour, tolerating the legacy `fillColor` field. */
function elementFill(element: DriplElement): string | undefined {
  const background = element.backgroundColor;
  if (typeof background === 'string') return background;
  const legacy = (element as { fillColor?: unknown }).fillColor;
  return typeof legacy === 'string' ? legacy : undefined;
}

/**
 * Draw a provisional placeholder for an element whose bitmap this frame could
 * not afford to build.
 *
 * The direct (uncached) draw is not usable as the fallback: it re-runs the same
 * Rough.js generation, so deferring to it would move the cost rather than remove
 * it. At 10,000 elements the measured cost was ~76 us per generated bitmap
 * against ~1.7 us per blit, so a frame that built 300 bitmaps spent 22.8 ms of a
 * 24 ms frame on generation alone.
 *
 * A placeholder bounds that. It is deliberately crude, because the only scenes
 * dense enough to hit the budget are also scenes where elements are a few pixels
 * across and sketch detail is sub-pixel. The element appears immediately at the
 * right place, size, colour, and rotation, and is replaced by its real bitmap on
 * a following frame.
 */
function drawElementPlaceholder(
  ctx: CanvasRenderingContext2D,
  element: DriplElement,
  config: StaticSceneConfig
): void {
  const width = element.width;
  const height = element.height;
  if (!(width > 0) || !(height > 0)) return;

  // Same reasoning as `drawElement`: the pair guards the alpha and the rotation,
  // and the fill/stroke styles below are written before every use, so neither
  // needs unwinding. Alpha is restored once per frame by `renderStaticScene`.
  const opacity = typeof element.opacity === 'number' ? element.opacity : 1;
  const rotated = element.angle;
  if (rotated) ctx.save();
  ctx.globalAlpha = opacity;

  if (rotated) {
    const cx = element.x + width / 2;
    const cy = element.y + height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(rotated);
    ctx.translate(-cx, -cy);
  }

  if (elementFill(element) && elementFill(element) !== 'transparent') {
    ctx.fillStyle = elementFill(element) as string;
    ctx.fillRect(element.x, element.y, width, height);
  }
  ctx.strokeStyle = element.strokeColor || (config.theme === 'dark' ? '#ffffff' : '#1e1e1e');
  ctx.lineWidth = element.strokeWidth || 1;
  ctx.strokeRect(element.x, element.y, width, height);
  if (rotated) ctx.restore();
}

// ─── Offscreen element canvas (with cache) ────────────────────────────────────

const PADDING = 10;

function getOrCreateElementCanvas(
  element: DriplElement,
  config: StaticSceneConfig,
  shouldCacheIgnoreZoom: boolean = false,
  newBitmapsRemaining = Number.POSITIVE_INFINITY
):
  | { status: 'ready'; entry: CacheEntry; generated: boolean }
  | { status: 'deferred' }
  | { status: 'failed' } {
  const version = getElementVersion(element);
  const cached = elementCanvasCache.get(element);

  // O(1) version-number comparison
  // During zoom animations, callers may reuse the versioned canvas to avoid
  // rebuilding it; theme changes still invalidate the cache.
  if (
    cached &&
    (cached.version === version || shouldCacheIgnoreZoom) &&
    cached.theme === config.theme &&
    // The owner's bitmap embeds its label, so it also goes stale when the label
    // changes. Checking that here keeps invalidation O(1) instead of scanning
    // every cached element on each mutation.
    dependenciesUnchanged(cached.dependencyVersions, element, config.elements)
  ) {
    return { status: 'ready', entry: cached, generated: false };
  }

  // The frame's allocation budget is spent. Tell the caller to draw directly;
  // a later frame will pick this element up.
  if (newBitmapsRemaining <= 0) return { status: 'deferred' };

  // Generate a fresh offscreen canvas for this element.
  const dpr = config.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const generated = generateElementCanvas(element, config);
  if (!generated) return { status: 'failed' };

  const entry: CacheEntry = {
    canvas: generated.canvas,
    version,
    theme: config.theme,
    pixelsPerUnit: dpr * generated.scale,
    dependencyVersions: dependencyVersions(element, config.elements),
  };
  // Accounting must read the previous entry before overwriting it, otherwise a
  // regeneration never subtracts the size it is replacing and the total drifts
  // upward until everything looks evicted.
  const replaced = cached;
  if (replaced) cachedBitmapBytes -= bitmapBytes(replaced.canvas);
  if (cachedBitmapBytes < 0) cachedBitmapBytes = 0;

  // A new object carrying an id the cache already holds *supersedes* the old
  // one, and the old one has to go here rather than wait for a ceiling to
  // notice. `bitmapOrder` holds strong references by necessity (it is the
  // eviction order), so a superseded entry keeps its element alive and its
  // backing store accounted until something drops it — and nothing does, because
  // the paths that replace an element object do not bump `version`:
  // `bringForward` in the store maps the whole scene to `{ ...el }`, and a remote
  // delta that carries an unchanged version does the same. Measured on a
  // 1,200-element viewport: five such rounds left 3,270 entries and 81 MB of a
  // 128 MB budget holding objects the scene could no longer draw.
  //
  // Dropping by id is O(1) and needs no full flush: `invalidateElementCache` is
  // not involved, and if the superseded object is drawn again later — an undo
  // restoring a snapshot, say — it simply regenerates an identical bitmap.
  const superseded = elementIdMap.get(element.id);
  if (superseded !== undefined && superseded !== element) dropCachedBitmap(superseded);

  elementCanvasCache.set(element, entry);
  elementIdMap.set(element.id, element);
  bitmapOrder.add(element);
  cachedBitmapBytes += bitmapBytes(entry.canvas);
  evictBitmapsToFit();
  return { status: 'ready', entry, generated: true };
}

function generateElementCanvas(
  element: DriplElement,
  config: StaticSceneConfig
): { canvas: CanvasLike; scale: number } | null {
  const dpr = config.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

  // Guard against zero-size elements (e.g. a line being drawn), and cap the
  // backing store so a pathologically large element cannot request a surface
  // no browser will allocate.
  const {
    width: w,
    height: h,
    scale,
  } = computeElementCanvasSize(element.width, element.height, dpr, PADDING);

  // Prefer OffscreenCanvas when available (no DOM dependency, transferable to Workers).
  const canvas: CanvasLike =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : (() => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          return c;
        })();

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Scale for hi-DPI, then translate so (0,0) in drawing coords == top-left
  // of the element's bounding box (offset by PADDING). When the backing store
  // was downscaled to fit a browser limit, `scale` carries that factor so the
  // content still covers the element's full logical size.
  ctx.scale(dpr * scale, dpr * scale);
  ctx.translate(PADDING, PADDING);

  const rc = createRoughCanvas(canvas as HTMLCanvasElement);
  if (rc) {
    // renderRoughElement draws relative to element.x / element.y.
    // We translate so those become local offscreen coords.
    ctx.translate(-element.x, -element.y);
    // Pass elements array for arrow label cutout rendering
    renderRoughElement(
      rc,
      ctx as CanvasRenderingContext2D,
      element,
      config.elements ?? [],
      config.theme
    );
  }

  return { canvas, scale };
}

// ─── Image elements ───────────────────────────────────────────────────────────

function drawImageElement(
  ctx: CanvasRenderingContext2D,
  element: DriplElement,
  config: StaticSceneConfig
): void {
  const src: string | undefined = element.type === 'image' ? element.src : undefined;
  if (!src) return;

  const opacity = typeof element.opacity === 'number' ? element.opacity : 1;

  ctx.save();
  ctx.globalAlpha = opacity;

  if (element.angle) {
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(element.angle);
    ctx.translate(-cx, -cy);
  }

  const cached = imageCache.get(src);
  if (cached?.loaded) {
    ctx.drawImage(cached.image, element.x, element.y, element.width, element.height);
  } else if (cached?.error) {
    ctx.fillStyle = config.theme === 'dark' ? 'rgba(255,100,100,0.15)' : 'rgba(255,0,0,0.1)';
    ctx.fillRect(element.x, element.y, element.width, element.height);
  } else {
    if (!cached) {
      void imageCache
        .load(src)
        .then(() => config.onAssetLoad?.())
        .catch(() => config.onAssetLoad?.());
    }
    ctx.fillStyle = config.theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    ctx.fillRect(element.x, element.y, element.width, element.height);
  }

  ctx.restore();
}
