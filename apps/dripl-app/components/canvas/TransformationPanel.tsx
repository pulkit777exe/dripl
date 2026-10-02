'use client';

import type { DriplElement } from '@dripl/common';
import { RotateCw, ArrowUpDown, ArrowLeftRight, Link2, ExternalLink, X } from 'lucide-react';
import { useState } from 'react';
import { isSafeHttpUrl } from '@/utils/export';
import { normalizeLinkInput } from '@/lib/canvas/link';

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
  // Link draft (keyed by element id so switching selection discards it).
  // Declared before the early return to keep hook order stable.
  const [linkDraft, setLinkDraft] = useState<{ id: string; value: string } | null>(null);

  if (!selectedElement) return null;

  // Link draft commits on blur/Enter so typing doesn't spam history.
  const committedLink = selectedElement.link ?? '';

  const updateProperty = <K extends keyof DriplElement>(key: K, value: DriplElement[K]) => {
    onUpdateElement({
      ...selectedElement,
      [key]: value,
    });
  };

  const handleRotate = () => {
    const currentRotation = (selectedElement.rotation ?? 0) + 45;
    updateProperty('rotation', currentRotation);
  };

  const handleFlipHorizontal = () => {
    const currentFlip = selectedElement.flipHorizontal ?? 1;
    updateProperty('flipHorizontal', currentFlip === 1 ? -1 : 1);
  };

  const handleFlipVertical = () => {
    const currentFlip = selectedElement.flipVertical ?? 1;
    updateProperty('flipVertical', currentFlip === 1 ? -1 : 1);
  };

  const handleLock = () => {
    updateProperty('locked', !selectedElement.locked);
  };

  const handleDelete = () => {
    onDeleteElement(selectedElement.id);
  };

  const handleDuplicate = () => {
    onDuplicateElement(selectedElement);
  };

  const linkValue =
    linkDraft && linkDraft.id === selectedElement.id ? linkDraft.value : committedLink;
  const linkIsSafe = linkValue === '' || isSafeHttpUrl(linkValue);

  const commitLink = (raw: string) => {
    const normalized = normalizeLinkInput(raw, committedLink);
    setLinkDraft(null);
    if (!normalized.changed) return;
    updateProperty('link', normalized.value);
  };

  return (
    <div className="fixed top-4 right-4 flex flex-col gap-2 pointer-events-auto z-100">
      <div
        className="p-4 rounded-lg shadow-lg w-64 space-y-4"
        style={{
          backgroundColor: 'var(--color-card)',
          border: '1px solid var(--color-border)',
        }}
      >
        <h3 className="font-semibold text-sm mb-2">Transformations</h3>

        <div className="space-y-1">
          <label className="text-xs text-[#6B6860]">Position</label>
          <div className="flex gap-1">
            <div className="flex-1">
              <label className="text-xs text-[#6B6860]">X</label>
              <input
                type="number"
                value={Math.round(selectedElement.x)}
                onChange={e => updateProperty('x', Number(e.target.value))}
                className="w-full text-xs p-1 border rounded bg-background"
                step="1"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-[#6B6860]">Y</label>
              <input
                type="number"
                value={Math.round(selectedElement.y)}
                onChange={e => updateProperty('y', Number(e.target.value))}
                className="w-full text-xs p-1 border rounded bg-background"
                step="1"
              />
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-[#6B6860]">Size</label>
          <div className="flex gap-1">
            <div className="flex-1">
              <label className="text-xs text-[#6B6860]">W</label>
              <input
                type="number"
                value={Math.round(selectedElement.width)}
                onChange={e => updateProperty('width', Number(e.target.value))}
                className="w-full text-xs p-1 border rounded bg-background"
                min="1"
                step="1"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-[#6B6860]">H</label>
              <input
                type="number"
                value={Math.round(selectedElement.height)}
                onChange={e => updateProperty('height', Number(e.target.value))}
                className="w-full text-xs p-1 border rounded bg-background"
                min="1"
                step="1"
              />
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-[#6B6860]">Rotation</label>
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
              value={selectedElement.rotation ?? 0}
              onChange={e => updateProperty('rotation', Number(e.target.value))}
              className="flex-1 text-xs p-1 border rounded bg-background"
              min="0"
              max="360"
              step="1"
            />
            <span className="text-xs">°</span>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-[#6B6860]">Flip</label>
          <div className="flex gap-1">
            <button
              onClick={handleFlipHorizontal}
              className={`flex-1 p-1 text-xs border rounded transition-colors ${
                selectedElement.flipHorizontal === -1
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent'
              }`}
            >
              <ArrowLeftRight className="w-4 h-4" />
            </button>
            <button
              onClick={handleFlipVertical}
              className={`flex-1 p-1 text-xs border rounded transition-colors ${
                selectedElement.flipVertical === -1
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent'
              }`}
            >
              <ArrowUpDown className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-[#6B6860]">Link</label>
          <div className="flex items-center gap-1">
            <Link2 className="w-4 h-4 shrink-0 text-[#6B6860]" />
            <input
              type="url"
              value={linkValue}
              placeholder="https://…"
              onChange={e => setLinkDraft({ id: selectedElement.id, value: e.target.value })}
              onBlur={e => commitLink(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitLink((e.target as HTMLInputElement).value);
              }}
              className="flex-1 min-w-0 text-xs p-1 border rounded bg-background"
            />
            {committedLink !== '' && (
              <>
                <button
                  onClick={() => {
                    // Prefer the committed link, but fall back to a safe
                    // draft (blur commits first, so this covers the race).
                    const candidate = linkIsSafe && linkValue !== '' ? linkValue : committedLink;
                    if (isSafeHttpUrl(candidate)) {
                      window.open(candidate, '_blank', 'noopener,noreferrer');
                    }
                  }}
                  className="p-1 border rounded hover:bg-accent transition-colors disabled:opacity-40"
                  title={linkIsSafe ? 'Open link' : 'Only http(s) links can be opened'}
                  disabled={!linkIsSafe}
                  aria-label="Open link"
                >
                  <ExternalLink className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setLinkDraft(null);
                    updateProperty('link', undefined);
                  }}
                  className="p-1 border rounded hover:bg-accent transition-colors"
                  title="Remove link"
                  aria-label="Remove link"
                >
                  <X className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
          {linkValue !== '' && !linkIsSafe && (
            <p className="text-[11px] text-[#C0392B]">Only http(s) links are kept on export.</p>
          )}
        </div>

        <div className="space-y-1 pt-2 border-t">
          <label className="text-xs text-[#6B6860]">Actions</label>
          <div className="grid grid-cols-2 gap-1">
            <button
              onClick={handleLock}
              className={`p-1 text-xs border rounded transition-colors ${
                selectedElement.locked ? 'bg-accent text-accent-foreground' : 'hover:bg-accent'
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
