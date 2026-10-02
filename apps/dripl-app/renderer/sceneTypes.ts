import type { DriplElement, Point } from '@dripl/common';

/**
 * Scene composer types — shared by the render engine (`elements.ts`,
 * `overlays.ts`) and its callers (`InteractiveCanvas`, `DualCanvas`).
 * Kept in one place so the renderer split does not scatter the wire
 * surface; `interactiveScene.ts` re-exports everything.
 */

export interface SceneViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

export interface MarqueeSelection {
  start: Point;
  end: Point;
  active: boolean;
}

export interface CollaboratorCursor {
  userId: string;
  displayName: string;
  color: string;
  x: number;
  y: number;
  updatedAt: number;
}

export interface RenderSceneOptions {
  ctx: CanvasRenderingContext2D;
  viewport: SceneViewport;
  canvasWidth: number;
  canvasHeight: number;
  elements: readonly DriplElement[];
  draftElement?: DriplElement | null;
  eraserPath?: readonly Point[];
  selectedIds?: ReadonlySet<string>;
  marqueeSelection?: MarqueeSelection | null;
  collaborators?: readonly CollaboratorCursor[];
  gridEnabled?: boolean;
  gridSize?: number;
  theme?: 'light' | 'dark';
  lockOwners?: ReadonlyMap<string, string>;
  localUserId?: string | null;
  renderCommittedElements?: boolean;
  dpr?: number;
  clearCanvas?: boolean;
  hoveredBindingId?: string | null;
  startPointBindingId?: string | null;
}
