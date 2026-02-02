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
      <div className="flex items-center bg-[#1a1a24]/90 backdrop-blur-xl border border-[#333]/50 rounded-2xl shadow-2xl overflow-hidden">
        <button
          onClick={handleZoomOut}
          className="p-3 hover:bg-[#2a2a3a] transition-colors text-[#a0a0a0] hover:text-white"
          title="Zoom Out (-)"
        >
          <Minus className="w-5 h-5" />
        </button>
        <span className="px-3 text-sm font-semibold min-w-16 text-center text-gray-300">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={handleZoomIn}
          className="p-3 hover:bg-[#2a2a3a] transition-colors text-[#a0a0a0] hover:text-white"
          title="Zoom In (+)"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      <div className="flex items-center bg-[#1a1a24]/90 backdrop-blur-xl border border-[#333]/50 rounded-2xl shadow-2xl overflow-hidden">
        <button
          onClick={undo}
          disabled={historyIndex <= 0}
          className="p-3 hover:bg-[#2a2a3a] transition-colors disabled:opacity-50 text-[#a0a0a0] hover:text-white"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-5 h-5" />
        </button>
        <div className="w-px h-6 bg-[#333]" />
        <button
          onClick={redo}
          disabled={historyIndex >= history.length - 1}
          className="p-3 hover:bg-[#2a2a3a] transition-colors disabled:opacity-50 text-[#a0a0a0] hover:text-white"
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
