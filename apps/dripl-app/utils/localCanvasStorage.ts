import type { DriplElement } from "@dripl/common";

// Primary key for structured storage: { userPreferences, elementStates }
const STORAGE_KEY_STRUCTURED = "dripl-local";

// Legacy keys (Excalidraw pattern) for backward compatibility
const STORAGE_KEYS = {
  CANVAS: "excalidraw",
  COLLAB: "excalidraw-collab",
  STATE: "excalidraw-state",
  THEME: "excalidraw-theme",
  VERSION_DATA: "version-dataState",
  VERSION_FILES: "version-files",
  STRUCTURED: STORAGE_KEY_STRUCTURED,
};

// Exported for consumers that need to listen to storage changes
export const LOCAL_CANVAS_STORAGE_KEYS = STORAGE_KEYS;

/** User preferences (theme, tool, stroke options, viewport). */
export interface UserPreferences {
  theme: "light" | "dark" | "system";
  zoom: number;
  panX: number;
  panY: number;
  currentStrokeColor: string;
  currentBackgroundColor: string;
  currentStrokeWidth: number;
  currentRoughness: number;
  currentStrokeStyle: "solid" | "dashed" | "dotted";
  currentFillStyle:
    | "hachure"
    | "solid"
    | "zigzag"
    | "cross-hatch"
    | "dots"
    | "dashed"
    | "zigzag-line";
  activeTool: string;
}

/** Element state (canvas elements and optional selection for restore). */
export interface ElementStates {
  elements: DriplElement[];
  selectedIds?: string[];
}

export interface LocalCanvasState extends UserPreferences {}

// Interface to match Excalidraw's state format for compatibility
export interface ExcalidrawState {
  showWelcomeScreen: boolean;
  theme: "dark" | "light";
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
  activeTool: any;
  preferredSelectionTool: any;
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
  previousSelectedElementIds: any;
  scrolledOutside: boolean;
  scrollX: number;
  scrollY: number;
  selectedElementIds: any;
  selectedGroupIds: any;
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
  selectedLinearElement: any;
  objectsSnapModeEnabled: boolean;
  lockedMultiSelections: any;
  bindMode: string;
}

export interface LocalStoragePayload {
  userPreferences: UserPreferences;
  elementStates: ElementStates;
}

export const saveLocalCanvasToStorage = (
  elements: DriplElement[],
  state: LocalCanvasState,
  selectedIds?: Set<string> | string[],
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
    localStorage.setItem(STORAGE_KEYS.STRUCTURED, JSON.stringify(payload));

    // Legacy keys for backward compatibility
    localStorage.setItem(STORAGE_KEYS.CANVAS, JSON.stringify(elements));
    localStorage.setItem(
      STORAGE_KEYS.STATE,
      JSON.stringify({
        theme: state.theme === "system" ? "dark" : state.theme,
        viewBackgroundColor: "#ffffff",
        currentItemStrokeColor: state.currentStrokeColor,
        currentItemBackgroundColor: state.currentBackgroundColor,
        currentItemStrokeWidth: state.currentStrokeWidth,
        currentItemRoughness: state.currentRoughness,
        currentItemStrokeStyle: state.currentStrokeStyle,
        currentItemFillStyle: state.currentFillStyle,
        gridSize: 20,
        gridStep: 5,
        gridModeEnabled: false,
        showWelcomeScreen: true,
        name: "Untitled",
        zoom: { value: state.zoom },
        scrollX: state.panX,
        scrollY: state.panY,
      }),
    );
    localStorage.setItem(STORAGE_KEYS.THEME, state.theme);
    const timestamp = Date.now();
    localStorage.setItem(STORAGE_KEYS.VERSION_DATA, timestamp.toString());
    localStorage.setItem(STORAGE_KEYS.VERSION_FILES, timestamp.toString());
    const collabUsername =
      typeof window !== "undefined"
        ? localStorage.getItem("dripl_username") || ""
        : "";
    localStorage.setItem(
      STORAGE_KEYS.COLLAB,
      JSON.stringify({ username: collabUsername }),
    );
  } catch (error) {
    console.error("Error saving local canvas to storage:", error);
  }
};

export const loadLocalCanvasFromStorage = (): {
  elements: DriplElement[] | null;
  appState: LocalCanvasState | null;
  selectedIds?: string[];
} => {
  try {
    const structured = localStorage.getItem(STORAGE_KEYS.STRUCTURED);
    if (structured) {
      const payload = JSON.parse(structured) as LocalStoragePayload;
      if (payload.userPreferences && payload.elementStates) {
        return {
          elements: payload.elementStates.elements ?? null,
          appState: payload.userPreferences as LocalCanvasState,
          selectedIds: payload.elementStates.selectedIds,
        };
      }
    }

    // Fallback: legacy keys
    const elements = localStorage.getItem(STORAGE_KEYS.CANVAS);
    const state = localStorage.getItem(STORAGE_KEYS.STATE);
    let parsedElements: DriplElement[] | null = null;
    if (elements) {
      parsedElements = JSON.parse(elements);
    }
    let parsedState: LocalCanvasState | null = null;
    if (state) {
      const excalidrawState: ExcalidrawState = JSON.parse(state);
      parsedState = {
        theme:
          (localStorage.getItem(STORAGE_KEYS.THEME) as
            | "light"
            | "dark"
            | "system") || "dark",
        zoom: excalidrawState.zoom?.value ?? 1,
        panX: excalidrawState.scrollX ?? 0,
        panY: excalidrawState.scrollY ?? 0,
        currentStrokeColor: excalidrawState.currentItemStrokeColor || "#1e1e1e",
        currentBackgroundColor:
          excalidrawState.currentItemBackgroundColor || "transparent",
        currentStrokeWidth: excalidrawState.currentItemStrokeWidth ?? 2,
        currentRoughness: excalidrawState.currentItemRoughness ?? 1,
        currentStrokeStyle:
          (excalidrawState.currentItemStrokeStyle as
            | "solid"
            | "dashed"
            | "dotted") || "solid",
        currentFillStyle:
          (excalidrawState.currentItemFillStyle as LocalCanvasState["currentFillStyle"]) ||
          "hachure",
        activeTool: "select",
      };
    }
    return {
      elements: parsedElements,
      appState: parsedState,
    };
  } catch (error) {
    console.error("Error loading local canvas from storage:", error);
    return { elements: null, appState: null };
  }
};

export const clearLocalCanvasStorage = () => {
  try {
    localStorage.removeItem(STORAGE_KEYS.STRUCTURED);
    localStorage.removeItem(STORAGE_KEYS.CANVAS);
    localStorage.removeItem(STORAGE_KEYS.STATE);
    localStorage.removeItem(STORAGE_KEYS.THEME);
    localStorage.removeItem(STORAGE_KEYS.COLLAB);
    localStorage.removeItem(STORAGE_KEYS.VERSION_DATA);
    localStorage.removeItem(STORAGE_KEYS.VERSION_FILES);
  } catch (error) {
    console.error("Error clearing local canvas storage:", error);
  }
};
