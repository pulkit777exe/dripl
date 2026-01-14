"use client";
import { useEffect } from "react";
import { useCanvasStore } from "@/lib/canvas-store";
import {
  Square,
  Circle,
  ArrowRight,
  Minus,
  Pencil,
  Type,
  Eraser,
  MousePointer,
} from "lucide-react";

const tools = [
  { id: "select" as const, icon: MousePointer, label: "Select", shortcut: "V" },
  { id: "rectangle" as const, icon: Square, label: "Rectangle", shortcut: "R" },
  { id: "ellipse" as const, icon: Circle, label: "Ellipse", shortcut: "E" },
  { id: "arrow" as const, icon: ArrowRight, label: "Arrow", shortcut: "A" },
  { id: "line" as const, icon: Minus, label: "Line", shortcut: "L" },
  { id: "freedraw" as const, icon: Pencil, label: "Pen", shortcut: "P" },
  { id: "text" as const, icon: Type, label: "Text", shortcut: "T" },
  { id: "eraser" as const, icon: Eraser, label: "Eraser", shortcut: "X" },
];

export function CanvasToolbar() {
  const activeTool = useCanvasStore((state) => state.activeTool);
  const setActiveTool = useCanvasStore((state) => state.setActiveTool);
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tool = tools.find(
        (t) => t.shortcut.toLowerCase() === e.key.toLowerCase()
      );
      if (
        tool &&
        !e.ctrlKey &&
        !e.metaKey &&
        !(e.target as HTMLElement)?.closest("input, textarea")
      ) {
        setActiveTool(tool.id);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setActiveTool, undo, redo]);

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-10">
      <div className="flex items-center gap-1 p-2 bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg">
        {tools.map((tool) => {
          const Icon = tool.icon;
          const isActive = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              className={`
                p-2 rounded transition-colors
                ${isActive 
                  ? "bg-accent" 
                  : "hover:bg-accent/50"}
              `}
              title={`${tool.label} (${tool.shortcut})`}
              aria-label={`${tool.label} tool, press ${tool.shortcut} to activate`}
              aria-pressed={isActive}
            >
              <Icon className="w-5 h-5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}