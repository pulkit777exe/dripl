import { useCanvasStore, type ActiveTool } from '@/lib/store';
import type { DriplElement } from '@dripl/common';
import { uploadImageToServer, loadImage } from '@/utils/tools/image';
import { v4 as uuidv4 } from 'uuid';
import type {
  CanvasInteractionAssetPort,
  CanvasInteractionEnvPort,
  CanvasInteractionSnapshot,
  CanvasInteractionStorePort,
} from './interaction-controller';

export function createCanvasInteractionStoreSnapshot(): CanvasInteractionSnapshot {
  const s = useCanvasStore.getState();
  return {
    elements: s.elements,
    elementsById: s.elementsById,
    selectedIds: s.selectedIds,
    activeTool: s.activeTool,
    isDrawing: s.isDrawing,
    zoom: s.zoom,
    panX: s.panX,
    panY: s.panY,
    marqueeSelection: s.marqueeSelection,
    marqueeSelectionMode: s.marqueeSelectionMode,
    elementLocks: s.elementLocks,
    userId: s.userId,
    gridEnabled: s.gridEnabled,
    gridSize: s.gridSize,
    isEditingElementId: s.isEditingElementId,
    draftElement: s.draftElement,
    currentStrokeColor: s.currentStrokeColor,
    currentBackgroundColor: s.currentBackgroundColor,
    currentStrokeWidth: s.currentStrokeWidth,
    currentRoughness: s.currentRoughness,
    currentStrokeStyle: s.currentStrokeStyle,
    currentFillStyle: s.currentFillStyle,
    currentArrowStyle: s.currentArrowStyle,
  };
}

/**
 * Production Zustand-backed store adapter. Composed once per controller and
 * reads/writes through the store's current state/actions.
 */
export class CanvasInteractionStoreAdapter implements CanvasInteractionStorePort {
  getSnapshot(): CanvasInteractionSnapshot {
    return createCanvasInteractionStoreSnapshot();
  }
  setSelectedIds(ids: Set<string>): void { useCanvasStore.getState().setSelectedIds(ids); }
  clearSelection(): void { useCanvasStore.getState().clearSelection(); }
  setIsDragging(active: boolean): void { useCanvasStore.getState().setIsDragging(active); }
  setIsPanning(active: boolean): void { useCanvasStore.getState().setIsPanning(active); }
  setIsResizing(active: boolean): void { useCanvasStore.getState().setIsResizing(active); }
  setIsRotating(active: boolean): void { useCanvasStore.getState().setIsRotating(active); }
  setIsDrawing(active: boolean): void { useCanvasStore.getState().setIsDrawing(active); }
  setTextInput(state: { x: number; y: number; id: string; value?: string; existingElementId?: string } | null): void {
    useCanvasStore.getState().setTextInput(state);
  }
  setCursorPosition(pos: { x: number; y: number } | null): void { useCanvasStore.getState().setCursorPosition(pos); }
  setMarqueeSelection(selection: { start: { x: number; y: number }; end: { x: number; y: number }; active: boolean } | null): void {
    useCanvasStore.getState().setMarqueeSelection(selection);
  }
  setEraserPath(path: Array<{ x: number; y: number }> | ((prev: Array<{ x: number; y: number }>) => Array<{ x: number; y: number }>)): void {
    useCanvasStore.getState().setEraserPath(path as never);
  }
  setPan(x: number, y: number): void { useCanvasStore.getState().setPan(x, y); }
  setViewport(zoom: number, panX: number, panY: number): void { useCanvasStore.getState().setViewport(zoom, panX, panY); }
  setActiveTool(tool: ActiveTool): void { useCanvasStore.getState().setActiveTool(tool); }
  setEditingElementId(id: string | null): void { useCanvasStore.getState().setEditingElementId(id); }
  expandSelectionWithGroups(ids: Set<string>, elements: readonly DriplElement[]): Set<string> {
    return useCanvasStore.getState().expandSelectionWithGroups(ids, elements as DriplElement[]);
  }
  getSelectionBounds(selectedIds: ReadonlySet<string>, elements: readonly DriplElement[]) {
    return useCanvasStore.getState().getSelectionBounds(selectedIds as Set<string>, elements as DriplElement[]);
  }
  collectCascadeDeleteIds(ids: Iterable<string>): string[] {
    return useCanvasStore.getState().collectCascadeDeleteIds(ids);
  }
  deleteElements(ids: string[], options?: { skipHistory?: boolean }): void {
    useCanvasStore.getState().deleteElements(ids, options);
  }
  pushHistory(): void { useCanvasStore.getState().pushHistory(); }
  clearPendingEmbed(): void { useCanvasStore.getState().clearPendingEmbed(); }
}

export const defaultCanvasInteractionAssets: CanvasInteractionAssetPort = {
  uploadImage: uploadImageToServer,
  loadImageDims: loadImage,
  makeId: uuidv4,
};

export const browserCanvasInteractionEnv: CanvasInteractionEnvPort = {
  now: () => Date.now(),
  requestFrame: (cb) => requestAnimationFrame(cb),
  cancelFrame: (id) => cancelAnimationFrame(id),
  hasAnimationFrame: () => typeof requestAnimationFrame !== 'undefined',
  dispatchEvent: (event) => window.dispatchEvent(event),
};
