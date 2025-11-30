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
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarProps {
  activeTool?: string;
  onToolSelect?: (tool: string) => void;
}

export function Sidebar({ activeTool = "select", onToolSelect }: SidebarProps) {
  const tools = [
    { id: "select", icon: MousePointer2, label: "Select" },
    { id: "hand", icon: Hand, label: "Pan" },
    { id: "rectangle", icon: Square, label: "Rectangle" },
    { id: "circle", icon: Circle, label: "Circle" },
    { id: "text", icon: Type, label: "Text" },
    { id: "image", icon: ImageIcon, label: "Image" },
    { id: "draw", icon: Pencil, label: "Draw" },
  ];

  return (
    <aside className="fixed left-0 top-0 z-50 flex h-full w-14 flex-col items-center border-r bg-background py-4">
      <div className="mb-4">
        {/* Logo or Brand Icon could go here */}
        <div className="h-8 w-8 rounded bg-primary" />
      </div>
      <div className="flex flex-col gap-2">
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => onToolSelect?.(tool.id)}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground",
              activeTool === tool.id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground"
            )}
            title={tool.label}
          >
            <tool.icon className="h-5 w-5" />
          </button>
        ))}
      </div>
    </aside>
  );
}
