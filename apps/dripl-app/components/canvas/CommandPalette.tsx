"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";

import { useTheme } from "@/hooks/useTheme";
import { useCanvasStore } from "@/lib/canvas-store";

type Command = {
  id: string;
  label: string;
  keywords: string[];
  perform: () => void;
};

export function CommandPalette() {
  const { theme, setTheme } = useTheme();

  const zoom = useCanvasStore((state) => state.zoom);
  const setZoom = useCanvasStore((state) => state.setZoom);
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);
  const setActiveTool = useCanvasStore((state) => state.setActiveTool);

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsOpen((open) => !open);
        return;
      }
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const commands: Command[] = useMemo(
    () => [
      {
        id: "toggle-theme",
        label:
          theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        keywords: ["theme", "dark", "light", "appearance"],
        perform: () => {
          setTheme(theme === "dark" ? "light" : "dark");
        },
      },
      {
        id: "zoom-in",
        label: "Zoom in",
        keywords: ["zoom", "in", "+"],
        perform: () => setZoom(zoom * 1.1),
      },
      {
        id: "zoom-out",
        label: "Zoom out",
        keywords: ["zoom", "out", "-"],
        perform: () => setZoom(zoom / 1.1),
      },
      {
        id: "reset-zoom",
        label: "Reset zoom",
        keywords: ["zoom", "reset", "fit"],
        perform: () => setZoom(1),
      },
      {
        id: "undo",
        label: "Undo",
        keywords: ["undo", "history", "back"],
        perform: () => undo(),
      },
      {
        id: "redo",
        label: "Redo",
        keywords: ["redo", "history", "forward"],
        perform: () => redo(),
      },
      {
        id: "tool-hand",
        label: "Hand tool (panning)",
        keywords: ["tool", "hand", "pan", "move", "canvas"],
        perform: () => setActiveTool("hand"),
      },
      {
        id: "tool-select",
        label: "Select tool",
        keywords: ["tool", "select", "pointer"],
        perform: () => setActiveTool("select"),
      },
      {
        id: "tool-rectangle",
        label: "Rectangle tool",
        keywords: ["tool", "rectangle", "shape"],
        perform: () => setActiveTool("rectangle"),
      },
      {
        id: "tool-diamond",
        label: "Diamond tool",
        keywords: ["tool", "diamond", "shape"],
        perform: () => setActiveTool("diamond"),
      },
      {
        id: "tool-ellipse",
        label: "Ellipse tool",
        keywords: ["tool", "ellipse", "circle"],
        perform: () => setActiveTool("ellipse"),
      },
      {
        id: "tool-arrow",
        label: "Arrow tool",
        keywords: ["tool", "arrow"],
        perform: () => setActiveTool("arrow"),
      },
      {
        id: "tool-line",
        label: "Line tool",
        keywords: ["tool", "line"],
        perform: () => setActiveTool("line"),
      },
      {
        id: "tool-freedraw",
        label: "Freedraw tool",
        keywords: ["tool", "freedraw", "draw", "pen"],
        perform: () => setActiveTool("freedraw"),
      },
      {
        id: "tool-text",
        label: "Text tool",
        keywords: ["tool", "text", "type"],
        perform: () => setActiveTool("text"),
      },
      {
        id: "tool-image",
        label: "Image tool",
        keywords: ["tool", "image", "picture", "photo"],
        perform: () => setActiveTool("image"),
      },
      {
        id: "tool-eraser",
        label: "Eraser tool",
        keywords: ["tool", "eraser", "delete", "remove"],
        perform: () => setActiveTool("eraser"),
      },
    ],
    [theme, setTheme, zoom, setZoom, undo, redo, setActiveTool],
  );

  const filteredCommands = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return commands;
    }
    return commands.filter((command) => {
      const haystack = [command.label, ...command.keywords]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [commands, query]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-120 flex items-start justify-center pt-24 bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="w-full max-w-md rounded-xl bg-background shadow-lg border border-border pointer-events-auto">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground"
            placeholder="Type a command or search…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {filteredCommands.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No commands found.
            </div>
          ) : (
            filteredCommands.map((command) => (
              <button
                key={command.id}
                type="button"
                className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  command.perform();
                  setIsOpen(false);
                  setQuery("");
                }}
              >
                {command.label}
              </button>
            ))
          )}
        </div>
        <div className="flex justify-between items-center px-3 py-1 border-t border-border text-[11px] text-muted-foreground">
          <span>Press Esc to close</span>
          <span>Ctrl/Cmd + K</span>
        </div>
      </div>
    </div>
  );
}
