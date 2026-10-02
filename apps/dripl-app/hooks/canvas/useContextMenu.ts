'use client';

import { useCallback, useEffect, useState } from 'react';
import { screenToCanvas, type Viewport } from '@/utils/canvas-coordinates';
import type { DriplElement } from '@dripl/common';

interface UseContextMenuOptions {
  readOnly: boolean;
  viewport: Viewport;
  getElementAtPosition: (x: number, y: number) => DriplElement | null | undefined;
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  elementId: string;
}

/**
 * Canvas context-menu state.
 *
 * Extracted verbatim from RoughCanvas: opening selects the hit element when
 * it is not already selected, and entering read-only mode dismisses the menu.
 */
export function useContextMenu({
  readOnly,
  viewport,
  getElementAtPosition,
  selectedIds,
  setSelectedIds,
}: UseContextMenuOptions) {
  const [contextMenuState, setContextMenuState] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    if (readOnly) setContextMenuState(null);
  }, [readOnly]);

  const openContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (readOnly) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const point = screenToCanvas(e.clientX - rect.left, e.clientY - rect.top, viewport);
      const element = getElementAtPosition(point.x, point.y);
      if (!element) {
        setContextMenuState(null);
        return;
      }
      if (!selectedIds.has(element.id)) {
        setSelectedIds(new Set([element.id]));
      }
      setContextMenuState({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        elementId: element.id,
      });
    },
    [getElementAtPosition, readOnly, selectedIds, setSelectedIds, viewport]
  );

  return { contextMenuState, setContextMenuState, openContextMenu };
}
