"use client";

import { useEffect, useRef, useState } from "react";
import { canvasStore } from "@dripl/state";
import { renderElement } from "@dripl/element";
import { useCanvas } from "@/hooks/useCanvas";
import { useCollaboration } from "@/hooks/useCollaboration";

export default function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [elements, setElements] = useState(canvasStore.state.elements);
  
  // Subscribe to store updates
  useEffect(() => {
    const unsubscribe = canvasStore.subscribe(() => {
      setElements(canvasStore.state.elements);
    });
    return unsubscribe;
  }, []);

  // Initialize canvas interaction
  const { previewElement } = useCanvas(canvasRef);
  
  // Initialize collaboration
  const { users, sendCursorMove } = useCollaboration();

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    sendCursorMove(x, y);
  };

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener("resize", updateDimensions);
    updateDimensions();

    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Render all elements
    elements.forEach((element) => {
      renderElement(ctx, element);
    });

    // Render preview element
    if (previewElement) {
      renderElement(ctx, previewElement);
    }

    // Render other users' cursors
    users.forEach((user) => {
      if (user.cursorX !== undefined && user.cursorY !== undefined) {
        // Draw cursor
        ctx.fillStyle = user.color;
        ctx.beginPath();
        ctx.arc(user.cursorX, user.cursorY, 5, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw user name
        ctx.fillStyle = user.color;
        ctx.font = '12px sans-serif';
        ctx.fillText(user.userName, user.cursorX + 10, user.cursorY - 10);
      }
    });
  }, [elements, dimensions, users, previewElement]);

  return (
    <div ref={containerRef} className="w-full h-full bg-gray-50">
      <canvas
        ref={canvasRef}
        width={dimensions.width}
        height={dimensions.height}
        className="touch-none"
        onMouseMove={handleMouseMove}
      />
    </div>
  );
}
