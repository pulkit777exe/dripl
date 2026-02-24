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
} from "lucide-react";
import { useState } from "react";
import { ExportModal } from "./ExportModal";
import type { DriplElement } from "@dripl/common";

interface ElementPropertiesProps {
  selectedElement: DriplElement | null;
  onUpdateElement: (element: DriplElement) => void;
  onDeleteElement?: () => void;
  onDuplicateElement?: () => void;
}


const STROKE_COLORS = [
  { value: "#1e1e1e", label: "Black" },
  { value: "#e03131", label: "Red" },
  { value: "#2f9e44", label: "Green" },
  { value: "#1971c2", label: "Blue" },
  { value: "#f08c00", label: "Orange" },
  { value: "#6965db", label: "Purple" },
  { value: "#c2255c", label: "Pink" },
  { value: "#ffffff", label: "White" },
];

const BACKGROUND_COLORS = [
  { value: "transparent", label: "None" },
  { value: "#ffc9c9", label: "Light Red" },
  { value: "#b2f2bb", label: "Light Green" },
  { value: "#a5d8ff", label: "Light Blue" },
  { value: "#ffec99", label: "Light Yellow" },
  { value: "#e0dcff", label: "Light Purple" },
];


const SHAPE_PROPERTIES: Record<string, string[]> = {
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


function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      className="text-xs font-medium select-none"
      style={{ color: "var(--color-panel-label)" }}
    >
      {children}
    </label>
  );
}


interface RowBtnProps {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}

function RowBtn({ active, onClick, title, children }: RowBtnProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex-1 h-7 rounded flex items-center justify-center transition-all duration-120"
      style={
        active
          ? {
              backgroundColor: "var(--color-panel-btn-active)",
              color: "var(--color-panel-btn-active-text, #fff)",
              boxShadow: "inset 0 1px 2px rgba(0,0,0,0.15)",
            }
          : {
              backgroundColor: "var(--color-panel-btn-bg)",
              color: "var(--color-panel-text)",
            }
      }
      onMouseEnter={(e) => {
        if (!active)
          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
            "var(--color-panel-btn-hover)";
      }}
      onMouseLeave={(e) => {
        if (!active)
          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
            "var(--color-panel-btn-bg)";
      }}
    >
      {children}
    </button>
  );
}


function ActionBtn({
  onClick,
  title,
  danger,
  children,
}: {
  onClick?: () => void;
  title?: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex-1 h-7 rounded flex items-center justify-center transition-all duration-120"
      style={{
        backgroundColor: "var(--color-panel-btn-bg)",
        color: "var(--color-panel-text)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor = danger
          ? "rgba(224,49,49,0.15)"
          : "var(--color-panel-btn-hover)";
        if (danger)
          (e.currentTarget as HTMLButtonElement).style.color =
            "var(--color-destructive)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor =
          "var(--color-panel-btn-bg)";
        (e.currentTarget as HTMLButtonElement).style.color =
          "var(--color-panel-text)";
      }}
    >
      {children}
    </button>
  );
}


export function PropertiesPanel({
  selectedElement,
  onUpdateElement,
  onDeleteElement,
  onDuplicateElement,
}: Partial<ElementPropertiesProps> = {}) {
  const [showExportModal, setShowExportModal] = useState(false);

  const currentStrokeColor = useCanvasStore((s) => s.currentStrokeColor);
  const currentBackgroundColor = useCanvasStore(
    (s) => s.currentBackgroundColor,
  );
  const currentStrokeWidth = useCanvasStore((s) => s.currentStrokeWidth);
  const currentRoughness = useCanvasStore((s) => s.currentRoughness);
  const currentStrokeStyle = useCanvasStore((s) => s.currentStrokeStyle);

  const setCurrentStrokeColor = useCanvasStore((s) => s.setCurrentStrokeColor);
  const setCurrentBackgroundColor = useCanvasStore(
    (s) => s.setCurrentBackgroundColor,
  );
  const setCurrentStrokeWidth = useCanvasStore((s) => s.setCurrentStrokeWidth);
  const setCurrentRoughness = useCanvasStore((s) => s.setCurrentRoughness);
  const setCurrentStrokeStyle = useCanvasStore((s) => s.setCurrentStrokeStyle);

  const updateProp = (property: string, value: unknown) => {
    if (!selectedElement || !onUpdateElement) return;
    onUpdateElement({ ...selectedElement, [property]: value } as DriplElement);
  };

  const visibleProps = selectedElement
    ? (SHAPE_PROPERTIES[selectedElement.type] ?? [])
    : [];
  const showProp = (p: string) => !selectedElement || visibleProps.includes(p);

  const strokeColor = selectedElement?.strokeColor ?? currentStrokeColor;
  const backgroundColor =
    selectedElement?.backgroundColor ?? currentBackgroundColor;
  const strokeWidth = selectedElement?.strokeWidth ?? currentStrokeWidth;
  const roughness = selectedElement?.roughness ?? currentRoughness;
  const strokeStyle = selectedElement?.strokeStyle ?? currentStrokeStyle;
  const opacity = selectedElement?.opacity ?? 1;

  // Slide-in: when an element is selected → is-visible; otherwise no-selection
  const panelClass = `properties-panel${selectedElement ? " is-visible" : " no-selection"}`;

  return (
    <div className={`flex flex-col gap-2 z-50 ${panelClass}`}>
      <div
        className="p-4 rounded-xl shadow-2xl w-48 space-y-3"
        style={{
          backgroundColor: "var(--color-panel-bg)",
          border: "1px solid var(--color-panel-border)",
        }}
      >
        {/* ── Stroke colour ─────────────────────────────────────────────── */}
        {showProp("strokeColor") && (
          <div className="space-y-1.5">
            <SectionLabel>Stroke</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {STROKE_COLORS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() =>
                    selectedElement
                      ? updateProp("strokeColor", value)
                      : setCurrentStrokeColor(value)
                  }
                  title={label}
                  aria-label={label}
                  className="w-5 h-5 rounded transition-all duration-120"
                  style={{
                    backgroundColor: value,
                    border:
                      strokeColor === value
                        ? "2px solid var(--color-panel-text)"
                        : value === "#ffffff"
                          ? "1.5px solid var(--color-panel-border)"
                          : "2px solid transparent",
                    transform:
                      strokeColor === value ? "scale(1.18)" : "scale(1)",
                    boxShadow:
                      strokeColor === value
                        ? "0 0 0 1px var(--color-panel-bg)"
                        : "none",
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Background colour ─────────────────────────────────────────── */}
        {showProp("background") && (
          <div className="space-y-1.5">
            <SectionLabel>Background</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {BACKGROUND_COLORS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() =>
                    selectedElement
                      ? updateProp("backgroundColor", value)
                      : setCurrentBackgroundColor(value)
                  }
                  title={label}
                  aria-label={label}
                  className={`w-5 h-5 rounded transition-all duration-120${
                    value === "transparent"
                      ? " bg-[url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%228%22 height=%228%22%3E%3Crect width=%224%22 height=%224%22 fill=%22%23ddd%22/%3E%3Crect x=%224%22 y=%224%22 width=%224%22 height=%224%22 fill=%22%23ddd%22/%3E%3C/svg%3E')]"
                      : ""
                  }`}
                  style={{
                    backgroundColor:
                      value === "transparent" ? undefined : value,
                    border:
                      backgroundColor === value
                        ? "2px solid var(--color-panel-text)"
                        : "2px solid transparent",
                    transform:
                      backgroundColor === value ? "scale(1.18)" : "scale(1)",
                    boxShadow:
                      backgroundColor === value
                        ? "0 0 0 1px var(--color-panel-bg)"
                        : "none",
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Divider when both stroke and bg are visible */}
        {showProp("strokeColor") && showProp("background") && (
          <div
            className="h-px"
            style={{ backgroundColor: "var(--color-panel-divider)" }}
          />
        )}

        {/* ── Stroke width ──────────────────────────────────────────────── */}
        {showProp("strokeWidth") && (
          <div className="space-y-1.5">
            <SectionLabel>Stroke width</SectionLabel>
            <div className="flex gap-1">
              {[1, 2, 4].map((w) => (
                <RowBtn
                  key={w}
                  active={strokeWidth === w}
                  onClick={() =>
                    selectedElement
                      ? updateProp("strokeWidth", w)
                      : setCurrentStrokeWidth(w)
                  }
                  title={`Width ${w}`}
                >
                  <div
                    className="rounded-full"
                    style={{
                      width: w * 5 + 4,
                      height: w + 1,
                      backgroundColor: "currentColor",
                    }}
                  />
                </RowBtn>
              ))}
            </div>
          </div>
        )}

        {/* ── Stroke style ──────────────────────────────────────────────── */}
        {showProp("strokeStyle") && (
          <div className="space-y-1.5">
            <SectionLabel>Stroke style</SectionLabel>
            <div className="flex gap-1">
              {(["solid", "dashed", "dotted"] as const).map((s) => (
                <RowBtn
                  key={s}
                  active={strokeStyle === s}
                  onClick={() =>
                    selectedElement
                      ? updateProp("strokeStyle", s)
                      : setCurrentStrokeStyle(s)
                  }
                  title={s}
                >
                  <div
                    className="w-5 border-t-2"
                    style={{
                      borderStyle: s,
                      borderColor: "currentColor",
                    }}
                  />
                </RowBtn>
              ))}
            </div>
          </div>
        )}

        {/* ── Sloppiness ────────────────────────────────────────────────── */}
        {showProp("sloppiness") && (
          <div className="space-y-1.5">
            <SectionLabel>Sloppiness</SectionLabel>
            <div className="flex gap-1">
              {[0, 1, 2].map((level) => (
                <RowBtn
                  key={level}
                  active={roughness === level}
                  onClick={() =>
                    selectedElement
                      ? updateProp("roughness", level)
                      : setCurrentRoughness(level)
                  }
                  title={["Architect", "Artist", "Cartoonist"][level]}
                >
                  <svg
                    width="16"
                    height="14"
                    viewBox="0 0 24 18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    {level === 0 && <path d="M4 9h16" />}
                    {level === 1 && <path d="M4 9c3-2 5 2 8 0s5-2 8 0" />}
                    {level === 2 && (
                      <path d="M4 9c1-3 2 3 4 0s2 3 4 0 2 3 4 0 2 3 4 0" />
                    )}
                  </svg>
                </RowBtn>
              ))}
            </div>
          </div>
        )}

        {/* ── Edges ─────────────────────────────────────────────────────── */}
        {showProp("edges") && (
          <div className="space-y-1.5">
            <SectionLabel>Edges</SectionLabel>
            <div className="flex gap-1">
              {(["sharp", "round"] as const).map((edge) => (
                <RowBtn
                  key={edge}
                  active={(selectedElement as any)?.edges === edge}
                  onClick={() => updateProp("edges", edge)}
                  title={edge}
                >
                  <div
                    className={`w-4 h-4 border-2 ${edge === "round" ? "rounded" : ""}`}
                    style={{ borderColor: "currentColor" }}
                  />
                </RowBtn>
              ))}
            </div>
          </div>
        )}

        {/* ── Arrow type ────────────────────────────────────────────────── */}
        {showProp("arrowType") && (
          <div className="space-y-1.5">
            <SectionLabel>Arrow type</SectionLabel>
            <div className="flex gap-1">
              {(["straight", "curved", "elbow"] as const).map((type) => (
                <RowBtn
                  key={type}
                  active={(selectedElement as any)?.arrowType === type}
                  onClick={() => updateProp("arrowType", type)}
                  title={type}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {type === "straight" && <path d="M5 12h14M15 6l6 6-6 6" />}
                    {type === "curved" && (
                      <path d="M5 19c4-8 11-12 14-7M15 6l6 6-6 6" />
                    )}
                    {type === "elbow" && <path d="M5 19v-7h14M15 6l6 6-6 6" />}
                  </svg>
                </RowBtn>
              ))}
            </div>
          </div>
        )}

        {/* ── Arrowheads ────────────────────────────────────────────────── */}
        {showProp("arrowheads") && (
          <div className="space-y-1.5">
            <SectionLabel>Arrowheads</SectionLabel>
            <div className="flex gap-1">
              <RowBtn
                active={!!(selectedElement as any)?.startArrowhead}
                onClick={() =>
                  updateProp(
                    "startArrowhead",
                    !(selectedElement as any)?.startArrowhead,
                  )
                }
                title="Start arrowhead"
              >
                <span className="text-xs">←●</span>
              </RowBtn>
              <RowBtn
                active={(selectedElement as any)?.endArrowhead !== false}
                onClick={() =>
                  updateProp(
                    "endArrowhead",
                    !(selectedElement as any)?.endArrowhead,
                  )
                }
                title="End arrowhead"
              >
                <span className="text-xs">●→</span>
              </RowBtn>
            </div>
          </div>
        )}

        {/* ── Opacity ───────────────────────────────────────────────────── */}
        {showProp("opacity") && (
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <SectionLabel>Opacity</SectionLabel>
              <span
                className="text-xs tabular-nums"
                style={{ color: "var(--color-panel-label)" }}
              >
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
                  ? updateProp("opacity", Number(e.target.value) / 100)
                  : undefined
              }
              className="w-full"
            />
          </div>
        )}

        {/* ── Layers ────────────────────────────────────────────────────── */}
        {showProp("layers") && (
          <div className="space-y-1.5">
            <SectionLabel>Layers</SectionLabel>
            <div className="flex gap-1">
              <ActionBtn
                onClick={() =>
                  updateProp("zIndex", (selectedElement?.zIndex ?? 100) - 100)
                }
                title="Send to back"
              >
                <ChevronsDown size={13} />
              </ActionBtn>
              <ActionBtn
                onClick={() =>
                  updateProp("zIndex", (selectedElement?.zIndex ?? 100) - 10)
                }
                title="Send backward"
              >
                <ChevronDown size={13} />
              </ActionBtn>
              <ActionBtn
                onClick={() =>
                  updateProp("zIndex", (selectedElement?.zIndex ?? 100) + 10)
                }
                title="Bring forward"
              >
                <ChevronUp size={13} />
              </ActionBtn>
              <ActionBtn
                onClick={() =>
                  updateProp("zIndex", (selectedElement?.zIndex ?? 100) + 100)
                }
                title="Bring to front"
              >
                <ChevronsUp size={13} />
              </ActionBtn>
            </div>
          </div>
        )}

        {/* ── Align ─────────────────────────────────────────────────────── */}
        {showProp("align") && (
          <div className="space-y-1.5">
            <SectionLabel>Align</SectionLabel>
            <div className="flex gap-1 flex-wrap">
              <ActionBtn title="Align left">
                <AlignLeft size={13} />
              </ActionBtn>
              <ActionBtn title="Align center">
                <AlignCenter size={13} />
              </ActionBtn>
              <ActionBtn title="Align right">
                <AlignRight size={13} />
              </ActionBtn>
              <ActionBtn title="Align middle">
                <AlignVerticalJustifyCenter size={13} />
              </ActionBtn>
            </div>
          </div>
        )}

        {/* ── Actions ───────────────────────────────────────────────────── */}
        {showProp("actions") && (
          <div className="space-y-1.5">
            <div
              className="h-px"
              style={{ backgroundColor: "var(--color-panel-divider)" }}
            />
            <div className="flex gap-1">
              <ActionBtn onClick={onDuplicateElement} title="Duplicate">
                <Copy size={13} />
              </ActionBtn>
              <ActionBtn onClick={onDeleteElement} title="Delete" danger>
                <Trash2 size={13} />
              </ActionBtn>
              <ActionBtn
                onClick={() => setShowExportModal(true)}
                title="Export"
              >
                <Download size={13} />
              </ActionBtn>
            </div>
          </div>
        )}

        {/* ── Global export (no selection) ──────────────────────────────── */}
        {!selectedElement && (
          <div
            className="pt-2"
            style={{ borderTop: "1px solid var(--color-panel-divider)" }}
          >
            <button
              onClick={() => setShowExportModal(true)}
              className="w-full flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs transition-all duration-120"
              style={{
                backgroundColor: "var(--color-panel-btn-bg)",
                color: "var(--color-panel-label)",
                border: "1px solid var(--color-panel-border)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  "var(--color-panel-btn-hover)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  "var(--color-panel-btn-bg)";
              }}
            >
              <Download className="w-3.5 h-3.5" />
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
