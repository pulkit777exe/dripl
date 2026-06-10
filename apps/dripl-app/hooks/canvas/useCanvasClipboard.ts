'use client';

import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCanvasStore } from '@/lib/canvas-store';
import type { DriplElement } from '@dripl/common';
import { loadImage, uploadImageToServer } from '@/utils/tools/image';

export function useCanvasClipboard() {
  const addElement = useCanvasStore(state => state.addElement);
  const setSelectedIds = useCanvasStore(state => state.setSelectedIds);

  const duplicateSelection = useCallback(() => {
    const state = useCanvasStore.getState();
    const { selectedIds, elements } = state;
    if (selectedIds.size === 0) return;

    const selectedElements = elements.filter(element => selectedIds.has(element.id));
    const copies = selectedElements.map(element => ({
      ...element,
      id: uuidv4(),
      x: element.x + 10,
      y: element.y + 10,
    }));
    useCanvasStore.getState().addElements(copies);
    setSelectedIds(new Set(copies.map(element => element.id)));
    return;
  }, [setSelectedIds]);

  const copySelectedToClipboard = useCallback(async () => {
    const state = useCanvasStore.getState();
    const { selectedIds, elements } = state;
    if (selectedIds.size === 0) return;

    const selectedElements = elements.filter(element => selectedIds.has(element.id));
    try {
      await navigator.clipboard.writeText(JSON.stringify(selectedElements));
    } catch {
      // Clipboard API not available or denied
    }
  }, []);

  const pasteFromClipboard = useCallback(async () => {
    const state = useCanvasStore.getState();
    const { selectedIds, elements } = state;

    if (selectedIds.size > 0) {
      const selectedElements = elements.filter(element => selectedIds.has(element.id));
      const copies = selectedElements.map(element => ({
        ...element,
        id: uuidv4(),
        x: element.x + 10,
        y: element.y + 10,
      }));
      useCanvasStore.getState().addElements(copies);
      setSelectedIds(new Set(copies.map(element => element.id)));
      return;
    }

    if (typeof navigator.clipboard.read === 'function') {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes('image/png')) {
            const blob = await item.getType('image/png');
            const file = new File([blob], 'clipboard-image.png', { type: 'image/png' });
            
            // Upload to server and get URL
            const imageUrl = await uploadImageToServer(file);
            const imageResult = await loadImage(imageUrl);
            
            const element: DriplElement = {
              id: uuidv4(),
              type: 'image',
              x: 0,
              y: 0,
              width: imageResult.displayWidth,
              height: imageResult.displayHeight,
              strokeColor: 'transparent',
              backgroundColor: 'transparent',
              strokeWidth: 0,
              opacity: 1,
              src: imageUrl,
            };
            addElement(element);
            return;
          }

          if (item.types.includes('text/plain')) {
            const textBlob = await item.getType('text/plain');
            const text = await textBlob.text();
            try {
              const parsed = JSON.parse(text) as DriplElement[];
              if (Array.isArray(parsed) && parsed.length > 0) {
                const copies = parsed.map(el => ({
                  ...el,
                  id: uuidv4(),
                  x: (el.x ?? 0) + 10,
                  y: (el.y ?? 0) + 10,
                }));
                useCanvasStore.getState().addElements(copies);
                setSelectedIds(new Set(copies.map(el => el.id)));
                return;
              }
            } catch {
              // Not JSON elements, treat as text element
            }
          }
        }
      } catch {
        // Clipboard API not available or denied
      }
    }
  }, [addElement, setSelectedIds]);

  const findOnCanvas = useCallback(
    (query: string): number => {
      const state = useCanvasStore.getState();
      const lowerQuery = query.toLowerCase();
      const matchingIds: string[] = [];

      for (const element of state.elements) {
        if ('text' in element && typeof element.text === 'string') {
          if (element.text.toLowerCase().includes(lowerQuery)) {
            matchingIds.push(element.id);
          }
        }
        if ('name' in element && typeof (element as Record<string, unknown>).name === 'string') {
          const name = (element as Record<string, string>).name;
          if (name && name.toLowerCase().includes(lowerQuery)) {
            matchingIds.push(element.id);
          }
        }
      }

      if (matchingIds.length > 0) {
        setSelectedIds(new Set(matchingIds));
      }

      return matchingIds.length;
    },
    [setSelectedIds]
  );

  return { duplicateSelection, copySelectedToClipboard, pasteFromClipboard, findOnCanvas };
}
