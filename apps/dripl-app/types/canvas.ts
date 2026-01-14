export interface Point {
  x: number;
  y: number;
}

export interface CanvasElement {
  id: string;
  type:
    | "rectangle"
    | "circle"
    | "diamond"
    | "arrow"
    | "line"
    | "freedraw"
    | "text"
    | "ellipse"
    | "image";
  x: number;
  y: number;
  width: number;
  height: number;

  strokeColor: string;
  strokeWidth: number;
  strokeStyle: "solid" | "dashed" | "dotted";

  backgroundColor: string;
  fillStyle?: "solid" | "hachure" | "cross-hatch";

  opacity: number;
  roughness: number;
  roundness: number | { type: number };
  rotation?: number;
  angle?: number;

  text?: string;
  fontSize?: number;
  fontFamily?: string;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";

  points?: Point[];

  seed?: number;
  version?: number;
  versionNonce?: number;
  isDeleted?: boolean;
  groupIds?: string[];
  frameId?: string | null;
  boundElements?: Array<{ id: string; type: string }>;
  updated?: number;
  link?: string | null;
  locked?: boolean;
  index?: string;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AppState {
  showWelcomeScreen: boolean;
  theme: string;
  currentChartType: string;
  currentItemBackgroundColor: string;
  currentItemEndArrowhead: string;
  currentItemFillStyle: string;
  currentItemFontFamily: number;
  currentItemFontSize: number;
  currentItemOpacity: number;
  currentItemRoughness: number;
  currentItemRoundness: string;
  currentItemStartArrowhead: string | null;
  currentItemStrokeColor: string;
  currentItemStrokeStyle: string;
  currentItemStrokeWidth: number;
  currentItemTextAlign: string;
  cursorButton: string;
  editingGroupId: string | null;
  exportBackground: boolean;
  exportEmbedScene: boolean;
  exportScale: number;
  exportWithDarkMode: boolean;
  gridModeEnabled: boolean;
  gridSize: number;
  name: string;
  objectsSnapModeEnabled: boolean;
  scrollX: number;
  scrollY: number;
  scrolledOutside: boolean;
  selectedElementIds: Record<string, boolean>;
  viewBackgroundColor: string;
  zenModeEnabled: boolean;
  zoom: { value: number };
  activeTool: {
    type: string;
    customType: string | null;
    locked: boolean;
    lastActiveTool: string | null;
  };
}

export type ToolType =
  | "select"
  | "hand"
  | "rectangle"
  | "diamond"
  | "circle"
  | "arrow"
  | "line"
  | "draw"
  | "text"
  | "image"
  | "eraser";

export interface SelectionState {
  selectedIds: string[];
  selectionStart: Point | null;
  selectionEnd: Point | null;
}
