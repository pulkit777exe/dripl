'use client';

import { useEffect } from 'react';
import { useShallow } from 'zustand/shallow';
import { useCanvasStore } from '@/lib/canvas-store';
import type { ActiveTool } from '@/lib/canvas-store';
import type { DriplElement } from '@dripl/common';

interface InteractionRef {
  current: { isSpacePressed: boolean };
}

interface LastToolRef {
  current: string | null;
}

interface UseCanvasKeyboardOptions {
  interactionRef: InteractionRef;
  lastToolBeforeSpaceRef: LastToolRef;
  activeTool: ActiveTool;
  readOnly: boolean;
  elements: DriplElement[];
  setTextInput: (state: { x: number; y: number; id: string; value?: string; existingElementId?: string } | null) => void;
  setDrawingState: (next: boolean) => void;
  cancelDrawing: () => void;
  collectCascadeDeleteIds: (ids: Set<string>) => string[];
  copySelectedToClipboard: () => Promise<void>;
  pasteFromClipboard: () => Promise<void>;
  duplicateSelection: () => void;
  findOnCanvas: (query: string) => number;
  fitAllToScreen: () => void;
}

export function useCanvasKeyboard({
  interactionRef,
  lastToolBeforeSpaceRef,
  activeTool,
  readOnly,
  elements,
  setTextInput,
  setDrawingState,
  cancelDrawing,
  collectCascadeDeleteIds,
  copySelectedToClipboard,
  pasteFromClipboard,
  duplicateSelection,
  findOnCanvas,
  fitAllToScreen,
}: UseCanvasKeyboardOptions) {
  const store = useCanvasStore(
    useShallow(state => ({
      setActiveTool: state.setActiveTool,
      undo: state.undo,
      redo: state.redo,
      setSelectedIds: state.setSelectedIds,
      deleteElements: state.deleteElements,
      clearSelection: state.clearSelection,
      setGridEnabled: state.setGridEnabled,
      setPan: state.setPan,
      setZoom: state.setZoom,
      bringForward: state.bringForward,
      bringToFront: state.bringToFront,
      sendBackward: state.sendBackward,
      sendToBack: state.sendToBack,
      groupElements: state.groupElements,
      ungroupElements: state.ungroupElements,
    }))
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        return;

      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      const key = e.key.toLowerCase();

      if (e.code === 'Space') {
        if (!interactionRef.current.isSpacePressed) {
          interactionRef.current.isSpacePressed = true;
          if (activeTool !== 'hand') {
            lastToolBeforeSpaceRef.current = activeTool;
            store.setActiveTool('hand');
          }
        }
        e.preventDefault();
      }

      if (!cmdOrCtrl && !e.altKey && !e.shiftKey) {
        if (key === 'v') store.setActiveTool('select');
        if (key === 'r') store.setActiveTool('rectangle');
        if (key === 'd') store.setActiveTool('diamond');
        if (key === 'e' || key === 'o') store.setActiveTool('ellipse');
        if (key === 'p') store.setActiveTool('freedraw');
        if (key === 'l') store.setActiveTool('line');
        if (key === 'a') store.setActiveTool('arrow');
        if (key === 't') store.setActiveTool('text');
        if (key === 'f') store.setActiveTool('frame');
        if (key === 'x') store.setActiveTool('eraser');
        if (key === 'h') store.setActiveTool('hand');
      }

      if (cmdOrCtrl && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }

      if (cmdOrCtrl && key === 'y') {
        e.preventDefault();
        store.redo();
        return;
      }

      if (cmdOrCtrl && key === 'a') {
        e.preventDefault();
        store.setSelectedIds(new Set(elements.map(element => element.id)));
        return;
      }

      if (cmdOrCtrl && key === 'f') {
        e.preventDefault();
        const query = window.prompt('Find on canvas', '');
        if (query && query.trim()) {
          const count = findOnCanvas(query);
          if (count === 0) {
            alert('No matching elements found on canvas.');
          }
        }
        return;
      }

      if (cmdOrCtrl && key === 'c') {
        e.preventDefault();
        void copySelectedToClipboard();
        return;
      }

      if (cmdOrCtrl && key === 'v') {
        if (readOnly) return;
        e.preventDefault();
        void pasteFromClipboard();
        return;
      }

      if (cmdOrCtrl && key === 'd') {
        if (readOnly) return;
        e.preventDefault();
        duplicateSelection();
        return;
      }

      if (cmdOrCtrl && key === 'g') {
        e.preventDefault();
        if (e.shiftKey) {
          const ids = Array.from(useCanvasStore.getState().selectedIds);
          store.ungroupElements(ids);
        } else {
          const ids = Array.from(useCanvasStore.getState().selectedIds);
          store.groupElements(ids);
        }
        return;
      }

      if (cmdOrCtrl && e.altKey && key === 'g') {
        e.preventDefault();
        store.setGridEnabled(!useCanvasStore.getState().gridEnabled);
        return;
      }

      if (cmdOrCtrl && e.shiftKey && key === 'f') {
        e.preventDefault();
        fitAllToScreen();
        return;
      }

      if (cmdOrCtrl && key === '0') {
        e.preventDefault();
        fitAllToScreen();
        return;
      }

      if (cmdOrCtrl && e.shiftKey && key === 'h') {
        e.preventDefault();
        store.setZoom(1);
        store.setPan(0, 0);
        return;
      }

      if (key === '[') {
        if (readOnly) return;
        e.preventDefault();
        const ids = Array.from(useCanvasStore.getState().selectedIds);
        if (cmdOrCtrl) store.sendToBack(ids);
        else store.sendBackward(ids);
        return;
      }

      if (key === ']') {
        if (readOnly) return;
        e.preventDefault();
        const ids = Array.from(useCanvasStore.getState().selectedIds);
        if (cmdOrCtrl) store.bringToFront(ids);
        else store.bringForward(ids);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (readOnly) return;
        const { selectedIds: ids } = useCanvasStore.getState();
        if (ids.size > 0) {
          e.preventDefault();
          const idsArr = collectCascadeDeleteIds(ids);
          store.deleteElements(idsArr);
          store.clearSelection();
        }
      }

      if (e.key === 'Escape') {
        store.clearSelection();
        setTextInput(null);
        cancelDrawing();
        setDrawingState(false);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        interactionRef.current.isSpacePressed = false;
        if (
          activeTool === 'hand' &&
          lastToolBeforeSpaceRef.current &&
          lastToolBeforeSpaceRef.current !== 'hand'
        ) {
          store.setActiveTool(lastToolBeforeSpaceRef.current as ActiveTool);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    activeTool,
    readOnly,
    elements,
    interactionRef,
    lastToolBeforeSpaceRef,
    store,
    setTextInput,
    setDrawingState,
    cancelDrawing,
    collectCascadeDeleteIds,
    copySelectedToClipboard,
    pasteFromClipboard,
    duplicateSelection,
    findOnCanvas,
    fitAllToScreen,
  ]);
}
