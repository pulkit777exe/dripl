"use client";

import { useCanvasStore } from "@/lib/canvas-store";
import {
  Download,
  Copy,
  Trash2,
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignVerticalJustifyCenter,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";
import { ExportModal } from "./ExportModal";
import type { DriplElement, TextElement, FreeDrawElement } from "@dripl/common";

interface ElementPropertiesProps {
  selectedElement: DriplElement | null;
  onUpdateElement: (element: DriplElement) => void;
  onDeleteElement?: () => void;
  onDuplicateElement?: () => void;
}

const STROKE_COLORS = [
  "#1e1e1e", // Near-black (Excalidraw default in light)
  "#e03131", // Red
  "#2f9e44", // Green
  "#1971c2", // Blue
  "#f08c00", // Orange
  "#6965db", // Purple
  "#ffffff", // White (visible in dark mode)
];

const BACKGROUND_COLORS = [
  "transparent",
  "#ffc9c9", // Light red
  "#b2f2bb", // Light green
  "#a5d8ff", // Light blue
  "#ffec99", // Light yellow
  "#e0dcff", // Light purple
];

const SHAPE_PROPERTIES = {
  rectangle: [
    "strokeColor",
    "background",
    "strokeWidth",
    "strokeStyle",
    "sloppiness",
    "edges",
    "opacity",
    "layers",
    "align",
    "actions",
  ],
  diamond: [
    "strokeColor",
    "background",
    "strokeWidth",
    "strokeStyle",
    "sloppiness",
    "edges",
    "opacity",
    "layers",
    "align",
    "actions",
  ],
  ellipse: [
    "strokeColor",
    "background",
    "strokeWidth",
    "strokeStyle",
    "sloppiness",
    "opacity",
    "layers",
    "align",
    "actions",
  ],
  arrow: [
    "strokeColor",
    "strokeWidth",
    "strokeStyle",
    "sloppiness",
    "arrowType",
    "arrowheads",
    "opacity",
    "layers",
    "actions",
  ],
  line: [
    "strokeColor",
    "strokeWidth",
    "strokeStyle",
    "sloppiness",
    "opacity",
    "layers",
    "actions",
  ],
  freedraw: ["strokeColor", "strokeWidth", "opacity", "layers", "actions"],
  text: [
    "strokeColor",
    "fontSize",
    "fontFamily",
    "opacity",
    "layers",
    "align",
    "actions",
  ],
  image: ["opacity", "layers", "align", "actions"],
  frame: ["strokeColor", "opacity", "layers", "actions"],
};

export function PropertiesPanel({
  selectedElement,
  onUpdateElement,
  onDeleteElement,
  onDuplicateElement,
}: Partial<ElementPropertiesProps> = {}) {
  const [showExportModal, setShowExportModal] = useState(false);

  const currentStrokeColor = useCanvasStore(
    (state) => state.currentStrokeColor,
  );
  const currentBackgroundColor = useCanvasStore(
    (state) => state.currentBackgroundColor,
  );
  const currentStrokeWidth = useCanvasStore(
    (state) => state.currentStrokeWidth,
  );
  const currentRoughness = useCanvasStore((state) => state.currentRoughness);
  const currentStrokeStyle = useCanvasStore(
    (state) => state.currentStrokeStyle,
  );

  const setCurrentStrokeColor = useCanvasStore(
    (state) => state.setCurrentStrokeColor,
  );
  const setCurrentBackgroundColor = useCanvasStore(
    (state) => state.setCurrentBackgroundColor,
  );
  const setCurrentStrokeWidth = useCanvasStore(
    (state) => state.setCurrentStrokeWidth,
  );
  const setCurrentRoughness = useCanvasStore(
    (state) => state.setCurrentRoughness,
  );
  const setCurrentStrokeStyle = useCanvasStore(
    (state) => state.setCurrentStrokeStyle,
  );

  const updateElementProperty = (property: string, value: any) => {
    if (!selectedElement || !onUpdateElement) return;
    onUpdateElement({ ...selectedElement, [property]: value });
  };

  const getVisibleProperties = () => {
    if (!selectedElement) return [];
    const type = selectedElement.type as keyof typeof SHAPE_PROPERTIES;
    return SHAPE_PROPERTIES[type] || [];
  };

  const visibleProps = getVisibleProperties();
  const showProp = (prop: string) => visibleProps.includes(prop);

  const strokeColor = selectedElement?.strokeColor ?? currentStrokeColor;
  const backgroundColor =
    selectedElement?.backgroundColor ?? currentBackgroundColor;
  const strokeWidth = selectedElement?.strokeWidth ?? currentStrokeWidth;
  const roughness = selectedElement?.roughness ?? currentRoughness;
  const strokeStyle = selectedElement?.strokeStyle ?? currentStrokeStyle;
  const opacity = selectedElement?.opacity ?? 1;

  return (
    <div className="flex flex-col gap-2 pointer-events-auto z-50">
      <div className="p-4 bg-panel-bg border border-panel-border rounded-xl shadow-2xl w-48 space-y-4 ">
        {(!selectedElement || showProp("strokeColor")) && (
          <div className="space-y-1.5">
            <label className="text-xs text-panel-label font-medium ">
              Stroke
            </label>
            <div className="flex flex-wrap gap-1.5">
              {STROKE_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() =>
                    selectedElement
                      ? updateElementProperty("strokeColor", color)
                      : setCurrentStrokeColor(color)
                  }
                  className={`w-5 h-5 rounded border-2 transition-all ${
                    strokeColor === color
                      ? "border-panel-text scale-110 "
                      : "border-transparent hover:border-panel-label "
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        )}

        {(!selectedElement || showProp("background")) && (
          <div className="space-y-1.5">
            <label className="text-xs text-panel-label font-medium ">
              Background
            </label>
            <div className="flex flex-wrap gap-1.5">
              {BACKGROUND_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() =>
                    selectedElement
                      ? updateElementProperty("backgroundColor", color)
                      : setCurrentBackgroundColor(color)
                  }
                  className={`w-5 h-5 rounded border-2 transition-all ${
                    backgroundColor === color
                      ? "border-panel-text scale-110 "
                      : "border-transparent hover:border-panel-label "
                  } ${color === "transparent" ? "bg-[url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%228%22 height=%228%22%3E%3Crect width=%224%22 height=%224%22 fill=%22%23ccc%22/%3E%3Crect x=%224%22 y=%224%22 width=%224%22 height=%224%22 fill=%22%23ccc%22/%3E%3C/svg%3E')]" : ""}`}
                  style={{
                    backgroundColor:
                      color === "transparent" ? undefined : color,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {(!selectedElement || showProp("strokeWidth")) && (
          <div className="space-y-1.5">
            <label className="text-xs text-panel-label font-medium">
              Stroke width
            </label>
            <div className="flex gap-1">
              {[1, 2, 4].map((width) => (
                <button
                  key={width}
                  onClick={() =>
                    selectedElement
                      ? updateElementProperty("strokeWidth", width)
                      : setCurrentStrokeWidth(width)
                  }
                  className={`flex-1 h-7 rounded flex items-center justify-center transition-colors ${
                    strokeWidth === width
                      ? "bg-panel-btn-active"
                      : "bg-panel-btn-bg hover:bg-panel-btn-hover"
                  }`}
                >
                  <div
                    className="bg-panel-text rounded-full"
                    style={{ width: width * 2 + 4, height: width + 1 }}
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {(!selectedElement || showProp("strokeStyle")) && (
          <div className="space-y-1.5">
            <label className="text-xs text-panel-label font-medium">
              Stroke style
            </label>
            <div className="flex gap-1">
              {["solid", "dashed", "dotted"].map((style) => (
                <button
                  key={style}
                  onClick={() =>
                    selectedElement
                      ? updateElementProperty("strokeStyle", style)
                      : setCurrentStrokeStyle(style as any)
                  }
                  className={`flex-1 h-7 rounded flex items-center justify-center transition-colors ${
                    strokeStyle === style
                      ? "bg-panel-btn-active"
                      : "bg-panel-btn-bg hover:bg-panel-btn-hover"
                  }`}
                >
                  <div
                    className="w-5 border-t-2 border-panel-text"
                    style={{ borderStyle: style }}
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {(!selectedElement || showProp("sloppiness")) && (
          <div className="space-y-1.5">
            <label className="text-xs text-panel-label font-medium">
              Sloppiness
            </label>
            <div className="flex gap-1">
              {[0, 1, 2].map((level) => (
                <button
                  key={level}
                  onClick={() =>
                    selectedElement
                      ? updateElementProperty("roughness", level)
                      : setCurrentRoughness(level)
                  }
                  className={`flex-1 h-7 rounded flex items-center justify-center transition-colors ${
                    roughness === level
                      ? "bg-panel-btn-active"
                      : "bg-panel-btn-bg hover:bg-panel-btn-hover"
                  }`}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    {level === 0 && <path d="M6 12h12" />}
                    {level === 1 && <path d="M6 12c2-1 4 1 6 0s4-1 6 0" />}
                    {level === 2 && (
                      <path d="M6 12c1-2 2 2 3 0s2 2 3 0 2 2 3 0 2 2 3 0" />
                    )}
                  </svg>
                </button>
              ))}
            </div>
          </div>
        )}

        {showProp("edges") && (
          <div className="space-y-1.5">
            <label className="text-xs text--(--color-panel-label) font-medium">
              Edges
            </label>
            <div className="flex gap-1">
              {["sharp", "round"].map((edge) => (
                <button
                  key={edge}
                  onClick={() => updateElementProperty("edges", edge)}
                  className={`flex-1 h-7 rounded flex items-center justify-center transition-colors ${
                    (selectedElement as any)?.edges === edge
                      ? "bg--(--color-panel-btn-active)"
                      : "bg-panel-btn-bg  hover:bg-panel-btn-hover "
                  }`}
                >
                  <div
                    className={`w-4 h-4 border-2 border-panel-text  ${
                      edge === "round" ? "rounded" : ""
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {showProp("arrowType") && (
          <div className="space-y-1.5">
            <label className="text-xs text--(--color-panel-label) font-medium">
              Arrow type
            </label>
            <div className="flex gap-1">
              {["straight", "curved", "elbow"].map((type) => (
                <button
                  key={type}
                  onClick={() => updateElementProperty("arrowType", type)}
                  className={`flex-1 h-7 rounded flex items-center justify-center transition-colors ${
                    (selectedElement as any)?.arrowType === type
                      ? "bg--(--color-panel-btn-active)"
                      : "bg-panel-btn-bg  hover:bg-panel-btn-hover "
                  }`}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    {type === "straight" && <path d="M5 12h14M15 6l6 6-6 6" />}
                    {type === "curved" && (
                      <path d="M5 19c4-8 11-12 14-7M15 6l6 6-6 6" />
                    )}
                    {type === "elbow" && <path d="M5 19v-7h14M15 6l6 6-6 6" />}
                  </svg>
                </button>
              ))}
            </div>
          </div>
        )}

        {showProp("arrowheads") && (
          <div className="space-y-1.5">
            <label className="text-xs text--(--color-panel-label) font-medium">
              Arrowheads
            </label>
            <div className="flex gap-1">
              <button
                onClick={() =>
                  updateElementProperty(
                    "startArrowhead",
                    !(selectedElement as any)?.startArrowhead,
                  )
                }
                className={`flex-1 h-7 rounded flex items-center justify-center transition-colors ${
                  (selectedElement as any)?.startArrowhead
                    ? "bg--(--color-panel-btn-active)"
                    : "bg-panel-btn-bg  hover:bg-panel-btn-hover "
                }`}
                title="Start arrowhead"
              >
                <span className="text-xs text-panel-text ">←o</span>
              </button>
              <button
                onClick={() =>
                  updateElementProperty(
                    "endArrowhead",
                    !(selectedElement as any)?.endArrowhead,
                  )
                }
                className={`flex-1 h-7 rounded flex items-center justify-center transition-colors ${
                  (selectedElement as any)?.endArrowhead !== false
                    ? "bg--(--color-panel-btn-active)"
                    : "bg-panel-btn-bg  hover:bg-panel-btn-hover "
                }`}
                title="End arrowhead"
              >
                <span className="text-xs text-panel-text ">o→</span>
              </button>
            </div>
          </div>
        )}

        {(!selectedElement || showProp("opacity")) && (
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="text-xs text--(--color-panel-label) font-medium">
                Opacity
              </label>
              <span className="text-xs text--(--color-panel-label)">
                {Math.round(opacity * 100)}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(opacity * 100)}
              onChange={(e) =>
                selectedElement
                  ? updateElementProperty(
                      "opacity",
                      Number(e.target.value) / 100,
                    )
                  : null
              }
              className="w-full h-1.5 bg--(--color-panel-slider) rounded-lg appearance-none cursor-pointer accent--(--color-panel-btn-active)"
            />
          </div>
        )}

        {showProp("layers") && (
          <div className="space-y-1.5">
            <label className="text-xs text--(--color-panel-label) font-medium">
              Layers
            </label>
            <div className="flex gap-1">
              <button
                onClick={() =>
                  updateElementProperty(
                    "zIndex",
                    (selectedElement?.zIndex ?? 100) - 100,
                  )
                }
                className="flex-1 h-7 rounded bg-panel-btn-bg  hover:bg-panel-btn-hover  flex items-center justify-center transition-colors"
                title="Send to back"
              >
                <ChevronsDown size={14} className="text-panel-text " />
              </button>
              <button
                onClick={() =>
                  updateElementProperty(
                    "zIndex",
                    (selectedElement?.zIndex ?? 100) - 10,
                  )
                }
                className="flex-1 h-7 rounded bg-panel-btn-bg  hover:bg-panel-btn-hover  flex items-center justify-center transition-colors"
                title="Send backward"
              >
                <ChevronDown size={14} className="text-panel-text " />
              </button>
              <button
                onClick={() =>
                  updateElementProperty(
                    "zIndex",
                    (selectedElement?.zIndex ?? 100) + 10,
                  )
                }
                className="flex-1 h-7 rounded bg-panel-btn-bg  hover:bg-panel-btn-hover  flex items-center justify-center transition-colors"
                title="Bring forward"
              >
                <ChevronUp size={14} className="text-panel-text " />
              </button>
              <button
                onClick={() =>
                  updateElementProperty(
                    "zIndex",
                    (selectedElement?.zIndex ?? 100) + 100,
                  )
                }
                className="flex-1 h-7 rounded bg-panel-btn-bg  hover:bg-panel-btn-hover  flex items-center justify-center transition-colors"
                title="Bring to front"
              >
                <ChevronsUp size={14} className="text-panel-text " />
              </button>
            </div>
          </div>
        )}

        {showProp("align") && (
          <div className="space-y-1.5">
            <label className="text-xs text--(--color-panel-label) font-medium">
              Align
            </label>
            <div className="flex gap-1 flex-wrap">
              <button
                className="flex-1 h-7 rounded bg-panel-btn-bg  hover:bg-panel-btn-hover  flex items-center justify-center transition-colors"
                title="Align left"
              >
                <AlignLeft size={14} className="text-panel-text " />
              </button>
              <button
                className="flex-1 h-7 rounded bg-panel-btn-bg  hover:bg-panel-btn-hover  flex items-center justify-center transition-colors"
                title="Align center"
              >
                <AlignCenter size={14} className="text-panel-text " />
              </button>
              <button
                className="flex-1 h-7 rounded bg-panel-btn-bg  hover:bg-panel-btn-hover  flex items-center justify-center transition-colors"
                title="Align right"
              >
                <AlignRight size={14} className="text-panel-text " />
              </button>
              <button
                className="flex-1 h-7 rounded bg-panel-btn-bg  hover:bg-panel-btn-hover  flex items-center justify-center transition-colors"
                title="Align middle"
              >
                <AlignVerticalJustifyCenter
                  size={14}
                  className="text-panel-text "
                />
              </button>
            </div>
          </div>
        )}

        {showProp("actions") && (
          <div className="space-y-1.5">
            <label className="text-xs text--(--color-panel-label) font-medium">
              Actions
            </label>
            <div className="flex gap-1">
              <button
                onClick={onDuplicateElement}
                className="flex-1 h-7 rounded bg-panel-btn-bg  hover:bg-panel-btn-hover  flex items-center justify-center transition-colors"
                title="Duplicate"
              >
                <Copy size={14} className="text-panel-text " />
              </button>
              <button
                onClick={onDeleteElement}
                className="flex-1 h-7 rounded bg-panel-btn-bg  hover:bg-red-500/20 flex items-center justify-center transition-colors"
                title="Delete"
              >
                <Trash2 size={14} className="text-panel-text " />
              </button>
              <button
                onClick={() => setShowExportModal(true)}
                className="flex-1 h-7 rounded bg-panel-btn-bg  hover:bg-panel-btn-hover  flex items-center justify-center transition-colors"
                title="Export"
              >
                <Download size={14} className="text-panel-text " />
              </button>
            </div>
          </div>
        )}

        {!selectedElement && (
          <div className="pt-2 border-t border-panel-divider ">
            <button
              onClick={() => setShowExportModal(true)}
              className="w-full flex items-center justify-center gap-2 p-2 bg-panel-btn-bg  text--(--color-panel-label) border border--(--color-panel-border) rounded-lg hover:bg-panel-btn-hover  transition-colors text-xs"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>
        )}
      </div>

      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
      />
    </div>
  );
}
