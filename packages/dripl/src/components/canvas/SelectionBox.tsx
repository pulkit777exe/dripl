import React, { useMemo } from "react";
import { useCanvasColors } from "../../theme";

export interface SelectionBoxProps {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  strokeWidth?: number;
  strokeStyle?: "solid" | "dashed";
  dashOffset?: number;
  dashArray?: string;
  opacity?: number;
  fill?: string;
  stroke?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function SelectionBox({
  x,
  y,
  width,
  height,
  rotation = 0,
  strokeWidth = 1,
  strokeStyle = "dashed",
  dashOffset = 0,
  dashArray = "5,5",
  opacity = 1,
  fill,
  stroke,
  className,
  style,
}: SelectionBoxProps) {
  const colors = useCanvasColors();

  const fillColor = fill ?? colors.selectionFill;
  const strokeColor = stroke ?? colors.selectionStroke;

  const transform =
    rotation !== 0
      ? `rotate(${rotation} ${x + width / 2} ${y + height / 2})`
      : undefined;

  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill={fillColor}
      stroke={strokeColor}
      strokeWidth={strokeWidth}
      strokeDasharray={strokeStyle === "dashed" ? dashArray : undefined}
      strokeDashoffset={dashOffset}
      opacity={opacity}
      transform={transform}
      className={className}
      style={{
        pointerEvents: "none",
        ...style,
      }}
    />
  );
}

export interface SelectionBoxWithHandlesProps extends SelectionBoxProps {
  handleSize?: number;
  handleFill?: string;
  handleStroke?: string;
  showHandles?: boolean;
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

export function SelectionBoxWithHandles({
  x,
  y,
  width,
  height,
  rotation = 0,
  handleSize = 8,
  handleFill,
  handleStroke,
  showHandles = true,
  onHandleMouseDown,
  ...props
}: SelectionBoxWithHandlesProps) {
  const colors = useCanvasColors();

  const handleFillColor = handleFill ?? colors.canvasBackground;
  const handleStrokeColor = handleStroke ?? colors.selectionStroke;

  const handles = useMemo(() => {
    if (!showHandles) return [];

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

    return handles;
  }, [showHandles, x, y, width, height, handleSize]);

  return (
    <g>
      <SelectionBox
        x={x}
        y={y}
        width={width}
        height={width}
        rotation={rotation}
        {...props}
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
          style={{ cursor: getCursorForHandle(handle.position, rotation) }}
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
  const normalizedRotation = ((rotation % 360) + 360) % 360;

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

export default SelectionBox;
