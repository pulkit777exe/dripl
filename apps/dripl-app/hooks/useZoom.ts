"use client";

import { useState, useCallback, useEffect } from "react";
import type { DriplElement, Point } from "@dripl/common";
import {
  zoomToFit,
  zoomToSelection,
  calculateZoom,
  getVisibleElements,
  getMousePosition,
  DEFAULT_ZOOM_SETTINGS,
} from "@/utils/zoomUtils";

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

export interface UseZoomReturn {
  viewport: Viewport;
  visibleElements: DriplElement[];
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  zoomToFit: (elements: DriplElement[]) => void;
  zoomToSelection: (selectedElements: DriplElement[]) => void;
  setZoom: (zoom: number, center?: Point) => void;
  getMousePosition: (event: React.MouseEvent<HTMLDivElement>) => Point;
  updateCanvasSize: () => void;
}

export function useZoom(elements: DriplElement[]): UseZoomReturn {
  const [viewport, setViewport] = useState<Viewport>({
    x: 0,
    y: 0,
    width: window.innerWidth,
    height: window.innerHeight,
    zoom: 1,
  });

  useEffect(() => {
    const handleResize = () => {
      setViewport((prev) => ({
        ...prev,
        width: window.innerWidth,
        height: window.innerHeight,
      }));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const visibleElements = getVisibleElements(elements, viewport);

  const updateCanvasSize = useCallback(() => {
    setViewport((prev) => ({
      ...prev,
      width: window.innerWidth,
      height: window.innerHeight,
    }));
  }, []);

  const zoomIn = useCallback(() => {
    setViewport((prev) => ({
      ...prev,
      zoom: calculateZoom(prev.zoom, 1),
    }));
  }, []);

  const zoomOut = useCallback(() => {
    setViewport((prev) => ({
      ...prev,
      zoom: calculateZoom(prev.zoom, -1),
    }));
  }, []);

  const resetZoom = useCallback(() => {
    setViewport((prev) => ({
      ...prev,
      zoom: 1,
      x: 0,
      y: 0,
    }));
  }, []);

  const handleZoomToFit = useCallback(
    (elementsToFit: DriplElement[]) => {
      const { zoom, centerX, centerY } = zoomToFit(
        elementsToFit,
        viewport.width,
        viewport.height
      );

      setViewport((prev) => ({
        ...prev,
        zoom,
        x: (prev.width / 2) - (centerX * zoom),
        y: (prev.height / 2) - (centerY * zoom),
      }));
    },
    [viewport.width, viewport.height]
  );

  const handleZoomToSelection = useCallback(
    (selectedElements: DriplElement[]) => {
      const result = zoomToSelection(
        selectedElements,
        viewport.width,
        viewport.height
      );

      if (result) {
        setViewport((prev) => ({
          ...prev,
          zoom: result.zoom,
          x: (prev.width / 2) - (result.centerX * result.zoom),
          y: (prev.height / 2) - (result.centerY * result.zoom),
        }));
      }
    },
    [viewport.width, viewport.height]
  );

  const handleSetZoom = useCallback(
    (newZoom: number, center?: Point) => {
      setViewport((prev) => {
        const boundedZoom = Math.min(
          Math.max(newZoom, DEFAULT_ZOOM_SETTINGS.minZoom),
          DEFAULT_ZOOM_SETTINGS.maxZoom
        );

        if (center) {
          const dx = prev.x + (center.x * prev.zoom) - (center.x * boundedZoom);
          const dy = prev.y + (center.y * prev.zoom) - (center.y * boundedZoom);
          
          return {
            ...prev,
            zoom: boundedZoom,
            x: dx,
            y: dy,
          };
        }

        return {
          ...prev,
          zoom: boundedZoom,
        };
      });
    },
    []
  );

  const handleGetMousePosition = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      return getMousePosition(event, viewport);
    },
    [viewport]
  );

  return {
    viewport,
    visibleElements,
    zoomIn,
    zoomOut,
    resetZoom,
    zoomToFit: handleZoomToFit,
    zoomToSelection: handleZoomToSelection,
    setZoom: handleSetZoom,
    getMousePosition: handleGetMousePosition,
    updateCanvasSize,
  };
}