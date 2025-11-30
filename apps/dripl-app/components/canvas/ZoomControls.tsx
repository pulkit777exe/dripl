"use client";

import React from "react";
import { Minus, Plus, Undo2, Redo2, HelpCircle } from "lucide-react";

interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onHelp: () => void;
}

export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onHelp
}: ZoomControlsProps) {
  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-4">
      {/* Zoom Group */}
      <div className="flex items-center bg-card/90 backdrop-blur-sm border border-border rounded-lg shadow-lg overflow-hidden">
        <button
          onClick={onZoomOut}
          className="p-2 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="Zoom Out (-)"
        >
          <Minus className="w-4 h-4" />
        </button>
        <span className="px-2 text-xs font-mono text-foreground min-w-12 text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={onZoomIn}
          className="p-2 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="Zoom In (+)"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* History Group */}
      <div className="flex items-center bg-card/90 backdrop-blur-sm border border-border rounded-lg shadow-lg overflow-hidden">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="p-2 hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-border" />
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="p-2 hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Redo (Ctrl+Y)"
        >
          <Redo2 className="w-4 h-4" />
        </button>
      </div>
      
       {/* Help Button */}
       <button
          onClick={onHelp}
          className="p-2 bg-card/90 backdrop-blur-sm border border-border rounded-lg shadow-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="Help / Shortcuts (?)"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
    </div>
  );
}
