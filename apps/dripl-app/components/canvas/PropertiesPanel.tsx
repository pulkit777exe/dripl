"use client";

import React from "react";
import { CanvasElement } from "@dripl/common";
import { cn } from "@/lib/utils";
import { Trash2, Copy, Layers, ArrowUp, ArrowDown } from "lucide-react";

interface PropertiesPanelProps {
  element: CanvasElement | null;
  onChange: (updates: Partial<CanvasElement>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
}

const COLORS = [
  "#ffffff", // White
  "#ef4444", // Red
  "#f97316", // Orange
  "#eab308", // Yellow
  "#22c55e", // Green
  "#3b82f6", // Blue
  "#a855f7", // Purple
  "#ec4899", // Pink
  "#71717a", // Zinc
];

export function PropertiesPanel({
  element,
  onChange,
  onDelete,
  onDuplicate,
  onBringToFront,
  onSendToBack,
}: PropertiesPanelProps) {
  if (!element) return null;

  return (
    <div className="fixed top-20 left-4 z-50 w-64 p-4 bg-card/90 backdrop-blur-sm border border-border rounded-xl shadow-xl flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-white/10 pb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {element.type} Properties
        </span>
        <div className="flex gap-1">
          <button
            onClick={onDuplicate}
            className="p-1.5 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
            title="Duplicate"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 hover:bg-red-500/20 rounded text-muted-foreground hover:text-red-400 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Stroke Color */}
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Stroke</label>
        <div className="grid grid-cols-5 gap-1">
          {COLORS.map((color) => (
            <button
              key={color}
              onClick={() => onChange({ stroke: color })}
              className={cn(
                "w-6 h-6 rounded-md border border-white/10 transition-transform hover:scale-110",
                element.stroke === color && "ring-2 ring-accent ring-offset-1 ring-offset-background"
              )}
              style={{ backgroundColor: color }}
            />
          ))}
          <input
            type="color"
            value={element.stroke || "#ffffff"}
            onChange={(e) => onChange({ stroke: e.target.value })}
            className="w-6 h-6 p-0 border-0 rounded-md overflow-hidden cursor-pointer"
          />
        </div>
      </div>

      {/* Fill Color (for shapes) */}
      {(element.type === "rectangle" || element.type === "circle") && (
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Fill</label>
          <div className="grid grid-cols-5 gap-1">
            <button
                onClick={() => onChange({ fill: "transparent" })}
                className={cn(
                  "w-6 h-6 rounded-md border border-border flex items-center justify-center text-[10px] text-muted-foreground bg-secondary",
                  element.fill === "transparent" && "ring-2 ring-accent ring-offset-1 ring-offset-background"
                )}
            >
                /
            </button>
            {COLORS.map((color) => (
              <button
                key={color}
                onClick={() => onChange({ fill: color })}
                className={cn(
                  "w-6 h-6 rounded-md border border-white/10 transition-transform hover:scale-110",
                  element.fill === color && "ring-2 ring-accent ring-offset-1 ring-offset-background"
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Stroke Width & Opacity */}
      <div className="space-y-3">
        <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
                <label>Stroke Width</label>
                <span>{element.strokeWidth || 2}px</span>
            </div>
            <input
                type="range"
                min="1"
                max="20"
                value={element.strokeWidth || 2}
                onChange={(e) => onChange({ strokeWidth: parseInt(e.target.value) })}
                className="w-full h-1 bg-secondary rounded-lg appearance-none cursor-pointer accent-accent"
            />
        </div>
        
        <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
                <label>Opacity</label>
                <span>{Math.round((element.opacity || 1) * 100)}%</span>
            </div>
            <input
                type="range"
                min="0.1"
                max="1"
                step="0.1"
                value={element.opacity || 1}
                onChange={(e) => onChange({ opacity: parseFloat(e.target.value) })}
                className="w-full h-1 bg-secondary rounded-lg appearance-none cursor-pointer accent-accent"
            />
        </div>
      </div>
      
      {/* Layers */}
      <div className="pt-2 border-t border-white/10">
        <label className="text-xs text-muted-foreground mb-2 block">Layers</label>
        <div className="flex gap-2">
            <button 
                onClick={onBringToFront}
                className="flex-1 flex items-center justify-center gap-2 p-1.5 text-xs bg-secondary hover:bg-accent rounded text-foreground transition-colors"
            >
                <ArrowUp className="w-3 h-3" /> Front
            </button>
            <button 
                onClick={onSendToBack}
                className="flex-1 flex items-center justify-center gap-2 p-1.5 text-xs bg-secondary hover:bg-accent rounded text-foreground transition-colors"
            >
                <ArrowDown className="w-3 h-3" /> Back
            </button>
        </div>
      </div>
    </div>
  );
}
