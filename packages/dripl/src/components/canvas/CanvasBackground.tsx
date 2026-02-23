import React, { useMemo } from "react";
import { useCanvasColors } from "../../theme";

export interface CanvasBackgroundProps {
  width: number;
  height: number;
  showGrid?: boolean;
  gridSize?: number;
  className?: string;
}

export function CanvasBackground({
  width,
  height,
  showGrid = true,
  gridSize = 20,
  className = "",
}: CanvasBackgroundProps) {
  const colors = useCanvasColors();

  const gridPattern = useMemo(() => {
    if (!showGrid) return null;

    const gridColor = colors.gridLines;
    const svgContent = `
      <svg width="${gridSize}" height="${gridSize}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="${gridSize}" height="${gridSize}" patternUnits="userSpaceOnUse">
            <path d="M ${gridSize} 0 L 0 0 0 ${gridSize}" fill="none" stroke="${gridColor}" stroke-width="0.5"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
    `;

    return `data:image/svg+xml;base64,${btoa(svgContent)}`;
  }, [showGrid, gridSize, colors.gridLines]);

  return (
    <div
      className={`canvas-background ${className}`}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        backgroundColor: colors.canvasBackground,
        backgroundImage: gridPattern ? `url(${gridPattern})` : "none",
        backgroundPosition: "0 0",
        touchAction: "none",
      }}
    />
  );
}

export default CanvasBackground;
