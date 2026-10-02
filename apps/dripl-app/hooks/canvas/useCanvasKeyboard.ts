'use client';

import { useEffect } from 'react';
import { useShallow } from 'zustand/shallow';
import { useCanvasStore } from '@/lib/store';
import type { ActiveTool } from '@/lib/store';
import { DEFAULT_ZOOM_SETTINGS } from '@/utils/zoomUtils';
import { resolveKeybinding } from '@/lib/canvas/keybindings';

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
  setTextInput: (
    state: { x: number; y: number; id: string; value?: string; existingElementId?: string } | null
  ) => void;
  setDrawingState: (next: boolean) => void;
  cancelDrawing: () => void;
  collectCascadeDeleteIds: (ids: Set<string>) => string[];
  copySelectedToClipboard: () => Promise<void>;
  pasteFromClipboard: () => Promise<void>;
  duplicateSelection: () => void;
  findOnCanvas: (query: string) => number;
  fitAllToScreen: () => void;
  copyElementStyle: () => boolean;
  pasteElementStyle: () => boolean;
}

export function useCanvasKeyboard({
  interactionRef,
  lastToolBeforeSpaceRef,
  activeTool,
  readOnly,
  setTextInput,
  setDrawingState,
  cancelDrawing,
  collectCascadeDeleteIds,
  copySelectedToClipboard,
  pasteFromClipboard,
  duplicateSelection,
  findOnCanvas,
  fitAllToScreen,
  copyElementStyle,
  pasteElementStyle,
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
      translateElements: state.translateElements,
    }))
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInteractiveControl =
        target instanceof HTMLElement &&
        (target.matches('button, a, select, [role="button"], [role="checkbox"], [role="radio"]') ||
          target.closest(
            'button, a, select, [role="button"], [role="checkbox"], [role="radio"]'
          ) !== null);
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        (target instanceof HTMLElement && target.closest('[role="dialog"]')) ||
        (isInteractiveControl && e.key !== 'Escape')
      )
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

      // All remaining shortcuts dispatch through the pure precedence table
      // in lib/canvas/keybindings.ts; the hook only executes the action.
      const resolved = resolveKeybinding({
        key,
        cmdOrCtrl,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        readOnly,
        hasSelection: useCanvasStore.getState().selectedIds.size > 0,
      });
      if (!resolved) return;
      if (resolved.preventDefault) e.preventDefault();

      switch (resolved.action.kind) {
        case 'tool':
          store.setActiveTool(resolved.action.tool);
          return;
        case 'zoom-in':
          store.setZoom(
            Math.min(
              DEFAULT_ZOOM_SETTINGS.maxZoom,
              useCanvasStore.getState().zoom * DEFAULT_ZOOM_SETTINGS.zoomFactor
            )
          );
          return;
        case 'zoom-out':
          store.setZoom(
            Math.max(
              DEFAULT_ZOOM_SETTINGS.minZoom,
              useCanvasStore.getState().zoom / DEFAULT_ZOOM_SETTINGS.zoomFactor
            )
          );
          return;
        case 'reset-view':
          store.setZoom(1);
          store.setPan(0, 0);
          return;
        case 'undo':
          store.undo();
          return;
        case 'redo':
          store.redo();
          return;
        case 'select-all':
          store.setSelectedIds(
            new Set(useCanvasStore.getState().elements.map(element => element.id))
          );
          return;
        case 'find': {
          const query = window.prompt('Find on canvas', '');
          if (query && query.trim()) {
            const count = findOnCanvas(query);
            if (count === 0) {
              alert('No matching elements found on canvas.');
            }
          }
          return;
        }
        case 'copy':
          void copySelectedToClipboard();
          return;
        case 'paste':
          void pasteFromClipboard();
          return;
        case 'duplicate':
          duplicateSelection();
          return;
        case 'toggle-grid':
          store.setGridEnabled(!useCanvasStore.getState().gridEnabled);
          return;
        case 'group':
        case 'ungroup': {
          const ids = Array.from(useCanvasStore.getState().selectedIds);
          if (resolved.action.kind === 'group') store.groupElements(ids);
          else store.ungroupElements(ids);
          return;
        }
        case 'fit':
          fitAllToScreen();
          return;
        case 'send-backward':
        case 'send-to-back':
        case 'bring-forward':
        case 'bring-to-front': {
          const ids = Array.from(useCanvasStore.getState().selectedIds);
          if (resolved.action.kind === 'send-backward') store.sendBackward(ids);
          else if (resolved.action.kind === 'send-to-back') store.sendToBack(ids);
          else if (resolved.action.kind === 'bring-forward') store.bringForward(ids);
          else store.bringToFront(ids);
          return;
        }
        case 'delete-selection': {
          const { selectedIds: ids } = useCanvasStore.getState();
          const idsArr = collectCascadeDeleteIds(ids);
          store.deleteElements(idsArr);
          store.clearSelection();
          return;
        }
        case 'escape':
          store.clearSelection();
          setTextInput(null);
          cancelDrawing();
          setDrawingState(false);
          return;
        case 'nudge': {
          const ids = Array.from(useCanvasStore.getState().selectedIds);
          store.translateElements(ids, resolved.action.dx, resolved.action.dy);
          return;
        }
        case 'copy-style':
          copyElementStyle();
          return;
        case 'paste-style':
          pasteElementStyle();
          return;
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

    window.addEventListener('keydown', handleKeyDown as EventListener);
    // Keep key-up cleanup global so releasing Space after focus moves does not
    // leave the temporary hand tool active.
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown as EventListener);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    activeTool,
    readOnly,
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
