"use client";

import { useEffect, useCallback } from "react";
import type { DriplElement } from "@dripl/common";

export interface AccessibilityConfig {
  announceSelection?: (message: string) => void;
  announceToolChange?: (message: string) => void;
  announceUndo?: (message: string) => void;
  announceRedo?: (message: string) => void;
  announceElementCreated?: (message: string) => void;
  announceElementDeleted?: (message: string) => void;
  enabled?: boolean;
}

export function useAccessibility({
  announceSelection,
  announceToolChange,
  announceUndo,
  announceRedo,
  announceElementCreated,
  announceElementDeleted,
  enabled = true,
}: AccessibilityConfig) {
  const defaultAnnounce = useCallback(
    (message: string) => {
      if (!enabled) return;

      let liveRegion = document.getElementById("aria-live-region");
      if (!liveRegion) {
        liveRegion = document.createElement("div");
        liveRegion.id = "aria-live-region";
        liveRegion.setAttribute("aria-live", "polite");
        liveRegion.setAttribute("aria-atomic", "true");
        liveRegion.className = "sr-only";
        liveRegion.style.cssText =
          "position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0;";
        document.body.appendChild(liveRegion);
      }

      liveRegion.textContent = message;
      setTimeout(() => {
        if (liveRegion) liveRegion.textContent = "";
      }, 1000);
    },
    [enabled],
  );

  const announce = useCallback(
    (message: string) => {
      defaultAnnounce(message);
    },
    [defaultAnnounce],
  );

  return {
    announce,
    announceSelection: (count: number) => {
      const message =
        count === 0
          ? "Selection cleared"
          : count === 1
            ? "1 element selected"
            : `${count} elements selected`;
      announceSelection?.(message) || announce(message);
    },
    announceToolChange: (tool: string) => {
      const message = `${tool} tool activated`;
      announceToolChange?.(message) || announce(message);
    },
    announceUndo: () => {
      const message = "Undone";
      announceUndo?.(message) || announce(message);
    },
    announceRedo: () => {
      const message = "Redone";
      announceRedo?.(message) || announce(message);
    },
    announceElementCreated: (type: string) => {
      const message = `${type} created`;
      announceElementCreated?.(message) || announce(message);
    },
    announceElementDeleted: (count: number) => {
      const message =
        count === 1 ? "Element deleted" : `${count} elements deleted`;
      announceElementDeleted?.(message) || announce(message);
    },
  };
}

export function getElementAccessibleLabel(element: DriplElement): string {
  switch (element.type) {
    case "rectangle":
      return `Rectangle at position ${Math.round(element.x)}, ${Math.round(element.y)}`;
    case "ellipse":
      return `Ellipse at position ${Math.round(element.x)}, ${Math.round(element.y)}`;
    case "diamond":
      return `Diamond at position ${Math.round(element.x)}, ${Math.round(element.y)}`;
    case "arrow":
      return `Arrow from ${element.x}, ${element.y}`;
    case "line":
      return `Line from ${element.x}, ${element.y}`;
    case "freedraw":
      return `Freehand drawing at ${element.x}, ${element.y}`;
    case "text":
      return `Text: ${"text" in element ? element.text : ""}`;
     case "image":
       return `Image at position ${Math.round(element.x)}, ${Math.round(element.y)}`;
     case "frame":
       return `Frame at position ${Math.round(element.x)}, ${Math.round(element.y)}`;
     default: {
       const _exhaustive: never = element;
       return `Element at position ${Math.round((_exhaustive as DriplElement).x)}, ${Math.round((_exhaustive as DriplElement).y)}`;
    }
  }
}

export function addCanvasAriaAttributes(
  canvas: HTMLCanvasElement,
  role: string = "img",
  label: string = "Drawing canvas",
): void {
  canvas.setAttribute("role", role);
  canvas.setAttribute("aria-label", label);
  canvas.setAttribute("tabindex", "0");
}
