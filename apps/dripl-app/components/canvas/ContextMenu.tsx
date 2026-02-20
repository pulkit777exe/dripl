"use client";

import { useEffect, useRef } from "react";
import type { DriplElement } from "@dripl/common";
import { Copy, Trash2, Layers, RotateCcw } from "lucide-react";

interface ContextMenuProps {
  x: number;
  y: number;
  element: DriplElement | null;
  onClose: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
}

export function ContextMenu({
  x,
  y,
  element,
  onClose,
  onDuplicate,
  onDelete,
  onBringToFront,
  onSendToBack,
  onCopy,
  onPaste,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  if (!element) return null;

  return (
    <div
      ref={menuRef}
      className="absolute z-50 bg-card border border-border rounded-lg shadow-lg py-1 min-w-50 text-foreground"
      style={{ left: `${x}px`, top: `${y}px` }}
      role="menu"
      aria-label="Element context menu"
    >
      {onCopy && (
        <button
          className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-2 text-foreground"
          onClick={() => {
            onCopy();
            onClose();
          }}
          role="menuitem"
        >
          <Copy className="w-4 h-4" />
          Copy
        </button>
      )}
      {onPaste && (
        <button
          className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-2 text-foreground"
          onClick={() => {
            onPaste();
            onClose();
          }}
          role="menuitem"
        >
          <Copy className="w-4 h-4" />
          Paste
        </button>
      )}
      <button
        className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-2 text-foreground"
        onClick={() => {
          onDuplicate();
          onClose();
        }}
        role="menuitem"
      >
        <Copy className="w-4 h-4" />
        Duplicate
      </button>
      <div className="border-t border-border my-1" />
      <button
        className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-2 text-foreground"
        onClick={() => {
          onBringToFront();
          onClose();
        }}
        role="menuitem"
      >
        <Layers className="w-4 h-4" />
        Bring to Front
      </button>
      <button
        className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-2 text-foreground"
        onClick={() => {
          onSendToBack();
          onClose();
        }}
        role="menuitem"
      >
        <RotateCcw className="w-4 h-4" />
        Send to Back
      </button>
      <div className="border-t border-border my-1" />
      <button
        className="w-full px-4 py-2 text-left hover:bg-red-500/20 text-red-500 flex items-center gap-2"
        onClick={() => {
          onDelete();
          onClose();
        }}
        role="menuitem"
      >
        <Trash2 className="w-4 h-4" />
        Delete
      </button>
    </div>
  );
}
