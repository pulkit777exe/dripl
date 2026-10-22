'use client';

import { lazy, Suspense, useState } from 'react';
import type React from 'react';
import type { DriplElement, Point } from '@dripl/common';
import type { CollaboratorCursor } from '@/renderer/interactiveScene';
import type { CanvasTextInput, ActiveTool } from '@/lib/store';
import type { ContextMenuState } from '@/hooks/canvas/useContextMenu';
import type { ResizeHandle } from './SelectionOverlay';
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

const PropertiesPanel = lazy(() =>
  import('./PropertiesPanel').then(m => ({ default: m.PropertiesPanel }))
);
const NameInputModal = lazy(() =>
  import('./NameInputModal').then(m => ({ default: m.NameInputModal }))
);
const WelcomeScreen = lazy(() =>
  import('./WelcomeScreen').then(m => ({ default: m.WelcomeScreen }))
);

/**
 * The editor's UI layer. This is deliberately presentation-only: it owns
 * transient UI visibility, while `RoughCanvas` owns scene, interaction and
 * collaboration wiring. Keeping this boundary mirrors Excalidraw's LayerUI
 * and prevents canvas mechanics from leaking into modal/overlay markup.
 */
export interface CanvasLayerUIProps {
  containerRef: React.RefObject<HTMLDivElement>;
  containerReady: boolean;
  setContainerRef: (element: HTMLDivElement | null) => void;
  backgroundColor: string;
  roomSlug: string | null;
  theme: 'light' | 'dark';
  isLocalCanvas: boolean;
  elements: DriplElement[];
  visibleElements: readonly DriplElement[];
  selectedIds: Set<string>;
  draftElement: DriplElement | null;
  eraserPath: Point[];
  viewport: { x: number; y: number; width: number; height: number; zoom: number };
  activeTool: ActiveTool;
  readOnly: boolean;
  gridEnabled: boolean;
  gridSize: number;
  shouldCacheIgnoreZoom: boolean;
  cursorPosition: Point | null;
  isDrawing: boolean;
  isDragging: boolean;
  isResizing: boolean;
  marqueeSelection: { start: Point; end: Point; active: boolean } | null;
  collaborators: CollaboratorCursor[];
  elementLocks: ReadonlyMap<string, string>;
  userId: string | null;
  userName: string | null;
  isConnected: boolean;
  connectionMessage: string;
  textInput: CanvasTextInput | null;
  canvasCursor: string;
  hoveredBindingId: string | null;
  startPointBindingId: string | null;
  contextMenuState: ContextMenuState | null;
  primarySelectedElement: DriplElement | null;
  onDragOver: React.DragEventHandler<HTMLDivElement>;
  onDrop: React.DragEventHandler<HTMLDivElement>;
  onContextMenu: React.MouseEventHandler<HTMLDivElement>;
  onPointerDown: React.PointerEventHandler<HTMLCanvasElement>;
  onPointerMove: React.PointerEventHandler<HTMLCanvasElement>;
  onPointerUp: React.PointerEventHandler<HTMLCanvasElement>;
  onPointerCancel: React.PointerEventHandler<HTMLCanvasElement>;
  onResizeStart: (handle: ResizeHandle, event: React.PointerEvent) => void;
  onRotateStart: (event: React.PointerEvent) => void;
  onTextSubmit: (text: string) => void;
  onNameSubmit: (name: string) => void;
  onUpdateElement: (element: DriplElement) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onCopyStyle: () => void;
  onPasteStyle: () => void;
  onCloseContextMenu: () => void;
}

export function CanvasLayerUI({
  containerRef,
  containerReady,
  setContainerRef,
  backgroundColor,
  roomSlug,
  theme,
  isLocalCanvas,
  elements,
  visibleElements,
  selectedIds,
  draftElement,
  eraserPath,
  viewport,
  activeTool,
  readOnly,
  gridEnabled,
  gridSize,
  shouldCacheIgnoreZoom,
  cursorPosition,
  isDrawing,
  isDragging,
  isResizing,
  marqueeSelection,
  collaborators,
  elementLocks,
  userId,
  userName,
  isConnected,
  connectionMessage,
  textInput,
  canvasCursor,
  hoveredBindingId,
  startPointBindingId,
  contextMenuState,
  primarySelectedElement,
  onDragOver,
  onDrop,
  onContextMenu,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onResizeStart,
  onRotateStart,
  onTextSubmit,
  onNameSubmit,
  onUpdateElement,
  onDuplicate,
  onDelete,
  onBringToFront,
  onSendToBack,
  onCopy,
  onPaste,
  onCopyStyle,
  onPasteStyle,
  onCloseContextMenu,
}: CanvasLayerUIProps) {
  const [welcomeScreenDismissed, setWelcomeScreenDismissed] = useState(false);

  return (
    <div
      ref={setContainerRef}
      className="canvas-surface relative w-full h-full"
      role="application"
      aria-label="Dripl drawing canvas"
      aria-describedby="dripl-canvas-instructions"
      tabIndex={0}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
      style={{ backgroundColor }}
    >
      <p id="dripl-canvas-instructions" className="sr-only">
        Drawing canvas. Choose a tool from the toolbar. Press V for selection, R for a rectangle, or
        H for the hand tool. Hold Space to pan temporarily and press Escape to cancel the current
        gesture.
      </p>
      <ConnectionStatusBanner {...{ roomSlug, isConnected, connectionMessage, readOnly }} />
      {containerReady && (
        <DualCanvas
          {...{
            containerRef,
            elements,
            visibleElements,
            selectedIds,
            draftElement,
            eraserPath,
            viewport,
            theme,
            gridEnabled,
            gridSize,
            collaborators,
            lockOwners: elementLocks,
            localUserId: userId,
            hoveredBindingId,
            startPointBindingId,
            shouldCacheIgnoreZoom,
            isDrawing,
            isDragging,
            isResizing,
            marqueeSelection,
            cursorPosition,
            cursor: canvasCursor,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          preservePointerSamples={activeTool === 'freedraw' || activeTool === 'eraser'}
        />
      )}
      <LaserCanvas />
      {!readOnly && (
        <MemoizedSelectionOverlay
          zoom={viewport.zoom}
          panX={viewport.x}
          panY={viewport.y}
          {...{ elements, selectedIds, marqueeSelection }}
          onResizeStart={onResizeStart}
          onRotateStart={onRotateStart}
        />
      )}
      <MemoizedRemoteCursors />
      {isLocalCanvas && elements.length === 0 && !welcomeScreenDismissed && (
        <Suspense fallback={null}>
          <WelcomeScreen onClose={() => setWelcomeScreenDismissed(true)} />
        </Suspense>
      )}
      {!userName && roomSlug !== null && (
        <Suspense fallback={null}>
          <NameInputModal onSubmit={onNameSubmit} />
        </Suspense>
      )}
      {activeTool === 'select' && selectedIds.size > 0 && !readOnly && (
        <div className="absolute top-20 left-4 z-20">
          <Suspense fallback={null}>
            <PropertiesPanel
              selectedElement={primarySelectedElement}
              onUpdateElement={onUpdateElement}
              onDuplicateElement={onDuplicate}
              onDeleteElement={onDelete}
            />
          </Suspense>
        </div>
      )}
      <TextInputOverlay
        textInput={textInput}
        readOnly={readOnly}
        zoom={viewport.zoom}
        panX={viewport.x}
        panY={viewport.y}
        onSubmit={onTextSubmit}
      />
      <EraserCursorRing
        activeTool={activeTool}
        cursorPosition={cursorPosition}
        zoom={viewport.zoom}
        panX={viewport.x}
        panY={viewport.y}
      />
      <CanvasContextMenuHost
        contextMenuState={contextMenuState}
        readOnly={readOnly}
        elements={elements}
        onClose={onCloseContextMenu}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        onBringToFront={onBringToFront}
        onSendToBack={onSendToBack}
        onCopy={onCopy}
        onPaste={onPaste}
        onCopyStyle={onCopyStyle}
        onPasteStyle={onPasteStyle}
      />
    </div>
  );
}
