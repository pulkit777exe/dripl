"use client";

import React from "react";
import { X, Keyboard } from "lucide-react";

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpModal({ isOpen, onClose }: HelpModalProps) {
  if (!isOpen) return null;

  const shortcuts = [
    { key: "V / 1", action: "Selection Tool" },
    { key: "H / 2", action: "Hand (Pan) Tool" },
    { key: "R / 3", action: "Rectangle Tool" },
    { key: "C / 4", action: "Circle Tool" },
    { key: "P / 5", action: "Draw (Pencil) Tool" },
    { key: "T / 6", action: "Text Tool" },
    { key: "7", action: "Image Tool" },
    { key: "E / 0", action: "Eraser Tool" },
    { key: "Del / Backspace", action: "Delete Selection" },
    { key: "Ctrl + Z", action: "Undo" },
    { key: "Ctrl + Y", action: "Redo" },
    { key: "+ / -", action: "Zoom In / Out" },
  ];

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border bg-card">
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-accent" />
            <h2 className="text-sm font-semibold text-foreground">Keyboard Shortcuts</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-4 max-h-[60vh] overflow-y-auto">
          <div className="grid gap-2">
            {shortcuts.map((s) => (
              <div key={s.key} className="flex items-center justify-between p-2 rounded hover:bg-accent/20">
                <span className="text-sm text-foreground">{s.action}</span>
                <kbd className="px-2 py-1 text-xs font-mono bg-secondary rounded border border-border text-muted-foreground min-w-12 text-center">
                  {s.key}
                </kbd>
              </div>
            ))}
          </div>
        </div>
        
        <div className="p-4 bg-muted border-t border-border text-center">
            <p className="text-xs text-muted-foreground">
                Dripl Canvas - v1.0.0
            </p>
        </div>
      </div>
    </div>
  );
}
