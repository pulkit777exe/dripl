"use client";

import React from "react";
import StaticCanvas from "./StaticCanvas";
import InteractiveCanvas from "./InteractiveCanvas";
import type { DriplElement, Point } from "@dripl/common";
import { Viewport } from "@/utils/canvas-coordinates";

interface DualCanvasProps {
  containerRef: React.RefObject<HTMLDivElement>;
  elements: DriplElement[];
  selectedIds: Set<string>;
  currentPreview: DriplElement | null;
  eraserPath: Point[];
  viewport: Viewport;
  theme?: "light" | "dark";
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
}

export function DualCanvas({
  containerRef,
  elements,
  selectedIds,
  currentPreview,
  eraserPath,
  viewport,
  theme = "dark",
  onPointerDown,
  onPointerMove,
  onPointerUp,
  cursorPosition,
  isDragging,
  isResizing,
  isDrawing,
  marqueeSelection,
}: DualCanvasProps) {
  // Make sure containerRef has current before rendering
  if (!containerRef || !containerRef.current) {
    return null;
  }

  return (
    <div className="absolute inset-0">
      <StaticCanvas
        containerRef={containerRef}
        elements={elements}
        selectedIds={selectedIds}
        viewport={viewport}
        theme={theme}
      />

      <InteractiveCanvas
        containerRef={containerRef}
        elements={elements}
        selectedIds={selectedIds}
        currentPreview={currentPreview}
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
      />
    </div>
  );
}

export default DualCanvas;
