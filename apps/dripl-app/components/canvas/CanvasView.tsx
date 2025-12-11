import React from "react";

interface CanvasViewProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  containerRef: React.RefObject<HTMLDivElement>;
  onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseUp: () => void;
  cursor?: string;
}

export const CanvasView: React.FC<CanvasViewProps> = ({
  canvasRef,
  containerRef,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  cursor = "default",
}) => {
  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-0 overflow-hidden bg-[#121212]"
      style={{ cursor }}
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
