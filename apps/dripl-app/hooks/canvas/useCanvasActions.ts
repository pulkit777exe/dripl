'use client';

import { useCallback } from 'react';
import { useCanvasStore, type ActiveTool } from '@/lib/store';
import { collectCascadeDeleteIds } from '@dripl/common/cascade-delete';
import { getElementBounds } from '@dripl/math/intersection';
import type { DriplElement } from '@dripl/common';
import { getDefaultFontFamily } from '@/utils/fontPreferences';

interface UseCanvasActionsOptions {
  elements: DriplElement[];
}

/**
 * Canvas action callbacks (ActionManager-lite).
 *
 * Extracted verbatim from RoughCanvas: cascade-delete resolution, the tool
 * reversion rule, frame auto-grouping, and text-input commit. All store
 * writes go through `useCanvasStore.getState()` except the subscribed
 * rule inputs (`toolLocked`, `readOnly`, `textInput`, `activeTool`,
 * `currentStrokeColor`).
 */
export function useCanvasActions({ elements }: UseCanvasActionsOptions) {
  const toolLocked = useCanvasStore(state => state.toolLocked);
  const readOnly = useCanvasStore(state => state.readOnly);
  const textInput = useCanvasStore(state => state.textInput);
  const activeTool = useCanvasStore(state => state.activeTool);
  const currentStrokeColor = useCanvasStore(state => state.currentStrokeColor);

  const collectCascadeDeleteIdsCallback = useCallback(
    (seedIds: Iterable<string>): string[] => {
      return collectCascadeDeleteIds(seedIds, elements);
    },
    [elements]
  );

  const maybeRevertToSelectTool = useCallback(
    (completedTool: ActiveTool) => {
      if (toolLocked || completedTool === 'laser') return;
      // RULE: Tool Reversion
      useCanvasStore.getState().setActiveTool('select');
    },
    [toolLocked]
  );

  const applyFrameGrouping = useCallback((frameElement: DriplElement) => {
    const store = useCanvasStore.getState();
    if (store.readOnly || frameElement.type !== 'frame') return;

    const frameBounds = getElementBounds(frameElement);
    const frameRight = frameBounds.x + frameBounds.width;
    const frameBottom = frameBounds.y + frameBounds.height;

    const groupedIds = store.elements
      .filter(element => element.id !== frameElement.id)
      .filter(element => {
        const bounds = getElementBounds(element);
        return (
          bounds.x >= frameBounds.x &&
          bounds.y >= frameBounds.y &&
          bounds.x + bounds.width <= frameRight &&
          bounds.y + bounds.height <= frameBottom
        );
      })
      .map(element => element.id);

    if (groupedIds.length === 0) return;

    const frameGroupId = `frame-${frameElement.id}`;
    const idsToGroup = new Set([frameElement.id, ...groupedIds]);

    const nextElements = store.elements.map(element => {
      if (!idsToGroup.has(element.id)) return element;
      return { ...element, groupId: frameGroupId } as DriplElement;
    });

    store.setElements(nextElements);
    store.setSelectedIds(new Set([frameElement.id, ...groupedIds]));
  }, []);

  const handleTextSubmit = useCallback(
    (text: string) => {
      const store = useCanvasStore.getState();
      if (store.readOnly) {
        store.setTextInput(null);
        return;
      }
      const input = store.textInput;
      if (!input || !text.trim()) {
        store.setTextInput(null);
        if (store.activeTool === 'text') {
          if (!store.toolLocked) store.setActiveTool('select');
        }
        return;
      }

      const lines = text.split('\n');
      const lineHeightFactor = 1.25;
      // Use a base fontSize for measurement; actual fontSize comes from element (if editing) or default
      const baseFontSize = input.existingElementId
        ? (elements.find(el => el.id === input.existingElementId)?.fontSize ?? 20)
        : 20;
      const lineHeight = baseFontSize * lineHeightFactor;
      const measuredWidth = Math.max(40, ...lines.map(line => line.length * (baseFontSize * 0.55)));
      const measuredHeight = Math.max(lineHeight, lines.length * lineHeight);

      if (input.existingElementId) {
        const existingElement = elements.find(el => el.id === input.existingElementId);
        store.updateElement(input.existingElementId, {
          text,
          width: measuredWidth,
          height: measuredHeight,
          // Re-measure and update fontSize/width/height based on new content while preserving user's font
          fontSize: existingElement?.fontSize ?? 20,
          fontFamily: existingElement?.fontFamily ?? getDefaultFontFamily(),
        } as Partial<DriplElement>);
        store.setTextInput(null);
        if (store.activeTool === 'text') {
          if (!store.toolLocked) store.setActiveTool('select');
        }
        return;
      }

      const textElement: DriplElement = {
        id: input.id,
        type: 'text',
        x: input.x,
        y: input.y,
        width: measuredWidth,
        height: measuredHeight,
        strokeColor: store.currentStrokeColor,
        backgroundColor: 'transparent',
        strokeWidth: 1,
        opacity: 1,
        text,
        fontSize: baseFontSize,
        fontFamily: getDefaultFontFamily(),
      };

      store.addElement(textElement);
      store.setTextInput(null);
      if (store.activeTool === 'text') {
        if (!store.toolLocked) store.setActiveTool('select');
      }
    },
    [elements]
  );

  return {
    collectCascadeDeleteIdsCallback,
    maybeRevertToSelectTool,
    applyFrameGrouping,
    handleTextSubmit,
    // Rule inputs, re-exposed so the orchestrator keeps a single subscription point.
    toolLocked,
    readOnly,
    textInput,
    activeTool,
    currentStrokeColor,
  };
}
