import type { Theme } from "../theme/colors";

export type { Theme };

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ToolType =
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
  | "eraser"
  | "frame";

export type StrokeStyle = "solid" | "dashed" | "dotted";

export type FillStyle =
  | "hachure"
  | "solid"
  | "zigzag"
  | "cross-hatch"
  | "dots"
  | "dashed"
  | "zigzag-line";

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

export interface SelectionState {
  selectedIds: Set<string>;
  selectionStart: Point | null;
  selectionEnd: Point | null;
}

export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface DrawingStyle {
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  roughness: number;
  strokeStyle: StrokeStyle;
  fillStyle: FillStyle;
}

export interface HistoryState<T> {
  history: T[][];
  historyIndex: number;
}

export interface FileMetadata {
  fileId: string | null;
  fileName: string;
  isSaving: boolean;
  lastSaved: number | null;
}

export interface RoomState {
  roomId: string | null;
  roomSlug: string | null;
  isConnected: boolean;
  userId: string | null;
}

export interface CanvasAppState {
  theme: Theme;
  activeTool: ToolType;
  viewport: ViewportState;
  style: DrawingStyle;
  selection: SelectionState;
  room: RoomState;
  file: FileMetadata;
}

export const DEFAULT_VIEWPORT: ViewportState = {
  zoom: 1,
  panX: 0,
  panY: 0,
};

export const DEFAULT_DRAWING_STYLE: DrawingStyle = {
  strokeColor: "#1e1e1e", // Excalidraw default stroke color
  backgroundColor: "transparent",
  strokeWidth: 2,
  roughness: 1,
  strokeStyle: "solid",
  fillStyle: "hachure",
};

export const DEFAULT_SELECTION: SelectionState = {
  selectedIds: new Set(),
  selectionStart: null,
  selectionEnd: null,
};

export const DEFAULT_APP_STATE: CanvasAppState = {
  theme: "light",
  activeTool: "select",
  viewport: DEFAULT_VIEWPORT,
  style: DEFAULT_DRAWING_STYLE,
  selection: DEFAULT_SELECTION,
  room: {
    roomId: null,
    roomSlug: null,
    isConnected: false,
    userId: null,
  },
  file: {
    fileId: null,
    fileName: "Untitled",
    isSaving: false,
    lastSaved: null,
  },
};
