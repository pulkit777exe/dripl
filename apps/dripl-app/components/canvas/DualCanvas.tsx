'use client';

import React from 'react';
import StaticCanvas from './StaticCanvas';
import InteractiveCanvas from './InteractiveCanvas';
import type { DriplElement, Point } from '@dripl/common';
import { Viewport } from '@/utils/canvas-coordinates';
import type { CollaboratorCursor } from '@/renderer/interactiveScene';

interface CanvasErrorBoundaryProps {
  name: string;
  children: React.ReactNode;
}

interface CanvasErrorBoundaryState {
  hasError: boolean;
}

class CanvasErrorBoundary extends React.Component<CanvasErrorBoundaryProps, CanvasErrorBoundaryState> {
  state: CanvasErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): CanvasErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.name}] render error:`, error);
  }

  render() {
    if (this.state.hasError) {
      return null; // Gracefully hide the failed canvas layer
    }
    return this.props.children;
  }
}

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
}

export function DualCanvas({
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
}: DualCanvasProps) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
      }}
    >
      <CanvasErrorBoundary name="StaticCanvas">
        <StaticCanvas
          containerRef={containerRef}
          elements={elements}
          selectedIds={selectedIds}
          viewport={viewport}
          gridEnabled={gridEnabled}
          gridSize={gridSize}
          theme={theme}
        />
      </CanvasErrorBoundary>

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
        />
      </CanvasErrorBoundary>
    </div>
  );
}

export default DualCanvas;
