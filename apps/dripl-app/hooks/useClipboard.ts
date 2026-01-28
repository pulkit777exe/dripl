"use client";

import { useCallback, useRef } from "react";
import type { DriplElement } from "@dripl/common";

interface ClipboardData {
  type: "dripl-clipboard";
  elements: DriplElement[];
}

/**
 * Hook for clipboard operations on canvas elements
 * Supports copy, cut, paste operations
 */
export function useClipboard() {
  const localClipboard = useRef<DriplElement[]>([]);

  /**
   * Copy elements to clipboard
   */
  const copy = useCallback(async (elements: DriplElement[]): Promise<void> => {
    if (elements.length === 0) return;

    const data: ClipboardData = {
      type: "dripl-clipboard",
      elements: elements.map((el) => ({ ...el })),
    };

    const json = JSON.stringify(data);

    try {
      await navigator.clipboard.writeText(json);
      // Also store locally for same-tab operations
      localClipboard.current = elements.map((el) => ({ ...el }));
    } catch (error) {
      // Fallback to local clipboard only
      console.warn("System clipboard not available:", error);
      localClipboard.current = elements.map((el) => ({ ...el }));
    }
  }, []);

  /**
   * Paste elements from clipboard
   * Returns new elements with fresh IDs and offset positions
   */
  const paste = useCallback(
    async (
      offset: { x: number; y: number } = { x: 20, y: 20 },
    ): Promise<DriplElement[]> => {
      let elements: DriplElement[] = [];

      try {
        const text = await navigator.clipboard.readText();
        const data = JSON.parse(text);

        if (data.type === "dripl-clipboard" && Array.isArray(data.elements)) {
          elements = data.elements;
        }
      } catch {
        // Fallback to local clipboard
        elements = localClipboard.current;
      }

      if (elements.length === 0) return [];

      // Generate new IDs and offset positions
      return elements.map((el) => ({
        ...el,
        id: crypto.randomUUID(),
        x: el.x + offset.x,
        y: el.y + offset.y,
      }));
    },
    [],
  );

  /**
   * Cut elements (copy + mark for deletion)
   * Returns the element IDs that should be deleted
   */
  const cut = useCallback(
    async (elements: DriplElement[]): Promise<string[]> => {
      await copy(elements);
      return elements.map((el) => el.id);
    },
    [copy],
  );

  /**
   * Check if clipboard has Dripl content
   */
  const hasContent = useCallback(async (): Promise<boolean> => {
    if (localClipboard.current.length > 0) return true;

    try {
      const text = await navigator.clipboard.readText();
      const data = JSON.parse(text);
      return data.type === "dripl-clipboard" && Array.isArray(data.elements);
    } catch {
      return false;
    }
  }, []);

  /**
   * Clear local clipboard
   */
  const clear = useCallback((): void => {
    localClipboard.current = [];
  }, []);

  return {
    copy,
    paste,
    cut,
    hasContent,
    clear,
  };
}
