"use client";

import { useCanvasStore } from "@/lib/canvas-store";
import { Download } from "lucide-react";
import { useState } from "react";
import { ExportModal } from "./ExportModal";

export function PropertiesPanel() {
  const [showExportModal, setShowExportModal] = useState(false);

  const currentStrokeColor = useCanvasStore(
    (state) => state.currentStrokeColor
  );
  const currentBackgroundColor = useCanvasStore(
    (state) => state.currentBackgroundColor
  );
  const currentStrokeWidth = useCanvasStore(
    (state) => state.currentStrokeWidth
  );
  const currentRoughness = useCanvasStore((state) => state.currentRoughness);
  const currentStrokeStyle = useCanvasStore(
    (state) => state.currentStrokeStyle
  );
  const currentFillStyle = useCanvasStore(
    (state) => state.currentFillStyle
  );

  const setCurrentStrokeColor = useCanvasStore(
    (state) => state.setCurrentStrokeColor
  );
  const setCurrentBackgroundColor = useCanvasStore(
    (state) => state.setCurrentBackgroundColor
  );
  const setCurrentStrokeWidth = useCanvasStore(
    (state) => state.setCurrentStrokeWidth
  );
  const setCurrentRoughness = useCanvasStore(
    (state) => state.setCurrentRoughness
  );
  const setCurrentStrokeStyle = useCanvasStore(
    (state) => state.setCurrentStrokeStyle
  );
  const setCurrentFillStyle = useCanvasStore(
    (state) => state.setCurrentFillStyle
  );

  return (
    <div className="fixed top-4 left-4 flex flex-col gap-2 pointer-events-auto z-100">
      <div className="p-4 bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg w-64 space-y-4">
        <h3 className="font-semibold text-sm mb-2">Properties</h3>

        {/* Stroke Color */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Stroke Color</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={currentStrokeColor}
              onChange={(e) => setCurrentStrokeColor(e.target.value)}
              className="w-full h-8 rounded cursor-pointer"
            />
            <span className="text-xs font-mono">{currentStrokeColor}</span>
          </div>
        </div>

        {/* Background Color */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Background</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={
                currentBackgroundColor === "transparent"
                  ? "#ffffff"
                  : currentBackgroundColor
              }
              onChange={(e) => setCurrentBackgroundColor(e.target.value)}
              disabled={currentBackgroundColor === "transparent"}
              className="w-full h-8 rounded cursor-pointer disabled:opacity-50"
            />
            <button
              onClick={() =>
                setCurrentBackgroundColor(
                  currentBackgroundColor === "transparent"
                    ? "#ffffff"
                    : "transparent"
                )
              }
              className={`px-2 py-1 text-xs border rounded transition-colors ${
                currentBackgroundColor === "transparent"
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent"
              }`}
            >
              {currentBackgroundColor === "transparent" ? "None" : "Fill"}
            </button>
          </div>
        </div>

        {/* Stroke Width */}
        <div className="space-y-1">
          <div className="flex justify-between items-center">
            <label className="text-xs text-muted-foreground">
              Stroke Width
            </label>
            <span className="text-xs">{currentStrokeWidth}px</span>
          </div>
          <input
            type="range"
            min="1"
            max="10"
            value={currentStrokeWidth}
            onChange={(e) => setCurrentStrokeWidth(Number(e.target.value))}
            className="w-full"
          />
        </div>

        {/* Stroke Style */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Stroke Style</label>
          <div className="flex gap-1">
            {["solid", "dashed", "dotted"].map((style) => (
              <button
                key={style}
                onClick={() => setCurrentStrokeStyle(style as any)}
                className={`px-2 py-1 text-xs border rounded transition-colors ${
                  currentStrokeStyle === style
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent"
                }`}
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        {/* Fill Style */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Fill Style</label>
          <div className="flex gap-1 flex-wrap">
            {["hachure", "solid", "zigzag", "cross-hatch", "dots", "dashed", "zigzag-line"].map((style) => (
              <button
                key={style}
                onClick={() => setCurrentFillStyle(style as any)}
                className={`px-2 py-1 text-xs border rounded transition-colors ${
                  currentFillStyle === style
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent"
                }`}
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        {/* Roughness */}
        <div className="space-y-1">
          <div className="flex justify-between items-center">
            <label className="text-xs text-muted-foreground">Sloppiness</label>
            <span className="text-xs">{currentRoughness}</span>
          </div>
          <input
            type="range"
            min="0"
            max="3"
            step="0.5"
            value={currentRoughness}
            onChange={(e) => setCurrentRoughness(Number(e.target.value))}
            className="w-full"
          />
        </div>

        <div className="pt-2 border-t">
          <button
            onClick={() => setShowExportModal(true)}
            className="w-full flex items-center justify-center gap-2 p-2 text-sm border rounded hover:bg-accent transition-colors"
          >
            <Download className="w-4 h-4" />
            Export Canvas
          </button>
        </div>
      </div>

      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
      />
    </div>
  );
}
