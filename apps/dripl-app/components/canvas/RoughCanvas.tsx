'use client';

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import { selectEraserCursorPosition, useCanvasStore } from '@/lib/store';
import { getOrCreateCollaboratorName } from '@/utils/username';
import { useAuth } from '@/app/context/AuthContext';
import { CanvasLayerUI } from './CanvasLayerUI';
import { Viewport } from '@/utils/canvas-coordinates';
import { useDrawingTools } from '@/hooks/useDrawingTools';
import { useCanvasPersistence } from '@/hooks/canvas/useCanvasPersistence';
import { perfMark, perfMeasure } from '@/utils/performance';
import { useCanvasViewport } from '@/hooks/canvas/useCanvasViewport';
import { useSpatialIndex } from '@/hooks/canvas/useSpatialIndex';
import { useCanvasClipboard } from '@/hooks/canvas/useCanvasClipboard';
import { useCanvasPointerEvents } from '@/hooks/canvas/useCanvasPointerEvents';
import { useCanvasKeyboard } from '@/hooks/canvas/useCanvasKeyboard';
import { useCanvasWheel } from '@/hooks/canvas/useCanvasWheel';
import { useHitTesting } from '@/hooks/canvas/useHitTesting';
import { useCanvasSync } from '@/hooks/canvas/useCanvasSync';
import { useContainerSize } from '@/hooks/canvas/useContainerSize';
import { useCanvasCoordinates } from '@/hooks/canvas/useCanvasCoordinates';
import { useCanvasActions } from '@/hooks/canvas/useCanvasActions';
import { useTransformStart } from '@/hooks/canvas/useTransformStart';
import { useContextMenu } from '@/hooks/canvas/useContextMenu';
import { useStyleTransfer } from '@/hooks/canvas/useStyleTransfer';
import { resolveCanvasBackground } from '@/lib/canvas/background';

interface CanvasProps {
  roomSlug: string | null;
  theme: 'light' | 'dark';
  shareToken?: string | null;
  /**
   * True only for the unscoped scratch canvas at `/canvas`.
   *
   * Rooms and saved files must not inherit local-canvas behaviour: a file page
   * has `roomSlug === null`, so using that as the local-mode signal made it
   * overwrite the scratch canvas and show local onboarding over saved files.
   */
  isLocalCanvas?: boolean;
}

export default function RoughCanvas({
  roomSlug,
  theme,
  shareToken = null,
  isLocalCanvas = false,
}: CanvasProps) {
  perfMark('RoughCanvas:render:start');
  const { containerRef, containerReady, containerSize, setContainerRef } = useContainerSize();

  const { user } = useAuth();
  const [userName, setUserName] = useState<string | null>(
    () => user?.name?.trim() || getOrCreateCollaboratorName()
  );

  const isDrawing = useCanvasStore(s => s.isDrawing);
  const isDrawingRef = useRef(false);
  const isDragging = useCanvasStore(s => s.isDragging);
  const isResizing = useCanvasStore(s => s.isResizing);
  const textInput = useCanvasStore(s => s.textInput);
  const eraserPath = useCanvasStore(state => state.eraserPath);
  // Tracked only while the eraser is the active tool — see
  // `selectEraserCursorPosition` for why that is a performance property and not a
  // convenience, and for why it is a named export rather than a ternary inlined here.
  const cursorPosition = useCanvasStore(selectEraserCursorPosition);
  const marqueeSelection = useCanvasStore(state => state.marqueeSelection);

  const setDrawingState = useCallback((next: boolean) => {
    isDrawingRef.current = next;
    useCanvasStore.getState().setIsDrawing(next);
  }, []);

  const { startDrawing, updateDrawing, finishDrawing, cancelDrawing } = useDrawingTools();

  const elements = useCanvasStore(useShallow(state => state.elements));
  // draftElement lives in Zustand — the single source of truth for the in-progress shape.
  const draftElement = useCanvasStore(state => state.draftElement);
  const activeTool = useCanvasStore(state => state.activeTool);
  const selectedIds = useCanvasStore(useShallow(state => state.selectedIds));
  const readOnly = useCanvasStore(state => state.readOnly);
  const gridEnabled = useCanvasStore(state => state.gridEnabled);
  const gridSize = useCanvasStore(state => state.gridSize);
  const canvasBackground = useCanvasStore(state => state.canvasBackground);
  const elementLocks = useCanvasStore(state => state.elementLocks);
  const userId = useCanvasStore(state => state.userId);
  const shouldCacheIgnoreZoom = useCanvasStore(state => state.shouldCacheIgnoreZoom);

  const addElement = useCanvasStore(state => state.addElement);
  const updateElement = useCanvasStore(state => state.updateElement);
  const updateElementTransient = useCanvasStore(state => state.updateElementTransient);
  const updateElementsTransient = useCanvasStore(state => state.updateElementsTransient);
  const deleteElements = useCanvasStore(state => state.deleteElements);
  const setSelectedIds = useCanvasStore(state => state.setSelectedIds);
  const clearSelection = useCanvasStore(state => state.clearSelection);
  const setEditingElementId = useCanvasStore(state => state.setEditingElementId);
  const bringToFront = useCanvasStore(state => state.bringToFront);
  const sendToBack = useCanvasStore(state => state.sendToBack);
  const pushHistory = useCanvasStore(state => state.pushHistory);

  const zoom = useCanvasStore(state => state.zoom);
  const panX = useCanvasStore(state => state.panX);
  const panY = useCanvasStore(state => state.panY);

  // ── Collaboration sync (locks, tombstones, broadcast) ────────────────────
  const {
    lockElementsForGesture,
    unlockGestureElements,
    collaborators,
    broadcastCursor,
    unlockElement,
    isConnected,
    connectionMessage,
  } = useCanvasSync({ roomSlug, shareToken, displayName: userName, elements });

  // ── Persist local canvas ─────────────────────────────────────────────────
  useCanvasPersistence({ isLocalCanvas, theme, isDrawingRef, readOnly });

  useEffect(() => {
    const stored = getOrCreateCollaboratorName();
    setUserName(stored);
  }, []);

  const handleNameSubmit = (name: string) => {
    setUserName(name);
    localStorage.setItem('dripl_username', name);
  };

  // ── Viewport ─────────────────────────────────────────────────────────────
  const viewport: Viewport = useMemo(
    () => ({
      x: panX,
      y: panY,
      width: containerSize.width,
      height: containerSize.height,
      zoom,
    }),
    [panX, panY, containerSize.width, containerSize.height, zoom]
  );

  const { fitAllToScreen, fitElementsToScreen } = useCanvasViewport(containerRef);

  // Listen for dripl:fit-elements event (dispatched by AI generation modal)
  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ elementIds: string[] }>;
      if (customEvent.detail?.elementIds?.length) {
        fitElementsToScreen(customEvent.detail.elementIds);
      }
    };
    window.addEventListener('dripl:fit-elements', handler);
    return () => window.removeEventListener('dripl:fit-elements', handler);
  }, [fitElementsToScreen]);

  // ── Clipboard ────────────────────────────────────────────────────────────
  const { duplicateSelection, copySelectedToClipboard, pasteFromClipboard, findOnCanvas } =
    useCanvasClipboard();

  const { spatialIndex, visibleElements } = useSpatialIndex(elements, viewport);

  // ── Coordinate helpers ────────────────────────────────────────────────────
  const { getCanvasCoordinates, snapPointToGrid } = useCanvasCoordinates({
    containerRef,
    viewport,
    gridEnabled,
    gridSize,
  });

  const { getElementAtPosition, getElementsAtPosition } = useHitTesting(spatialIndex);

  // ── Canvas actions (ActionManager-lite) ────────────────────────────────────
  const {
    collectCascadeDeleteIdsCallback,
    maybeRevertToSelectTool,
    applyFrameGrouping,
    handleTextSubmit,
  } = useCanvasActions({ elements });

  const { copyElementStyle, pasteElementStyle } = useStyleTransfer();

  // ── Pointer events hook ──────────────────────────────────────────────────
  const {
    interactionRef,
    lastToolBeforeSpaceRef,
    hoveredBindingId,
    startPointBindingId,
    handleDragOver,
    handleDrop: hookHandleDrop,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    cancelActiveGesture,
  } = useCanvasPointerEvents({
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
    setDrawingState,
    maybeRevertToSelectTool,
    finishDrawing,
    cancelDrawing,
    applyFrameGrouping,
    spatialIndex,
  });

  // Legacy createElement is removed — all element creation goes through
  // useDrawingTools (startDrawing → updateDrawing → finishDrawing → commitDraft).

  // ── Resize / rotate gesture entry ──────────────────────────────────────────
  const { handleResizeStart, handleRotateStart } = useTransformStart({
    interactionRef,
    containerRef,
    readOnly,
    getCanvasCoordinates,
    lockElementsForGesture,
    unlockGestureElements,
    setEditingElementId,
  });

  // ── Context menu ───────────────────────────────────────────────────────────
  const { contextMenuState, setContextMenuState, openContextMenu } = useContextMenu({
    readOnly,
    viewport,
    getElementAtPosition,
    selectedIds,
    setSelectedIds,
  });

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useCanvasKeyboard({
    interactionRef,
    lastToolBeforeSpaceRef,
    activeTool,
    readOnly,
    cancelActiveGesture,
    setTextInput: useCanvasStore.getState().setTextInput as (
      state: { x: number; y: number; id: string; value?: string; existingElementId?: string } | null
    ) => void,
    setDrawingState,
    cancelDrawing,
    collectCascadeDeleteIds: collectCascadeDeleteIdsCallback,
    copySelectedToClipboard,
    pasteFromClipboard,
    duplicateSelection,
    findOnCanvas,
    fitAllToScreen,
    copyElementStyle,
    pasteElementStyle,
  });

  // ── Mouse wheel zoom & momentum ───────────────────────────────────────
  useCanvasWheel({ containerRef, containerReady });

  const collaboratorCursors = collaborators;
  const isPanning = useCanvasStore(state => state.isPanning);
  // Per-tool surface cursor (Excalidraw parity): crosshair for creation
  // tools, text for text, grab for hand, none where a custom ring/trail
  // replaces the pointer (eraser ring, laser trail).
  const canvasCursor = useMemo(() => {
    if (isPanning) return 'grabbing';
    switch (activeTool) {
      case 'hand':
        return 'grab';
      case 'text':
        return 'text';
      case 'eraser':
        return 'none';
      case 'laser':
        return 'crosshair';
      case 'select':
        return 'default';
      default:
        return 'crosshair';
    }
  }, [activeTool, isPanning]);
  const primarySelectedElement = useMemo(
    () =>
      selectedIds.size > 0 ? (elements.find(element => selectedIds.has(element.id)) ?? null) : null,
    [elements, selectedIds]
  );

  perfMark('RoughCanvas:render:end');
  perfMeasure('RoughCanvas:render', 'RoughCanvas:render:start', 'RoughCanvas:render:end');

  const deleteSelection = () => {
    const ids = collectCascadeDeleteIdsCallback(Array.from(useCanvasStore.getState().selectedIds));
    deleteElements(ids);
    clearSelection();
  };

  return (
    <CanvasLayerUI
      containerRef={containerRef as React.RefObject<HTMLDivElement>}
      containerReady={containerReady}
      setContainerRef={setContainerRef}
      backgroundColor={
        canvasBackground
          ? resolveCanvasBackground(canvasBackground, theme)
          : 'var(--color-canvas-bg)'
      }
      roomSlug={roomSlug}
      theme={theme}
      isLocalCanvas={isLocalCanvas}
      elements={elements}
      visibleElements={visibleElements}
      selectedIds={selectedIds}
      draftElement={draftElement}
      eraserPath={eraserPath}
      viewport={viewport}
      activeTool={activeTool}
      readOnly={readOnly}
      gridEnabled={gridEnabled}
      gridSize={gridSize}
      shouldCacheIgnoreZoom={shouldCacheIgnoreZoom}
      cursorPosition={cursorPosition}
      isDrawing={isDrawing}
      isDragging={isDragging}
      isResizing={isResizing}
      marqueeSelection={marqueeSelection}
      collaborators={collaboratorCursors}
      elementLocks={elementLocks}
      userId={userId}
      userName={userName}
      isConnected={isConnected}
      connectionMessage={connectionMessage}
      textInput={textInput}
      canvasCursor={canvasCursor}
      hoveredBindingId={hoveredBindingId}
      startPointBindingId={startPointBindingId}
      contextMenuState={contextMenuState}
      primarySelectedElement={primarySelectedElement}
      onDragOver={handleDragOver}
      onDrop={hookHandleDrop}
      onContextMenu={openContextMenu}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={cancelActiveGesture}
      onResizeStart={handleResizeStart}
      onRotateStart={handleRotateStart}
      onTextSubmit={handleTextSubmit}
      onNameSubmit={handleNameSubmit}
      onUpdateElement={element => updateElement(element.id, element)}
      onDuplicate={duplicateSelection}
      onDelete={deleteSelection}
      onBringToFront={() => bringToFront(Array.from(useCanvasStore.getState().selectedIds))}
      onSendToBack={() => sendToBack(Array.from(useCanvasStore.getState().selectedIds))}
      onCopy={() => void copySelectedToClipboard()}
      onPaste={() => void pasteFromClipboard()}
      onCopyStyle={copyElementStyle}
      onPasteStyle={pasteElementStyle}
      onCloseContextMenu={() => setContextMenuState(null)}
    />
  );
}
