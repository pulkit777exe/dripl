import * as React from "react";
import { ZoomIn, ZoomOut, Undo2, Redo2 } from "lucide-react";
import { cn } from "./utils/cn";

export interface BottomToolbarProps {
  zoom?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  className?: string;
}

export const BottomToolbar = React.forwardRef<HTMLDivElement, BottomToolbarProps>(
  ({ zoom = 100, onZoomIn, onZoomOut, onUndo, onRedo, className }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center gap-3 bg-gray-800/95 backdrop-blur-sm rounded-xl px-4 py-2.5 shadow-lg border border-gray-700",
          className
        )}
      >
        <button
          onClick={onZoomOut}
          className="p-1.5 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          title="Zoom Out"
          aria-label="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        
        <span className="text-sm font-medium text-gray-300 min-w-[45px] text-center">
          {zoom}%
        </span>
        
        <button
          onClick={onZoomIn}
          className="p-1.5 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          title="Zoom In"
          aria-label="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        
        <div className="w-px h-6 bg-gray-700 mx-1" />
        
        <button
          onClick={onUndo}
          className="p-1.5 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          title="Undo"
          aria-label="Undo"
        >
          <Undo2 className="w-4 h-4" />
        </button>
        
        <button
          onClick={onRedo}
          className="p-1.5 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          title="Redo"
          aria-label="Redo"
        >
          <Redo2 className="w-4 h-4" />
        </button>
      </div>
    );
  }
);

BottomToolbar.displayName = "BottomToolbar";
