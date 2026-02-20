"use client";

import { useState } from "react";
import { useCanvasStore } from "@/lib/canvas-store";
import { Download, X } from "lucide-react";
import { createRoughCanvas, renderRoughElement } from "@dripl/element";
import rough from "roughjs";

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExportModal({ isOpen, onClose }: ExportModalProps) {
  const elements = useCanvasStore((state) => state.elements);
  const [exporting, setExporting] = useState(false);

  if (!isOpen) return null;

  const getBounds = () => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    if (elements.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };

    elements.forEach((el) => {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      const width = "width" in el ? el.width : 0;
      const height = "height" in el ? el.height : 0;
      maxX = Math.max(maxX, el.x + width);
      maxY = Math.max(maxY, el.y + height);
    });

    return {
      minX: minX - 20,
      minY: minY - 20,
      maxX: maxX + 20,
      maxY: maxY + 20,
    };
  };

  const exportAsJSON = () => {
    const json = JSON.stringify(elements, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `canvas-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAsPNG = async () => {
    setExporting(true);
    try {
      const { minX, minY, maxX, maxY } = getBounds();
      const width = maxX - minX;
      const height = maxY - minY;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Background
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);

      // Setup Rough
      const rc = createRoughCanvas(canvas);
      if (!rc) return;

      // Translate context to local coordinates
      ctx.translate(-minX, -minY);

      // Render all elements
      // Note: We duplicate render logic here or reuse renderRoughElement.
      // renderRoughElement uses cache but handles transforms.
      // It expects context to be transformed for Zoom/Pan? No, it handles local rotation.
      // We only need to handle the global shift (-minX, -minY).

      elements.forEach((el) => {
        renderRoughElement(rc, ctx, el);
      });

      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `canvas-${Date.now()}.png`;
          a.click();
          URL.revokeObjectURL(url);
        }
        setExporting(false);
      });
    } catch (error) {
      console.error("Failed to export PNG:", error);
      setExporting(false);
    }
  };

  const exportAsSVG = async () => {
    setExporting(true);
    try {
      const { minX, minY, maxX, maxY } = getBounds();
      const width = maxX - minX;
      const height = maxY - minY;

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", width.toString());
      svg.setAttribute("height", height.toString());
      svg.setAttribute("viewBox", `${minX} ${minY} ${width} ${height}`);
      svg.style.backgroundColor = "#ffffff";

      const rc = rough.svg(svg);

      elements.forEach((el) => {
        // Rough.js SVG rendering
        // We need to generate shapes.
        // Reuse shape generation logic?
        // rough-renderer only exports `renderRoughElement` which draws to Canvas.
        // We need a `getShape` or similar.
        // Or we just manually use `rc.rectangle/ellipse` etc here matching standard styles.

        // For now, let's just implement basic rough SVG support without full cache reuse to enable the feature.
        // To match styles we need to copy options logic.

        const options = {
          stroke: el.strokeColor,
          strokeWidth: el.strokeWidth,
          fill:
            el.backgroundColor !== "transparent"
              ? el.backgroundColor
              : undefined,
          fillStyle: "hachure",
          roughness: 1, // Default, assume 1 as we don't have it in types yet or use prop
          // ...
        };
        // Add checks for props
        // ...

        // BUT, `rough-renderer.ts` has the accurate logic.
        // Refactoring rough-renderer to return shapes for SVG would be best.
        // But for MVP export, let's keep it simple.

        let node;

        // Simplification: Not full feature parity with canvas renderer (e.g. cache)
        // but functional for basic shapes.

        switch (el.type) {
          case "rectangle":
            node = rc.rectangle(el.x, el.y, el.width, el.height, options);
            break;
          case "ellipse":
            node = rc.ellipse(
              el.x + el.width / 2,
              el.y + el.height / 2,
              el.width,
              el.height,
              options,
            );
            break;
          case "line":
          case "arrow":
          case "freedraw":
            if ("points" in el && el.points) {
              const points = el.points.map(
                (p: any) => [p.x, p.y] as [number, number],
              );
              if (el.type === "freedraw") {
                node = rc.curve(points, options);
              } else {
                node = rc.linearPath(points, options);
              }
            }
            break;
          case "text":
            // RoughJS doesn't do text, specific SVG node needed
            const textNode = document.createElementNS(
              "http://www.w3.org/2000/svg",
              "text",
            );
            textNode.setAttribute("x", el.x.toString());
            textNode.setAttribute(
              "y",
              (el.y + ("fontSize" in el ? el.fontSize || 16 : 16)).toString(),
            );
            textNode.setAttribute(
              "font-family",
              "fontFamily" in el ? el.fontFamily || "sans-serif" : "sans-serif",
            );
            textNode.setAttribute(
              "font-size",
              ("fontSize" in el ? el.fontSize || 16 : 16).toString(),
            );
            textNode.setAttribute("fill", el.strokeColor || "#000000");
            textNode.textContent = "text" in el ? el.text || "" : "";
            svg.appendChild(textNode);
            break;
          case "image":
            if ("src" in el && el.src) {
              const imgNode = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "image",
              );
              imgNode.setAttribute("x", el.x.toString());
              imgNode.setAttribute("y", el.y.toString());
              imgNode.setAttribute("width", el.width.toString());
              imgNode.setAttribute("height", el.height.toString());
              imgNode.setAttribute("href", el.src);
              svg.appendChild(imgNode);
            }
            break;
        }

        if (node) svg.appendChild(node);
      });

      // Serialize
      const s = new XMLSerializer();
      const str = s.serializeToString(svg);
      const blob = new Blob([str], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `canvas-${Date.now()}.svg`;
      a.click();
      URL.revokeObjectURL(url);

      setExporting(false);
    } catch (e) {
      console.error(e);
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 pointer-events-auto">
      <div className="bg-background rounded-lg shadow-xl p-6 w-96">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Export Canvas</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <button
            onClick={exportAsJSON}
            className="w-full flex items-center gap-3 p-4 border rounded-lg hover:bg-accent transition-colors"
          >
            <Download className="w-5 h-5" />
            <div className="text-left">
              <div className="font-medium">Export as JSON</div>
              <div className="text-sm text-muted-foreground">
                Save all elements as JSON data
              </div>
            </div>
          </button>

          <button
            onClick={exportAsPNG}
            disabled={exporting}
            className="w-full flex items-center gap-3 p-4 border rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
          >
            <Download className="w-5 h-5" />
            <div className="text-left">
              <div className="font-medium">
                {exporting ? "Exporting..." : "Export as PNG"}
              </div>
              <div className="text-sm text-muted-foreground">
                High-quality raster image
              </div>
            </div>
          </button>

          <button
            onClick={exportAsSVG}
            disabled={exporting}
            className="w-full flex items-center gap-3 p-4 border rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
          >
            <Download className="w-5 h-5" />
            <div className="text-left">
              <div className="font-medium">
                {exporting ? "Exporting..." : "Export as SVG"}
              </div>
              <div className="text-sm text-muted-foreground">
                Vector graphics (Experimental)
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
