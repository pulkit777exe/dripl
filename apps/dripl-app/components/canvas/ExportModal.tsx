"use client";

import { useState } from "react";
import { Download, X } from "lucide-react";
import { useCanvasStore } from "@/lib/canvas-store";
import {
  exportCanvas,
  downloadBlob,
  importFromJson,
} from "@/utils/export";

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExportModal({ isOpen, onClose }: ExportModalProps) {
  const elements = useCanvasStore((state) => state.elements);
  const setElements = useCanvasStore((state) => state.setElements);
  const [exporting, setExporting] = useState(false);

  if (!isOpen) return null;

  const handleExport = async (format: "png" | "svg" | "json") => {
    setExporting(true);
    try {
      const blob = await Promise.resolve(
        exportCanvas(format, elements, {
          scale: 2,
          background: "#ffffff",
          padding: 16,
        }),
      );
      downloadBlob(blob, `canvas-${Date.now()}.${format}`);
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const raw = await file.text();
      const replace = window.confirm(
        "Replace current canvas?\nPress Cancel to merge imported elements.",
      );
      const imported = importFromJson(raw, elements, replace ? "replace" : "merge");
      setElements(imported);
    };
    input.click();
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
            onClick={() => handleExport("json")}
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
            onClick={() => handleExport("png")}
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
            onClick={() => handleExport("svg")}
            disabled={exporting}
            className="w-full flex items-center gap-3 p-4 border rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
          >
            <Download className="w-5 h-5" />
            <div className="text-left">
              <div className="font-medium">
                {exporting ? "Exporting..." : "Export as SVG"}
              </div>
              <div className="text-sm text-muted-foreground">
                Vector graphics
              </div>
            </div>
          </button>

          <button
            onClick={handleImport}
            className="w-full flex items-center gap-3 p-4 border rounded-lg hover:bg-accent transition-colors"
          >
            <Download className="w-5 h-5" />
            <div className="text-left">
              <div className="font-medium">Import JSON</div>
              <div className="text-sm text-muted-foreground">
                Merge or replace from exported JSON
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
