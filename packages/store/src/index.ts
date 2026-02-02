import { Store } from "@tanstack/store";
import { DriplElement } from "@dripl/common";


export interface User {
  userId: string;
  userName: string;
  color: string;
  cursorX?: number;
  cursorY?: number;
}

export interface AppState {
  zoom: number;
  scrollX: number;
  scrollY: number;
  viewModeEnabled: boolean;
  
  gridSize: number;
  gridEnabled: boolean;
  snapToGrid: boolean;
  
  theme: "light" | "dark";
  canvasBackgroundColor: string;
  
  activeTool: "selection" | "rectangle" | "ellipse" | "diamond" | "arrow" | "line" | "draw" | "text" | "image";
  
  selectedElementIds: Set<string>;
  editingTextId: string | null;
  
  currentItemStrokeColor: string;
  currentItemBackgroundColor: string;
  currentItemStrokeWidth: number;
  currentItemRoughness: number;
  currentItemStrokeSharpness: "round" | "sharp";
  
  fileId: string | null;
  fileName: string;
  isSaving: boolean;
  lastSaved: number | null;
  
  isCollaborative: boolean;
  roomId: string | null;
  currentUserId: string | null;
  connectedUsers: Map<string, User>;
}

export interface HistoryEntry {
  elements: DriplElement[];
  timestamp: number;
}

export interface StoreState {
  appState: AppState;
  elements: DriplElement[];
  history: {
    past: HistoryEntry[];
    future: HistoryEntry[];
  };
}


export const defaultAppState: AppState = {
  zoom: 1,
  scrollX: 0,
  scrollY: 0,
  viewModeEnabled: false,
  gridSize: 20,
  gridEnabled: true,
  snapToGrid: false,
  theme: "light",
  canvasBackgroundColor: "#ffffff",
  activeTool: "selection",
  selectedElementIds: new Set(),
  editingTextId: null,
  currentItemStrokeColor: "#000000",
  currentItemBackgroundColor: "transparent",
  currentItemStrokeWidth: 1,
  currentItemRoughness: 1,
  currentItemStrokeSharpness: "round",
  fileId: null,
  fileName: "Untitled",
  isSaving: false,
  lastSaved: null,
  isCollaborative: false,
  roomId: null,
  currentUserId: null,
  connectedUsers: new Map(),
};


export const store = new Store<StoreState>({
  appState: defaultAppState,
  elements: [],
  history: {
    past: [],
    future: [],
  },
});


const MAX_HISTORY_SIZE = 50;
const HISTORY_THROTTLE_MS = 300;
let historyThrottleTimeout: NodeJS.Timeout | null = null;


export const actions = {
   
  setAppState: (updater: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => {
    store.setState((state) => ({
      ...state,
      appState: {
        ...state.appState,
        ...(typeof updater === "function" ? updater(state.appState) : updater),
      },
    }));
  },

  setTool: (tool: AppState["activeTool"]) => {
    actions.setAppState({ activeTool: tool });
  },

  setZoom: (zoom: number) => {
    actions.setAppState({ zoom: Math.max(0.1, Math.min(10, zoom)) });
  },

  setScroll: (scrollX: number, scrollY: number) => {
    actions.setAppState({ scrollX, scrollY });
  },

 
  setElements: (
    updater: DriplElement[] | ((prev: DriplElement[]) => DriplElement[]),
    options: { addToHistory?: boolean; source?: "local" | "remote" } = {}
  ) => {
    const { addToHistory = true, source = "local" } = options;

    store.setState((state) => {
      const newElements =
        typeof updater === "function" ? updater(state.elements) : updater;

      if (addToHistory && source === "local") {
        if (historyThrottleTimeout) {
          clearTimeout(historyThrottleTimeout);
        }

        historyThrottleTimeout = setTimeout(() => {
          actions.pushToHistory();
        }, HISTORY_THROTTLE_MS);
      }

      return {
        ...state,
        elements: newElements,
      };
    });
  },

  addElement: (element: DriplElement, options?: { addToHistory?: boolean }) => {
    actions.setElements((prev) => [...prev, element], options);
  },

  updateElement: (
    elementId: string,
    updates: Partial<DriplElement>,
    options?: { addToHistory?: boolean }
  ) => {
    actions.setElements(
      (prev) =>
        prev.map((el) => (el.id === elementId ? { ...el, ...updates } : el)),
      options
    );
  },

  deleteElements: (elementIds: string[], options?: { addToHistory?: boolean }) => {
    actions.setElements(
      (prev) => prev.filter((el) => !elementIds.includes(el.id)),
      options
    );
    
    actions.setAppState((prev) => {
      const newSelected = new Set(prev.selectedElementIds);
      elementIds.forEach(id => newSelected.delete(id));
      return { selectedElementIds: newSelected };
    });
  },

 
  selectElements: (elementIds: string[]) => {
    actions.setAppState({ selectedElementIds: new Set(elementIds) });
  },

  toggleElementSelection: (elementId: string) => {
    actions.setAppState((prev) => {
      const newSelected = new Set(prev.selectedElementIds);
      if (newSelected.has(elementId)) {
        newSelected.delete(elementId);
      } else {
        newSelected.add(elementId);
      }
      return { selectedElementIds: newSelected };
    });
  },

  clearSelection: () => {
    actions.setAppState({ selectedElementIds: new Set() });
  },

 
  pushToHistory: () => {
    store.setState((state) => {
      const entry: HistoryEntry = {
        elements: JSON.parse(JSON.stringify(state.elements)),
        timestamp: Date.now(),
      };

      const newPast = [...state.history.past, entry];
      
      if (newPast.length > MAX_HISTORY_SIZE) {
        newPast.shift();
      }

      return {
        ...state,
        history: {
          past: newPast,
          future: [],
        },
      };
    });
  },

  undo: () => {
    store.setState((state) => {
      if (state.history.past.length === 0) return state;

      const previous = state.history.past[state.history.past.length - 1];
      const newPast = state.history.past.slice(0, -1);
      
      const currentEntry: HistoryEntry = {
        elements: JSON.parse(JSON.stringify(state.elements)),
        timestamp: Date.now(),
      };

      return {
        ...state,
        elements: previous!.elements,
        history: {
          past: newPast,
          future: [currentEntry, ...state.history.future],
        },
      };
    });
  },

  redo: () => {
    store.setState((state) => {
      if (state.history.future.length === 0) return state;

      const next = state.history.future[0];
      const newFuture = state.history.future.slice(1);
      
      const currentEntry: HistoryEntry = {
        elements: JSON.parse(JSON.stringify(state.elements)),
        timestamp: Date.now(),
      };

      return {
        ...state,
        elements: next!.elements,
        history: {
          past: [...state.history.past, currentEntry],
          future: newFuture,
        },
      };
    });
  },

  canUndo: (): boolean => {
    return store.state.history.past.length > 0;
  },

  canRedo: (): boolean => {
    return store.state.history.future.length > 0;
  },

  clearHistory: () => {
    store.setState((state) => ({
      ...state,
      history: {
        past: [],
        future: [],
      },
    }));
  },

 
  setCollaborativeMode: (isCollaborative: boolean, roomId?: string, userId?: string) => {
    actions.setAppState({
      isCollaborative,
      roomId: roomId || null,
      currentUserId: userId || null,
    });
  },

  updateUser: (userId: string, updates: Partial<User>) => {
    store.setState((state) => {
      const newUsers = new Map(state.appState.connectedUsers);
      const existing = newUsers.get(userId);
      if (existing) {
        newUsers.set(userId, { ...existing, ...updates });
      } else {
        newUsers.set(userId, { userId, userName: "Unknown", color: "#000000", ...updates });
      }
      
      return {
        ...state,
        appState: {
          ...state.appState,
          connectedUsers: newUsers,
        },
      };
    });
  },

  removeUser: (userId: string) => {
    store.setState((state) => {
      const newUsers = new Map(state.appState.connectedUsers);
      newUsers.delete(userId);
      
      return {
        ...state,
        appState: {
          ...state.appState,
          connectedUsers: newUsers,
        },
      };
    });
  },

  setFileMetadata: (fileId: string, fileName: string) => {
    actions.setAppState({ fileId, fileName });
  },

  markSaving: (isSaving: boolean) => {
    actions.setAppState({ isSaving });
  },

  markSaved: () => {
    actions.setAppState({ isSaving: false, lastSaved: Date.now() });
  },

  loadState: (elements: DriplElement[], appState?: Partial<AppState>) => {
    store.setState((state) => ({
      elements,
      appState: {
        ...state.appState,
        ...appState,
      },
      history: {
        past: [],
        future: [],
      },
    }));
  },

  resetState: () => {
    store.setState({
      appState: defaultAppState,
      elements: [],
      history: {
        past: [],
        future: [],
      },
    });
  },
};


export const selectors = {
  elements: (state: StoreState) => state.elements,
  appState: (state: StoreState) => state.appState,
  selectedElements: (state: StoreState) =>
    state.elements.filter((el) => state.appState.selectedElementIds.has(el.id)),
  getElementById: (id: string) => (state: StoreState) =>
    state.elements.find((el) => el.id === id),
  canUndo: (state: StoreState) => state.history.past.length > 0,
  canRedo: (state: StoreState) => state.history.future.length > 0,
  connectedUsers: (state: StoreState) => Array.from(state.appState.connectedUsers.values()),
};

export default store;