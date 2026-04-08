'use client';

import { useState } from 'react';
import {
  Download,
  X,
  Image as ImageIcon,
  FileCode,
  FileJson,
  Clipboard,
  Square,
} from 'lucide-react';
import { useCanvasStore } from '@/lib/canvas-store';
import { exportCanvas, downloadBlob, importFromJson } from '@/utils/export';
import Image from 'next/image';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ExportFormat = 'png' | 'svg' | 'json';
type ExportScale = 1 | 2 | 3 | 4;

export function ExportModal({ isOpen, onClose }: ExportModalProps) {
  const elements = useCanvasStore(state => state.elements);
  const setElements = useCanvasStore(state => state.setElements);
  const selectedIds = useCanvasStore(state => state.selectedIds);
  const [exporting, setExporting] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('png');
  const [scale, setScale] = useState<ExportScale>(2);
  const [customWidth, setCustomWidth] = useState<string>('');
  const [customHeight, setCustomHeight] = useState<string>('');
  const [useCustomSize, setUseCustomSize] = useState(false);
  const [exportSelectionOnly, setExportSelectionOnly] = useState(false);

  if (!isOpen) return null;

  const calculateDimensions = () => {
    if (!useCustomSize || !customWidth || !customHeight) {
      return { width: undefined, height: undefined };
    }
    return {
      width: parseInt(customWidth, 10),
      height: parseInt(customHeight, 10),
    };
  };

  const handleExport = async (format: ExportFormat) => {
    setExporting(true);
    try {
      const dims = calculateDimensions();
      const exportElements =
        exportSelectionOnly && selectedIds.size > 0
          ? elements.filter(el => selectedIds.has(el.id))
          : elements;

      if (exportElements.length === 0) {
        alert('No elements to export');
        return;
      }

      const options = {
        scale: dims.width ? dims.width / 1920 : scale,
        background: '#ffffff',
        padding: 16,
        ...(dims.width && dims.height
          ? { customWidth: dims.width, customHeight: dims.height }
          : {}),
      };
      const blob = await Promise.resolve(exportCanvas(format, exportElements, options));
      downloadBlob(blob, `canvas-${Date.now()}.${format}`);
    } finally {
      setExporting(false);
    }
  };

  const handleCopyToClipboard = async () => {
    const exportElements =
      exportSelectionOnly && selectedIds.size > 0
        ? elements.filter(el => selectedIds.has(el.id))
        : elements;

    if (exportElements.length === 0) {
      alert('No elements to copy');
      return;
    }

    setExporting(true);
    try {
      const blob = await Promise.resolve(
        exportCanvas('png', exportElements, { scale: 2, background: '#ffffff', padding: 16 })
      );
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      alert('Copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      alert('Failed to copy to clipboard. Try downloading instead.');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async event => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const raw = await file.text();
      const replace = window.confirm(
        'Replace current canvas?\nPress Cancel to merge imported elements.'
      );
      const imported = importFromJson(raw, elements, replace ? 'replace' : 'merge');
      setElements(imported);
    };
    input.click();
  };

  const getFormatIcon = (format: ExportFormat) => {
    switch (format) {
      case 'png':
        return <ImageIcon className="w-5 h-5" />;
      case 'svg':
        return <FileCode className="w-5 h-5" />;
      case 'json':
        return <FileJson className="w-5 h-5" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 pointer-events-auto">
      <div className="bg-background rounded-lg shadow-xl p-6 w-120">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Export Canvas</h2>
          <button onClick={onClose} className="p-1 hover:bg-accent rounded transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Format Selection */}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">Format</label>
            <div className="grid grid-cols-3 gap-2">
              {(['png', 'svg', 'json'] as ExportFormat[]).map(format => (
                <button
                  key={format}
                  onClick={() => setSelectedFormat(format)}
                  className={`flex items-center justify-center gap-2 p-3 rounded-lg border transition-colors ${
                    selectedFormat === format
                      ? 'bg-primary/10 border-primary text-primary'
                      : 'hover:bg-accent border-border'
                  }`}
                >
                  {getFormatIcon(format)}
                  <span className="font-medium uppercase">{format}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Scale / Resolution Options */}
          {selectedFormat !== 'json' && (
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">
                Resolution / Scale
              </label>
              <div className="space-y-3">
                <div className="flex gap-2">
                  {([1, 2, 3, 4] as ExportScale[]).map(s => (
                    <button
                      key={s}
                      onClick={() => {
                        setScale(s);
                        setUseCustomSize(false);
                      }}
                      className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        scale === s && !useCustomSize
                          ? 'bg-primary/10 border-primary text-primary'
                          : 'border-border hover:bg-accent'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={useCustomSize}
                    onChange={e => setUseCustomSize(e.target.checked)}
                    className="rounded border-border"
                  />
                  Custom dimensions
                </label>
                {useCustomSize && (
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      placeholder="Width"
                      value={customWidth}
                      onChange={e => setCustomWidth(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
                      min={100}
                      max={10000}
                    />
                    <span className="text-muted-foreground">×</span>
                    <input
                      type="number"
                      placeholder="Height"
                      value={customHeight}
                      onChange={e => setCustomHeight(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
                      min={100}
                      max={10000}
                    />
                    <span className="text-xs text-muted-foreground">px</span>
                  </div>
                )}

                {selectedIds.size > 0 && (
                  <label className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                    <input
                      type="checkbox"
                      checked={exportSelectionOnly}
                      onChange={e => setExportSelectionOnly(e.target.checked)}
                      className="rounded border-border"
                    />
                    <Square size={14} />
                    Export selected only ({selectedIds.size} elements)
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Export Buttons */}
          <div className="space-y-2 pt-2">
            <button
              onClick={() => handleExport('json')}
              className="w-full flex items-center gap-3 p-4 border rounded-lg hover:bg-accent transition-colors"
            >
              <FileJson className="w-5 h-5" />
              <div className="text-left">
                <div className="font-medium">Export as JSON</div>
                <div className="text-sm text-muted-foreground">Save all elements as JSON data</div>
              </div>
            </button>

            <button
              onClick={() => handleExport('png')}
              disabled={exporting}
              className="w-full flex items-center gap-3 p-4 border rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
            >
              <ImageIcon className="w-5 h-5" />
              <div className="text-left">
                <div className="font-medium">{exporting ? 'Exporting...' : 'Export as PNG'}</div>
                <div className="text-sm text-muted-foreground">
                  {useCustomSize
                    ? `${customWidth || '?'} × ${customHeight || '?'} px`
                    : `${scale}x scale`}
                </div>
              </div>
            </button>

            <button
              onClick={() => handleExport('svg')}
              disabled={exporting}
              className="w-full flex items-center gap-3 p-4 border rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
            >
              <FileCode className="w-5 h-5" />
              <div className="text-left">
                <div className="font-medium">{exporting ? 'Exporting...' : 'Export as SVG'}</div>
                <div className="text-sm text-muted-foreground">Vector graphics (scalable)</div>
              </div>
            </button>

            <button
              onClick={handleCopyToClipboard}
              disabled={exporting}
              className="w-full flex items-center gap-3 p-4 border rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
            >
              <Clipboard className="w-5 h-5" />
              <div className="text-left">
                <div className="font-medium">{exporting ? 'Copying...' : 'Copy to Clipboard'}</div>
                <div className="text-sm text-muted-foreground">Copy as PNG image</div>
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
    </div>
  );
}
