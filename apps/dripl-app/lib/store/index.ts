import { create } from 'zustand';
import { initializeShapeRegistry } from '@/utils/shapes/shapeInitializer';
import type { CanvasStoreState } from './types';
import { createCanvasSlice } from './canvasSlice';
import { createHistorySlice } from './historySlice';
import { createCollabSlice } from './collabSlice';
import { createUiSlice } from './uiSlice';

initializeShapeRegistry();

export type { CanvasStoreState as CanvasState };
export type { RemoteUser, RemoteCursor, Theme, ActiveTool, DrawingLifecycle } from './helpers';
export type { FillStyle, StrokeStyle } from './helpers';

export const useCanvasStore = create<CanvasStoreState>()((...args) => ({
  ...createCanvasSlice(...args),
  ...createHistorySlice(...args),
  ...createCollabSlice(...args),
  ...createUiSlice(...args),
}));
