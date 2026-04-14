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
      case 'png': return <ImageIcon className="w-4 h-4" />;
      case 'svg': return <FileCode className="w-4 h-4" />;
      case 'json': return <FileJson className="w-4 h-4" />;
    }
  };

  const inputClass =
    'flex-1 px-3 py-1.5 rounded-md border border-[#D4D0C9] bg-white text-[13px] text-[#1A1917] outline-none focus:border-[#E8462A]';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm pointer-events-auto animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-[#FAFAF7] border border-[#E4E0D9] rounded-xl shadow-lg p-5 w-[440px] animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[15px] font-semibold text-[#1A1917]">Export Canvas</h2>
          <button onClick={onClose} className="p-1 hover:bg-[#E8E5DE] rounded-md transition-colors text-[#9B9890] hover:text-[#1A1917]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Format Selection */}
          <div>
            <label className="text-[12px] font-medium text-[#6B6860] mb-2 block">Format</label>
            <div className="grid grid-cols-3 gap-2">
              {(['png', 'svg', 'json'] as ExportFormat[]).map(format => (
                <button
                  key={format}
                  onClick={() => setSelectedFormat(format)}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-md border text-[12px] font-medium transition-colors ${
                    selectedFormat === format
                      ? 'bg-[#FAE8E5] border-[#E8462A] text-[#E8462A]'
                      : 'border-[#D4D0C9] hover:bg-[#E8E5DE] text-[#6B6860]'
                  }`}
                >
                  {getFormatIcon(format)}
                  <span className="uppercase">{format}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Scale */}
          {selectedFormat !== 'json' && (
            <div>
              <label className="text-[12px] font-medium text-[#6B6860] mb-2 block">Scale</label>
              <div className="space-y-2">
                <div className="flex gap-1.5">
                  {([1, 2, 3, 4] as ExportScale[]).map(s => (
                    <button
                      key={s}
                      onClick={() => { setScale(s); setUseCustomSize(false); }}
                      className={`flex-1 py-1.5 rounded-md border text-[12px] font-medium transition-colors ${
                        scale === s && !useCustomSize
                          ? 'bg-[#FAE8E5] border-[#E8462A] text-[#E8462A]'
                          : 'border-[#D4D0C9] hover:bg-[#E8E5DE] text-[#6B6860]'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-[12px] text-[#6B6860] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useCustomSize}
                    onChange={e => setUseCustomSize(e.target.checked)}
                    className="rounded border-[#D4D0C9] w-3.5 h-3.5 accent-[#E8462A]"
                  />
                  Custom dimensions
                </label>
                {useCustomSize && (
                  <div className="flex gap-2 items-center">
                    <input type="number" placeholder="Width" value={customWidth} onChange={e => setCustomWidth(e.target.value)} className={inputClass} min={100} max={10000} />
                    <span className="text-[#9B9890]">×</span>
                    <input type="number" placeholder="Height" value={customHeight} onChange={e => setCustomHeight(e.target.value)} className={inputClass} min={100} max={10000} />
                    <span className="text-[11px] text-[#9B9890]">px</span>
                  </div>
                )}
                {selectedIds.size > 0 && (
                  <label className="flex items-center gap-2 text-[12px] text-[#6B6860] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={exportSelectionOnly}
                      onChange={e => setExportSelectionOnly(e.target.checked)}
                      className="rounded border-[#D4D0C9] w-3.5 h-3.5 accent-[#E8462A]"
                    />
                    <Square size={12} />
                    Export selected only ({selectedIds.size})
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Export Buttons */}
          <div className="space-y-1.5 pt-1">
            <button
              onClick={() => handleExport('json')}
              className="w-full flex items-center gap-3 px-3 py-2.5 border border-[#E4E0D9] rounded-md bg-white hover:bg-[#E8E5DE] transition-colors"
            >
              <FileJson className="w-4 h-4 text-[#E8462A]" />
              <div className="text-left">
                <div className="text-[13px] font-medium text-[#1A1917]">Export as JSON</div>
                <div className="text-[11px] text-[#9B9890]">Save all elements as JSON data</div>
              </div>
            </button>

            <button
              onClick={() => handleExport('png')}
              disabled={exporting}
              className="w-full flex items-center gap-3 px-3 py-2.5 border border-[#E4E0D9] rounded-md bg-white hover:bg-[#E8E5DE] transition-colors disabled:opacity-50"
            >
              <ImageIcon className="w-4 h-4 text-[#E8462A]" />
              <div className="text-left">
                <div className="text-[13px] font-medium text-[#1A1917]">{exporting ? 'Exporting...' : 'Export as PNG'}</div>
                <div className="text-[11px] text-[#9B9890]">
                  {useCustomSize ? `${customWidth || '?'} × ${customHeight || '?'} px` : `${scale}x scale`}
                </div>
              </div>
            </button>

            <button
              onClick={() => handleExport('svg')}
              disabled={exporting}
              className="w-full flex items-center gap-3 px-3 py-2.5 border border-[#E4E0D9] rounded-md bg-white hover:bg-[#E8E5DE] transition-colors disabled:opacity-50"
            >
              <FileCode className="w-4 h-4 text-[#E8462A]" />
              <div className="text-left">
                <div className="text-[13px] font-medium text-[#1A1917]">{exporting ? 'Exporting...' : 'Export as SVG'}</div>
                <div className="text-[11px] text-[#9B9890]">Vector graphics (scalable)</div>
              </div>
            </button>

            <button
              onClick={handleCopyToClipboard}
              disabled={exporting}
              className="w-full flex items-center gap-3 px-3 py-2.5 border border-[#E4E0D9] rounded-md bg-white hover:bg-[#E8E5DE] transition-colors disabled:opacity-50"
            >
              <Clipboard className="w-4 h-4 text-[#E8462A]" />
              <div className="text-left">
                <div className="text-[13px] font-medium text-[#1A1917]">{exporting ? 'Copying...' : 'Copy to Clipboard'}</div>
                <div className="text-[11px] text-[#9B9890]">Copy as PNG image</div>
              </div>
            </button>

            <button
              onClick={handleImport}
              className="w-full flex items-center gap-3 px-3 py-2.5 border border-[#E4E0D9] rounded-md bg-white hover:bg-[#E8E5DE] transition-colors"
            >
              <Download className="w-4 h-4 text-[#E8462A]" />
              <div className="text-left">
                <div className="text-[13px] font-medium text-[#1A1917]">Import JSON</div>
                <div className="text-[11px] text-[#9B9890]">Merge or replace from exported JSON</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
