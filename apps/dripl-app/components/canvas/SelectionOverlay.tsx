import React from "react";
import { CanvasElement, Point } from "@/types/canvas";
import { getElementBounds } from "@/utils/canvasUtils";

interface SelectionOverlayProps {
  selectedIds: string[];
  elements: CanvasElement[];
  zoom: number;
  pan: Point;
  onResizeStart: (
    e: React.MouseEvent,
    handle: string,
    elementId: string
  ) => void;
  onRotateStart: (e: React.MouseEvent, elementId: string) => void;
}

export const SelectionOverlay: React.FC<SelectionOverlayProps> = ({
  selectedIds,
  elements,
  zoom,
  pan,
  onResizeStart,
  onRotateStart,
}) => {
  if (selectedIds.length === 0) return null;

  // For now, we only show handles for single selection
  // Multi-selection bounding box logic would go here
  if (selectedIds.length !== 1) return null;

  const element = elements.find((el) => el.id === selectedIds[0]);
  if (!element) return null;

  const bounds = getElementBounds(element);

  // Transform to screen coordinates
  const screenX = (bounds.x * zoom) / 100 + pan.x;
  const screenY = (bounds.y * zoom) / 100 + pan.y;
  const screenWidth = (bounds.width * zoom) / 100;
  const screenHeight = (bounds.height * zoom) / 100;
  const rotation = element.rotation || 0;

  const handleStyle =
    "absolute w-2.5 h-2.5 bg-white border border-[#a8a5ff] rounded-full z-10";

  return (
    <div
      className="absolute top-0 left-0 pointer-events-none"
      style={{
        transform: `translate(${screenX}px, ${screenY}px) rotate(${rotation}rad)`,
        width: screenWidth,
        height: screenHeight,
        transformOrigin: "center center",
      }}
    >
      {/* Selection Border */}
      <div className="absolute inset-0 border border-[#a8a5ff] pointer-events-none" />

      {/* Resize Handles */}
      <div className="pointer-events-auto">
        {/* Top Left */}
        <div
          className={`${handleStyle} -top-1.5 -left-1.5 cursor-nwse-resize`}
          onMouseDown={(e) => onResizeStart(e, "top-left", element.id)}
        />
        {/* Top */}
        <div
          className={`${handleStyle} -top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize`}
          onMouseDown={(e) => onResizeStart(e, "top", element.id)}
        />
        {/* Top Right */}
        <div
          className={`${handleStyle} -top-1.5 -right-1.5 cursor-nesw-resize`}
          onMouseDown={(e) => onResizeStart(e, "top-right", element.id)}
        />
        {/* Right */}
        <div
          className={`${handleStyle} top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize`}
          onMouseDown={(e) => onResizeStart(e, "right", element.id)}
        />
        {/* Bottom Right */}
        <div
          className={`${handleStyle} -bottom-1.5 -right-1.5 cursor-nwse-resize`}
          onMouseDown={(e) => onResizeStart(e, "bottom-right", element.id)}
        />
        {/* Bottom */}
        <div
          className={`${handleStyle} -bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize`}
          onMouseDown={(e) => onResizeStart(e, "bottom", element.id)}
        />
        {/* Bottom Left */}
        <div
          className={`${handleStyle} -bottom-1.5 -left-1.5 cursor-nesw-resize`}
          onMouseDown={(e) => onResizeStart(e, "bottom-left", element.id)}
        />
        {/* Left */}
        <div
          className={`${handleStyle} top-1/2 -left-1.5 -translate-y-1/2 cursor-ew-resize`}
          onMouseDown={(e) => onResizeStart(e, "left", element.id)}
        />

        {/* Rotation Handle */}
        <div
          className="absolute -top-8 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-white border border-[#a8a5ff] rounded-full cursor-move z-10"
          onMouseDown={(e) => onRotateStart(e, element.id)}
        />
      </div>
    </div>
  );
};
