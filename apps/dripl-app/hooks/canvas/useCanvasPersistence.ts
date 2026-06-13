'use client';

import { useEffect, useRef } from 'react';
import { useCanvasStore } from '@/lib/canvas-store';
import { saveLocalCanvasToStorage, type LocalCanvasState } from '@/utils/localCanvasStorage';

interface UseCanvasPersistenceProps {
  roomSlug: string | null;
  theme: 'light' | 'dark';
  isDrawingRef: React.RefObject<boolean>;
}

export function useCanvasPersistence({ roomSlug, theme, isDrawingRef }: UseCanvasPersistenceProps) {
  const flushToStorageRef = useRef<(() => void) | null>(null);

  flushToStorageRef.current = () => {
    if (roomSlug !== null) return;
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
      activeTool: state.activeTool,
    };
    saveLocalCanvasToStorage(state.elements, appState, state.selectedIds);
  };

  // Activity-gated debounce: only serialize when the user is idle.
  useEffect(() => {
    if (roomSlug !== null) return;
    const IDLE_DELAY = 2500;
    const RETRY_DELAY = 2000;
    let timeoutId: ReturnType<typeof setTimeout>;

    const schedule = () => {
      timeoutId = setTimeout(() => {
        if (isDrawingRef.current) {
          schedule();
        } else {
          flushToStorageRef.current?.();
        }
      }, isDrawingRef.current ? RETRY_DELAY : IDLE_DELAY);
    };

    schedule();

    // Re-save on every element change (debounced via the idle delay)
    const unsubscribe = useCanvasStore.subscribe(
      (state, prevState) => {
        if (state.elements !== prevState.elements && !isDrawingRef.current) {
          clearTimeout(timeoutId);
          schedule();
        }
      }
    );

    return () => {
      clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [roomSlug, theme, isDrawingRef]);

  // Flush immediately on tab close / navigation.
  useEffect(() => {
    if (roomSlug !== null) return;
    const handleBeforeUnload = () => flushToStorageRef.current?.();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [roomSlug]);
}
