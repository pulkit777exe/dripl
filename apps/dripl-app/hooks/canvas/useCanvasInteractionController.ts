'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/shallow';
import { useCanvasStore, type ActiveTool } from '@/lib/store';
import type { DriplElement } from '@dripl/common';
import { uploadImageToServer, loadImage } from '@/utils/tools/image';
import { v4 as uuidv4 } from 'uuid';
import type { ToolType } from '@/hooks/useDrawingTools';
import type { ToolStartOptions, ToolUpdateOptions } from '@/lib/draw/tool-state';
import {
  CanvasInteractionControllerImpl,
  type CanvasInteractionController,
  type CanvasInteractionControllerDeps,
  type CanvasInteractionSnapshot,
} from '@/lib/canvas/interaction-controller';

export interface UseCanvasInteractionControllerProps {
  readOnly: boolean;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  getCanvasCoordinates: (e: React.PointerEvent | React.DragEvent) => { x: number; y: number };
  snapPointToGrid: (point: { x: number; y: number }) => { x: number; y: number };
  broadcastCursor: (x: number, y: number) => void;
  addElement: (element: DriplElement) => void;
  getElementAtPosition: (x: number, y: number) => DriplElement | null | undefined;
  getElementsAtPosition: (x: number, y: number) => DriplElement[];
  updateElementTransient: (id: string, element: DriplElement) => void;
  updateElementsTransient: (updates: ReadonlyMap<string, Partial<DriplElement>>) => void;
  updateElement: (id: string, updates: Partial<DriplElement>) => void;
  pushHistory: () => void;
  lockElementsForGesture: (ids: Iterable<string>) => void;
  unlockElement: (id: string) => void;
  unlockGestureElements: () => void;
  setEditingElementId: (id: string | null) => void;
  startDrawing: (
    point: { x: number; y: number },
    tool: ToolType,
    options: ToolStartOptions,
    baseProps: {
      strokeColor: string;
      backgroundColor: string;
      strokeWidth: number;
      opacity: number;
      roughness: number;
      strokeStyle: 'solid' | 'dashed' | 'dotted';
      fillStyle: 'hachure' | 'solid' | 'zigzag' | 'cross-hatch' | 'dots' | 'dashed' | 'zigzag-line';
      arrowStyle?: 'straight' | 'curved' | 'elbow';
    },
    elements?: DriplElement[]
  ) => void;
  updateDrawing: (
    point: { x: number; y: number },
    options: ToolUpdateOptions,
    elements: DriplElement[]
  ) => void;
  maybeRevertToSelectTool: (tool: ActiveTool) => void;
  finishDrawing: () => DriplElement | null;
  cancelDrawing: () => void;
  applyFrameGrouping: (frameElement: DriplElement) => void;
  spatialIndex: {
    tree: {
      search: (bbox: {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
      }) => Array<{ id: string }>;
    };
    byId: Map<string, DriplElement>;
  };
}

function snapshotFromStore(): CanvasInteractionSnapshot {
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

export function useCanvasInteractionController({
  readOnly,
  containerRef,
  getCanvasCoordinates,
  snapPointToGrid,
  broadcastCursor,
  addElement,
  getElementAtPosition,
  getElementsAtPosition,
  updateElementTransient,
  updateElementsTransient,
  updateElement,
  pushHistory,
  lockElementsForGesture,
  unlockElement,
  unlockGestureElements,
  setEditingElementId,
  startDrawing,
  updateDrawing,
  maybeRevertToSelectTool,
  finishDrawing,
  cancelDrawing,
  applyFrameGrouping,
  spatialIndex,
}: UseCanvasInteractionControllerProps): CanvasInteractionController & {
  viewState: { hoveredBindingId: string | null; startPointBindingId: string | null };
} {
  const storeActions = useCanvasStore(
    useShallow(state => ({
      setSelectedIds: state.setSelectedIds,
      clearSelection: state.clearSelection,
      setIsDragging: state.setIsDragging,
      setIsPanning: state.setIsPanning,
      setIsResizing: state.setIsResizing,
      setIsRotating: state.setIsRotating,
      setIsDrawing: state.setIsDrawing,
      setTextInput: state.setTextInput,
      setCursorPosition: state.setCursorPosition,
      setMarqueeSelection: state.setMarqueeSelection,
      setEraserPath: state.setEraserPath,
      setPan: state.setPan,
      setViewport: state.setViewport,
      setActiveTool: state.setActiveTool,
      expandSelectionWithGroups: state.expandSelectionWithGroups,
      getSelectionBounds: state.getSelectionBounds,
      collectCascadeDeleteIds: state.collectCascadeDeleteIds,
      deleteElements: state.deleteElements,
      clearPendingEmbed: state.clearPendingEmbed,
    }))
  );

  const controllerRef = useRef<CanvasInteractionControllerImpl | null>(null);
  if (!controllerRef.current) {
    // Placeholder deps; updated immediately below.
    controllerRef.current = new CanvasInteractionControllerImpl({
      readOnly,
      containerRef,
      getCanvasCoordinates,
      snapPointToGrid,
      store: {
        getSnapshot: snapshotFromStore,
        setSelectedIds: storeActions.setSelectedIds,
        clearSelection: storeActions.clearSelection,
        setIsDragging: storeActions.setIsDragging,
        setIsPanning: storeActions.setIsPanning,
        setIsResizing: storeActions.setIsResizing,
        setIsRotating: storeActions.setIsRotating,
        setIsDrawing: storeActions.setIsDrawing,
        setTextInput: storeActions.setTextInput as CanvasInteractionControllerDeps['store']['setTextInput'],
        setCursorPosition: storeActions.setCursorPosition,
        setMarqueeSelection: storeActions.setMarqueeSelection,
        setEraserPath: storeActions.setEraserPath as CanvasInteractionControllerDeps['store']['setEraserPath'],
        setPan: storeActions.setPan,
        setViewport: storeActions.setViewport,
        setActiveTool: storeActions.setActiveTool,
        setEditingElementId,
        expandSelectionWithGroups: storeActions.expandSelectionWithGroups as CanvasInteractionControllerDeps['store']['expandSelectionWithGroups'],
        getSelectionBounds: storeActions.getSelectionBounds as CanvasInteractionControllerDeps['store']['getSelectionBounds'],
        collectCascadeDeleteIds: storeActions.collectCascadeDeleteIds,
        deleteElements: storeActions.deleteElements,
        pushHistory,
        clearPendingEmbed: storeActions.clearPendingEmbed,
      },
      drawing: { startDrawing, updateDrawing, finishDrawing, cancelDrawing },
      collab: { broadcastCursor, lockElementsForGesture, unlockElement, unlockGestureElements },
      assets: { uploadImage: uploadImageToServer, loadImageDims: loadImage, makeId: uuidv4 },
      env: {
        now: () => Date.now(),
        requestFrame: (cb) => requestAnimationFrame(cb),
        cancelFrame: (id) => cancelAnimationFrame(id),
        hasAnimationFrame: () => typeof requestAnimationFrame !== 'undefined',
        dispatchEvent: (event) => window.dispatchEvent(event),
      },
      hitTest: { getElementAtPosition, getElementsAtPosition, spatialIndex },
      addElement,
      updateElementTransient,
      updateElementsTransient,
      updateElement,
      maybeRevertToSelectTool,
      applyFrameGrouping,
    });
  }

  controllerRef.current.updateDeps({
    readOnly,
    containerRef,
    getCanvasCoordinates,
    snapPointToGrid,
    store: {
      getSnapshot: snapshotFromStore,
      setSelectedIds: storeActions.setSelectedIds,
      clearSelection: storeActions.clearSelection,
      setIsDragging: storeActions.setIsDragging,
      setIsPanning: storeActions.setIsPanning,
      setIsResizing: storeActions.setIsResizing,
      setIsRotating: storeActions.setIsRotating,
      setIsDrawing: storeActions.setIsDrawing,
      setTextInput: storeActions.setTextInput as CanvasInteractionControllerDeps['store']['setTextInput'],
      setCursorPosition: storeActions.setCursorPosition,
      setMarqueeSelection: storeActions.setMarqueeSelection,
      setEraserPath: storeActions.setEraserPath as CanvasInteractionControllerDeps['store']['setEraserPath'],
      setPan: storeActions.setPan,
      setViewport: storeActions.setViewport,
      setActiveTool: storeActions.setActiveTool,
      setEditingElementId,
      expandSelectionWithGroups: storeActions.expandSelectionWithGroups as CanvasInteractionControllerDeps['store']['expandSelectionWithGroups'],
      getSelectionBounds: storeActions.getSelectionBounds as CanvasInteractionControllerDeps['store']['getSelectionBounds'],
      collectCascadeDeleteIds: storeActions.collectCascadeDeleteIds,
      deleteElements: storeActions.deleteElements,
      pushHistory,
      clearPendingEmbed: storeActions.clearPendingEmbed,
    },
    drawing: { startDrawing, updateDrawing, finishDrawing, cancelDrawing },
    collab: { broadcastCursor, lockElementsForGesture, unlockElement, unlockGestureElements },
    assets: { uploadImage: uploadImageToServer, loadImageDims: loadImage, makeId: uuidv4 },
    env: {
      now: () => Date.now(),
      requestFrame: (cb) => requestAnimationFrame(cb),
      cancelFrame: (id) => cancelAnimationFrame(id),
      hasAnimationFrame: () => typeof requestAnimationFrame !== 'undefined',
      dispatchEvent: (event) => window.dispatchEvent(event),
    },
    hitTest: { getElementAtPosition, getElementsAtPosition, spatialIndex },
    addElement,
    updateElementTransient,
    updateElementsTransient,
    updateElement,
    maybeRevertToSelectTool,
    applyFrameGrouping,
  });

  useEffect(() => {
    return () => {
      controllerRef.current?.dispose();
    };
  }, []);

  const viewState = useSyncExternalStore(
    (listener) => controllerRef.current!.subscribeViewState(listener),
    () => controllerRef.current!.getViewState(),
    () => controllerRef.current!.getViewState()
  );

  const c = controllerRef.current;
  return {
    handlers: c.handlers,
    getViewState: c.getViewState.bind(c),
    subscribeViewState: c.subscribeViewState.bind(c),
    cancelActiveGesture: c.cancelActiveGesture,
    setSpacePressed: c.setSpacePressed.bind(c),
    beginResize: c.beginResize,
    beginRotate: c.beginRotate,
    dispose: c.dispose.bind(c),
    state: c.state,
    interactionRef: c.interactionRef,
    eraserHitIdsRef: c.eraserHitIdsRef,
    lastToolBeforeSpaceRef: c.lastToolBeforeSpaceRef,
    viewState,
  };
}
