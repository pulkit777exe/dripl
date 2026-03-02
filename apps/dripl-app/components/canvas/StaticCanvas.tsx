"use client";

import React, { useRef, useEffect, useCallback } from "react";
import type { DriplElement } from "@dripl/common";
import { renderStaticScene } from "@dripl/element";
import type { Viewport } from "@/utils/canvas-coordinates";

interface StaticCanvasProps {
  containerRef?: React.RefObject<HTMLDivElement>;
  elements: DriplElement[];
  selectedIds: Set<string>;
  viewport: Viewport;
  gridEnabled?: boolean;
  gridSize?: number;
  theme: "light" | "dark";
}

const StaticCanvas: React.FC<StaticCanvasProps> = ({
  containerRef,
  elements,
  selectedIds,
  viewport,
  gridEnabled = false,
  gridSize = 20,
  theme,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const container = containerRef?.current;
    const displayWidth = container ? container.clientWidth : viewport.width || window.innerWidth;
    const displayHeight = container ? container.clientHeight : viewport.height || window.innerHeight;

    if (displayWidth <= 0 || displayHeight <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const bufferWidth = Math.round(displayWidth * dpr);
    const bufferHeight = Math.round(displayHeight * dpr);

    if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
      canvas.width = bufferWidth;
      canvas.height = bufferHeight;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
    }

    const effectiveViewport: Viewport = {
      ...viewport,
      width: displayWidth,
      height: displayHeight,
    };

    renderStaticScene(canvas, elements, effectiveViewport, {
      gridEnabled,
      gridSize,
      zoom: viewport.zoom,
      theme,
      dpr,
    });
  }, [elements, viewport, gridEnabled, gridSize, theme, containerRef]);

  useEffect(() => {
    render();
  }, [render]);

  useEffect(() => {
    const handleResize = () => render();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [render]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: 1,
        touchAction: "none",
        imageRendering: "crisp-edges",
        pointerEvents: "none",
      }}
    />
  );
};

export default StaticCanvas;