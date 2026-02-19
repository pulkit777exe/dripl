export interface Point {
  x: number;
  y: number;
}

import type { DriplElement } from "@dripl/common";
export type { DriplElement };

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
  | "ellipse"
  | "arrow"
  | "line"
  | "draw"
  | "text"
  | "image"
  | "frame"
  | "eraser";

export interface SelectionState {
  selectedIds: string[];
  selectionStart: Point | null;
  selectionEnd: Point | null;
}
