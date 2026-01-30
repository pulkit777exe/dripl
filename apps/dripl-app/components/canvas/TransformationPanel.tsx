"use client";

import type { DriplElement } from "@dripl/common";
import { RotateCw, Move, Maximize, ArrowUpDown, ArrowLeftRight } from "lucide-react";

interface TransformationPanelProps {
  selectedElement: DriplElement | null;
  onUpdateElement: (element: DriplElement) => void;
  onDeleteElement: (elementId: string) => void;
  onDuplicateElement: (element: DriplElement) => void;
}

export function TransformationPanel({
  selectedElement,
  onUpdateElement,
  onDeleteElement,
  onDuplicateElement,
}: TransformationPanelProps) {
  if (!selectedElement) return null;

  const updateProperty = (key: string, value: any) => {
    onUpdateElement({
      ...selectedElement,
      [key]: value,
    });
  };

  const handleRotate = () => {
    const currentRotation = (selectedElement.rotation || 0) + 45;
    updateProperty("rotation", currentRotation);
  };

  const handleFlipHorizontal = () => {
    const currentFlip = selectedElement.flipHorizontal || 1;
    updateProperty("flipHorizontal", currentFlip === 1 ? -1 : 1);
  };

  const handleFlipVertical = () => {
    const currentFlip = selectedElement.flipVertical || 1;
    updateProperty("flipVertical", currentFlip === 1 ? -1 : 1);
  };

  const handleLock = () => {
    updateProperty("locked", !selectedElement.locked);
  };

  const handleDelete = () => {
    onDeleteElement(selectedElement.id);
  };

  const handleDuplicate = () => {
    onDuplicateElement(selectedElement);
  };

  return (
    <div className="fixed top-4 right-4 flex flex-col gap-2 pointer-events-auto z-100">
      <div className="p-4 bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg w-64 space-y-4">
        <h3 className="font-semibold text-sm mb-2">Transformations</h3>

        {/* Position */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Position</label>
          <div className="flex gap-1">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">X</label>
              <input
                type="number"
                value={Math.round(selectedElement.x)}
                onChange={(e) => updateProperty("x", Number(e.target.value))}
                className="w-full text-xs p-1 border rounded bg-background"
                step="1"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Y</label>
              <input
                type="number"
                value={Math.round(selectedElement.y)}
                onChange={(e) => updateProperty("y", Number(e.target.value))}
                className="w-full text-xs p-1 border rounded bg-background"
                step="1"
              />
            </div>
          </div>
        </div>

        {/* Size */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Size</label>
          <div className="flex gap-1">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">W</label>
              <input
                type="number"
                value={Math.round(selectedElement.width)}
                onChange={(e) => updateProperty("width", Number(e.target.value))}
                className="w-full text-xs p-1 border rounded bg-background"
                min="1"
                step="1"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">H</label>
              <input
                type="number"
                value={Math.round(selectedElement.height)}
                onChange={(e) => updateProperty("height", Number(e.target.value))}
                className="w-full text-xs p-1 border rounded bg-background"
                min="1"
                step="1"
              />
            </div>
          </div>
        </div>

        {/* Rotation */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Rotation</label>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRotate}
              className="p-1 border rounded hover:bg-accent transition-colors"
              title="Rotate 45 degrees"
            >
              <RotateCw className="w-4 h-4" />
            </button>
            <input
              type="number"
              value={selectedElement.rotation || 0}
              onChange={(e) => updateProperty("rotation", Number(e.target.value))}
              className="flex-1 text-xs p-1 border rounded bg-background"
              min="0"
              max="360"
              step="1"
            />
            <span className="text-xs">°</span>
          </div>
        </div>

        {/* Flip */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Flip</label>
          <div className="flex gap-1">
            <button
              onClick={handleFlipHorizontal}
              className={`flex-1 p-1 text-xs border rounded transition-colors ${
                selectedElement.flipHorizontal === -1
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent"
              }`}
            >
              <ArrowLeftRight className="w-4 h-4" />
            </button>
            <button
              onClick={handleFlipVertical}
              className={`flex-1 p-1 text-xs border rounded transition-colors ${
                selectedElement.flipVertical === -1
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent"
              }`}
            >
              <ArrowUpDown className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-1 pt-2 border-t">
          <label className="text-xs text-muted-foreground">Actions</label>
          <div className="grid grid-cols-2 gap-1">
            <button
              onClick={handleLock}
              className={`p-1 text-xs border rounded transition-colors ${
                selectedElement.locked
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent"
              }`}
            >
              Lock
            </button>
            <button
              onClick={handleDuplicate}
              className="p-1 text-xs border rounded hover:bg-accent transition-colors"
            >
              Duplicate
            </button>
            <button
              onClick={handleDelete}
              className="col-span-2 p-1 text-xs border rounded bg-red-500 hover:bg-red-600 text-white transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}