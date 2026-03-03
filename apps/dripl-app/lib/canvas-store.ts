import { create } from "zustand";
import type { DriplElement } from "@dripl/common";
import { getRuntimeStore } from "@/lib/runtime-store-bridge";
import { initializeShapeRegistry } from "@/utils/shapes/shapeInitializer";
import { shapeRegistry } from "@/utils/shapes/ShapeRegistry";

export type DrawingLifecycle = "idle" | "drawing" | "committing";

initializeShapeRegistry();

export interface RemoteUser {
  userId: string;
  userName: string;
  color: string;
}

export interface RemoteCursor {
  x: number;
  y: number;
  userName: string;
  color: string;
}

export type Theme = "light" | "dark" | "system";

export interface CanvasState {
  theme: Theme;
  roomId: string | null;
  roomSlug: string | null;
  isConnected: boolean;

  userId: string | null;

  fileId: string | null;
  fileName: string;
  isSaving: boolean;
  lastSaved: number | null;

  drawingLifecycle: DrawingLifecycle;
  draftElement: DriplElement | null;
  isEditingElementId: string | null;

  elements: DriplElement[];
  selectedIds: Set<string>;
  activeTool:
    | "select"
    | "hand"
    | "rectangle"
    | "ellipse"
    | "diamond"
    | "arrow"
    | "line"
    | "freedraw"
    | "text"
    | "image"
    | "eraser";

  remoteUsers: Map<string, RemoteUser>;
  remoteCursors: Map<string, RemoteCursor>;

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

  history: DriplElement[][];
  historyIndex: number;

  setRoomId: (roomId: string | null) => void;
  setRoomSlug: (roomSlug: string | null) => void;
  setIsConnected: (isConnected: boolean) => void;

  setDraftElement: (element: DriplElement | null) => void;
  updateDraftElement: (updates: Partial<DriplElement>) => void;
  commitDraft: () => DriplElement | null;
  setDrawingLifecycle: (lifecycle: DrawingLifecycle) => void;

  setEditingElementId: (id: string | null) => void;

  setElements: (elements: DriplElement[]) => void;
  addElement: (element: DriplElement) => void;
  addElements: (elements: DriplElement[]) => void;
  updateElement: (id: string, updates: Partial<DriplElement>) => void;
  deleteElements: (ids: string[]) => void;

  setSelectedIds: (ids: Set<string>) => void;
  selectElement: (id: string, addToSelection?: boolean) => void;
  clearSelection: () => void;

  setActiveTool: (tool: CanvasState["activeTool"]) => void;

  setRemoteUsers: (users: Map<string, RemoteUser>) => void;
  addRemoteUser: (user: RemoteUser) => void;
  removeRemoteUser: (userId: string) => void;
  updateRemoteCursor: (userId: string, cursor: RemoteCursor) => void;
  removeRemoteCursor: (userId: string) => void;

  setZoom: (zoom: number) => void;
  setPan: (panX: number, panY: number) => void;
  setTheme: (theme: Theme) => void;

  setCurrentStrokeColor: (color: string) => void;
  setCurrentBackgroundColor: (color: string) => void;
  setCurrentStrokeWidth: (width: number) => void;
  setCurrentRoughness: (roughness: number) => void;
  setCurrentStrokeStyle: (style: "solid" | "dashed" | "dotted") => void;
  setCurrentFillStyle: (
    style: "hachure" | "solid" | "zigzag" | "cross-hatch" | "dots",
  ) => void;

  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
  clearHistory: () => void;

  setUserId: (userId: string | null) => void;
  setFileMetadata: (fileId: string | null, fileName: string) => void;
  markSaving: (isSaving: boolean) => void;
  markSaved: () => void;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  theme: "system",
  roomId: null,
  roomSlug: null,
  isConnected: false,

  userId: null,

  fileId: null,
  fileName: "Untitled",
  isSaving: false,
  lastSaved: null,

  drawingLifecycle: "idle",
  draftElement: null,
  isEditingElementId: null,

  elements: [],
  selectedIds: new Set(),
  activeTool: "select",

  remoteUsers: new Map(),
  remoteCursors: new Map(),

  zoom: 1,
  panX: 0,
  panY: 0,

  currentStrokeColor: "#1e1e1e",
  currentBackgroundColor: "transparent",
  currentStrokeWidth: 2,
  currentRoughness: 1,
  currentStrokeStyle: "solid",
  currentFillStyle: "hachure",

  history: [],
  historyIndex: -1,

  setRoomId: (roomId) => set({ roomId }),
  setRoomSlug: (roomSlug) => set({ roomSlug }),
  setIsConnected: (isConnected) => set({ isConnected }),

  setDraftElement: (element) =>
    set({
      draftElement: element,
      drawingLifecycle: element ? "drawing" : "idle",
    }),

  updateDraftElement: (updates) =>
    set((state) => ({
      draftElement:
        state.draftElement !== null
          ? ({ ...state.draftElement, ...updates } as DriplElement)
          : null,
    })),

   commitDraft: () => {
    const state = get();
    const draft = state.draftElement;
    if (!draft) return null;

    set({ drawingLifecycle: "committing" });

    const elementToCommit = {
      ...draft,
      version: 1,
      versionNonce: Math.floor(Math.random() * 2_147_483_647),
      updated: Date.now(),
    };

    set((s) => {
      const newElements = [...s.elements, elementToCommit];
      const newHistory = s.history.slice(0, s.historyIndex + 1);
      newHistory.push([...newElements]);
      return {
        elements: newElements,
        draftElement: null,
        drawingLifecycle: "idle",
        history: newHistory,
        historyIndex: newHistory.length - 1,
      };
    });

    return elementToCommit;
  },

  setDrawingLifecycle: (lifecycle) => set({ drawingLifecycle: lifecycle }),

  setEditingElementId: (id) => set({ isEditingElementId: id }),

  setElements: (elements) => set({ elements }),
  addElement: (element) =>
    set((state) => ({ elements: [...state.elements, element] })),
  addElements: (newElements) =>
    set((state) => ({ elements: [...state.elements, ...newElements] })),
  updateElement: (id, updates) =>
    set((state) => ({
      elements: state.elements.map((el) =>
        el.id === id
          ? ({
              ...el,
              ...updates,
              version: (el.version ?? 0) + 1,
              versionNonce: Math.floor(Math.random() * 2_147_483_647),
              updated: Date.now(),
            } as DriplElement)
          : el,
      ),
    })),
  deleteElements: (ids) =>
    set((state) => ({
      elements: state.elements.filter((el) => el.id && !ids.includes(el.id)),
      selectedIds: new Set(
        Array.from(state.selectedIds).filter((id) => !ids.includes(id)),
      ),
    })),

  setSelectedIds: (ids) => set({ selectedIds: ids }),
  selectElement: (id, addToSelection = false) =>
    set((state) => {
      const newSelectedIds = new Set(addToSelection ? state.selectedIds : []);
      newSelectedIds.add(id);
      return { selectedIds: newSelectedIds };
    }),
  clearSelection: () => set({ selectedIds: new Set() }),

  setActiveTool: (activeTool) => set({ activeTool }),

  setRemoteUsers: (users) => set({ remoteUsers: users }),
  addRemoteUser: (user) =>
    set((state) => {
      const newUsers = new Map(state.remoteUsers);
      newUsers.set(user.userId, user);
      return { remoteUsers: newUsers };
    }),
  removeRemoteUser: (userId) =>
    set((state) => {
      const newUsers = new Map(state.remoteUsers);
      newUsers.delete(userId);
      const newCursors = new Map(state.remoteCursors);
      newCursors.delete(userId);
      return { remoteUsers: newUsers, remoteCursors: newCursors };
    }),
  updateRemoteCursor: (userId, cursor) =>
    set((state) => {
      const newCursors = new Map(state.remoteCursors);
      newCursors.set(userId, cursor);
      return { remoteCursors: newCursors };
    }),
  removeRemoteCursor: (userId) =>
    set((state) => {
      const newCursors = new Map(state.remoteCursors);
      newCursors.delete(userId);
      return { remoteCursors: newCursors };
    }),

  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(10, zoom)) }),
  setPan: (panX, panY) => set({ panX, panY }),
  setTheme: (theme: Theme) => set({ theme }),

  setCurrentStrokeColor: (color) => set({ currentStrokeColor: color }),
  setCurrentBackgroundColor: (color) => set({ currentBackgroundColor: color }),
  setCurrentStrokeWidth: (width) => set({ currentStrokeWidth: width }),
  setCurrentRoughness: (roughness) => set({ currentRoughness: roughness }),
  setCurrentStrokeStyle: (style) => set({ currentStrokeStyle: style }),
  setCurrentFillStyle: (style) => set({ currentFillStyle: style }),

  undo: () => {
    const runtime = getRuntimeStore();
    if (runtime) {
      runtime.undo();
      return;
    }
    set((state) => {
      if (state.historyIndex > 0) {
        const newIndex = state.historyIndex - 1;
        return {
          elements: state.history[newIndex] || [],
          historyIndex: newIndex,
        };
      }
      return state;
    });
  },
  redo: () => {
    const runtime = getRuntimeStore();
    if (runtime) {
      runtime.redo();
      return;
    }
    set((state) => {
      if (state.historyIndex < state.history.length - 1) {
        const newIndex = state.historyIndex + 1;
        return {
          elements: state.history[newIndex] || [],
          historyIndex: newIndex,
        };
      }
      return state;
    });
  },
  pushHistory: () =>
    set((state) => {
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push([...state.elements]);
      return {
        history: newHistory,
        historyIndex: newHistory.length - 1,
      };
    }),
  clearHistory: () => set({ history: [], historyIndex: -1 }),

  setUserId: (userId) => set({ userId }),
  setFileMetadata: (fileId, fileName) => set({ fileId, fileName }),
  markSaving: (isSaving) => set({ isSaving }),
  markSaved: () => set({ isSaving: false, lastSaved: Date.now() }),
}));
