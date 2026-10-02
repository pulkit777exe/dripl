import type { DriplElement, Point } from '@dripl/common';
import { getElementBounds } from '@dripl/math/intersection';
import type { CollaboratorCursor, MarqueeSelection, SceneViewport } from './sceneTypes';

/**
 * Scene overlays — extracted verbatim from `interactiveScene.ts`.
 *
 * Everything drawn on top of (or under) the element pass: grid dots,
 * multi-selection box, marquee, collaborator cursors, remote-lock
 * overlays, binding indicators, and the eraser trail. The composer in
 * `interactiveScene.ts` owns transform setup and draw order.
 */

const MARQUEE_DASH = [6, 4];
const MIN_GRID_ZOOM = 0.3;

export function worldToScreen(point: Point, viewport: SceneViewport): Point {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  };
}

export function drawGridDots(
  ctx: CanvasRenderingContext2D,
  viewport: SceneViewport,
  canvasWidth: number,
  canvasHeight: number,
  theme: 'light' | 'dark',
  gridSize: number
) {
  if (viewport.zoom < MIN_GRID_ZOOM) return;

  const worldLeft = -viewport.x / viewport.zoom;
  const worldTop = -viewport.y / viewport.zoom;
  const worldRight = worldLeft + canvasWidth / viewport.zoom;
  const worldBottom = worldTop + canvasHeight / viewport.zoom;
  const startX = Math.floor(worldLeft / gridSize) * gridSize;
  const startY = Math.floor(worldTop / gridSize) * gridSize;
  const radius = Math.max(0.8 / viewport.zoom, 0.35);

  ctx.save();
  ctx.fillStyle = theme === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.16)';

  for (let x = startX; x <= worldRight; x += gridSize) {
    for (let y = startY; y <= worldBottom; y += gridSize) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export function drawSelectionBox(
  ctx: CanvasRenderingContext2D,
  selectedIds: ReadonlySet<string>,
  viewport: SceneViewport,
  elementsById: ReadonlyMap<string, DriplElement>
) {
  if (selectedIds.size === 0) return;

  const selected = Array.from(selectedIds, id => elementsById.get(id)).filter(
    (element): element is DriplElement => Boolean(element)
  );
  if (selected.length === 0) return;

  // Only draw axis-aligned selection box if multiple elements are selected.
  // Single elements use the highly-optimized rotated HTML SelectionOverlay.
  if (selected.length <= 1) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  selected.forEach(element => {
    const bounds = getElementBounds(element);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  });

  const topLeft = worldToScreen({ x: minX, y: minY }, viewport);
  const bottomRight = worldToScreen({ x: maxX, y: maxY }, viewport);
  const width = bottomRight.x - topLeft.x;
  const height = bottomRight.y - topLeft.y;

  ctx.save();
  ctx.strokeStyle = '#6965db';
  ctx.lineWidth = 1.5;
  ctx.setLineDash(MARQUEE_DASH);
  ctx.strokeRect(topLeft.x, topLeft.y, width, height);
  ctx.restore();
}

export function drawMarquee(
  ctx: CanvasRenderingContext2D,
  marqueeSelection: MarqueeSelection,
  viewport: SceneViewport
) {
  if (!marqueeSelection.active) return;
  const start = worldToScreen(marqueeSelection.start, viewport);
  const end = worldToScreen(marqueeSelection.end, viewport);
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  ctx.save();
  ctx.fillStyle = 'rgba(105,101,219,0.12)';
  ctx.strokeStyle = '#6965db';
  ctx.lineWidth = 1.2;
  ctx.setLineDash(MARQUEE_DASH);
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
}

export function drawCollaborators(
  ctx: CanvasRenderingContext2D,
  collaborators: readonly CollaboratorCursor[],
  viewport: SceneViewport
) {
  const now = Date.now();
  collaborators.forEach(collaborator => {
    const screen = worldToScreen({ x: collaborator.x, y: collaborator.y }, viewport);
    const age = now - collaborator.updatedAt;
    const alpha = age <= 5000 ? 1 : Math.max(0, 1 - (age - 5000) / 5000);
    if (alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(screen.x, screen.y);
    ctx.fillStyle = collaborator.color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 16);
    ctx.lineTo(5, 12);
    ctx.lineTo(10, 20);
    ctx.lineTo(12, 19);
    ctx.lineTo(7, 11);
    ctx.lineTo(14, 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    const labelX = screen.x + 12;
    const labelY = screen.y + 12;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '12px sans-serif';
    const text = collaborator.displayName;
    const textWidth = ctx.measureText(text).width;
    const chipWidth = textWidth + 22;
    const chipHeight = 20;
    ctx.fillStyle = 'rgba(15,15,15,0.86)';
    ctx.beginPath();
    ctx.roundRect(labelX, labelY, chipWidth, chipHeight, 10);
    ctx.fill();
    ctx.fillStyle = collaborator.color;
    ctx.beginPath();
    ctx.arc(labelX + 9, labelY + chipHeight / 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, labelX + 15, labelY + chipHeight / 2);
    ctx.restore();
  });
}

export function drawLockOverlays(
  ctx: CanvasRenderingContext2D,
  elementsById: ReadonlyMap<string, DriplElement>,
  lockOwners: ReadonlyMap<string, string>,
  localUserId: string | null
) {
  lockOwners.forEach((owner, elementId) => {
    if (owner === localUserId) return;
    const element = elementsById.get(elementId);
    if (!element) return;

    const bounds = getElementBounds(element);
    ctx.save();
    ctx.fillStyle = 'rgba(60, 60, 60, 0.13)';
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.fillStyle = 'rgba(40, 40, 40, 0.65)';
    const iconX = bounds.x + bounds.width - 16;
    const iconY = bounds.y + 4;
    ctx.beginPath();
    ctx.roundRect(iconX, iconY + 5, 10, 8, 2);
    ctx.fill();
    ctx.beginPath();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(40, 40, 40, 0.65)';
    ctx.arc(iconX + 5, iconY + 5, 3, Math.PI, 0);
    ctx.stroke();
    ctx.restore();
  });
}

export function drawBindingIndicator(
  ctx: CanvasRenderingContext2D,
  elementsById: ReadonlyMap<string, DriplElement>,
  hoveredBindingId: string,
  viewport: SceneViewport,
  bindingPoint: 'start' | 'end' = 'end'
) {
  const target = elementsById.get(hoveredBindingId);
  if (!target || target.isDeleted) return;

  const bounds = getElementBounds(target);
  const padding = 8 / viewport.zoom;
  const lineWidth = 2 / viewport.zoom;

  ctx.save();

  // Different colors for start vs end binding
  ctx.strokeStyle = bindingPoint === 'start' ? '#3B82F6' : '#E8462A';
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([6 / viewport.zoom, 4 / viewport.zoom]);
  ctx.globalAlpha = 0.8;

  // Draw dashed rectangle around the bound shape
  ctx.beginPath();
  ctx.roundRect(
    bounds.x - padding,
    bounds.y - padding,
    bounds.width + padding * 2,
    bounds.height + padding * 2,
    4 / viewport.zoom
  );
  ctx.stroke();

  // Draw a small circle at the center to indicate binding mode
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const radius = 6 / viewport.zoom;

  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.globalAlpha = 0.6;
  ctx.fill();

  ctx.restore();
}

export function drawEraserPath(
  ctx: CanvasRenderingContext2D,
  eraserPath: readonly Point[],
  zoom: number
) {
  if (eraserPath.length <= 1) return;
  const first = eraserPath[0];
  if (!first) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 76, 76, 0.35)';
  ctx.lineWidth = 20 / Math.max(zoom, 0.1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < eraserPath.length; i += 1) {
    const point = eraserPath[i];
    if (!point) continue;
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.restore();
}
