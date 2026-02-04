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
    <div className="flex gap-4 z-100">
      <div className="flex items-center bg-card/90 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl overflow-hidden">
        <button
          onClick={handleZoomOut}
          className="p-3 hover:bg-accent transition-colors text-muted-foreground hover:text-accent-foreground"
          title="Zoom Out (-)"
        >
          <Minus className="w-5 h-5" />
        </button>
        <span className="px-3 text-sm font-semibold min-w-16 text-center text-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={handleZoomIn}
          className="p-3 hover:bg-accent transition-colors text-muted-foreground hover:text-accent-foreground"
          title="Zoom In (+)"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      <div className="flex items-center bg-card/90 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl overflow-hidden">
        <button
          onClick={undo}
          disabled={historyIndex <= 0}
          className="p-3 hover:bg-accent transition-colors disabled:opacity-50 text-muted-foreground hover:text-accent-foreground"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-5 h-5" />
        </button>
        <div className="w-px h-6 bg-border" />
        <button
          onClick={redo}
          disabled={historyIndex >= history.length - 1}
          className="p-3 hover:bg-accent transition-colors disabled:opacity-50 text-muted-foreground hover:text-accent-foreground"
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
