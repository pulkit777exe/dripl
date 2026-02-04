import React from "react";

interface CanvasViewProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  containerRef: React.RefObject<HTMLDivElement>;
  onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseUp: () => void;
  cursor?: string;
  theme?: "light" | "dark";
}

export const CanvasView: React.FC<CanvasViewProps> = ({
  canvasRef,
  containerRef,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  cursor = "default",
  theme = "dark",
}) => {
  const canvasBg = theme === "dark" ? "#121212" : "#f8f9fa";
  
  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-0 overflow-hidden"
      style={{ 
        cursor,
        backgroundColor: canvasBg
      }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        className="block touch-none"
      />
    </div>
  );
};
