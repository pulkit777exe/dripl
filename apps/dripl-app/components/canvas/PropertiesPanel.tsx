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

  const currentStrokeColor = useCanvasStore((state) => state.currentStrokeColor);
  const currentBackgroundColor = useCanvasStore((state) => state.currentBackgroundColor);
  const currentStrokeWidth = useCanvasStore((state) => state.currentStrokeWidth);
  const currentRoughness = useCanvasStore((state) => state.currentRoughness);
  const currentStrokeStyle = useCanvasStore((state) => state.currentStrokeStyle);
  const currentFillStyle = useCanvasStore((state) => state.currentFillStyle);

  const setCurrentStrokeColor = useCanvasStore((state) => state.setCurrentStrokeColor);
  const setCurrentBackgroundColor = useCanvasStore((state) => state.setCurrentBackgroundColor);
  const setCurrentStrokeWidth = useCanvasStore((state) => state.setCurrentStrokeWidth);
  const setCurrentRoughness = useCanvasStore((state) => state.setCurrentRoughness);
  const setCurrentStrokeStyle = useCanvasStore((state) => state.setCurrentStrokeStyle);
  const setCurrentFillStyle = useCanvasStore((state) => state.setCurrentFillStyle);

  const updateElementProperty = (property: string, value: any) => {
    if (!selectedElement || !onUpdateElement) return;
    
    const updatedElement = {
      ...selectedElement,
      [property]: value,
    };
    
    onUpdateElement(updatedElement);
  };

  return (
    <div className="flex flex-col gap-2 pointer-events-auto z-100">
      <div className="p-6 bg-card/90 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl w-72 space-y-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          {selectedElement ? "Properties" : "Canvas Properties"}
        </h3>

        {selectedElement ? (
          <>
            {/* Element Type Specific Properties */}
            {selectedElement.type === "text" && (
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground font-medium">Text Content</label>
                <textarea
                  value={(selectedElement as TextElement).text ?? ""}
                  onChange={(e) => updateElementProperty("text", e.target.value)}
                  className="w-full text-sm p-2 bg-accent border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  rows={3}
                />
              </div>
            )}

            {selectedElement.type === "text" && (
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground font-medium">Font Size</label>
                <input
                  type="number"
                  value={(selectedElement as TextElement).fontSize ?? 16}
                  onChange={(e) => updateElementProperty("fontSize", Number(e.target.value))}
                  className="w-full text-sm p-2 bg-accent border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  min="8"
                  max="72"
                />
              </div>
            )}

            {selectedElement.type === "freedraw" && (
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground font-medium">Brush Size</label>
                <input
                  type="number"
                  value={(selectedElement as FreeDrawElement).brushSize ?? 2}
                  onChange={(e) => updateElementProperty("brushSize", Number(e.target.value))}
                  className="w-full text-sm p-2 bg-accent border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  min="1"
                  max="20"
                />
              </div>
            )}

            {selectedElement.type === "frame" && (
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground font-medium">Frame Title</label>
                <input
                  type="text"
                  value={(selectedElement as any).title ?? "Frame"}
                  onChange={(e) => updateElementProperty("title", e.target.value)}
                  className="w-full text-sm p-2 bg-accent border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                />
              </div>
            )}

            {selectedElement.type === "frame" && (
              <div className="space-y-2">
                <label className="text-sm text-gray-400 font-medium">Padding</label>
                <input
                  type="number"
                  value={(selectedElement as any).padding ?? 20}
                  onChange={(e) => updateElementProperty("padding", Number(e.target.value))}
                  className="w-full text-sm p-2 bg-[#2a2a3a] border border-[#333] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[#6965db] focus:border-transparent"
                  min="0"
                  max="100"
                />
              </div>
            )}

            {/* Common Properties */}
            {selectedElement.type !== "text" && (
              <div className="space-y-2">
                <label className="text-sm text-gray-400 font-medium">Stroke Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={selectedElement.strokeColor ?? currentStrokeColor}
                    onChange={(e) => updateElementProperty("strokeColor", e.target.value)}
                    className="w-full h-10 rounded-lg cursor-pointer bg-[#2a2a3a] border border-[#333] focus:outline-none focus:ring-2 focus:ring-[#6965db] focus:border-transparent"
                  />
                  <span className="text-xs font-mono text-gray-400">{selectedElement.strokeColor ?? currentStrokeColor}</span>
                </div>
              </div>
            )}

            {selectedElement.type !== "text" && selectedElement.type !== "freedraw" && (
              <div className="space-y-2">
                <label className="text-sm text-gray-400 font-medium">Background</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={
                      selectedElement.backgroundColor === "transparent"
                        ? "#ffffff"
                        : selectedElement.backgroundColor ?? currentBackgroundColor
                    }
                    onChange={(e) => updateElementProperty("backgroundColor", e.target.value)}
                    disabled={selectedElement.backgroundColor === "transparent"}
                    className="w-full h-10 rounded-lg cursor-pointer bg-[#2a2a3a] border border-[#333] focus:outline-none focus:ring-2 focus:ring-[#6965db] focus:border-transparent disabled:opacity-50"
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
                    className={`px-3 py-2 text-sm border rounded-lg transition-colors ${
                      selectedElement.backgroundColor === "transparent"
                        ? "bg-[#6965db] text-white border-[#6965db]"
                        : "bg-[#2a2a3a] text-gray-400 border-[#333] hover:bg-[#3a3a4a]"
                    }`}
                  >
                    {selectedElement.backgroundColor === "transparent" ? "None" : "Fill"}
                  </button>
                </div>
              </div>
            )}

            {selectedElement.type !== "text" && (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-sm text-gray-400 font-medium">
                    Stroke Width
                  </label>
                  <span className="text-sm text-gray-400">{selectedElement.strokeWidth ?? currentStrokeWidth}px</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={selectedElement.strokeWidth ?? currentStrokeWidth}
                  onChange={(e) => updateElementProperty("strokeWidth", Number(e.target.value))}
                  className="w-full h-2 bg-[#333] rounded-lg appearance-none cursor-pointer accent-[#6965db]"
                />
              </div>
            )}

            {selectedElement.type !== "text" && (
              <div className="space-y-2">
                <label className="text-sm text-gray-400 font-medium">Stroke Style</label>
                <div className="flex gap-2">
                  {["solid", "dashed", "dotted"].map((style) => (
                    <button
                      key={style}
                      onClick={() => updateElementProperty("strokeStyle", style)}
                      className={`px-3 py-2 text-sm border rounded-lg transition-colors ${
                        (selectedElement.strokeStyle ?? currentStrokeStyle) === style
                          ? "bg-[#6965db] text-white border-[#6965db]"
                          : "bg-[#2a2a3a] text-gray-400 border-[#333] hover:bg-[#3a3a4a]"
                      }`}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedElement.type !== "text" && selectedElement.type !== "freedraw" && (
              <div className="space-y-2">
                <label className="text-sm text-gray-400 font-medium">Fill Style</label>
                <div className="flex gap-2 flex-wrap">
                  {["hachure", "solid", "zigzag", "cross-hatch", "dots", "dashed", "zigzag-line"].map((style) => (
                    <button
                      key={style}
                      onClick={() => updateElementProperty("fillStyle", style)}
                      className={`px-3 py-2 text-sm border rounded-lg transition-colors ${
                        (selectedElement.fillStyle ?? currentFillStyle) === style
                          ? "bg-[#6965db] text-white border-[#6965db]"
                          : "bg-[#2a2a3a] text-gray-400 border-[#333] hover:bg-[#3a3a4a]"
                      }`}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-sm text-gray-400 font-medium">
                  Sloppiness
                </label>
                <span className="text-sm text-gray-400">{selectedElement.roughness ?? currentRoughness}</span>
              </div>
              <input
                type="range"
                min="0"
                max="3"
                step="0.5"
                value={selectedElement.roughness ?? currentRoughness}
                onChange={(e) => updateElementProperty("roughness", Number(e.target.value))}
                className="w-full h-2 bg-[#333] rounded-lg appearance-none cursor-pointer accent-[#6965db]"
              />
            </div>

            {/* Z-Index Property */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-sm text-gray-400 font-medium">
                  Z-Index
                </label>
                <span className="text-sm text-gray-400">{selectedElement.zIndex ?? 100}</span>
              </div>
              <input
                type="number"
                value={selectedElement.zIndex ?? 100}
                onChange={(e) => updateElementProperty("zIndex", Number(e.target.value))}
                className="w-full text-sm p-2 bg-[#2a2a3a] border border-[#333] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[#6965db] focus:border-transparent"
                min="0"
                max="1000"
              />
            </div>

            {/* Opacity Property */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-sm text-gray-400 font-medium">
                  Opacity
                </label>
                <span className="text-sm text-gray-400">{Math.round((selectedElement.opacity ?? 1) * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round((selectedElement.opacity ?? 1) * 100)}
                onChange={(e) => updateElementProperty("opacity", Number(e.target.value) / 100)}
                className="w-full h-2 bg-[#333] rounded-lg appearance-none cursor-pointer accent-[#6965db]"
              />
            </div>
          </>
        ) : (
          <>
            {/* Default Properties Panel when no element is selected */}
            <div className="space-y-2">
              <label className="text-sm text-gray-400 font-medium">Stroke Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={currentStrokeColor}
                  onChange={(e) => setCurrentStrokeColor(e.target.value)}
                  className="w-full h-10 rounded-lg cursor-pointer bg-[#2a2a3a] border border-[#333] focus:outline-none focus:ring-2 focus:ring-[#6965db] focus:border-transparent"
                />
                <span className="text-xs font-mono text-gray-400">{currentStrokeColor}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-gray-400 font-medium">Background</label>
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
                  className="w-full h-10 rounded-lg cursor-pointer bg-[#2a2a3a] border border-[#333] focus:outline-none focus:ring-2 focus:ring-[#6965db] focus:border-transparent disabled:opacity-50"
                />
                <button
                  onClick={() =>
                    setCurrentBackgroundColor(
                      currentBackgroundColor === "transparent"
                        ? "#ffffff"
                        : "transparent"
                    )
                  }
                  className={`px-3 py-2 text-sm border rounded-lg transition-colors ${
                    currentBackgroundColor === "transparent"
                      ? "bg-[#6965db] text-white border-[#6965db]"
                      : "bg-[#2a2a3a] text-gray-400 border-[#333] hover:bg-[#3a3a4a]"
                  }`}
                >
                  {currentBackgroundColor === "transparent" ? "None" : "Fill"}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-sm text-gray-400 font-medium">
                  Stroke Width
                </label>
                <span className="text-sm text-gray-400">{currentStrokeWidth}px</span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                value={currentStrokeWidth}
                onChange={(e) => setCurrentStrokeWidth(Number(e.target.value))}
                className="w-full h-2 bg-[#333] rounded-lg appearance-none cursor-pointer accent-[#6965db]"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm text-gray-400 font-medium">Stroke Style</label>
              <div className="flex gap-2">
                {["solid", "dashed", "dotted"].map((style) => (
                  <button
                    key={style}
                    onClick={() => setCurrentStrokeStyle(style as any)}
                    className={`px-3 py-2 text-sm border rounded-lg transition-colors ${
                      currentStrokeStyle === style
                        ? "bg-[#6965db] text-white border-[#6965db]"
                        : "bg-[#2a2a3a] text-gray-400 border-[#333] hover:bg-[#3a3a4a]"
                    }`}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-gray-400 font-medium">Fill Style</label>
              <div className="flex gap-2 flex-wrap">
                {["hachure", "solid", "zigzag", "cross-hatch", "dots", "dashed", "zigzag-line"].map((style) => (
                  <button
                    key={style}
                    onClick={() => setCurrentFillStyle(style as any)}
                    className={`px-3 py-2 text-sm border rounded-lg transition-colors ${
                      currentFillStyle === style
                        ? "bg-[#6965db] text-white border-[#6965db]"
                        : "bg-[#2a2a3a] text-gray-400 border-[#333] hover:bg-[#3a3a4a]"
                    }`}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-sm text-gray-400 font-medium">
                  Sloppiness
                </label>
                <span className="text-sm text-gray-400">{currentRoughness}</span>
              </div>
              <input
                type="range"
                min="0"
                max="3"
                step="0.5"
                value={currentRoughness}
                onChange={(e) => setCurrentRoughness(Number(e.target.value))}
                className="w-full h-2 bg-[#333] rounded-lg appearance-none cursor-pointer accent-[#6965db]"
              />
            </div>
          </>
        )}

        <div className="pt-4 border-t border-[#333]">
          <button
            onClick={() => setShowExportModal(true)}
            className="w-full flex items-center justify-center gap-2 p-3 bg-[#2a2a3a] text-gray-300 border border-[#333] rounded-lg hover:bg-[#3a3a4a] transition-colors"
          >
            <Download className="w-5 h-5" />
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
