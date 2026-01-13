"use client";

import { useEffect, useCallback } from "react";
import type { ToolType } from "./useDrawingTools";

export interface KeyboardShortcutsConfig {
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
  undo: () => void;
  redo: () => void;
  duplicate: () => void;
  deleteSelected: () => void;
  selectAll: () => void;
  copy?: () => void;
  paste?: () => void;
  escape?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
  enabled?: boolean;
}

/**
 * Hook for keyboard shortcuts
 * Implements all standard shortcuts for a drawing application
 */
export function useKeyboardShortcuts({
  activeTool,
  setActiveTool,
  undo,
  redo,
  duplicate,
  deleteSelected,
  selectAll,
  copy,
  paste,
  escape,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  enabled = true,
}: KeyboardShortcutsConfig) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Don't trigger shortcuts when typing in input fields
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Tool shortcuts (only when not holding modifier keys)
      if (!cmdOrCtrl && !e.shiftKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case "v":
            e.preventDefault();
            setActiveTool("select");
            return;
          case "r":
            e.preventDefault();
            setActiveTool("rectangle");
            return;
          case "e":
            e.preventDefault();
            setActiveTool("ellipse");
            return;
          case "a":
            e.preventDefault();
            setActiveTool("arrow");
            return;
          case "l":
            e.preventDefault();
            setActiveTool("line");
            return;
          case "p":
            e.preventDefault();
            setActiveTool("freedraw");
            return;
          case "t":
            e.preventDefault();
            setActiveTool("text");
            return;
        }
      }

      // Command/Ctrl shortcuts
      if (cmdOrCtrl) {
        switch (e.key.toLowerCase()) {
          case "z":
            e.preventDefault();
            if (e.shiftKey) {
              redo();
            } else {
              undo();
            }
            return;
          case "d":
            e.preventDefault();
            duplicate();
            return;
          case "a":
            e.preventDefault();
            selectAll();
            return;
          case "c":
            e.preventDefault();
            copy?.();
            return;
          case "v":
            e.preventDefault();
            paste?.();
            return;
          case "g":
            e.preventDefault();
            // Group (future feature)
            return;
          case "=":
          case "+":
            e.preventDefault();
            onZoomIn?.();
            return;
          case "-":
            e.preventDefault();
            onZoomOut?.();
            return;
          case "0":
            e.preventDefault();
            onResetZoom?.();
            return;
        }
      }

      // Delete/Backspace
      if ((e.key === "Delete" || e.key === "Backspace") && !cmdOrCtrl) {
        e.preventDefault();
        deleteSelected();
        return;
      }

      // Escape
      if (e.key === "Escape") {
        e.preventDefault();
        escape?.();
        return;
      }
    },
    [
      enabled,
      activeTool,
      setActiveTool,
      undo,
      redo,
      duplicate,
      deleteSelected,
      selectAll,
      copy,
      paste,
      escape,
      onZoomIn,
      onZoomOut,
      onResetZoom,
    ]
  );

  useEffect(() => {
    if (enabled) {
      window.addEventListener("keydown", handleKeyDown);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [enabled, handleKeyDown]);
}
