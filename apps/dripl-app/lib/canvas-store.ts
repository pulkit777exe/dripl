import { create } from "zustand";
import type { DriplElement } from "@dripl/common";

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

export interface CanvasState {
  // Room info
  roomId: string | null;
  roomSlug: string | null;
  isConnected: boolean;

  // Auth/User info
  userId: string | null;

  // Persistence tracking
  fileId: string | null;
  fileName: string;
  isSaving: boolean;
  lastSaved: number | null;

  // Drawing state
  elements: DriplElement[];
  selectedIds: Set<string>;
  activeTool:
    | "select"
    | "rectangle"
    | "ellipse"
    | "diamond"
    | "arrow"
    | "line"
    | "freedraw"
    | "text"
    | "eraser";

  // Collaboration
  remoteUsers: Map<string, RemoteUser>;
  remoteCursors: Map<string, RemoteCursor>;

  // View state
  zoom: number;
  panX: number;
  panY: number;

  // Style state
  currentStrokeColor: string;
  currentBackgroundColor: string;
  currentStrokeWidth: number;
  currentRoughness: number;
  currentStrokeStyle: "solid" | "dashed" | "dotted";
  currentFillStyle: "hachure" | "solid" | "zigzag" | "cross-hatch" | "dots";

  // History
  history: DriplElement[][];
  historyIndex: number;

  // Actions - Room
  setRoomId: (roomId: string | null) => void;
  setRoomSlug: (roomSlug: string | null) => void;
  setIsConnected: (isConnected: boolean) => void;

  // Actions - Elements
  setElements: (elements: DriplElement[]) => void;
  addElement: (element: DriplElement) => void;
  updateElement: (id: string, updates: Partial<DriplElement>) => void;
  deleteElements: (ids: string[]) => void;

  // Actions - Selection
  setSelectedIds: (ids: Set<string>) => void;
  selectElement: (id: string, addToSelection?: boolean) => void;
  clearSelection: () => void;

  // Actions - Tool
  setActiveTool: (tool: CanvasState["activeTool"]) => void;

  // Actions - Collaboration
  setRemoteUsers: (users: Map<string, RemoteUser>) => void;
  addRemoteUser: (user: RemoteUser) => void;
  removeRemoteUser: (userId: string) => void;
  updateRemoteCursor: (userId: string, cursor: RemoteCursor) => void;
  removeRemoteCursor: (userId: string) => void;

  // Actions - View
  setZoom: (zoom: number) => void;
  setPan: (panX: number, panY: number) => void;

  // Actions - Style
  setCurrentStrokeColor: (color: string) => void;
  setCurrentBackgroundColor: (color: string) => void;
  setCurrentStrokeWidth: (width: number) => void;
  setCurrentRoughness: (roughness: number) => void;
  setCurrentStrokeStyle: (style: "solid" | "dashed" | "dotted") => void;
  setCurrentFillStyle: (
    style: "hachure" | "solid" | "zigzag" | "cross-hatch" | "dots"
  ) => void;

  // Actions - History
  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
  clearHistory: () => void;

  // Actions - Persistence
  setUserId: (userId: string | null) => void;
  setFileMetadata: (fileId: string | null, fileName: string) => void;
  markSaving: (isSaving: boolean) => void;
  markSaved: () => void;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  // Initial state - Room
  roomId: null,
  roomSlug: null,
  isConnected: false,

  // Initial state - Auth/User
  userId: null,

  // Initial state - Persistence
  fileId: null,
  fileName: "Untitled",
  isSaving: false,
  lastSaved: null,

  // Initial state - Drawing
  elements: [],
  selectedIds: new Set(),
  activeTool: "select",

  // Initial state - Collaboration
  remoteUsers: new Map(),
  remoteCursors: new Map(),

  // Initial state - View
  zoom: 1,
  panX: 0,
  panY: 0,

  // Initial state - Style
  currentStrokeColor: "#000000",
  currentBackgroundColor: "transparent",
  currentStrokeWidth: 2,
  currentRoughness: 1,
  currentStrokeStyle: "solid",
  currentFillStyle: "hachure",

  // Initial state - History
  history: [],
  historyIndex: -1,

  // Actions - Room
  setRoomId: (roomId) => set({ roomId }),
  setRoomSlug: (roomSlug) => set({ roomSlug }),
  setIsConnected: (isConnected) => set({ isConnected }),

  // Actions - Elements
  setElements: (elements) => set({ elements }),
  addElement: (element) =>
    set((state) => ({ elements: [...state.elements, element] })),
  updateElement: (id, updates) =>
    set((state) => ({
      elements: state.elements.map((el) =>
        el.id === id ? ({ ...el, ...updates } as DriplElement) : el
      ),
    })),
  deleteElements: (ids) =>
    set((state) => ({
      elements: state.elements.filter((el) => !ids.includes(el.id)),
      selectedIds: new Set(
        Array.from(state.selectedIds).filter((id) => !ids.includes(id))
      ),
    })),

  // Actions - Selection
  setSelectedIds: (ids) => set({ selectedIds: ids }),
  selectElement: (id, addToSelection = false) =>
    set((state) => {
      const newSelectedIds = new Set(addToSelection ? state.selectedIds : []);
      newSelectedIds.add(id);
      return { selectedIds: newSelectedIds };
    }),
  clearSelection: () => set({ selectedIds: new Set() }),

  // Actions - Tool
  setActiveTool: (activeTool) => set({ activeTool }),

  // Actions - Collaboration
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

  // Actions - View
  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(10, zoom)) }),
  setPan: (panX, panY) => set({ panX, panY }),

  // Actions - Style
  setCurrentStrokeColor: (color) => set({ currentStrokeColor: color }),
  setCurrentBackgroundColor: (color) => set({ currentBackgroundColor: color }),
  setCurrentStrokeWidth: (width) => set({ currentStrokeWidth: width }),
  setCurrentRoughness: (roughness) => set({ currentRoughness: roughness }),
  setCurrentStrokeStyle: (style) => set({ currentStrokeStyle: style }),
  setCurrentFillStyle: (style) => set({ currentFillStyle: style }),

  // Actions - History
  undo: () =>
    set((state) => {
      if (state.historyIndex > 0) {
        const newIndex = state.historyIndex - 1;
        return {
          elements: state.history[newIndex] || [],
          historyIndex: newIndex,
        };
      }
      return state;
    }),
  redo: () =>
    set((state) => {
      if (state.historyIndex < state.history.length - 1) {
        const newIndex = state.historyIndex + 1;
        return {
          elements: state.history[newIndex] || [],
          historyIndex: newIndex,
        };
      }
      return state;
    }),
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

  // Actions - Persistence
  setUserId: (userId) => set({ userId }),
  setFileMetadata: (fileId, fileName) => set({ fileId, fileName }),
  markSaving: (isSaving) => set({ isSaving }),
  markSaved: () => set({ isSaving: false, lastSaved: Date.now() }),
}));
