import type { DriplElement } from "@dripl/common";

const STORAGE_KEYS = {
  LOCAL_CANVAS_ELEMENTS: "dripl-rough-elements",
  LOCAL_CANVAS_STATE: "dripl-rough-state",
};

export interface LocalCanvasState {
  theme: "light" | "dark" | "system";
  zoom: number;
  panX: number;
  panY: number;
  currentStrokeColor: string;
  currentBackgroundColor: string;
  currentStrokeWidth: number;
  currentRoughness: number;
  currentStrokeStyle: "solid" | "dashed" | "dotted";
  currentFillStyle: "hachure" | "solid" | "zigzag" | "cross-hatch" | "dots" | "dashed" | "zigzag-line";
  activeTool: string;
}

export const saveLocalCanvasToStorage = (
  elements: DriplElement[],
  state: LocalCanvasState
) => {
  try {
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_CANVAS_ELEMENTS,
      JSON.stringify(elements)
    );
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_CANVAS_STATE,
      JSON.stringify(state)
    );
  } catch (error) {
    console.error("Error saving local canvas to storage:", error);
  }
};

export const loadLocalCanvasFromStorage = () => {
  try {
    const elements = localStorage.getItem(STORAGE_KEYS.LOCAL_CANVAS_ELEMENTS);
    const state = localStorage.getItem(STORAGE_KEYS.LOCAL_CANVAS_STATE);

    return {
      elements: elements ? JSON.parse(elements) : null,
      appState: state ? JSON.parse(state) : null,
    };
  } catch (error) {
    console.error("Error loading local canvas from storage:", error);
    return { elements: null, appState: null };
  }
};

export const clearLocalCanvasStorage = () => {
  try {
    localStorage.removeItem(STORAGE_KEYS.LOCAL_CANVAS_ELEMENTS);
    localStorage.removeItem(STORAGE_KEYS.LOCAL_CANVAS_STATE);
  } catch (error) {
    console.error("Error clearing local canvas storage:", error);
  }
};
