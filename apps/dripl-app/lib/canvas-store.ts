import { create } from "zustand";
import type { DriplElement } from "@dripl/common";
import { initializeShapeRegistry } from "@/utils/shapes/shapeInitializer";
import { invalidateElementCache } from "@dripl/element";

initializeShapeRegistry();

const MAX_HISTORY = 100;

export type DrawingLifecycle = "idle" | "drawing" | "committing";

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
  updatedAt: number;
}

export type Theme = "light" | "dark" | "system";

export type ActiveTool =
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

type FillStyle =
  | "hachure"
  | "solid"
  | "zigzag"
  | "cross-hatch"
  | "dots"
  | "dashed"
  | "zigzag-line";

type StrokeStyle = "solid" | "dashed" | "dotted";

interface HistoryState {
  past: DriplElement[][];
  future: DriplElement[][];
}

function cloneElements(elements: readonly DriplElement[]): DriplElement[] {
  return elements.map((element) => ({ ...element }));
}

function pushPast(
  past: readonly DriplElement[][],
  snapshot: readonly DriplElement[],
): DriplElement[][] {
  const next = [...past, cloneElements(snapshot)];
  if (next.length <= MAX_HISTORY) return next;
  return next.slice(next.length - MAX_HISTORY);
}

function deriveHistoryIndex(past: readonly DriplElement[][]): number {
  return past.length;
}

function deriveHistory(
  past: readonly DriplElement[][],
  present: readonly DriplElement[],
  future: readonly DriplElement[][],
): DriplElement[][] {
  return [
    ...past.map((snapshot) => cloneElements(snapshot)),
    cloneElements(present),
    ...future.map((snapshot) => cloneElements(snapshot)),
  ];
}

function withHistoryBeforeMutation(
  history: HistoryState,
  currentElements: readonly DriplElement[],
): HistoryState {
  return {
    past: pushPast(history.past, currentElements),
    future: [],
  };
}

function commitPresentFromHistory(
  past: readonly DriplElement[][],
  future: readonly DriplElement[][],
  present: readonly DriplElement[],
) {
  return {
    past: [...past],
    future: [...future],
    history: deriveHistory(past, present, future),
    historyIndex: deriveHistoryIndex(past),
  };
}

export interface CanvasState {
  theme: Theme;
  roomId: string | null;
  roomSlug: string | null;
  isConnected: boolean;
  readOnly: boolean;
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
  activeTool: ActiveTool;

  remoteUsers: Map<string, RemoteUser>;
  remoteCursors: Map<string, RemoteCursor>;
  elementLocks: Map<string, string>;

  zoom: number;
  panX: number;
  panY: number;
  gridEnabled: boolean;
  gridSize: number;

  currentStrokeColor: string;
  currentBackgroundColor: string;
  currentStrokeWidth: number;
  currentRoughness: number;
  currentStrokeStyle: StrokeStyle;
  currentFillStyle: FillStyle;

  past: DriplElement[][];
  future: DriplElement[][];
  history: DriplElement[][];
  historyIndex: number;

  setRoomId: (roomId: string | null) => void;
  setRoomSlug: (roomSlug: string | null) => void;
  setIsConnected: (isConnected: boolean) => void;
  setReadOnly: (readOnly: boolean) => void;
  setUserId: (userId: string | null) => void;
  setFileMetadata: (fileId: string | null, fileName: string) => void;
  markSaving: (isSaving: boolean) => void;
  markSaved: () => void;

  setDraftElement: (element: DriplElement | null) => void;
  updateDraftElement: (updates: Partial<DriplElement>) => void;
  commitDraft: () => DriplElement | null;
  setDrawingLifecycle: (lifecycle: DrawingLifecycle) => void;
  setEditingElementId: (id: string | null) => void;

  setElements: (
    elements: DriplElement[],
    options?: { skipHistory?: boolean },
  ) => void;
  addElement: (element: DriplElement) => void;
  addElements: (elements: DriplElement[]) => void;
  updateElement: (id: string, updates: Partial<DriplElement>) => void;
  deleteElements: (ids: string[]) => void;

  bringForward: (ids: string[]) => void;
  sendBackward: (ids: string[]) => void;
  bringToFront: (ids: string[]) => void;
  sendToBack: (ids: string[]) => void;

  setSelectedIds: (ids: Set<string>) => void;
  selectElement: (id: string, addToSelection?: boolean) => void;
  clearSelection: () => void;
  setActiveTool: (tool: ActiveTool) => void;

  setRemoteUsers: (users: Map<string, RemoteUser>) => void;
  addRemoteUser: (user: RemoteUser) => void;
  removeRemoteUser: (userId: string) => void;
  updateRemoteCursor: (userId: string, cursor: Omit<RemoteCursor, "updatedAt">) => void;
  removeRemoteCursor: (userId: string) => void;

  setElementLock: (elementId: string, userId: string) => void;
  releaseElementLock: (elementId: string) => void;
  clearElementLocks: () => void;

  setZoom: (zoom: number) => void;
  setPan: (panX: number, panY: number) => void;
  setTheme: (theme: Theme) => void;
  setGridEnabled: (enabled: boolean) => void;
  setGridSize: (size: number) => void;

  setCurrentStrokeColor: (color: string) => void;
  setCurrentBackgroundColor: (color: string) => void;
  setCurrentStrokeWidth: (width: number) => void;
  setCurrentRoughness: (roughness: number) => void;
  setCurrentStrokeStyle: (style: StrokeStyle) => void;
  setCurrentFillStyle: (style: FillStyle) => void;

  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
  clearHistory: () => void;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  theme: "system",
  roomId: null,
  roomSlug: null,
  isConnected: false,
  readOnly: false,
  userId: null,
  fileId: null,
  fileName: "Untitled",
  isSaving: false,
  lastSaved: null,

  drawingLifecycle: "idle",
  draftElement: null,
  isEditingElementId: null,

  elements: [],
  selectedIds: new Set<string>(),
  activeTool: "select",

  remoteUsers: new Map<string, RemoteUser>(),
  remoteCursors: new Map<string, RemoteCursor>(),
  elementLocks: new Map<string, string>(),

  zoom: 1,
  panX: 0,
  panY: 0,
  gridEnabled: false,
  gridSize: 20,

  currentStrokeColor: "#1e1e1e",
  currentBackgroundColor: "transparent",
  currentStrokeWidth: 2,
  currentRoughness: 1,
  currentStrokeStyle: "solid",
  currentFillStyle: "hachure",

  past: [],
  future: [],
  history: [cloneElements([])],
  historyIndex: 0,

  setRoomId: (roomId) => set({ roomId }),
  setRoomSlug: (roomSlug) => set({ roomSlug }),
  setIsConnected: (isConnected) => set({ isConnected }),
  setReadOnly: (readOnly) => set({ readOnly }),
  setUserId: (userId) => set({ userId }),
  setFileMetadata: (fileId, fileName) => set({ fileId, fileName }),
  markSaving: (isSaving) => set({ isSaving }),
  markSaved: () => set({ isSaving: false, lastSaved: Date.now() }),

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
    if (state.elements.some((element) => element.id === draft.id)) {
      set({ draftElement: null, drawingLifecycle: "idle" });
      return null;
    }

    const history = withHistoryBeforeMutation(
      { past: state.past, future: state.future },
      state.elements,
    );

    const committed: DriplElement = {
      ...draft,
      version: (draft.version ?? 0) + 1,
      versionNonce: Math.floor(Math.random() * 2_147_483_647),
      updated: Date.now(),
    };
    const elements = [...state.elements, committed];
    const historyPayload = commitPresentFromHistory(
      history.past,
      history.future,
      elements,
    );

    set({
      elements,
      draftElement: null,
      drawingLifecycle: "idle",
      past: historyPayload.past,
      future: historyPayload.future,
      history: historyPayload.history,
      historyIndex: historyPayload.historyIndex,
    });
    return committed;
  },

  setDrawingLifecycle: (drawingLifecycle) => set({ drawingLifecycle }),
  setEditingElementId: (isEditingElementId) => set({ isEditingElementId }),

  setElements: (elements, options) =>
    set((state) => {
      if (options?.skipHistory) {
        return { elements: cloneElements(elements) };
      }
      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements,
      );
      const nextElements = cloneElements(elements);
      const historyPayload = commitPresentFromHistory(
        history.past,
        history.future,
        nextElements,
      );
      return {
        elements: nextElements,
        past: historyPayload.past,
        future: historyPayload.future,
        history: historyPayload.history,
        historyIndex: historyPayload.historyIndex,
      };
    }),

  addElement: (element) =>
    set((state) => {
      if (state.elements.some((candidate) => candidate.id === element.id)) {
        return state;
      }
      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements,
      );
      const nextElements = [...state.elements, element];
      const historyPayload = commitPresentFromHistory(
        history.past,
        history.future,
        nextElements,
      );
      return {
        elements: nextElements,
        past: historyPayload.past,
        future: historyPayload.future,
        history: historyPayload.history,
        historyIndex: historyPayload.historyIndex,
      };
    }),

  addElements: (elements) =>
    set((state) => {
      if (elements.length === 0) return state;
      const existingIds = new Set(state.elements.map((element) => element.id));
      const deduped = elements.filter((element) => !existingIds.has(element.id));
      if (deduped.length === 0) return state;

      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements,
      );
      const nextElements = [...state.elements, ...deduped];
      const historyPayload = commitPresentFromHistory(
        history.past,
        history.future,
        nextElements,
      );

      return {
        elements: nextElements,
        past: historyPayload.past,
        future: historyPayload.future,
        history: historyPayload.history,
        historyIndex: historyPayload.historyIndex,
      };
    }),

  updateElement: (id, updates) =>
    set((state) => {
      const index = state.elements.findIndex((element) => element.id === id);
      if (index === -1) return state;

      invalidateElementCache(id);
      const previous = state.elements[index];
      if (!previous) return state;

      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements,
      );
      const nextElements = [...state.elements];
      nextElements[index] = {
        ...previous,
        ...updates,
        version: (previous.version ?? 0) + 1,
        versionNonce: Math.floor(Math.random() * 2_147_483_647),
        updated: Date.now(),
      } as DriplElement;

      const historyPayload = commitPresentFromHistory(
        history.past,
        history.future,
        nextElements,
      );
      return {
        elements: nextElements,
        past: historyPayload.past,
        future: historyPayload.future,
        history: historyPayload.history,
        historyIndex: historyPayload.historyIndex,
      };
    }),

  deleteElements: (ids) =>
    set((state) => {
      if (ids.length === 0) return state;
      const idSet = new Set(ids);
      const nextElements = state.elements.filter((element) => !idSet.has(element.id));
      if (nextElements.length === state.elements.length) return state;

      ids.forEach((id) => invalidateElementCache(id));

      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements,
      );
      const historyPayload = commitPresentFromHistory(
        history.past,
        history.future,
        nextElements,
      );
      return {
        elements: nextElements,
        selectedIds: new Set(
          Array.from(state.selectedIds).filter((selectedId) => !idSet.has(selectedId)),
        ),
        past: historyPayload.past,
        future: historyPayload.future,
        history: historyPayload.history,
        historyIndex: historyPayload.historyIndex,
      };
    }),

  bringForward: (ids) =>
    set((state) => {
      if (ids.length === 0) return state;
      const selected = new Set(ids);
      const next = [...state.elements];
      let changed = false;

      for (let i = next.length - 2; i >= 0; i -= 1) {
        if (selected.has(next[i]?.id ?? "") && !selected.has(next[i + 1]?.id ?? "")) {
          const current = next[i];
          next[i] = next[i + 1] as DriplElement;
          next[i + 1] = current as DriplElement;
          changed = true;
        }
      }
      if (!changed) return state;

      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements,
      );
      const historyPayload = commitPresentFromHistory(history.past, history.future, next);
      return {
        elements: next,
        past: historyPayload.past,
        future: historyPayload.future,
        history: historyPayload.history,
        historyIndex: historyPayload.historyIndex,
      };
    }),

  sendBackward: (ids) =>
    set((state) => {
      if (ids.length === 0) return state;
      const selected = new Set(ids);
      const next = [...state.elements];
      let changed = false;

      for (let i = 1; i < next.length; i += 1) {
        if (selected.has(next[i]?.id ?? "") && !selected.has(next[i - 1]?.id ?? "")) {
          const current = next[i];
          next[i] = next[i - 1] as DriplElement;
          next[i - 1] = current as DriplElement;
          changed = true;
        }
      }
      if (!changed) return state;

      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements,
      );
      const historyPayload = commitPresentFromHistory(history.past, history.future, next);
      return {
        elements: next,
        past: historyPayload.past,
        future: historyPayload.future,
        history: historyPayload.history,
        historyIndex: historyPayload.historyIndex,
      };
    }),

  bringToFront: (ids) =>
    set((state) => {
      if (ids.length === 0) return state;
      const selected = new Set(ids);
      const moving = state.elements.filter((element) => selected.has(element.id));
      if (moving.length === 0) return state;
      const stay = state.elements.filter((element) => !selected.has(element.id));
      const next = [...stay, ...moving];

      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements,
      );
      const historyPayload = commitPresentFromHistory(history.past, history.future, next);
      return {
        elements: next,
        past: historyPayload.past,
        future: historyPayload.future,
        history: historyPayload.history,
        historyIndex: historyPayload.historyIndex,
      };
    }),

  sendToBack: (ids) =>
    set((state) => {
      if (ids.length === 0) return state;
      const selected = new Set(ids);
      const moving = state.elements.filter((element) => selected.has(element.id));
      if (moving.length === 0) return state;
      const stay = state.elements.filter((element) => !selected.has(element.id));
      const next = [...moving, ...stay];

      const history = withHistoryBeforeMutation(
        { past: state.past, future: state.future },
        state.elements,
      );
      const historyPayload = commitPresentFromHistory(history.past, history.future, next);
      return {
        elements: next,
        past: historyPayload.past,
        future: historyPayload.future,
        history: historyPayload.history,
        historyIndex: historyPayload.historyIndex,
      };
    }),

  setSelectedIds: (selectedIds) => set({ selectedIds }),
  selectElement: (id, addToSelection = false) =>
    set((state) => {
      const selectedIds = new Set(addToSelection ? state.selectedIds : []);
      selectedIds.add(id);
      return { selectedIds };
    }),
  clearSelection: () => set({ selectedIds: new Set<string>() }),
  setActiveTool: (activeTool) => set({ activeTool }),

  setRemoteUsers: (remoteUsers) => set({ remoteUsers }),
  addRemoteUser: (user) =>
    set((state) => {
      const remoteUsers = new Map(state.remoteUsers);
      remoteUsers.set(user.userId, user);
      return { remoteUsers };
    }),
  removeRemoteUser: (userId) =>
    set((state) => {
      const remoteUsers = new Map(state.remoteUsers);
      remoteUsers.delete(userId);
      const remoteCursors = new Map(state.remoteCursors);
      remoteCursors.delete(userId);
      return { remoteUsers, remoteCursors };
    }),
  updateRemoteCursor: (userId, cursor) =>
    set((state) => {
      const remoteCursors = new Map(state.remoteCursors);
      remoteCursors.set(userId, { ...cursor, updatedAt: Date.now() });
      return { remoteCursors };
    }),
  removeRemoteCursor: (userId) =>
    set((state) => {
      const remoteCursors = new Map(state.remoteCursors);
      remoteCursors.delete(userId);
      return { remoteCursors };
    }),

  setElementLock: (elementId, userId) =>
    set((state) => {
      const elementLocks = new Map(state.elementLocks);
      elementLocks.set(elementId, userId);
      return { elementLocks };
    }),
  releaseElementLock: (elementId) =>
    set((state) => {
      const elementLocks = new Map(state.elementLocks);
      elementLocks.delete(elementId);
      return { elementLocks };
    }),
  clearElementLocks: () => set({ elementLocks: new Map<string, string>() }),

  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(20, zoom)) }),
  setPan: (panX, panY) => set({ panX, panY }),
  setTheme: (theme) => set({ theme }),
  setGridEnabled: (gridEnabled) => set({ gridEnabled }),
  setGridSize: (gridSize) => set({ gridSize: Math.max(4, gridSize) }),

  setCurrentStrokeColor: (currentStrokeColor) => set({ currentStrokeColor }),
  setCurrentBackgroundColor: (currentBackgroundColor) =>
    set({ currentBackgroundColor }),
  setCurrentStrokeWidth: (currentStrokeWidth) => set({ currentStrokeWidth }),
  setCurrentRoughness: (currentRoughness) => set({ currentRoughness }),
  setCurrentStrokeStyle: (currentStrokeStyle) => set({ currentStrokeStyle }),
  setCurrentFillStyle: (currentFillStyle) => set({ currentFillStyle }),

  undo: () =>
    set((state) => {
      if (state.past.length === 0) return state;

      const previous = state.past[state.past.length - 1];
      if (!previous) return state;

      const past = state.past.slice(0, -1);
      const future = [cloneElements(state.elements), ...state.future].slice(
        0,
        MAX_HISTORY,
      );
      const elements = cloneElements(previous);
      const historyPayload = commitPresentFromHistory(past, future, elements);

      elements.forEach((element) => invalidateElementCache(element.id));

      return {
        elements,
        past: historyPayload.past,
        future: historyPayload.future,
        history: historyPayload.history,
        historyIndex: historyPayload.historyIndex,
      };
    }),

  redo: () =>
    set((state) => {
      if (state.future.length === 0) return state;

      const next = state.future[0];
      if (!next) return state;

      const future = state.future.slice(1);
      const past = pushPast(state.past, state.elements);
      const elements = cloneElements(next);
      const historyPayload = commitPresentFromHistory(past, future, elements);

      elements.forEach((element) => invalidateElementCache(element.id));

      return {
        elements,
        past: historyPayload.past,
        future: historyPayload.future,
        history: historyPayload.history,
        historyIndex: historyPayload.historyIndex,
      };
    }),

  // Compatibility hook for old callsites; history is now captured automatically
  // before store mutations.
  pushHistory: () => {},
  clearHistory: () =>
    set((state) => {
      const history = [cloneElements(state.elements)];
      return {
        past: [],
        future: [],
        history,
        historyIndex: 0,
      };
    }),
}));
