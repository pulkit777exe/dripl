"use client";

import { useEffect } from "react";
import { useCanvasStore } from "@/lib/canvas-store";
import {
  Lock,
  Hand,
  MousePointer2,
  Square,
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
    numericShortcut: undefined,
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
    icon: Square,
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
      // Don't handle shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      // Don't handle shortcuts when modifier keys are pressed (except for undo/redo)
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

      // Handle tool shortcuts
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
    <div className="absolute top-6 left-1/2 -translate-x-1/2 p-1.5 rounded-xl border shadow-2xl flex items-center gap-0.5 z-50 bg-(--color-toolbar-bg) border-(--color-toolbar-border) pointer-events-auto">
      {/* Lock button (non-interactive) */}
      <button
        className="p-2 rounded-lg text-(--color-tool-inactive-text) cursor-default"
        disabled
        aria-label="Lock"
      >
        <Lock size={17} />
      </button>

      {/* Separator */}
      <div className="w-px h-6 bg-(--color-toolbar-divider) mx-1.5" />

      {/* Core tools */}
      {tools.map((tool) => {
        const Icon = tool.icon;
        const isActive = activeTool === tool.id;
        const isDiamond = tool.id === "diamond";

        return (
          <button
            key={tool.id}
            onClick={() => setActiveTool(tool.id as any)}
            className={`
              relative p-2 rounded-lg transition-colors
              ${
                isActive
                  ? "bg-(--color-tool-active-bg) text-(--color-tool-active-text)"
                  : "text-(--color-tool-inactive-text) hover:bg-(--color-tool-hover-bg)"
              }
            `}
            title={`${tool.label} (${tool.shortcuts.join(" or ")})`}
            aria-label={`${tool.label} tool`}
            aria-pressed={isActive}
          >
            {isDiamond ? (
              <div className="rotate-45">
                <Icon size={19} />
              </div>
            ) : (
              <Icon size={19} />
            )}
            {tool.numericShortcut && (
              <span className="absolute -bottom-0.5 -right-0.5 text-[10px] font-mono text-(--color-tool-inactive-text) leading-none">
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
