"use client";

import { useCanvasStore } from "@/lib/canvas-store";
import { DriplElement } from "@dripl/common";
import { memo } from "react";

interface SelectionOverlayProps {
  zoom: number;
  panX: number;
  panY: number;
  onResizeStart: (handle: ResizeHandle, e: React.PointerEvent) => void;
  onRotateStart: (e: React.PointerEvent) => void;
}

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLE_SIZE = 8;

export const SelectionOverlay = memo(function SelectionOverlay({
  zoom,
  panX,
  panY,
  onResizeStart,
  onRotateStart,
}: SelectionOverlayProps) {
  const elements = useCanvasStore((state) => state.elements);
  const selectedIds = useCanvasStore((state) => state.selectedIds);

  if (selectedIds.size === 0) return null;

  // Calculate bounding box of selection
  const selectedElements = elements.filter((el) => selectedIds.has(el.id));
  if (selectedElements.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  selectedElements.forEach((el) => {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    const width = "width" in el ? el.width : 0;
    const height = "height" in el ? el.height : 0;
    maxX = Math.max(maxX, el.x + width);
    maxY = Math.max(maxY, el.y + height);
  });

  const x = minX * zoom + panX;
  const y = minY * zoom + panY;
  const w = (maxX - minX) * zoom;
  const h = (maxY - minY) * zoom;

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
      className="absolute top-0 left-0 pointer-events-none"
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
});
