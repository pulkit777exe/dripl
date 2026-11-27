import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/shallow';
import { useCanvasStore, type ActiveTool } from '@/lib/store';
import type { DriplElement } from '@dripl/common';
import { uploadImageToServer, loadImage } from '@/utils/tools/image';
import { v4 as uuidv4 } from 'uuid';
import type { ToolType } from '@/hooks/useDrawingTools';
import type { ToolStartOptions, ToolUpdateOptions } from '@/lib/draw/tool-state';
import {
  CanvasInteractionControllerImpl,
  CLICK_DRAG_THRESHOLD_PX,
  clickDragThresholdWorld,
  createInteractionState,
  type CanvasInteractionControllerDeps,
  type CanvasInteractionSnapshot,
  type CanvasInteractionViewState,
  type InteractionState,
} from '@/lib/canvas/interaction-controller';

export { CLICK_DRAG_THRESHOLD_PX, clickDragThresholdWorld, createInteractionState };
export type { InteractionState };

interface CanvasPointerEventsProps {
  readOnly: boolean;
  /** Container for client→canvas offsetting (pinch anchor, like the wheel path). */
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
  setDrawingState: (drawing: boolean) => void;
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

export function useCanvasPointerEvents({
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
}: CanvasPointerEventsProps) {
  const {
    setSelectedIds,
    setIsDragging,
    setIsPanning,
    setIsResizing,
    setIsRotating,
    setTextInput,
    setCursorPosition,
    setMarqueeSelection,
    setIsDrawing,
    setEraserPath,
    expandSelectionWithGroups,
    getSelectionBounds,
    setActiveTool,
    clearSelection,
    collectCascadeDeleteIds,
    deleteElements,
    setPan,
    setViewport,
    clearPendingEmbed,
  } = useCanvasStore(
    useShallow(state => ({
      setSelectedIds: state.setSelectedIds,
      setIsDragging: state.setIsDragging,
      setIsPanning: state.setIsPanning,
      setIsResizing: state.setIsResizing,
      setIsRotating: state.setIsRotating,
      setTextInput: state.setTextInput,
      setCursorPosition: state.setCursorPosition,
      setMarqueeSelection: state.setMarqueeSelection,
      setIsDrawing: state.setIsDrawing,
      setEraserPath: state.setEraserPath,
      expandSelectionWithGroups: state.expandSelectionWithGroups,
      getSelectionBounds: state.getSelectionBounds,
      setActiveTool: state.setActiveTool,
      clearSelection: state.clearSelection,
      collectCascadeDeleteIds: state.collectCascadeDeleteIds,
      deleteElements: state.deleteElements,
      setPan: state.setPan,
      setViewport: state.setViewport,
      clearPendingEmbed: state.clearPendingEmbed,
    }))
  );

  const depsRef = useRef<CanvasInteractionControllerDeps | null>(null);
  const buildDeps = useCallback(
    (): CanvasInteractionControllerDeps => ({
      readOnly,
      containerRef,
      getCanvasCoordinates,
      snapPointToGrid,
      store: {
        getSnapshot: snapshotFromStore,
        setSelectedIds,
        clearSelection,
        setIsDragging,
        setIsPanning,
        setIsResizing,
        setIsRotating,
        setIsDrawing,
        setTextInput: setTextInput as CanvasInteractionControllerDeps['store']['setTextInput'],
        setCursorPosition,
        setMarqueeSelection,
        setEraserPath: setEraserPath as CanvasInteractionControllerDeps['store']['setEraserPath'],
        setPan,
        setViewport,
        setActiveTool,
        setEditingElementId,
        expandSelectionWithGroups: expandSelectionWithGroups as CanvasInteractionControllerDeps['store']['expandSelectionWithGroups'],
        getSelectionBounds: getSelectionBounds as CanvasInteractionControllerDeps['store']['getSelectionBounds'],
        collectCascadeDeleteIds,
        deleteElements,
        pushHistory,
        clearPendingEmbed,
      },
      drawing: { startDrawing, updateDrawing, finishDrawing, cancelDrawing },
      collab: { broadcastCursor, lockElementsForGesture, unlockElement, unlockGestureElements },
      assets: {
        uploadImage: uploadImageToServer,
        loadImageDims: loadImage,
        makeId: uuidv4,
      },
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
    }),
    [
      readOnly,
      containerRef,
      getCanvasCoordinates,
      snapPointToGrid,
      setSelectedIds,
      clearSelection,
      setIsDragging,
      setIsPanning,
      setIsResizing,
      setIsRotating,
      setIsDrawing,
      setTextInput,
      setCursorPosition,
      setMarqueeSelection,
      setEraserPath,
      setPan,
      setViewport,
      setActiveTool,
      setEditingElementId,
      expandSelectionWithGroups,
      getSelectionBounds,
      collectCascadeDeleteIds,
      deleteElements,
      pushHistory,
      clearPendingEmbed,
      startDrawing,
      updateDrawing,
      finishDrawing,
      cancelDrawing,
      broadcastCursor,
      lockElementsForGesture,
      unlockElement,
      unlockGestureElements,
      getElementAtPosition,
      getElementsAtPosition,
      spatialIndex,
      addElement,
      updateElementTransient,
      updateElementsTransient,
      updateElement,
      maybeRevertToSelectTool,
      applyFrameGrouping,
    ]
  );

  const controllerRef = useRef<CanvasInteractionControllerImpl | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new CanvasInteractionControllerImpl(buildDeps());
  }
  depsRef.current = buildDeps();
  controllerRef.current.updateDeps(depsRef.current);

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

  return {
    interactionRef: controllerRef.current.interactionRef,
    lastToolBeforeSpaceRef: controllerRef.current.lastToolBeforeSpaceRef,
    eraserHitIdsRef: controllerRef.current.eraserHitIdsRef,
    hoveredBindingId: viewState.hoveredBindingId,
    startPointBindingId: viewState.startPointBindingId,
    handleDragOver: controllerRef.current.handlers.handleDragOver,
    handleDrop: controllerRef.current.handlers.handleDrop,
    handlePointerDown: controllerRef.current.handlers.handlePointerDown,
    handlePointerMove: controllerRef.current.handlers.handlePointerMove,
    handlePointerUp: controllerRef.current.handlers.handlePointerUp,
    cancelActiveGesture: controllerRef.current.cancelActiveGesture,
    controller: controllerRef.current,
  };
}
