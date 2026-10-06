import { create } from 'zustand';
import type { CanvasStoreState } from './types';
import { createCanvasSlice } from './canvasSlice';
import { createHistorySlice } from './historySlice';
import { createCollabSlice } from './collabSlice';
import { createUiSlice } from './uiSlice';

export type { CanvasStoreState as CanvasState };
export type { CanvasTextInput } from './types';
export type { RemoteUser, RemoteCursor, Theme, ActiveTool, DrawingLifecycle } from './helpers';
export type { FillStyle, StrokeStyle } from './helpers';
export { selectEraserCursorPosition } from './selectors';

export const useCanvasStore = create<CanvasStoreState>()((...args) => ({
  ...createCanvasSlice(...args),
  ...createHistorySlice(...args),
  ...createCollabSlice(...args),
  ...createUiSlice(...args),
}));
