"use client";

import { useCallback } from "react";
import type { DriplElement } from "@dripl/common";

export type ExportFormat = "png" | "svg" | "json" | "clipboard";

interface ExportOptions {
  format: ExportFormat;
  quality?: number;
  includeBackground?: boolean;
  selectedOnly?: boolean;
  scale?: number;
}

export function useExport() {
  const toJSON = useCallback(
    (elements: DriplElement[], pretty: boolean = true): string => {
      const exportData = {
        version: 1,
        type: "dripl-canvas",
        exportedAt: new Date().toISOString(),
        elements: elements.filter((el) => !el.isDeleted),
      };

      return pretty
        ? JSON.stringify(exportData, null, 2)
        : JSON.stringify(exportData);
    },
    [],
  );

  const toPNG = useCallback(
    async (
      canvas: HTMLCanvasElement,
      options: { quality?: number; scale?: number } = {},
    ): Promise<Blob> => {
      const { quality = 1, scale = 2 } = options;

      const scaledCanvas = document.createElement("canvas");
      scaledCanvas.width = canvas.width * scale;
      scaledCanvas.height = canvas.height * scale;

      const ctx = scaledCanvas.getContext("2d");
      if (!ctx) throw new Error("Could not get canvas context");

      ctx.scale(scale, scale);
      ctx.drawImage(canvas, 0, 0);

      return new Promise((resolve, reject) => {
        scaledCanvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Failed to export PNG"));
          },
          "image/png",
          quality,
        );
      });
    },
    [],
  );

  const toSVG = useCallback(
    (elements: DriplElement[], width: number, height: number): string => {
      const visibleElements = elements.filter((el) => !el.isDeleted);

      let svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .dripl-shape { fill: none; stroke: #000; stroke-width: 2; }
  </style>
  <rect width="100%" height="100%" fill="white"/>
  <g id="elements">`;

      for (const element of visibleElements) {
        switch (element.type) {
          case "rectangle":
            svgContent += `
    <rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" 
          stroke="${element.strokeColor}" fill="${element.backgroundColor}" 
          stroke-width="${element.strokeWidth}" opacity="${element.opacity}" class="dripl-shape"/>`;
            break;
          case "ellipse":
            svgContent += `
    <ellipse cx="${element.x + element.width / 2}" cy="${element.y + element.height / 2}" 
             rx="${element.width / 2}" ry="${element.height / 2}"
             stroke="${element.strokeColor}" fill="${element.backgroundColor}" 
             stroke-width="${element.strokeWidth}" opacity="${element.opacity}" class="dripl-shape"/>`;
            break;
          case "diamond":
            const cx = element.x + element.width / 2;
            const cy = element.y + element.height / 2;
            svgContent += `
    <polygon points="${cx},${element.y} ${element.x + element.width},${cy} ${cx},${element.y + element.height} ${element.x},${cy}"
             stroke="${element.strokeColor}" fill="${element.backgroundColor}" 
             stroke-width="${element.strokeWidth}" opacity="${element.opacity}" class="dripl-shape"/>`;
            break;
          case "text":
            if ("text" in element) {
              svgContent += `
    <text x="${element.x}" y="${element.y + 20}" 
          fill="${element.strokeColor}" opacity="${element.opacity}"
          font-size="${"fontSize" in element ? element.fontSize : 16}px">${element.text}</text>`;
            }
            break;
          // Add more element types
        }
      }

      svgContent += `
  </g>
</svg>`;

      return svgContent;
    },
    [],
  );

  const toClipboard = useCallback(
    async (elements: DriplElement[]): Promise<void> => {
      const json = JSON.stringify({
        type: "dripl-clipboard",
        elements: elements.filter((el) => !el.isDeleted),
      });

      await navigator.clipboard.writeText(json);
    },
    [],
  );

  const downloadFile = useCallback(
    (content: Blob | string, filename: string): void => {
      const blob =
        typeof content === "string"
          ? new Blob([content], { type: "text/plain" })
          : content;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    [],
  );

  const exportCanvas = useCallback(
    async (
      elements: DriplElement[],
      canvas: HTMLCanvasElement | null,
      options: ExportOptions,
    ): Promise<void> => {
      const { format, selectedOnly = false, quality = 1, scale = 2 } = options;

      const elementsToExport = selectedOnly
        ? elements.filter((el) => !el.isDeleted)
        : elements.filter((el) => !el.isDeleted);

      switch (format) {
        case "json": {
          const json = toJSON(elementsToExport);
          downloadFile(json, `canvas-${Date.now()}.json`);
          break;
        }
        case "png": {
          if (!canvas) throw new Error("Canvas required for PNG export");
          const blob = await toPNG(canvas, { quality, scale });
          downloadFile(blob, `canvas-${Date.now()}.png`);
          break;
        }
        case "svg": {
          const width = canvas?.width || 1920;
          const height = canvas?.height || 1080;
          const svg = toSVG(elementsToExport, width, height);
          downloadFile(svg, `canvas-${Date.now()}.svg`);
          break;
        }
        case "clipboard": {
          await toClipboard(elementsToExport);
          break;
        }
      }
    },
    [toJSON, toPNG, toSVG, toClipboard, downloadFile],
  );

  return {
    exportCanvas,
    toJSON,
    toPNG,
    toSVG,
    toClipboard,
    downloadFile,
  };
}
