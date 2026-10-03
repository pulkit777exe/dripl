import type { DriplElement } from '@dripl/common';
import { getElementBounds } from '@dripl/math/intersection';
import { clearTextMeasurementCache, renderElement } from './elements';
import {
  drawBindingIndicator,
  drawCollaborators,
  drawEraserPath,
  drawGridDots,
  drawLockOverlays,
  drawMarquee,
  drawSelectionBox,
} from './overlays';
import type { RenderSceneOptions } from './sceneTypes';

export type {
  CollaboratorCursor,
  MarqueeSelection,
  RenderSceneOptions,
  SceneViewport,
} from './sceneTypes';
export { clearTextMeasurementCache };

const DEFAULT_GRID_SIZE = 20;
const HIT_CULL_PADDING = 20;

/**
 * Ids the overlay pass can ask for, and nothing else.
 *
 * The selection box, the remote-lock overlays and the two binding indicators
 * resolve a bounded number of elements per frame. The composer used to answer
 * those lookups by indexing the *whole* scene with `new Map(elements.map(...))`,
 * which is O(scene) per frame to serve a handful of reads. Measured on a
 * 10,000-element scene it cost ~0.7 ms per frame — ~84% of this composer's own
 * cost — and it did not appear in docs/performance-benchmark.md because none of
 * the recorded browser phases had a selection, so the interactive layer read as
 * flat.
 *
 * Collecting the wanted ids up front keeps the index proportional to what is
 * drawn over rather than to what exists. An overlay that starts looking up
 * elements has to add its ids here; the unit test pins that contract.
 */
function collectOverlayLookupIds(options: {
  selectedIds: ReadonlySet<string>;
  lockOwners: ReadonlyMap<string, string>;
  hoveredBindingId: string | null;
  startPointBindingId: string | null;
}): ReadonlySet<string> {
  const wanted = new Set<string>();
  for (const id of options.selectedIds) wanted.add(id);
  for (const id of options.lockOwners.keys()) wanted.add(id);
  if (options.hoveredBindingId) wanted.add(options.hoveredBindingId);
  if (options.startPointBindingId) wanted.add(options.startPointBindingId);
  return wanted;
}

/**
 * Index only `wanted`, in scene order.
 *
 * Scene order is preserved for one reason: if the scene somehow carried two
 * elements under the same id, the last one wins, exactly as a full `Map` built
 * from the same array would.
 */
function indexWantedElements(
  elements: readonly DriplElement[],
  wanted: ReadonlySet<string>
): ReadonlyMap<string, DriplElement> {
  const index = new Map<string, DriplElement>();
  if (wanted.size === 0) return index;
  for (const element of elements) {
    if (wanted.has(element.id)) index.set(element.id, element);
  }
  return index;
}

/**
 * Scene composer — the public render entry (`renderInteractiveScene`).
 *
 * Element drawing lives in `elements.ts`, overlays in `overlays.ts`, shared
 * types in `sceneTypes.ts`. This module owns only transform setup, viewport
 * culling, and draw order: clear → world pass (grid, elements, draft,
 * bindings, eraser, locks) → screen pass (marquee, selection, cursors).
 */

function isElementVisible(
  element: DriplElement,
  viewport: RenderSceneOptions['viewport'],
  canvasWidth: number,
  canvasHeight: number
): boolean {
  const worldLeft = -viewport.x / viewport.zoom - HIT_CULL_PADDING;
  const worldTop = -viewport.y / viewport.zoom - HIT_CULL_PADDING;
  const worldRight = worldLeft + canvasWidth / viewport.zoom + HIT_CULL_PADDING * 2;
  const worldBottom = worldTop + canvasHeight / viewport.zoom + HIT_CULL_PADDING * 2;

  const bounds = getElementBounds(element);
  const elementRight = bounds.x + bounds.width;
  const elementBottom = bounds.y + bounds.height;

  return !(
    elementRight < worldLeft ||
    bounds.x > worldRight ||
    elementBottom < worldTop ||
    bounds.y > worldBottom
  );
}

export function renderInteractiveScene({
  ctx,
  viewport,
  canvasWidth,
  canvasHeight,
  elements,
  draftElement,
  selectedIds = new Set<string>(),
  eraserPath = [],
  marqueeSelection,
  collaborators = [],
  gridEnabled = false,
  gridSize = DEFAULT_GRID_SIZE,
  theme = 'dark',
  lockOwners = new Map<string, string>(),
  localUserId = null,
  renderCommittedElements = true,
  dpr = 1,
  clearCanvas = true,
  hoveredBindingId,
  startPointBindingId,
}: RenderSceneOptions): void {
  if (clearCanvas) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasWidth * dpr, canvasHeight * dpr);
    ctx.restore();
  }

  // Lazy, and proportional to what the overlays actually ask for. Building the
  // index eagerly would cost a scene scan on frames that draw no overlays at
  // all, which is the common case: no selection, no locks, no binding hover.
  let elementsById: ReadonlyMap<string, DriplElement> | undefined;
  const getElementsById = (): ReadonlyMap<string, DriplElement> => {
    if (!elementsById) {
      elementsById = indexWantedElements(
        elements,
        collectOverlayLookupIds({
          selectedIds,
          lockOwners,
          // These are optional in the scene state but required by the lookup,
          // so coalesce `undefined` rather than widening the parameter to a
          // three-valued type that every caller would then have to handle.
          hoveredBindingId: hoveredBindingId ?? null,
          startPointBindingId: startPointBindingId ?? null,
        })
      );
    }
    return elementsById;
  };

  ctx.save();
  ctx.setTransform(
    viewport.zoom * dpr,
    0,
    0,
    viewport.zoom * dpr,
    viewport.x * dpr,
    viewport.y * dpr
  );

  if (gridEnabled) {
    drawGridDots(ctx, viewport, canvasWidth, canvasHeight, theme, gridSize);
  }

  if (renderCommittedElements) {
    for (const element of elements) {
      if (!isElementVisible(element, viewport, canvasWidth, canvasHeight)) {
        continue;
      }
      renderElement(ctx, element, viewport.zoom);
    }
  }

  if (draftElement && !draftElement.isDeleted) {
    renderElement(ctx, draftElement, viewport.zoom);
  }

  // Draw binding indicators for both endpoint and start point
  if (hoveredBindingId) {
    drawBindingIndicator(ctx, getElementsById(), hoveredBindingId, viewport, 'end');
  }
  if (startPointBindingId) {
    drawBindingIndicator(ctx, getElementsById(), startPointBindingId, viewport, 'start');
  }

  drawEraserPath(ctx, eraserPath, viewport.zoom);

  if (lockOwners.size > 0) {
    drawLockOverlays(ctx, getElementsById(), lockOwners, localUserId);
  }

  ctx.restore();
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (marqueeSelection?.active) {
    drawMarquee(ctx, marqueeSelection, viewport);
  }

  if (selectedIds.size > 0) {
    drawSelectionBox(ctx, selectedIds, viewport, getElementsById());
  }

  if (collaborators.length > 0) {
    drawCollaborators(ctx, collaborators, viewport);
  }
  ctx.restore();
}
