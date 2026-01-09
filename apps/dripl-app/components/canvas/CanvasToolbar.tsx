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
  { id: "select" as const, icon: MousePointer, label: "Select (V)", key: "V" },
  { id: "rectangle" as const, icon: Square, label: "Rectangle (R)", key: "R" },
  { id: "ellipse" as const, icon: Circle, label: "Ellipse (E)", key: "E" },
  { id: "arrow" as const, icon: ArrowRight, label: "Arrow (A)", key: "A" },
  { id: "line" as const, icon: Minus, label: "Line (L)", key: "L" },
  { id: "freedraw" as const, icon: Pencil, label: "Pen (P)", key: "P" },
  { id: "text" as const, icon: Type, label: "Text (T)", key: "T" },
  { id: "eraser" as const, icon: Eraser, label: "Eraser (E)", key: "E" },
];

export function CanvasToolbar() {
  const activeTool = useCanvasStore((state) => state.activeTool);
  const setActiveTool = useCanvasStore((state) => state.setActiveTool);
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Tool shortcuts
      const tool = tools.find(
        (t) => t.key.toLowerCase() === e.key.toLowerCase()
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

      // Undo/Redo
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
          return (
            <button
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              className={`p-2 rounded hover:bg-accent transition-colors ${
                activeTool === tool.id ? "bg-accent" : ""
              }`}
              title={tool.label}
            >
              <Icon className="w-5 h-5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
