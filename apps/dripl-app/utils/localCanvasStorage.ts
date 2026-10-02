import { logWarn, type DriplElement } from '@dripl/common';
import { repairBindings } from '@dripl/common/arrow-binding';

const STORAGE_KEY = 'dripl:local-canvas';

export const LOCAL_CANVAS_STORAGE_KEYS = {
  STRUCTURED: STORAGE_KEY,
} as const;

/** User preferences (theme, tool, stroke options, viewport). */
export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  zoom: number;
  panX: number;
  panY: number;
  currentStrokeColor: string;
  currentBackgroundColor: string;
  currentStrokeWidth: number;
  currentRoughness: number;
  currentStrokeStyle: 'solid' | 'dashed' | 'dotted';
  /** Scene background override; absent/null follows the theme default. */
  canvasBackground?: string | null;
  currentFillStyle:
    'hachure' | 'solid' | 'zigzag' | 'cross-hatch' | 'dots' | 'dashed' | 'zigzag-line';
  activeTool: string;
}

/** Element state (canvas elements and optional selection for restore). */
export interface ElementStates {
  elements: DriplElement[];
  selectedIds?: string[];
  /**
   * True when `elements` holds only part of the scene because the payload did
   * not fit in localStorage. Callers must not treat a truncated payload as a
   * complete save.
   */
  truncated?: boolean;
  /** How many elements the scene actually had, when `truncated` is true. */
  totalElements?: number;
}

export type LocalCanvasState = UserPreferences;

// Interface to match Dripl legacy state format for compatibility
export interface DriplLegacyState {
  showWelcomeScreen: boolean;
  theme: 'dark' | 'light';
  currentChartType: string;
  currentItemBackgroundColor: string;
  currentItemEndArrowhead: string;
  currentItemFillStyle: string;
  currentItemFontFamily: number;
  currentItemFontSize: number;
  currentItemOpacity: number;
  currentItemRoughness: number;
  currentItemStartArrowhead: string | null;
  currentItemStrokeColor: string;
  currentItemRoundness: string;
  currentItemArrowType: string;
  currentItemStrokeStyle: string;
  currentItemStrokeWidth: number;
  currentItemTextAlign: string;
  cursorButton: string;
  editingGroupId: string | null;
  activeTool: string;
  preferredSelectionTool: string;
  penMode: boolean;
  penDetected: boolean;
  exportBackground: boolean;
  exportScale: number;
  exportEmbedScene: boolean;
  exportWithDarkMode: boolean;
  gridSize: number;
  gridStep: number;
  gridModeEnabled: boolean;
  defaultSidebarDockedPreference: boolean;
  lastPointerDownWith: string;
  name: string;
  openMenu: string | null;
  openSidebar: string | null;
  previousSelectedElementIds: Record<string, boolean>;
  scrolledOutside: boolean;
  scrollX: number;
  scrollY: number;
  selectedElementIds: Record<string, boolean>;
  selectedGroupIds: Record<string, boolean>;
  shouldCacheIgnoreZoom: boolean;
  stats: {
    open: boolean;
    panels: number;
  };
  viewBackgroundColor: string;
  zenModeEnabled: boolean;
  zoom: {
    value: number;
  };
  selectedLinearElement: string | null;
  objectsSnapModeEnabled: boolean;
  lockedMultiSelections: string[];
  bindMode: string;
}

export interface LocalStoragePayload {
  userPreferences: UserPreferences;
  elementStates: ElementStates;
}

/**
 * Size budget for the localStorage copy, in serialized characters.
 *
 * localStorage is the fallback used when IndexedDB is unavailable, and its real
 * limit is a byte quota (commonly ~5 MB), not an element count. Budgeting by
 * size lets scenes well beyond the old 5,000-element cap survive in this path.
 * Character count is a close proxy for UTF-8 bytes, not an exact one.
 */
const LOCAL_STORAGE_BYTE_BUDGET = 4 * 1024 * 1024;

/**
 * Average serialized size of one element, estimated from a sample.
 *
 * Sampling keeps the autosave path O(sample) instead of O(scene); the caller
 * verifies the real payload length afterwards, so an optimistic estimate is
 * detected rather than silently truncating.
 */
function estimateBytesPerElement(elements: DriplElement[]): number {
  const SAMPLE_SIZE = 64;
  const step = Math.max(1, Math.floor(elements.length / SAMPLE_SIZE));
  const sample: DriplElement[] = [];
  for (let index = 0; index < elements.length && sample.length < SAMPLE_SIZE; index += step) {
    sample.push(elements[index] as DriplElement);
  }
  if (sample.length === 0) return 1;
  // +2 for the separating comma between elements.
  return Math.max(1, JSON.stringify(sample).length / sample.length + 2);
}

export const saveLocalCanvasToStorage = (
  elements: DriplElement[],
  state: LocalCanvasState,
  selectedIds?: Set<string> | string[]
) => {
  try {
    const userPreferences: UserPreferences = {
      theme: state.theme,
      zoom: state.zoom,
      panX: state.panX,
      panY: state.panY,
      currentStrokeColor: state.currentStrokeColor,
      currentBackgroundColor: state.currentBackgroundColor,
      currentStrokeWidth: state.currentStrokeWidth,
      currentRoughness: state.currentRoughness,
      currentStrokeStyle: state.currentStrokeStyle,
      currentFillStyle: state.currentFillStyle,
      activeTool: state.activeTool,
    };

    // Fit as many elements into the byte budget as we can, then record that the
    // stored copy is partial instead of letting a truncated scene pass as a
    // complete one.
    //
    // The per-element cost is estimated from a small sample rather than by
    // serializing the whole scene: this runs on the autosave path, and
    // serializing a 10k-element scene twice per save is exactly the kind of
    // main-thread work this budget is supposed to avoid.
    let kept = elements;
    if (elements.length > 1) {
      const perElement = estimateBytesPerElement(elements);
      const affordable = Math.floor(LOCAL_STORAGE_BYTE_BUDGET / perElement);
      if (affordable < elements.length) {
        kept = elements.slice(0, Math.max(1, affordable));
      }
    }

    const truncated = kept.length < elements.length;
    const elementStates: ElementStates = {
      elements: kept,
      selectedIds: selectedIds ? [...selectedIds].slice(0, 5_000) : undefined,
      ...(truncated ? { truncated: true, totalElements: elements.length } : {}),
    };
    const payload: LocalStoragePayload = {
      userPreferences,
      elementStates,
    };
    const serialized = JSON.stringify(payload);
    localStorage.setItem(STORAGE_KEY, serialized);
    // The sample-based estimate can be optimistic. If the real payload still
    // overran the budget, say so rather than reporting a partial save as
    // complete.
    const overBudget = serialized.length > LOCAL_STORAGE_BYTE_BUDGET;
    if (truncated || overBudget) {
      return {
        ok: false as const,
        error: new Error('scene_too_large_for_local_storage'),
      };
    }
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error };
  }
};

export const loadLocalCanvasFromStorage = (): {
  elements: DriplElement[] | null;
  appState: LocalCanvasState | null;
  selectedIds?: string[];
  storageUnavailable?: boolean;
  elementsTruncated?: boolean;
  totalElements?: number;
} => {
  try {
    const structured = localStorage.getItem(STORAGE_KEY);
    if (!structured) return { elements: null, appState: null };
    const payload = JSON.parse(structured) as LocalStoragePayload;
    if (!payload?.userPreferences || !payload?.elementStates) {
      localStorage.removeItem(STORAGE_KEY);
      logWarn('Invalid local canvas payload. Clearing stored canvas.');
      return { elements: null, appState: null };
    }
    const rawElements = payload.elementStates.elements ?? null;
    // No element-count truncation on load: the stored copy is already whatever
    // fit in the budget, and `truncated` records whether that was everything.
    const elements = Array.isArray(rawElements) ? repairBindings(rawElements) : null;
    return {
      elements,
      appState: payload.userPreferences as LocalCanvasState,
      selectedIds: payload.elementStates.selectedIds,
      ...(payload.elementStates.truncated
        ? {
            elementsTruncated: true,
            totalElements: payload.elementStates.totalElements,
          }
        : {}),
    };
  } catch (error) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      return { elements: null, appState: null, storageUnavailable: true };
    }
    logWarn('Corrupt local canvas data found. Resetting local canvas.', error);
    return { elements: null, appState: null };
  }
};

export const clearLocalCanvasStorage = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable (private browsing, etc.)
  }
};
