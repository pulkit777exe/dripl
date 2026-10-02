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

  let elementsById: ReadonlyMap<string, DriplElement> | undefined;
  const getElementsById = (): ReadonlyMap<string, DriplElement> => {
    if (!elementsById) {
      elementsById = new Map(elements.map(element => [element.id, element]));
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
