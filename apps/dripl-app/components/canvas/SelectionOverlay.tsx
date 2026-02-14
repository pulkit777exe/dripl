"use client";

import { useCanvasStore } from "@/lib/canvas-store";
import { DriplElement, Point } from "@dripl/common";
import { getElementBounds } from "@dripl/math";
import { Bounds } from "@dripl/math";

interface SelectionOverlayProps {
  zoom: number;
  panX: number;
  panY: number;
  onResizeStart: (handle: ResizeHandle, e: React.PointerEvent) => void;
  onRotateStart: (e: React.PointerEvent) => void;
  marqueeSelection?: { start: Point; end: Point; active: boolean } | null;
}

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLE_SIZE = 8;

export function SelectionOverlay({
  zoom,
  panX,
  panY,
  onResizeStart,
  onRotateStart,
  marqueeSelection,
}: SelectionOverlayProps) {
  const elements = useCanvasStore((state) => state.elements);
  const selectedIds = useCanvasStore((state) => state.selectedIds);

  // Render marquee selection if active
  if (marqueeSelection?.active) {
    const x =
      Math.min(marqueeSelection.start.x, marqueeSelection.end.x) * zoom + panX;
    const y =
      Math.min(marqueeSelection.start.y, marqueeSelection.end.y) * zoom + panY;
    const w =
      Math.abs(marqueeSelection.end.x - marqueeSelection.start.x) * zoom;
    const h =
      Math.abs(marqueeSelection.end.y - marqueeSelection.start.y) * zoom;

    return (
      <div
        className="absolute top-0 left-0 pointer-events-none"
        style={{
          transform: `translate(${x}px, ${y}px)`,
          width: w,
          height: h,
          border: "2px dashed #6965db",
          backgroundColor: "rgba(105, 101, 219, 0.1)",
          zIndex: 10,
        }}
      />
    );
  }

  if (selectedIds.size === 0) return null;

  // Calculate bounding box of selection using proper bounds calculation
  const selectedElements = elements.filter((el) => selectedIds.has(el.id));
  if (selectedElements.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  selectedElements.forEach((el) => {
    const bounds = getElementBounds(el);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  });

  const SELECTION_PADDING = 4;
  const x = minX * zoom + panX - SELECTION_PADDING;
  const y = minY * zoom + panY - SELECTION_PADDING;
  const w = (maxX - minX) * zoom + SELECTION_PADDING * 2;
  const h = (maxY - minY) * zoom + SELECTION_PADDING * 2;

  // Rotation (only for single element)
  const angle =
    selectedElements.length === 1 ? selectedElements[0]?.angle || 0 : 0;

  // Only show handles for single selection for now
  const showHandles = selectedElements.length === 1;

  const handleStyle = (cursor: string): React.CSSProperties => ({
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    backgroundColor: "white",
    border: "1px solid #6965db",
    position: "absolute",
    cursor: `${cursor}-resize`,
    pointerEvents: "auto",
    zIndex: 20,
    boxSizing: "border-box", // Ensure border doesn't add to size
  });

  return (
    <div
      className="absolute top-0 left-0 pointer-events-none transition-all duration-150 ease-out"
      style={{
        transform: `translate(${x}px, ${y}px) rotate(${angle}rad)`,
        width: w,
        height: h,
        border: "1px solid #6965db",
        zIndex: 10,
        transformOrigin: "center center",
      }}
    >
      {showHandles && (
        <>
          {/* Corners */}
          <div
            style={{ ...handleStyle("nw"), top: -4, left: -4 }}
            onPointerDown={(e) => onResizeStart("nw", e)}
          />
          <div
            style={{ ...handleStyle("ne"), top: -4, right: -4 }}
            onPointerDown={(e) => onResizeStart("ne", e)}
          />
          <div
            style={{ ...handleStyle("se"), bottom: -4, right: -4 }}
            onPointerDown={(e) => onResizeStart("se", e)}
          />
          <div
            style={{ ...handleStyle("sw"), bottom: -4, left: -4 }}
            onPointerDown={(e) => onResizeStart("sw", e)}
          />

          {/* Sides */}
          <div
            style={{
              ...handleStyle("n"),
              top: -4,
              left: "50%",
              transform: "translateX(-50%)",
            }}
            onPointerDown={(e) => onResizeStart("n", e)}
          />
          <div
            style={{
              ...handleStyle("e"),
              top: "50%",
              right: -4,
              transform: "translateY(-50%)",
            }}
            onPointerDown={(e) => onResizeStart("e", e)}
          />
          <div
            style={{
              ...handleStyle("s"),
              bottom: -4,
              left: "50%",
              transform: "translateX(-50%)",
            }}
            onPointerDown={(e) => onResizeStart("s", e)}
          />
          <div
            style={{
              ...handleStyle("w"),
              top: "50%",
              left: -4,
              transform: "translateY(-50%)",
            }}
            onPointerDown={(e) => onResizeStart("w", e)}
          />

          {/* Rotation Handle */}
          <div
            style={{
              width: HANDLE_SIZE,
              height: HANDLE_SIZE,
              backgroundColor: "white",
              border: "1px solid #6965db",
              borderRadius: "50%",
              position: "absolute",
              top: -24,
              left: "50%",
              transform: "translateX(-50%)",
              cursor: "move",
              pointerEvents: "auto",
              zIndex: 20,
            }}
            onPointerDown={onRotateStart}
          />
        </>
      )}
    </div>
  );
}
