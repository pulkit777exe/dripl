'use client';

import React from 'react';
import StaticCanvas from './StaticCanvas';
import InteractiveCanvas from './InteractiveCanvas';
import { CanvasErrorBoundary } from './CanvasErrorBoundary';
import type { DriplElement, Point } from '@dripl/common';
import type { Viewport } from '@/utils/canvas-coordinates';
import type { CollaboratorCursor } from '@/renderer/interactiveScene';

interface DualCanvasProps {
  containerRef: React.RefObject<HTMLDivElement>;
  elements: DriplElement[];
  selectedIds: Set<string>;
  /** The in-progress draft element. NOT part of elements[]. */
  draftElement: DriplElement | null;
  eraserPath: Point[];
  viewport: Viewport;
  theme?: 'light' | 'dark';
  onPointerDown?: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove?: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp?: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  cursorPosition?: Point | null;
  isDragging?: boolean;
  isResizing?: boolean;
  isDrawing?: boolean;
  marqueeSelection?: {
    start: Point;
    end: Point;
    active: boolean;
  } | null;
  gridEnabled?: boolean;
  gridSize?: number;
  collaborators?: CollaboratorCursor[];
  lockOwners?: ReadonlyMap<string, string>;
  localUserId?: string | null;
  hoveredBindingId?: string | null;
  startPointBindingId?: string | null;
  shouldCacheIgnoreZoom?: boolean;
}

/**
 * DualCanvas — stacked canvas architecture matching Excalidraw's pattern.
 *
 * StaticCanvas (z-1, pointer-events: none):
 *   Renders committed scene elements. Only re-renders when elements,
 *   viewport, grid, or theme change. Pointer events fall through.
 *
 * InteractiveCanvas (z-2, pointer-events: auto):
 *   Renders selection boxes, draft elements, cursors, marquee.
 *   Receives all pointer events for user interaction.
 *
 * This separation ensures panning/zooming only touches the interactive
 * canvas, while expensive element rendering is isolated to the static layer.
 */
const DualCanvas: React.FC<DualCanvasProps> = ({
  containerRef,
  elements,
  selectedIds,
  draftElement,
  eraserPath,
  viewport,
  theme = 'dark',
  onPointerDown,
  onPointerMove,
  onPointerUp,
  cursorPosition,
  isDragging,
  isResizing,
  isDrawing,
  marqueeSelection,
  gridEnabled = false,
  gridSize = 20,
  collaborators = [],
  lockOwners = new Map<string, string>(),
  localUserId = null,
  hoveredBindingId,
  startPointBindingId,
  shouldCacheIgnoreZoom = false,
}) => {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
      }}
    >
      {/* Static layer — committed elements only, no pointer events */}
      <CanvasErrorBoundary name="StaticCanvas">
        <StaticCanvas
          containerRef={containerRef}
          elements={elements}
          selectedIds={selectedIds}
          viewport={viewport}
          gridEnabled={gridEnabled}
          gridSize={gridSize}
          theme={theme}
          shouldCacheIgnoreZoom={shouldCacheIgnoreZoom}
        />
      </CanvasErrorBoundary>

      {/* Interactive layer — selection, cursors, draft, receives pointer events */}
      <CanvasErrorBoundary name="InteractiveCanvas">
        <InteractiveCanvas
          containerRef={containerRef}
          elements={elements}
          selectedIds={selectedIds}
          draftElement={draftElement}
          eraserPath={eraserPath}
          viewport={viewport}
          theme={theme}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          cursorPosition={cursorPosition}
          isDragging={isDragging}
          isResizing={isResizing}
          isDrawing={isDrawing}
          marqueeSelection={marqueeSelection}
          collaborators={collaborators}
          lockOwners={lockOwners}
          localUserId={localUserId}
          hoveredBindingId={hoveredBindingId}
          startPointBindingId={startPointBindingId}
        />
      </CanvasErrorBoundary>
    </div>
  );
};

/**
 * Memoize DualCanvas to prevent re-renders when props haven't changed.
 * The child canvases (StaticCanvas, InteractiveCanvas) have their own
 * React.memo with surgical equality checks, so they skip rendering
 * even when DualCanvas re-renders but their specific props are unchanged.
 */
const areEqual = (prev: DualCanvasProps, next: DualCanvasProps): boolean => {
  return (
    prev.elements === next.elements &&
    prev.selectedIds === next.selectedIds &&
    prev.draftElement === next.draftElement &&
    prev.eraserPath === next.eraserPath &&
    prev.viewport === next.viewport &&
    prev.theme === next.theme &&
    prev.onPointerDown === next.onPointerDown &&
    prev.onPointerMove === next.onPointerMove &&
    prev.onPointerUp === next.onPointerUp &&
    prev.cursorPosition === next.cursorPosition &&
    prev.isDragging === next.isDragging &&
    prev.isResizing === next.isResizing &&
    prev.isDrawing === next.isDrawing &&
    prev.marqueeSelection === next.marqueeSelection &&
    prev.gridEnabled === next.gridEnabled &&
    prev.gridSize === next.gridSize &&
    prev.collaborators === next.collaborators &&
    prev.lockOwners === next.lockOwners &&
    prev.localUserId === next.localUserId &&
    prev.hoveredBindingId === next.hoveredBindingId &&
    prev.startPointBindingId === next.startPointBindingId &&
    prev.shouldCacheIgnoreZoom === next.shouldCacheIgnoreZoom
  );
};

export default React.memo(DualCanvas, areEqual);
