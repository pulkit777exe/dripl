'use client';

import { useCanvasStore } from '@/lib/canvas-store';
import { Minus, Plus, Undo2, Redo2, Move } from 'lucide-react';

export function CanvasControls() {
  const zoom = useCanvasStore(state => state.zoom);
  const setZoom = useCanvasStore(state => state.setZoom);
  const marqueeSelectionMode = useCanvasStore(state => state.marqueeSelectionMode);
  const setMarqueeSelectionMode = useCanvasStore(state => state.setMarqueeSelectionMode);
  const undo = useCanvasStore(state => state.undo);
  const redo = useCanvasStore(state => state.redo);
  const canUndo = useCanvasStore(state => state.past.length > 0);
  const canRedo = useCanvasStore(state => state.future.length > 0);

  const handleZoomIn = () => setZoom(Math.min(zoom + 0.1, 5));
  const handleZoomOut = () => setZoom(Math.max(zoom - 0.1, 0.1));
  const toggleMarqueeMode = () =>
    setMarqueeSelectionMode(marqueeSelectionMode === 'intersecting' ? 'contained' : 'intersecting');

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

      <button
        onClick={toggleMarqueeMode}
        className={`p-2.5 rounded-lg border shadow-lg transition-colors group relative ${
          marqueeSelectionMode === 'contained'
            ? 'bg-tool-active-bg text-tool-active-text border-tool-active-shadow'
            : 'bg-toolbar-bg border-toolbar-border text-tool-inactive-text hover:bg-tool-hover-bg'
        }`}
        title={
          marqueeSelectionMode === 'contained'
            ? 'Selection mode: Contained (select only fully enclosed elements). Click for Intersecting.'
            : 'Selection mode: Intersecting (select any overlapping elements). Click for Contained.'
        }
        aria-label={`Selection mode: ${marqueeSelectionMode}. Click to toggle.`}
      >
        <Move className="size-5" />
        <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap bg-background px-2 py-1 rounded border shadow-md">
          {marqueeSelectionMode === 'contained' ? 'Enclosed' : 'Intersecting'}
        </span>
      </button>

      <div className="flex items-center bg-toolbar-bg border border-toolbar-border rounded-lg shadow-lg overflow-hidden">
        <button
          onClick={undo}
          disabled={!canUndo}
          className="p-2.5 hover:bg-tool-hover-bg transition-colors disabled:opacity-50 text-tool-inactive-text hover:text-tool-hover-text"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          <Undo2 className="size-5" />
        </button>
        <div className="w-px h-5 bg-toolbar-divider" />
        <button
          onClick={redo}
          disabled={!canRedo}
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
