"use client";

import { useCanvasStore } from "@/lib/canvas-store";
import { Download } from "lucide-react";
import { useState } from "react";
import { ExportModal } from "./ExportModal";
import type { DriplElement, TextElement, FreeDrawElement } from "@dripl/common";

interface ElementPropertiesProps {
  selectedElement: DriplElement | null;
  onUpdateElement: (element: DriplElement) => void;
}

export function PropertiesPanel({ selectedElement, onUpdateElement }: Partial<ElementPropertiesProps> = {}) {
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

  const updateElementProperty = (property: string, value: any) => {
    if (!selectedElement || !onUpdateElement) return;
    
    const updatedElement = {
      ...selectedElement,
      [property]: value,
    };
    
    onUpdateElement(updatedElement);
  };

  return (
    <div className="fixed top-4 left-4 flex flex-col gap-2 pointer-events-auto z-100">
      <div className="p-4 bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg w-64 space-y-4">
        <h3 className="font-semibold text-sm mb-2">
          {selectedElement ? "Element Properties" : "Properties"}
        </h3>

        {selectedElement ? (
          <>
            {/* Element Type Specific Properties */}
            {selectedElement.type === "text" && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Text Content</label>
                <textarea
                  value={(selectedElement as TextElement).text || ""}
                  onChange={(e) => updateElementProperty("text", e.target.value)}
                  className="w-full text-xs p-1 border rounded bg-background"
                  rows={3}
                />
              </div>
            )}

            {selectedElement.type === "text" && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Font Size</label>
                <input
                  type="number"
                  value={(selectedElement as TextElement).fontSize || 16}
                  onChange={(e) => updateElementProperty("fontSize", Number(e.target.value))}
                  className="w-full text-xs p-1 border rounded bg-background"
                  min="8"
                  max="72"
                />
              </div>
            )}

            {selectedElement.type === "freedraw" && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Brush Size</label>
                <input
                  type="number"
                  value={(selectedElement as FreeDrawElement).brushSize || 2}
                  onChange={(e) => updateElementProperty("brushSize", Number(e.target.value))}
                  className="w-full text-xs p-1 border rounded bg-background"
                  min="1"
                  max="20"
                />
              </div>
            )}

            {selectedElement.type === "frame" && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Frame Title</label>
                <input
                  type="text"
                  value={(selectedElement as any).title || "Frame"}
                  onChange={(e) => updateElementProperty("title", e.target.value)}
                  className="w-full text-xs p-1 border rounded bg-background"
                />
              </div>
            )}

            {selectedElement.type === "frame" && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Padding</label>
                <input
                  type="number"
                  value={(selectedElement as any).padding || 20}
                  onChange={(e) => updateElementProperty("padding", Number(e.target.value))}
                  className="w-full text-xs p-1 border rounded bg-background"
                  min="0"
                  max="100"
                />
              </div>
            )}

            {/* Common Properties */}
            {selectedElement.type !== "text" && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Stroke Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={selectedElement.strokeColor || currentStrokeColor}
                    onChange={(e) => updateElementProperty("strokeColor", e.target.value)}
                    className="w-full h-8 rounded cursor-pointer"
                  />
                  <span className="text-xs font-mono">{selectedElement.strokeColor || currentStrokeColor}</span>
                </div>
              </div>
            )}

            {selectedElement.type !== "text" && selectedElement.type !== "freedraw" && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Background</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={
                      selectedElement.backgroundColor === "transparent"
                        ? "#ffffff"
                        : selectedElement.backgroundColor || currentBackgroundColor
                    }
                    onChange={(e) => updateElementProperty("backgroundColor", e.target.value)}
                    disabled={selectedElement.backgroundColor === "transparent"}
                    className="w-full h-8 rounded cursor-pointer disabled:opacity-50"
                  />
                  <button
                    onClick={() =>
                      updateElementProperty(
                        "backgroundColor",
                        selectedElement.backgroundColor === "transparent"
                          ? "#ffffff"
                          : "transparent"
                      )
                    }
                    className={`px-2 py-1 text-xs border rounded transition-colors ${
                      selectedElement.backgroundColor === "transparent"
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent"
                    }`}
                  >
                    {selectedElement.backgroundColor === "transparent" ? "None" : "Fill"}
                  </button>
                </div>
              </div>
            )}

            {selectedElement.type !== "text" && (
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-xs text-muted-foreground">
                    Stroke Width
                  </label>
                  <span className="text-xs">{selectedElement.strokeWidth || currentStrokeWidth}px</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={selectedElement.strokeWidth || currentStrokeWidth}
                  onChange={(e) => updateElementProperty("strokeWidth", Number(e.target.value))}
                  className="w-full"
                />
              </div>
            )}

            {selectedElement.type !== "text" && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Stroke Style</label>
                <div className="flex gap-1">
                  {["solid", "dashed", "dotted"].map((style) => (
                    <button
                      key={style}
                      onClick={() => updateElementProperty("strokeStyle", style)}
                      className={`px-2 py-1 text-xs border rounded transition-colors ${
                        (selectedElement.strokeStyle || currentStrokeStyle) === style
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent"
                      }`}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedElement.type !== "text" && selectedElement.type !== "freedraw" && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Fill Style</label>
                <div className="flex gap-1 flex-wrap">
                  {["hachure", "solid", "zigzag", "cross-hatch", "dots", "dashed", "zigzag-line"].map((style) => (
                    <button
                      key={style}
                      onClick={() => updateElementProperty("fillStyle", style)}
                      className={`px-2 py-1 text-xs border rounded transition-colors ${
                        (selectedElement.fillStyle || currentFillStyle) === style
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent"
                      }`}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="text-xs text-muted-foreground">
                  Sloppiness
                </label>
                <span className="text-xs">{selectedElement.roughness || currentRoughness}</span>
              </div>
              <input
                type="range"
                min="0"
                max="3"
                step="0.5"
                value={selectedElement.roughness || currentRoughness}
                onChange={(e) => updateElementProperty("roughness", Number(e.target.value))}
                className="w-full"
              />
            </div>

            {/* Z-Index Property */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="text-xs text-muted-foreground">
                  Z-Index
                </label>
                <span className="text-xs">{selectedElement.zIndex || 100}</span>
              </div>
              <input
                type="number"
                value={selectedElement.zIndex || 100}
                onChange={(e) => updateElementProperty("zIndex", Number(e.target.value))}
                className="w-full text-xs p-1 border rounded bg-background"
                min="0"
                max="1000"
              />
            </div>

            {/* Opacity Property */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="text-xs text-muted-foreground">
                  Opacity
                </label>
                <span className="text-xs">{Math.round((selectedElement.opacity || 1) * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round((selectedElement.opacity || 1) * 100)}
                onChange={(e) => updateElementProperty("opacity", Number(e.target.value) / 100)}
                className="w-full"
              />
            </div>
          </>
        ) : (
          <>
            {/* Default Properties Panel when no element is selected */}
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

            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="text-xs text-muted-foreground">
                  Sloppiness
                </label>
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
          </>
        )}

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
