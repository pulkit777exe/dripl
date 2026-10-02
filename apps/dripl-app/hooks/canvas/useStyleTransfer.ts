'use client';

import { useCallback, useRef } from 'react';
import { useCanvasStore } from '@/lib/store';
import {
  snapshotStyleFromElement,
  type CurrentStyleInput,
  type ElementStyleSnapshot,
} from '@/lib/canvas/style-transfer';

/**
 * Style clipboard (copy/paste styles) — Ctrl+Shift+C / Ctrl+Shift+V.
 *
 * Copy snapshots the primary selected element's style into the current
 * tool defaults (so new shapes inherit it) and keeps it for paste.
 * Paste applies the snapshot to the selection in one history entry.
 * Memory-only per tab, like the element clipboard.
 */
export function useStyleTransfer() {
  const copiedStyleRef = useRef<ElementStyleSnapshot | null>(null);

  const copyElementStyle = useCallback((): boolean => {
    const state = useCanvasStore.getState();
    const primaryId = state.selectedIds.values().next().value as string | undefined;
    const element = primaryId ? state.elementsById.get(primaryId) : undefined;
    if (!element) return false;
    const snapshot = snapshotStyleFromElement(element, {
      currentStrokeColor: state.currentStrokeColor,
      currentBackgroundColor: state.currentBackgroundColor,
      currentStrokeWidth: state.currentStrokeWidth,
      currentStrokeStyle: state.currentStrokeStyle,
      currentRoughness: state.currentRoughness,
      currentFillStyle: state.currentFillStyle,
    } satisfies CurrentStyleInput);
    copiedStyleRef.current = snapshot;
    // Adopt as the current defaults so subsequently drawn shapes match.
    state.setCurrentStrokeColor(snapshot.strokeColor);
    state.setCurrentBackgroundColor(snapshot.backgroundColor);
    state.setCurrentStrokeWidth(snapshot.strokeWidth);
    state.setCurrentStrokeStyle(snapshot.strokeStyle);
    state.setCurrentRoughness(snapshot.roughness);
    state.setCurrentFillStyle(snapshot.fillStyle);
    return true;
  }, []);

  const pasteElementStyle = useCallback((): boolean => {
    const snapshot = copiedStyleRef.current;
    if (!snapshot) return false;
    const state = useCanvasStore.getState();
    const ids = Array.from(state.selectedIds);
    if (ids.length === 0) return false;
    state.applyStyleToElements(ids, snapshot);
    return true;
  }, []);

  return { copyElementStyle, pasteElementStyle };
}
