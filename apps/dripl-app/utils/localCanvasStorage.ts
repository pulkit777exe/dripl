import type { DriplElement } from '@dripl/common';

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
  currentFillStyle:
    | 'hachure'
    | 'solid'
    | 'zigzag'
    | 'cross-hatch'
    | 'dots'
    | 'dashed'
    | 'zigzag-line';
  activeTool: string;
}

/** Element state (canvas elements and optional selection for restore). */
export interface ElementStates {
  elements: DriplElement[];
  selectedIds?: string[];
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
    const elementStates: ElementStates = {
      elements,
      selectedIds: selectedIds ? [...selectedIds] : undefined,
    };
    const payload: LocalStoragePayload = {
      userPreferences,
      elementStates,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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
} => {
  try {
    const structured = localStorage.getItem(STORAGE_KEY);
    if (!structured) return { elements: null, appState: null };
    const payload = JSON.parse(structured) as LocalStoragePayload;
    if (!payload?.userPreferences || !payload?.elementStates) {
      localStorage.removeItem(STORAGE_KEY);
      console.warn('Invalid local canvas payload. Clearing stored canvas.');
      return { elements: null, appState: null };
    }
    return {
      elements: payload.elementStates.elements ?? null,
      appState: payload.userPreferences as LocalCanvasState,
      selectedIds: payload.elementStates.selectedIds,
    };
  } catch (error) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      return { elements: null, appState: null, storageUnavailable: true };
    }
    console.warn('Corrupt local canvas data found. Resetting local canvas.', error);
    return { elements: null, appState: null };
  }
};

export const clearLocalCanvasStorage = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
};
