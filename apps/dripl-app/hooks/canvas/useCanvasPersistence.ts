'use client';

import { useEffect, useRef } from 'react';
import { useCanvasStore } from '@/lib/store';
import { saveLocalCanvasToStorage, type LocalCanvasState } from '@/utils/localCanvasStorage';

interface UseCanvasPersistenceProps {
  /**
   * True only for the unscoped scratch canvas at `/canvas`.
   *
   * `roomSlug === null` used to stand in for "local", but saved file pages also
   * have no room slug. They own their persistence through `FileCanvasRoute`,
   * so treating them as local overwrote the scratch canvas with whatever file
   * the user happened to open.
   */
  isLocalCanvas: boolean;
  theme: 'light' | 'dark';
  isDrawingRef: React.RefObject<boolean>;
  readOnly?: boolean;
}

export function useCanvasPersistence({
  isLocalCanvas,
  theme,
  isDrawingRef,
  readOnly = false,
}: UseCanvasPersistenceProps) {
  const flushToStorageRef = useRef<(() => void) | null>(null);

  flushToStorageRef.current = () => {
    if (!isLocalCanvas || readOnly) return;
    const state = useCanvasStore.getState();
    const appState: LocalCanvasState = {
      theme,
      zoom: state.zoom,
      panX: state.panX,
      panY: state.panY,
      currentStrokeColor: state.currentStrokeColor,
      currentBackgroundColor: state.currentBackgroundColor,
      currentStrokeWidth: state.currentStrokeWidth,
      currentRoughness: state.currentRoughness,
      currentStrokeStyle: state.currentStrokeStyle,
      currentFillStyle: state.currentFillStyle,
      canvasBackground: state.canvasBackground,
      activeTool: state.activeTool,
    };
    saveLocalCanvasToStorage(state.elements, appState, state.selectedIds);
  };

  // Activity-gated debounce: only serialize when the user is idle.
  useEffect(() => {
    if (!isLocalCanvas || readOnly) return;
    const IDLE_DELAY = 2500;
    const RETRY_DELAY = 2000;
    let timeoutId: ReturnType<typeof setTimeout>;

    const schedule = () => {
      timeoutId = setTimeout(
        () => {
          if (isDrawingRef.current) {
            schedule();
          } else {
            flushToStorageRef.current?.();
          }
        },
        isDrawingRef.current ? RETRY_DELAY : IDLE_DELAY
      );
    };

    schedule();

    // Re-save on every element change (debounced via the idle delay)
    const unsubscribe = useCanvasStore.subscribe((state, prevState) => {
      if (state.elements !== prevState.elements && !isDrawingRef.current) {
        clearTimeout(timeoutId);
        schedule();
      }
    });

    return () => {
      clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [isLocalCanvas, theme, isDrawingRef, readOnly]);

  // Flush immediately on tab close / navigation.
  useEffect(() => {
    if (!isLocalCanvas || readOnly) return;
    const handleBeforeUnload = () => flushToStorageRef.current?.();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isLocalCanvas, readOnly]);
}
