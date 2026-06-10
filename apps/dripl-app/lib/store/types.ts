import type { DriplElement } from '@dripl/common';
import type { RemoteUser, RemoteCursor, Theme, ActiveTool, DrawingLifecycle } from '../canvas-store';

export type FillStyle = 'hachure' | 'solid' | 'zigzag' | 'cross-hatch' | 'dots' | 'dashed' | 'zigzag-line';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';

export interface HistoryState {
  past: DriplElement[][];
  future: DriplElement[][];
}

export interface CanvasSlice {
  elements: DriplElement[];
  elementsById: Map<string, DriplElement>;
  selectedIds: Set<string>;
  activeTool: ActiveTool;
  toolLocked: boolean;
  zoom: number;
  panX: number;
  panY: number;
  gridEnabled: boolean;
  gridSize: number;
  marqueeSelectionMode: 'intersecting' | 'contained';
  currentStrokeColor: string;
  currentBackgroundColor: string;
  currentStrokeWidth: number;
  currentRoughness: number;
  currentStrokeStyle: StrokeStyle;
  currentFillStyle: FillStyle;
  drawingLifecycle: DrawingLifecycle;
  draftElement: DriplElement | null;
  isEditingElementId: string | null;
  clipboard: DriplElement[];

  setElements: (elements: DriplElement[], options?: { skipHistory?: boolean }) => void;
  addElement: (element: DriplElement) => void;
  addElements: (elements: DriplElement[]) => void;
  updateElement: (id: string, updates: Partial<DriplElement>) => void;
  updateElementTransient: (id: string, updates: Partial<DriplElement>) => void;
  deleteElements: (ids: string[]) => void;
  bringForward: (ids: string[]) => void;
  sendBackward: (ids: string[]) => void;
  bringToFront: (ids: string[]) => void;
  sendToBack: (ids: string[]) => void;
  groupElements: (ids: string[]) => void;
  ungroupElements: (ids: string[]) => void;
  setSelectedIds: (ids: Set<string>) => void;
  selectElement: (id: string, addToSelection?: boolean) => void;
  clearSelection: () => void;
  setActiveTool: (tool: ActiveTool) => void;
  setToolLocked: (locked: boolean) => void;
  setCurrentStrokeColor: (color: string) => void;
  setCurrentBackgroundColor: (color: string) => void;
  setCurrentStrokeWidth: (width: number) => void;
  setCurrentRoughness: (roughness: number) => void;
  setCurrentStrokeStyle: (style: StrokeStyle) => void;
  setCurrentFillStyle: (style: FillStyle) => void;
  setDraftElement: (element: DriplElement | null) => void;
  updateDraftElement: (updates: Partial<DriplElement>) => void;
  commitDraft: () => DriplElement | null;
  setDrawingLifecycle: (lifecycle: DrawingLifecycle) => void;
  setEditingElementId: (id: string | null) => void;
  setZoom: (zoom: number) => void;
  setPan: (panX: number, panY: number) => void;
  setGridEnabled: (enabled: boolean) => void;
  setGridSize: (size: number) => void;
  setMarqueeSelectionMode: (mode: 'intersecting' | 'contained') => void;
  setClipboard: (elements: DriplElement[]) => void;
  clearClipboard: () => void;
}

export interface HistorySlice {
  past: DriplElement[][];
  future: DriplElement[][];
  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
  clearHistory: () => void;
}

export interface CollabSlice {
  roomId: string | null;
  roomSlug: string | null;
  isConnected: boolean;
  shouldLeaveRoom: boolean;
  readOnly: boolean;
  userId: string | null;
  remoteUsers: Map<string, RemoteUser>;
  remoteCursors: Map<string, RemoteCursor>;
  elementLocks: Map<string, string>;

  setRoomId: (roomId: string | null) => void;
  setRoomSlug: (roomSlug: string | null) => void;
  setIsConnected: (isConnected: boolean) => void;
  setShouldLeaveRoom: (should: boolean) => void;
  setReadOnly: (readOnly: boolean) => void;
  setUserId: (userId: string | null) => void;
  setRemoteUsers: (users: Map<string, RemoteUser>) => void;
  addRemoteUser: (user: RemoteUser) => void;
  removeRemoteUser: (userId: string) => void;
  updateRemoteCursor: (userId: string, cursor: Omit<RemoteCursor, 'updatedAt'>) => void;
  removeRemoteCursor: (userId: string) => void;
  setElementLock: (elementId: string, userId: string) => void;
  releaseElementLock: (elementId: string) => void;
  clearElementLocks: () => void;
}

export interface UiSlice {
  theme: Theme;
  fileId: string | null;
  fileName: string;
  isSaving: boolean;
  lastSaved: number | null;

  setTheme: (theme: Theme) => void;
  setFileMetadata: (fileId: string | null, fileName: string) => void;
  markSaving: (isSaving: boolean) => void;
  markSaved: () => void;
}

export type CanvasStoreState = CanvasSlice & HistorySlice & CollabSlice & UiSlice;
