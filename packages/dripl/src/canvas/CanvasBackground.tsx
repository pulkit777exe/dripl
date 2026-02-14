import * as React from "react";
import { cn } from "../lib/utils";

interface CanvasBackgroundProps {
  gridSize?: number;
  dotSize?: number;
  className?: string;
}

export const CanvasBackground = ({
  gridSize = 20,
  dotSize = 1,
  className,
}: CanvasBackgroundProps) => {
  return (
    <div
      className={cn(
        "absolute inset-0 pointer-events-none opacity-40",
        className,
      )}
      style={{
        backgroundImage: `radial-gradient(circle, currentColor ${dotSize}px, transparent ${dotSize}px)`,
        backgroundSize: `${gridSize}px ${gridSize}px`,
      }}
    />
  );
};
