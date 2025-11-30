"use client";

import React from "react";
import {
  MousePointer2,
  Square,
  Circle,
  Type,
  Image as ImageIcon,
  Pencil,
  Hand,
  Lock,
  Unlock,
  Eraser,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ToolbarProps {
  activeTool: string;
  onToolSelect: (tool: string) => void;
  isLocked?: boolean;
  onToggleLock?: () => void;
}

export function Toolbar({ activeTool, onToolSelect, isLocked, onToggleLock }: ToolbarProps) {
  const tools = [
    { id: "select", icon: MousePointer2, label: "Selection — V or 1" },
    { id: "hand", icon: Hand, label: "Pan — H or 2" },
    { id: "rectangle", icon: Square, label: "Rectangle — R or 3" },
    { id: "circle", icon: Circle, label: "Circle — C or 4" },
    { id: "draw", icon: Pencil, label: "Draw — P or 5" },
    { id: "text", icon: Type, label: "Text — T or 6" },
    { id: "image", icon: ImageIcon, label: "Image — 7" },
    { id: "eraser", icon: Eraser, label: "Eraser — E or 0" },
  ];

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 p-1 rounded-lg bg-card/90 backdrop-blur-sm border border-border shadow-xl">
      <div className="flex items-center gap-1 pr-2 border-r border-border">
        <button
          onClick={onToggleLock}
          className={cn(
            "p-2 rounded-md transition-colors hover:bg-accent",
            isLocked ? "bg-accent/50 text-accent-foreground" : "text-muted-foreground"
          )}
          title={isLocked ? "Unlock tools" : "Lock tool"}
        >
          {isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
        </button>
      </div>
      
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => onToolSelect(tool.id)}
          className={cn(
            "p-2 rounded-md transition-colors relative group",
            activeTool === tool.id
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          )}
          title={tool.label}
        >
          <tool.icon className="w-4 h-4" />
          <span className="sr-only">{tool.label}</span>
          
          {/* Tooltip */}
          <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-popover text-xs text-popover-foreground rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-border">
            {tool.label}
          </div>
        </button>
      ))}
    </div>
  );
}
