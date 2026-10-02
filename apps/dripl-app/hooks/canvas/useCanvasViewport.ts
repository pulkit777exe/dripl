'use client';

import { useCallback } from 'react';
import { getElementBounds } from '@dripl/math/intersection';
import { useCanvasStore } from '@/lib/store';
import { DEFAULT_ZOOM_SETTINGS } from '@/utils/zoomUtils';

export function useCanvasViewport(containerRef: React.RefObject<HTMLDivElement | null>) {
  const setZoom = useCanvasStore(state => state.setZoom);
  const setPan = useCanvasStore(state => state.setPan);

  const fitAllToScreen = useCallback(() => {
    const elements = useCanvasStore.getState().elements;
    if (!containerRef.current || elements.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    elements.forEach(element => {
      const bounds = getElementBounds(element);
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      maxY = Math.max(maxY, bounds.y + bounds.height);
    });

    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const padding = 64;
    const viewportWidth = containerRef.current.clientWidth - padding * 2;
    const viewportHeight = containerRef.current.clientHeight - padding * 2;
    const nextZoom = Math.max(
      DEFAULT_ZOOM_SETTINGS.minZoom,
      Math.min(
        DEFAULT_ZOOM_SETTINGS.maxZoom,
        Math.min(viewportWidth / contentWidth, viewportHeight / contentHeight)
      )
    );
    const nextPanX = containerRef.current.clientWidth / 2 - (minX + contentWidth / 2) * nextZoom;
    const nextPanY = containerRef.current.clientHeight / 2 - (minY + contentHeight / 2) * nextZoom;

    setZoom(nextZoom);
    setPan(nextPanX, nextPanY);
  }, [containerRef, setPan, setZoom]);

  const fitElementsToScreen = useCallback(
    (elementIds: string[]) => {
      const elements = useCanvasStore.getState().elements;
      if (!containerRef.current || elementIds.length === 0) return;

      const selectedElements = elements.filter(element => elementIds.includes(element.id));
      if (selectedElements.length === 0) return;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      selectedElements.forEach(element => {
        const bounds = getElementBounds(element);
        minX = Math.min(minX, bounds.x);
        minY = Math.min(minY, bounds.y);
        maxX = Math.max(maxX, bounds.x + bounds.width);
        maxY = Math.max(maxY, bounds.y + bounds.height);
      });

      const contentWidth = Math.max(1, maxX - minX);
      const contentHeight = Math.max(1, maxY - minY);
      const padding = 64;
      const viewportWidth = containerRef.current.clientWidth - padding * 2;
      const viewportHeight = containerRef.current.clientHeight - padding * 2;
      const nextZoom = Math.max(
        DEFAULT_ZOOM_SETTINGS.minZoom,
        Math.min(
          DEFAULT_ZOOM_SETTINGS.maxZoom,
          Math.min(viewportWidth / contentWidth, viewportHeight / contentHeight)
        )
      );
      const nextPanX = containerRef.current.clientWidth / 2 - (minX + contentWidth / 2) * nextZoom;
      const nextPanY =
        containerRef.current.clientHeight / 2 - (minY + contentHeight / 2) * nextZoom;

      setZoom(nextZoom);
      setPan(nextPanX, nextPanY);
    },
    [containerRef, setPan, setZoom]
  );

  return { fitAllToScreen, fitElementsToScreen };
}
