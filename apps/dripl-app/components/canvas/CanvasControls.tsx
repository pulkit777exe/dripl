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
    <div className="flex items-center gap-2 z-100">
      <div className="flex items-center bg-toolbar-bg border border-toolbar-border rounded-lg shadow-lg overflow-hidden">
        <button
          onClick={handleZoomOut}
          className="p-2.5 hover:bg-tool-hover-bg transition-colors text-tool-inactive-text hover:text-tool-hover-text"
          title="Zoom Out (-)"
          aria-label="Zoom out"
        >
          <Minus className="size-5" />
        </button>
        <span className="px-3 text-sm tabular-nums min-w-14 text-center text-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={handleZoomIn}
          className="p-2.5 hover:bg-tool-hover-bg transition-colors text-tool-inactive-text hover:text-tool-hover-text"
          title="Zoom In (+)"
          aria-label="Zoom in"
        >
          <Plus className="size-5" />
        </button>
      </div>

      <div className="flex items-center bg-toolbar-bg border border-toolbar-border rounded-lg shadow-lg overflow-hidden">
        <button
          onClick={undo}
          disabled={historyIndex <= 0}
          className="p-2.5 hover:bg-tool-hover-bg transition-colors disabled:opacity-50 text-tool-inactive-text hover:text-tool-hover-text"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          <Undo2 className="size-5" />
        </button>
        <div className="w-px h-5 bg-toolbar-divider" />
        <button
          onClick={redo}
          disabled={historyIndex >= history.length - 1}
          className="p-2.5 hover:bg-tool-hover-bg transition-colors disabled:opacity-50 text-tool-inactive-text hover:text-tool-hover-text"
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
        >
          <Redo2 className="size-5" />
        </button>
      </div>
    </div>
  );
}
