import type { StateCreator } from 'zustand';
import { clearAllShapeCache } from '@dripl/element/shape-cache';
import type { CanvasStoreState, UiSlice } from './types';

export const createUiSlice: StateCreator<CanvasStoreState, [], [], UiSlice> = (set) => ({
  theme: 'system',
  fileId: null,
  fileName: 'Untitled',
  isSaving: false,
  lastSaved: null,
  
  // UI state (moved from RoughCanvas local state)
  isDragging: false,
  isPanning: false,
  isResizing: false,
  isRotating: false,
  textInput: null,

  setTheme: theme => {
    clearAllShapeCache();
    set({ theme });
  },
  setFileMetadata: (fileId, fileName) => set({ fileId, fileName }),
  markSaving: isSaving => set({ isSaving }),
  markSaved: () => set({ isSaving: false, lastSaved: Date.now() }),
  
  // UI state setters
  setIsDragging: isDragging => set({ isDragging }),
  setIsPanning: isPanning => set({ isPanning }),
  setIsResizing: isResizing => set({ isResizing }),
  setIsRotating: isRotating => set({ isRotating }),
  setTextInput: textInput => set({ textInput }),
});
