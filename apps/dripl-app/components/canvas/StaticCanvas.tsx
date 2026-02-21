"use client";

import React, { useRef, useEffect, useMemo } from "react";
import { useCanvasStore } from "@/lib/canvas-store";
import type { DriplElement } from "@dripl/common";
import {
  createRoughCanvas,
  renderRoughElements,
  type RoughCanvas,
} from "@dripl/element";
import { getElementBounds } from "@dripl/math";
import { Viewport } from "@/utils/canvas-coordinates";
import { getVisibleElements } from "@/utils/viewport-culling";

interface StaticCanvasProps {
  containerRef: React.RefObject<HTMLDivElement>;
  elements: DriplElement[];
  selectedIds: Set<string>;
  viewport: Viewport;
  theme?: "light" | "dark";
}

interface StaticCanvasAppState {
  zoom: number;
  x: number;
  y: number;
  width: number;
  height: number;
  theme: "light" | "dark";
  selectedIds: Set<string>;
}

const getRelevantAppStateProps = (
  elements: DriplElement[],
  selectedIds: Set<string>,
  viewport: Viewport,
  theme: "light" | "dark"
): StaticCanvasAppState => {
  return {
    zoom: viewport.zoom,
    x: viewport.x,
    y: viewport.y,
    width: 0, // Will be set by container
    height: 0, // Will be set by container
    theme,
    selectedIds,
  };
};

const areEqual = (
  prevProps: StaticCanvasProps,
  nextProps: StaticCanvasProps
): boolean => {
  const prevState = getRelevantAppStateProps(
    prevProps.elements,
    prevProps.selectedIds,
    prevProps.viewport,
    prevProps.theme || "dark"
  );

  const nextState = getRelevantAppStateProps(
    nextProps.elements,
    nextProps.selectedIds,
    nextProps.viewport,
    nextProps.theme || "dark"
  );

  // Check if elements changed
  const elementsChanged =
    prevProps.elements.length !== nextProps.elements.length ||
    prevProps.elements.some((el, i) => {
      const prev = prevProps.elements[i];
      const next = nextProps.elements[i];
      if (!prev || !next) return true;
      return (
        el.id !== next.id ||
        el.x !== next.x ||
        el.y !== next.y ||
        el.width !== next.width ||
        el.height !== next.height ||
        el.type !== next.type ||
        el.strokeColor !== next.strokeColor ||
        el.backgroundColor !== next.backgroundColor ||
        el.strokeWidth !== next.strokeWidth ||
        el.opacity !== next.opacity ||
        el.roughness !== next.roughness ||
        el.strokeStyle !== next.strokeStyle ||
        el.fillStyle !== next.fillStyle ||
        JSON.stringify(el.points) !== JSON.stringify(next.points)
      );
    });

  // Check if selected ids changed
  const selectionChanged =
    prevProps.selectedIds.size !== nextProps.selectedIds.size ||
    Array.from(prevProps.selectedIds).some(
      (id) => !nextProps.selectedIds.has(id)
    );

  // Check if viewport changed
  const viewportChanged =
    prevProps.viewport.x !== nextProps.viewport.x ||
    prevProps.viewport.y !== nextProps.viewport.y ||
    prevProps.viewport.zoom !== nextProps.viewport.zoom;

  if (elementsChanged || selectionChanged || viewportChanged) {
    return false;
  }

  return true;
};

const StaticCanvas: React.FC<StaticCanvasProps> = ({
  containerRef,
  elements,
  selectedIds,
  viewport,
  theme = "dark",
}) => {
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  const staticRoughCanvasRef = useRef<RoughCanvas | null>(null);
  const isComponentMounted = useRef(false);

  const visibleElements = useMemo(
    () => getVisibleElements(elements, viewport),
    [elements, viewport],
  );

  useEffect(() => {
    if (staticCanvasRef.current && !staticRoughCanvasRef.current) {
      staticRoughCanvasRef.current = createRoughCanvas(
        staticCanvasRef.current
      );
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !staticCanvasRef.current) return;

    const canvas = staticCanvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();

    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
    }
  }, [containerRef]);

  useEffect(() => {
    if (!staticCanvasRef.current || !staticRoughCanvasRef.current) return;

    const canvas = staticCanvasRef.current;
    const ctx = canvas.getContext("2d");
    const rc = staticRoughCanvasRef.current;

    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    // Apply viewport transformations
    ctx.save();
    ctx.translate(viewport.x, viewport.y);
    ctx.scale(viewport.zoom, viewport.zoom);

    // Render only visible elements (viewport culling)
    renderRoughElements(rc, ctx, visibleElements, theme);

    // Render selection highlights on static canvas (for performance)
    if (selectedIds.size > 0) {
      ctx.save();
      ctx.strokeStyle = theme === "dark" ? "#6c47ff" : "#6b46c1";
      ctx.lineWidth = 2 / viewport.zoom;
      ctx.setLineDash([5 / viewport.zoom, 5 / viewport.zoom]);

      visibleElements.forEach((element) => {
        if (selectedIds.has(element.id)) {
          const bounds = getElementBounds(element);
          ctx.strokeRect(
            bounds.x - 5,
            bounds.y - 5,
            bounds.width + 10,
            bounds.height + 10
          );
        }
      });

      ctx.restore();
    }

    ctx.restore();
  }, [visibleElements, selectedIds, viewport, theme]);

  return (
    <canvas
      ref={staticCanvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 1 }}
    />
  );
};

export default React.memo(StaticCanvas, areEqual);
