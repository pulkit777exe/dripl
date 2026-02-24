"use client";

import { useEffect } from "react";
import { useCanvasStore } from "@/lib/canvas-store";
import {
  Lock,
  Hand,
  MousePointer2,
  Square,
  Diamond,
  Circle,
  ArrowRight,
  Minus,
  Pencil,
  Type,
  Image,
  Eraser,
} from "lucide-react";
import { ExtraToolsDropdown } from "./ExtraToolsDropdown";

interface Tool {
  id: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  shortcuts: string[];
  numericShortcut?: string;
}

const tools: Tool[] = [
  {
    id: "hand",
    icon: Hand,
    label: "Hand",
    shortcuts: ["h"],
  },
  {
    id: "select",
    icon: MousePointer2,
    label: "Selection",
    shortcuts: ["v", "1"],
    numericShortcut: "1",
  },
  {
    id: "rectangle",
    icon: Square,
    label: "Rectangle",
    shortcuts: ["r", "2"],
    numericShortcut: "2",
  },
  {
    id: "diamond",
    icon: Diamond,
    label: "Diamond",
    shortcuts: ["d", "3"],
    numericShortcut: "3",
  },
  {
    id: "ellipse",
    icon: Circle,
    label: "Ellipse",
    shortcuts: ["o", "4"],
    numericShortcut: "4",
  },
  {
    id: "arrow",
    icon: ArrowRight,
    label: "Arrow",
    shortcuts: ["a", "5"],
    numericShortcut: "5",
  },
  {
    id: "line",
    icon: Minus,
    label: "Line",
    shortcuts: ["l", "6"],
    numericShortcut: "6",
  },
  {
    id: "freedraw",
    icon: Pencil,
    label: "Freedraw",
    shortcuts: ["p", "7"],
    numericShortcut: "7",
  },
  {
    id: "text",
    icon: Type,
    label: "Text",
    shortcuts: ["t", "8"],
    numericShortcut: "8",
  },
  {
    id: "image",
    icon: Image,
    label: "Image",
    shortcuts: ["9"],
    numericShortcut: "9",
  },
  {
    id: "eraser",
    icon: Eraser,
    label: "Eraser",
    shortcuts: ["e", "0"],
    numericShortcut: "0",
  },
];

export function CanvasToolbar() {
  const activeTool = useCanvasStore((state) => state.activeTool);
  const setActiveTool = useCanvasStore((state) => state.setActiveTool);
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) {
        if ((e.ctrlKey || e.metaKey) && e.key === "z") {
          e.preventDefault();
          if (e.shiftKey) {
            redo();
          } else {
            undo();
          }
        }
        return;
      }

      const key = e.key.toLowerCase();

      for (const tool of tools) {
        if (tool.shortcuts.includes(key)) {
          e.preventDefault();
          setActiveTool(tool.id as any);
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setActiveTool, undo, redo]);

  return (
    <div
      className="absolute top-6 left-1/2 -translate-x-1/2 px-1.5 py-1.5 rounded-xl border shadow-lg flex items-center gap-0.5 z-50 pointer-events-auto"
      style={{
        backgroundColor: "var(--color-toolbar-bg)",
        borderColor: "var(--color-toolbar-border)",
        boxShadow:
          "0 4px 16px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.5)",
      }}
    >
      {/* Lock button (decorative, non-interactive) */}
      <button
        className="p-2 rounded-md cursor-default"
        style={{ color: "var(--color-tool-inactive-text)", opacity: 0.45 }}
        disabled
        aria-label="Lock"
        tabIndex={-1}
      >
        <Lock size={17} />
      </button>

      {/* Separator */}
      <div
        className="w-px h-5 mx-1"
        style={{ backgroundColor: "var(--color-toolbar-divider)" }}
      />

      {/* Tool buttons */}
      {tools.map((tool) => {
        const Icon = tool.icon;
        const isActive = activeTool === tool.id;

        return (
          <button
            key={tool.id}
            id={`tool-btn-${tool.id}`}
            onClick={() => setActiveTool(tool.id as any)}
            className="relative p-2 rounded-md transition-all duration-150"
            style={
              isActive
                ? {
                    backgroundColor: "var(--color-tool-active-bg)",
                    color: "var(--color-tool-active-text)",
                    boxShadow:
                      "0 0 0 2px var(--color-tool-active-shadow), inset 0 1px 0 rgba(255,255,255,0.1)",
                  }
                : {
                    color: "var(--color-tool-inactive-text)",
                  }
            }
            onMouseEnter={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  "var(--color-tool-hover-bg)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  "transparent";
              }
            }}
            title={`${tool.label} [${tool.shortcuts.join(" / ")}]`}
            aria-label={`${tool.label} tool`}
            aria-pressed={isActive}
          >
            <Icon size={18} />
            {tool.numericShortcut && (
              <span
                className="absolute -bottom-0.5 -right-0.5 text-[9px] font-mono leading-none opacity-60 select-none"
                style={{ color: "var(--color-tool-inactive-text)" }}
              >
                {tool.numericShortcut}
              </span>
            )}
          </button>
        );
      })}

      <ExtraToolsDropdown />
    </div>
  );
}
