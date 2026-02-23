import React, { useMemo } from "react";
import { useCanvasColors } from "../../theme";

export interface ElementBoundsProps {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  isSelected?: boolean;
  isHovered?: boolean;
  isEditing?: boolean;
  showHandles?: boolean;
  handleSize?: number;
  strokeStyle?: "solid" | "dashed";
  onHandleMouseDown?: (handle: HandlePosition, e: React.MouseEvent) => void;
}

export type HandlePosition =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "rotation";

export function ElementBounds({
  x,
  y,
  width,
  height,
  rotation = 0,
  isSelected = false,
  isHovered = false,
  isEditing = false,
  showHandles = true,
  handleSize = 8,
  strokeStyle = "solid",
  onHandleMouseDown,
}: ElementBoundsProps) {
  const colors = useCanvasColors();

  const strokeColor = useMemo(() => {
    if (isSelected) return colors.selectionStroke;
    if (isHovered) return colors.hoverStroke;
    return "transparent";
  }, [isSelected, isHovered, colors]);

  const fillColor = useMemo(() => {
    if (isSelected) return colors.selectionFill;
    if (isHovered) return colors.hoverFill;
    return "transparent";
  }, [isSelected, isHovered, colors]);

  const handleFillColor = colors.canvasBackground;
  const handleStrokeColor = colors.selectionStroke;

  const handles = useMemo(() => {
    if (!showHandles || !isSelected) return [];

    const halfHandle = handleSize / 2;
    const handles: { position: HandlePosition; x: number; y: number }[] = [];

    handles.push({ position: "nw", x: x - halfHandle, y: y - halfHandle });
    handles.push({
      position: "ne",
      x: x + width - halfHandle,
      y: y - halfHandle,
    });
    handles.push({
      position: "se",
      x: x + width - halfHandle,
      y: y + height - halfHandle,
    });
    handles.push({
      position: "sw",
      x: x - halfHandle,
      y: y + height - halfHandle,
    });

    if (!isEditing) {
      handles.push({
        position: "n",
        x: x + width / 2 - halfHandle,
        y: y - halfHandle,
      });
      handles.push({
        position: "e",
        x: x + width - halfHandle,
        y: y + height / 2 - halfHandle,
      });
      handles.push({
        position: "s",
        x: x + width / 2 - halfHandle,
        y: y + height - halfHandle,
      });
      handles.push({
        position: "w",
        x: x - halfHandle,
        y: y + height / 2 - halfHandle,
      });
    }

    return handles;
  }, [showHandles, isSelected, isEditing, x, y, width, height, handleSize]);

  const transform =
    rotation !== 0
      ? `rotate(${rotation} ${x + width / 2} ${y + height / 2})`
      : undefined;

  return (
    <g transform={transform}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={1}
        strokeDasharray={strokeStyle === "dashed" ? "5,5" : undefined}
        style={{ pointerEvents: "none" }}
      />

      {handles.map((handle) => (
        <rect
          key={handle.position}
          x={handle.x}
          y={handle.y}
          width={handleSize}
          height={handleSize}
          fill={handleFillColor}
          stroke={handleStrokeColor}
          strokeWidth={1}
          style={{
            cursor: getCursorForHandle(handle.position, rotation),
            pointerEvents: "auto",
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            onHandleMouseDown?.(handle.position, e);
          }}
        />
      ))}
    </g>
  );
}

function getCursorForHandle(
  position: HandlePosition,
  rotation: number,
): string {
  const cursors: Record<HandlePosition, string> = {
    nw: "nwse-resize",
    se: "nwse-resize",
    ne: "nesw-resize",
    sw: "nesw-resize",
    n: "ns-resize",
    s: "ns-resize",
    e: "ew-resize",
    w: "ew-resize",
    rotation: "grab",
  };

  return cursors[position];
}

export function useElementBounds(
  elements: Array<{ x: number; y: number; width: number; height: number }>,
) {
  return useMemo(() => {
    if (elements.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const el of elements) {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.width);
      maxY = Math.max(maxY, el.y + el.height);
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }, [elements]);
}

export default ElementBounds;
