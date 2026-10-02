'use client';

import { useCallback } from 'react';
import { useCanvasStore } from '@/lib/store';
import { CanvasContentSchema, type DriplElement } from '@dripl/common';
import { downloadBlob, exportCanvas } from '@/utils/export';
import { applyRestoredAppState, restoreAppState } from '@/lib/scene';
import { buildRasterExportOptions, exportFileName } from '@/lib/export-options';

/**
 * TopBar file operations — extracted from `TopBar`.
 *
 * Scene download/upload, quick PNG export, and canvas reset. File import
 * funnels through the shared restore pipeline (`restoreAppState` +
 * `applyRestoredAppState`) instead of a third copy of the apply logic, and
 * quick export reuses the modal's raster options so the canvas background
 * matches. `onActionDone` closes the menu after menu-initiated actions
 * (harmless no-op for keyboard-initiated ones). The TopBar keeps
 * share/collab/menu state and rendering.
 */
export function useTopBarFileOps({ onActionDone }: { onActionDone: () => void }) {
  const fileId = useCanvasStore(state => state.fileId);
  const fileName = useCanvasStore(state => state.fileName);
  const zoom = useCanvasStore(state => state.zoom);
  const panX = useCanvasStore(state => state.panX);
  const panY = useCanvasStore(state => state.panY);
  const gridEnabled = useCanvasStore(state => state.gridEnabled);
  const gridSize = useCanvasStore(state => state.gridSize);
  const canvasBackground = useCanvasStore(state => state.canvasBackground);
  const theme = useCanvasStore(state => state.theme);
  const setElements = useCanvasStore(state => state.setElements);
  const setSelectedIds = useCanvasStore(state => state.setSelectedIds);
  const setZoom = useCanvasStore(state => state.setZoom);
  const setPan = useCanvasStore(state => state.setPan);
  const setGridEnabled = useCanvasStore(state => state.setGridEnabled);
  const setGridSize = useCanvasStore(state => state.setGridSize);
  const setCanvasBackground = useCanvasStore(state => state.setCanvasBackground);
  const setTheme = useCanvasStore(state => state.setTheme);
  const setFileMetadata = useCanvasStore(state => state.setFileMetadata);

  const handleResetCanvas = useCallback(() => {
    if (confirm('Are you sure you want to reset the canvas? This cannot be undone.')) {
      useCanvasStore.getState().setElements([]);
    }
    onActionDone();
  }, [onActionDone]);

  const handleSaveToFile = useCallback(() => {
    const elements = useCanvasStore.getState().elements;
    const payload = {
      version: 1,
      type: 'dripl-scene',
      exportedAt: Date.now(),
      elements,
      appState: {
        zoom,
        panX,
        panY,
        gridEnabled,
        gridSize,
        canvasBackground,
        theme,
        fileName,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const safeName = (fileName || 'untitled').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    downloadBlob(blob, `${safeName || 'untitled'}.dripl`);
    onActionDone();
  }, [zoom, panX, panY, gridEnabled, gridSize, canvasBackground, theme, fileName, onActionDone]);

  const handleOpenFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.dripl,application/json';
    input.onchange = async event => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const raw = await file.text();
        const parsed = JSON.parse(raw) as unknown;

        let importedElements: DriplElement[] = [];
        let importedAppState: unknown;
        if (Array.isArray(parsed)) {
          importedElements = CanvasContentSchema.parse(parsed) as DriplElement[];
        } else if (parsed && typeof parsed === 'object' && 'elements' in parsed) {
          const scene = parsed as { elements?: unknown; appState?: unknown };
          importedElements = CanvasContentSchema.parse(scene.elements ?? []) as DriplElement[];
          importedAppState = scene.appState;
        } else {
          throw new Error('Invalid .dripl file format');
        }

        setElements(importedElements);
        setSelectedIds(new Set<string>());
        applyRestoredAppState(restoreAppState(importedAppState), {
          setZoom,
          setPan,
          setGridEnabled,
          setGridSize,
          setCanvasBackground,
          setTheme,
        });
        setFileMetadata(fileId, file.name.replace(/\.dripl$/i, ''));
      } catch (error) {
        // eslint-disable-next-line no-console -- file-open failure telemetry
        console.error('Failed to open .dripl file:', error);
        alert('Could not open this file. Please choose a valid .dripl file.');
      }
    };
    input.click();
    onActionDone();
  }, [
    fileId,
    setElements,
    setSelectedIds,
    setZoom,
    setPan,
    setGridEnabled,
    setGridSize,
    setCanvasBackground,
    setTheme,
    setFileMetadata,
  ]);

  const handleExportImage = useCallback(async () => {
    try {
      const elements = useCanvasStore.getState().elements;
      const blob = await Promise.resolve(
        exportCanvas('png', elements, buildRasterExportOptions({}, canvasBackground ?? '#ffffff'))
      );
      downloadBlob(blob, exportFileName('png'));
    } catch (error) {
      // eslint-disable-next-line no-console -- export failure telemetry
      console.error('PNG export failed:', error);
      alert('Failed to export PNG image.');
    } finally {
      onActionDone();
    }
  }, [canvasBackground, onActionDone]);

  return { handleResetCanvas, handleSaveToFile, handleOpenFile, handleExportImage };
}
