import { Store } from '@tanstack/store';
import { DriplElement } from '@dripl/common';

export interface CanvasState {
  elements: DriplElement[];
  selectedIds: string[];
  tool: string;
}

export const canvasStore = new Store<CanvasState>({
  elements: [],
  selectedIds: [],
  tool: 'selection',
});

export const addElement = (element: DriplElement) => {
  canvasStore.setState((state) => ({
    ...state,
    elements: [...state.elements, element],
  }));
};
