import { Store } from "@tanstack/store";
import { CanvasElement } from "@dripl/common";

export interface AppState {
  zoom: number;
  scrollX: number;
  scrollY: number;
  theme: string;
  viewModeEnabled: boolean;
  gridSize: number;
  name: string;
  activeTool: string;
  selectedElementIds: Record<string, boolean>;
  editingTextId: string | null;
  canvasBackgroundColor: string;
  gridEnabled: boolean;
  snapToGrid: boolean;
  currentItemStrokeColor: string;
  currentItemBackgroundColor: string;
  currentItemStrokeWidth: number;
  currentItemRoughness: number;
  currentItemStrokeSharpness: "round" | "sharp";
}

export const defaultAppState: AppState = {
  zoom: 1,
  scrollX: 0,
  scrollY: 0,
  theme: "light",
  viewModeEnabled: false,
  gridSize: 20,
  name: "Untitled",
  activeTool: "selection",
  selectedElementIds: {},
  editingTextId: null,
  canvasBackgroundColor: "#ffffff",
  gridEnabled: false,
  snapToGrid: false,
  currentItemStrokeColor: "#000000",
  currentItemBackgroundColor: "transparent",
  currentItemStrokeWidth: 1,
  currentItemRoughness: 1,
  currentItemStrokeSharpness: "round",
};

export interface StoreState {
  appState: AppState;
  elements: CanvasElement[];
  history: {
    stack: CanvasElement[][];
    index: number;
  };
}

export const appStore = new Store<StoreState>({
  appState: defaultAppState,
  elements: [],
  history: {
    stack: [],
    index: -1,
  },
});

// Actions
export const setAppState = (updater: (prev: AppState) => AppState) => {
  appStore.setState((state) => ({
    ...state,
    appState: updater(state.appState),
  }));
};

export const setElements = (
  updaterOrValue: CanvasElement[] | ((prev: CanvasElement[]) => CanvasElement[])
) => {
  appStore.setState((state) => {
    const newElements =
      typeof updaterOrValue === "function"
        ? updaterOrValue(state.elements)
        : updaterOrValue;
    return {
      ...state,
      elements: newElements,
    };
  });
};

export const pushToHistory = (elements: CanvasElement[]) => {
  appStore.setState((state) => {
    const newHistoryStack = state.history.stack.slice(
      0,
      state.history.index + 1
    );
    newHistoryStack.push(elements);
    return {
      ...state,
      history: {
        stack: newHistoryStack,
        index: newHistoryStack.length - 1,
      },
    };
  });
};

export const undo = () => {
  appStore.setState((state) => {
    if (state.history.index > 0) {
      const newIndex = state.history.index - 1;
      return {
        ...state,
        elements: state.history.stack[newIndex]!,
        history: {
          ...state.history,
          index: newIndex,
        },
      };
    }
    return state;
  });
};

export const redo = () => {
  appStore.setState((state) => {
    if (state.history.index < state.history.stack.length - 1) {
      const newIndex = state.history.index + 1;
      return {
        ...state,
        elements: state.history.stack[newIndex]!,
        history: {
          ...state.history,
          index: newIndex,
        },
      };
    }
    return state;
  });
};
