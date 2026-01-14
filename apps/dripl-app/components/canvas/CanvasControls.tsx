"use client";

import { useCanvasStore } from "@/lib/canvas-store";
import { Minus, Plus, Undo2, Redo2 } from "lucide-react";

export function CanvasControls() {
  const zoom = useCanvasStore((state) => state.zoom);
  const setZoom = useCanvasStore((state) => state.setZoom);
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);
  const history = useCanvasStore((state) => state.history);
  const historyIndex = useCanvasStore((state) => state.historyIndex);

  const handleZoomIn = () => setZoom(Math.min(zoom + 0.1, 5));
  const handleZoomOut = () => setZoom(Math.max(zoom - 0.1, 0.1));

  return (
    <div className="fixed bottom-4 left-4 flex gap-4">
      <div className="flex items-center bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg overflow-hidden">
        <button
          onClick={handleZoomOut}
          className="p-2 hover:bg-accent transition-colors"
          title="Zoom Out (-)"
        >
          <Minus className="w-4 h-4" />
        </button>
        <span className="px-2 text-sm font-medium min-w-12 text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={handleZoomIn}
          className="p-2 hover:bg-accent transition-colors"
          title="Zoom In (+)"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg overflow-hidden">
        <button
          onClick={undo}
          disabled={historyIndex <= 0}
          className="p-2 hover:bg-accent transition-colors disabled:opacity-50"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-border" />
        <button
          onClick={redo}
          disabled={historyIndex >= history.length - 1}
          className="p-2 hover:bg-accent transition-colors disabled:opacity-50"
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
