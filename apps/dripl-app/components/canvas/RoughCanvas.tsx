'use client';

import { useRef, useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { useShallow } from 'zustand/shallow';
import { selectEraserCursorPosition, useCanvasStore } from '@/lib/store';
import { getOrCreateCollaboratorName } from '@/utils/username';
import { useAuth } from '@/app/context/AuthContext';
import { MemoizedSelectionOverlay } from './SelectionOverlay';
import { MemoizedRemoteCursors } from './RemoteCursors';
import { LaserCanvas } from './LaserCanvas';
import DualCanvas from './DualCanvas';
import {
  CanvasContextMenuHost,
  ConnectionStatusBanner,
  EraserCursorRing,
  TextInputOverlay,
} from './CanvasOverlays';
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

const PropertiesPanel = lazy(() =>
  import('./PropertiesPanel').then(m => ({ default: m.PropertiesPanel }))
);
const NameInputModal = lazy(() =>
  import('./NameInputModal').then(m => ({ default: m.NameInputModal }))
);
const WelcomeScreen = lazy(() =>
  import('./WelcomeScreen').then(m => ({ default: m.WelcomeScreen }))
);

interface CanvasProps {
  roomSlug: string | null;
  theme: 'light' | 'dark';
  shareToken?: string | null;
}

export default function RoughCanvas({ roomSlug, theme, shareToken = null }: CanvasProps) {
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
  const [welcomeScreenDismissed, setWelcomeScreenDismissed] = useState(false);
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
  useCanvasPersistence({ roomSlug, theme, isDrawingRef, readOnly });

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
  } = useCanvasPointerEvents({
    readOnly,
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
  const shouldShowPropertiesPanel = activeTool === 'select' && selectedIds.size > 0; // RULE: Sidebar Visibility
  const primarySelectedElement = useMemo(
    () =>
      selectedIds.size > 0 ? (elements.find(element => selectedIds.has(element.id)) ?? null) : null,
    [elements, selectedIds]
  );

  perfMark('RoughCanvas:render:end');
  perfMeasure('RoughCanvas:render', 'RoughCanvas:render:start', 'RoughCanvas:render:end');

  return (
    <div
      ref={setContainerRef}
      className="canvas-surface relative w-full h-full"
      role="application"
      aria-label="Dripl drawing canvas"
      aria-describedby="dripl-canvas-instructions"
      tabIndex={0}
      onDragOver={handleDragOver}
      onDrop={hookHandleDrop}
      onContextMenu={openContextMenu}
      style={{ backgroundColor: canvasBackground ?? 'var(--color-canvas-bg)' }}
    >
      <p id="dripl-canvas-instructions" className="sr-only">
        Drawing canvas. Choose a tool from the toolbar. Press V for selection, R for a rectangle, or
        H for the hand tool. Hold Space to pan temporarily and press Escape to cancel the current
        gesture.
      </p>
      <ConnectionStatusBanner
        roomSlug={roomSlug}
        isConnected={isConnected}
        connectionMessage={connectionMessage}
        readOnly={readOnly}
      />
      {containerReady && (
        <DualCanvas
          containerRef={containerRef as React.RefObject<HTMLDivElement>}
          elements={elements}
          visibleElements={visibleElements}
          selectedIds={selectedIds}
          draftElement={draftElement}
          eraserPath={eraserPath}
          viewport={viewport}
          theme={theme}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          cursorPosition={cursorPosition}
          isDragging={isDragging}
          isResizing={isResizing}
          isDrawing={isDrawing}
          marqueeSelection={marqueeSelection}
          gridEnabled={gridEnabled}
          gridSize={gridSize}
          collaborators={collaboratorCursors}
          lockOwners={elementLocks}
          localUserId={userId}
          hoveredBindingId={hoveredBindingId}
          startPointBindingId={startPointBindingId}
          shouldCacheIgnoreZoom={shouldCacheIgnoreZoom}
          preservePointerSamples={activeTool === 'freedraw' || activeTool === 'eraser'}
        />
      )}

      <LaserCanvas />

      {!readOnly && (
        <MemoizedSelectionOverlay
          zoom={zoom}
          panX={panX}
          panY={panY}
          elements={elements}
          selectedIds={selectedIds}
          onResizeStart={handleResizeStart}
          onRotateStart={handleRotateStart}
          marqueeSelection={marqueeSelection}
        />
      )}

      <MemoizedRemoteCursors />

      {roomSlug === null && elements.length === 0 && !welcomeScreenDismissed && (
        <Suspense fallback={null}>
          <WelcomeScreen onClose={() => setWelcomeScreenDismissed(true)} />
        </Suspense>
      )}

      {!userName && roomSlug !== null && (
        <Suspense fallback={null}>
          <NameInputModal onSubmit={handleNameSubmit} />
        </Suspense>
      )}

      {shouldShowPropertiesPanel && !readOnly && (
        <div className="absolute top-20 left-4 z-20">
          <Suspense fallback={null}>
            <PropertiesPanel
              selectedElement={primarySelectedElement}
              onUpdateElement={updatedElement => {
                if (updatedElement.id) {
                  updateElement(updatedElement.id, updatedElement);
                }
              }}
              onDuplicateElement={duplicateSelection}
              onDeleteElement={() => {
                const ids = collectCascadeDeleteIdsCallback(
                  Array.from(useCanvasStore.getState().selectedIds)
                );
                deleteElements(ids);
                clearSelection();
              }}
            />
          </Suspense>
        </div>
      )}

      <TextInputOverlay
        textInput={textInput}
        readOnly={readOnly}
        zoom={zoom}
        panX={panX}
        panY={panY}
        onSubmit={handleTextSubmit}
      />

      <EraserCursorRing
        activeTool={activeTool}
        cursorPosition={cursorPosition}
        zoom={zoom}
        panX={panX}
        panY={panY}
      />

      <CanvasContextMenuHost
        contextMenuState={contextMenuState}
        readOnly={readOnly}
        elements={elements}
        onClose={() => setContextMenuState(null)}
        onDuplicate={duplicateSelection}
        onDelete={() => {
          const ids = Array.from(useCanvasStore.getState().selectedIds);
          deleteElements(collectCascadeDeleteIdsCallback(ids));
          clearSelection();
        }}
        onBringToFront={() => {
          const ids = Array.from(useCanvasStore.getState().selectedIds);
          bringToFront(ids);
        }}
        onSendToBack={() => {
          const ids = Array.from(useCanvasStore.getState().selectedIds);
          sendToBack(ids);
        }}
        onCopy={() => {
          void copySelectedToClipboard();
        }}
        onPaste={() => {
          void pasteFromClipboard();
        }}
        onCopyStyle={() => {
          copyElementStyle();
        }}
        onPasteStyle={() => {
          pasteElementStyle();
        }}
      />
    </div>
  );
}
