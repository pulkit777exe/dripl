import React, { useMemo } from "react";
import { useCanvasColors, getReadableTextColor } from "../../theme";

export interface CanvasTextProps {
  x: number;
  y: number;
  text: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number | string;
  fontStyle?: "normal" | "italic";
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  color?: string;
  backgroundColor?: string;
  maxWidth?: number;
  lineHeight?: number;
  opacity?: number;
  rotation?: number;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export function CanvasText({
  x,
  y,
  text,
  fontSize = 16,
  fontFamily = "Inter, system-ui, sans-serif",
  fontWeight = 400,
  fontStyle = "normal",
  textAlign = "left",
  verticalAlign = "top",
  color,
  backgroundColor = "transparent",
  maxWidth,
  lineHeight = 1.25,
  opacity = 1,
  rotation = 0,
  className,
  style,
  children,
}: CanvasTextProps) {
  const colors = useCanvasColors();
  const isDark = colors.canvasBackground === "#1e1e1e";

  const textColor = useMemo(() => {
    if (color) {
      return color;
    }

    return getReadableTextColor(backgroundColor, isDark);
  }, [color, backgroundColor, isDark]);

  const anchorX = useMemo(() => {
    switch (textAlign) {
      case "center":
        return "middle";
      case "right":
        return "end";
      default:
        return "start";
    }
  }, [textAlign]);

  const dy = useMemo(() => {
    switch (verticalAlign) {
      case "middle":
        return "0.35em";
      case "bottom":
        return "0.7em";
      default:
        return "0.9em";
    }
  }, [verticalAlign]);

  const transform =
    rotation !== 0 ? `rotate(${rotation} ${x} ${y})` : undefined;

  return (
    <text
      x={x}
      y={y}
      fill={textColor}
      fontSize={fontSize}
      fontFamily={fontFamily}
      fontWeight={fontWeight}
      fontStyle={fontStyle}
      textAnchor={anchorX}
      dominantBaseline="auto"
      dy={dy}
      opacity={opacity}
      transform={transform}
      className={className}
      style={{
        userSelect: "none",
        pointerEvents: "none",
        ...style,
      }}
    >
      {children || text}
    </text>
  );
}

export function useCanvasTextStyles() {
  const colors = useCanvasColors();
  const isDark = colors.canvasBackground === "#1e1e1e";

  return useMemo(
    () => ({
      primary: {
        color: colors.textPrimary,
        fontSize: 16,
        fontFamily: "Inter, system-ui, sans-serif",
      },
      secondary: {
        color: colors.textSecondary,
        fontSize: 14,
        fontFamily: "Inter, system-ui, sans-serif",
      },
      muted: {
        color: colors.textMuted,
        fontSize: 12,
        fontFamily: "Inter, system-ui, sans-serif",
      },
      label: {
        color: colors.textPrimary,
        fontSize: 12,
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: 500,
      },
      heading: {
        color: colors.textPrimary,
        fontSize: 20,
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: 600,
      },
    }),
    [colors, isDark],
  );
}

export default CanvasText;
