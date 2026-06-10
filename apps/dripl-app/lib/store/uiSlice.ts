import type { StateCreator } from 'zustand';
import { clearAllShapeCache } from '@dripl/element/shape-cache';
import type { CanvasStoreState, UiSlice } from './types';

export const createUiSlice: StateCreator<CanvasStoreState, [], [], UiSlice> = (set) => ({
  theme: 'system',
  fileId: null,
  fileName: 'Untitled',
  isSaving: false,
  lastSaved: null,

  setTheme: theme => {
    clearAllShapeCache();
    set({ theme });
  },
  setFileMetadata: (fileId, fileName) => set({ fileId, fileName }),
  markSaving: isSaving => set({ isSaving }),
  markSaved: () => set({ isSaving: false, lastSaved: Date.now() }),
});
