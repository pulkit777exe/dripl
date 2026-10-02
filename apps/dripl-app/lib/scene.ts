import type { DriplElement } from '@dripl/common';
import { shouldAcceptElement } from '@dripl/common/reconciliation';
import { normalizeElement } from '@/utils/canvasUtils';
import { ensureFractionalIndexes, buildElementsById } from '@/lib/store/helpers';
import { repairFractionalIndexes, sortElementsByZIndex } from '@/utils/zIndexUtils';
import type { TombstoneFilter } from '@/lib/collab/tombstones';

/**
 * Scene — single home for frontend scene restore + remote reconciliation.
 *
 * Two entry points, one pipeline:
 * every entry path (localStorage, IndexedDB, file import, collab sync)
 * funnels through the same normalize → index → sort pipeline, and every
 * remote merge funnels through the same version/nonce fence.
 */

/** Normalize unknown input into a sorted, indexed scene. */
export function restoreElements(raw: unknown): DriplElement[] {
  const list = Array.isArray(raw) ? raw : [];
  const normalized = (list as DriplElement[])
    .filter(el => el != null && typeof el === 'object')
    .map(el => {
      try {
        return normalizeElement(el);
      } catch {
        return null;
      }
    })
    .filter((el): el is DriplElement => el !== null);
  const withIndexes = ensureFractionalIndexes(normalized);
  return sortElementsByZIndex(repairFractionalIndexes(withIndexes));
}

/** Serialize a scene for storage/transport (whole-payload JSON). */
export function serializeScene(elements: readonly DriplElement[]): string {
  return JSON.stringify(elements);
}

export interface RestoredAppState {
  theme?: 'light' | 'dark' | 'system';
  zoom?: number;
  panX?: number;
  panY?: number;
  gridEnabled?: boolean;
  gridSize?: number;
  currentStrokeColor?: string;
  currentBackgroundColor?: string;
  currentStrokeWidth?: number;
  currentRoughness?: number;
  currentStrokeStyle?: 'solid' | 'dashed' | 'dotted';
  currentFillStyle?:
    'hachure' | 'solid' | 'zigzag' | 'cross-hatch' | 'dots' | 'dashed' | 'zigzag-line';
  canvasBackground?: string | null;
  activeTool?:
    | 'select'
    | 'hand'
    | 'rectangle'
    | 'ellipse'
    | 'diamond'
    | 'arrow'
    | 'line'
    | 'freedraw'
    | 'text'
    | 'image'
    | 'frame'
    | 'embed'
    | 'eraser'
    | 'laser';
}

const VALID_THEMES = new Set(['light', 'dark', 'system']);
const VALID_STROKE_STYLES = new Set(['solid', 'dashed', 'dotted']);
const VALID_FILL_STYLES = new Set([
  'hachure',
  'solid',
  'zigzag',
  'cross-hatch',
  'dots',
  'dashed',
  'zigzag-line',
]);
const VALID_TOOLS = new Set([
  'select',
  'hand',
  'rectangle',
  'ellipse',
  'diamond',
  'arrow',
  'line',
  'freedraw',
  'text',
  'image',
  'frame',
  'embed',
  'eraser',
  'laser',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate unknown persisted UI state into an allowlisted partial.
 * Unknown keys are dropped, invalid
 * values fall back to defaults (by omission — the store keeps its own).
 */
export function restoreAppState(raw: unknown): RestoredAppState {
  if (!isRecord(raw)) return {};
  const out: RestoredAppState = {};
  if (typeof raw.theme === 'string' && VALID_THEMES.has(raw.theme)) {
    out.theme = raw.theme as RestoredAppState['theme'];
  }
  if (typeof raw.zoom === 'number' && Number.isFinite(raw.zoom)) out.zoom = raw.zoom;
  if (typeof raw.gridEnabled === 'boolean') out.gridEnabled = raw.gridEnabled;
  if (typeof raw.gridSize === 'number' && Number.isFinite(raw.gridSize)) {
    out.gridSize = raw.gridSize;
  }
  if (typeof raw.panX === 'number' && typeof raw.panY === 'number') {
    if (Number.isFinite(raw.panX) && Number.isFinite(raw.panY)) {
      out.panX = raw.panX;
      out.panY = raw.panY;
    }
  }
  if (typeof raw.currentStrokeColor === 'string') out.currentStrokeColor = raw.currentStrokeColor;
  if (typeof raw.currentBackgroundColor === 'string')
    out.currentBackgroundColor = raw.currentBackgroundColor;
  if (typeof raw.currentStrokeWidth === 'number' && Number.isFinite(raw.currentStrokeWidth)) {
    out.currentStrokeWidth = raw.currentStrokeWidth;
  }
  if (typeof raw.currentRoughness === 'number' && Number.isFinite(raw.currentRoughness)) {
    out.currentRoughness = raw.currentRoughness;
  }
  if (
    typeof raw.currentStrokeStyle === 'string' &&
    VALID_STROKE_STYLES.has(raw.currentStrokeStyle)
  ) {
    out.currentStrokeStyle = raw.currentStrokeStyle as RestoredAppState['currentStrokeStyle'];
  }
  if (typeof raw.currentFillStyle === 'string' && VALID_FILL_STYLES.has(raw.currentFillStyle)) {
    out.currentFillStyle = raw.currentFillStyle as RestoredAppState['currentFillStyle'];
  }
  if (typeof raw.activeTool === 'string' && VALID_TOOLS.has(raw.activeTool)) {
    out.activeTool = raw.activeTool as RestoredAppState['activeTool'];
  }
  if (raw.canvasBackground === null) {
    out.canvasBackground = null;
  } else if (typeof raw.canvasBackground === 'string' && isHexColor(raw.canvasBackground)) {
    out.canvasBackground = raw.canvasBackground;
  }
  return out;
}

/** Store setters a restored app-state can flow into; all optional. */
export interface AppStateActions {
  setTheme?: (theme: 'light' | 'dark' | 'system') => void;
  setZoom?: (zoom: number) => void;
  setPan?: (panX: number, panY: number) => void;
  setGridEnabled?: (enabled: boolean) => void;
  setGridSize?: (size: number) => void;
  setCurrentStrokeColor?: (color: string) => void;
  setCurrentBackgroundColor?: (color: string) => void;
  setCurrentStrokeWidth?: (width: number) => void;
  setCurrentRoughness?: (roughness: number) => void;
  setCurrentStrokeStyle?: (style: 'solid' | 'dashed' | 'dotted') => void;
  setCurrentFillStyle?: (style: NonNullable<RestoredAppState['currentFillStyle']>) => void;
  setActiveTool?: (tool: NonNullable<RestoredAppState['activeTool']>) => void;
  setCanvasBackground?: (background: string | null) => void;
}

/**
 * Apply validated app-state onto the store. Single home for the
 * bootstrap/file-import paths so validation and application never drift.
 */
export function applyRestoredAppState(restored: RestoredAppState, actions: AppStateActions): void {
  if (restored.theme) actions.setTheme?.(restored.theme);
  if (typeof restored.zoom === 'number') actions.setZoom?.(restored.zoom);
  if (typeof restored.panX === 'number' && typeof restored.panY === 'number') {
    actions.setPan?.(restored.panX, restored.panY);
  }
  if (typeof restored.gridEnabled === 'boolean') actions.setGridEnabled?.(restored.gridEnabled);
  if (typeof restored.gridSize === 'number') actions.setGridSize?.(restored.gridSize);
  if (restored.currentStrokeColor) actions.setCurrentStrokeColor?.(restored.currentStrokeColor);
  if (restored.currentBackgroundColor) {
    actions.setCurrentBackgroundColor?.(restored.currentBackgroundColor);
  }
  if (typeof restored.currentStrokeWidth === 'number') {
    actions.setCurrentStrokeWidth?.(restored.currentStrokeWidth);
  }
  if (typeof restored.currentRoughness === 'number') {
    actions.setCurrentRoughness?.(restored.currentRoughness);
  }
  if (restored.currentStrokeStyle) actions.setCurrentStrokeStyle?.(restored.currentStrokeStyle);
  if (restored.currentFillStyle) actions.setCurrentFillStyle?.(restored.currentFillStyle);
  if (restored.activeTool) actions.setActiveTool?.(restored.activeTool);
  if (restored.canvasBackground !== undefined) {
    actions.setCanvasBackground?.(restored.canvasBackground);
  }
}

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;

/** Allowlist canvas background overrides to hex colors (or explicit null). */
export function isHexColor(value: string): boolean {
  return value.length <= 9 && HEX_COLOR.test(value);
}

export interface ReconcileInput {
  localById: ReadonlyMap<string, DriplElement>;
  added: readonly DriplElement[];
  updated: readonly DriplElement[];
  deleted: readonly string[];
  draftId?: string | null;
  isLocked?: (id: string) => boolean;
  /**
   * Local delete markers (frontend tombstones). Records for a tombstoned id
   * are ignored so a stale add/update cannot resurrect a deleted element.
   */
  tombstones?: TombstoneFilter | null;
}

export interface ReconcileOutput {
  nextById: Map<string, DriplElement>;
  changed: boolean;
  /** Remote deletes that were applied — the caller should tombstone them. */
  appliedDeleted: string[];
}

/**
 * Merge remote add/update/delete batches into local state.
 *
 * Rules:
 * - elements locked by an active local gesture (or the in-progress draft)
 *   are never replaced by remote records;
 * - records for tombstoned (deleted) ids are ignored — deletes win;
 * - otherwise the lower-version / lower-nonce record loses via
 *   `shouldAcceptElement`;
 * - deletes apply unless the id is locally locked.
 */
export function reconcileScene(input: ReconcileInput): ReconcileOutput {
  const nextById = new Map(input.localById);
  const isProtected = (id: string) => id === input.draftId || input.isLocked?.(id) === true;
  const isEntombed = (id: string) => input.tombstones?.has(id) === true;
  let changed = false;
  const appliedDeleted: string[] = [];

  for (const el of input.added) {
    if (isProtected(el.id) || isEntombed(el.id)) continue;
    const current = nextById.get(el.id);
    if (!current || shouldAcceptElement(el, current)) {
      nextById.set(el.id, el);
      changed = true;
    }
  }
  for (const el of input.updated) {
    if (isProtected(el.id) || isEntombed(el.id)) continue;
    const current = nextById.get(el.id);
    if (!current || shouldAcceptElement(el, current)) {
      nextById.set(el.id, el);
      changed = true;
    }
  }
  if (input.deleted.length > 0) {
    for (const id of input.deleted) {
      if (isProtected(id)) continue;
      if (nextById.delete(id)) changed = true;
      // Record even already-absent ids: the delete itself is the signal that
      // a racing add for this id is stale.
      appliedDeleted.push(id);
    }
  }
  return { nextById, changed, appliedDeleted };
}

/** Build the id map for a restored scene (convenience for store setters). */
export function restoredSceneMap(elements: readonly DriplElement[]): Map<string, DriplElement> {
  return buildElementsById(elements);
}
