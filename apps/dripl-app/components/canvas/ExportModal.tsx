'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Download,
  X,
  Image as ImageIcon,
  FileCode,
  FileJson,
  FileText,
  Clipboard,
  Square,
  Loader2,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { useShallow } from 'zustand/shallow';
import { useCanvasStore } from '@/lib/canvas-store';
import { exportCanvas, downloadBlob, importFromJson } from '@/utils/export';
import { InlineError } from '@/components/ui/ErrorState';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ExportFormat = 'png' | 'svg' | 'json' | 'pdf';
type ExportScale = 1 | 2 | 3 | 4;

export function ExportModal({ isOpen, onClose }: ExportModalProps) {
  const elements = useCanvasStore(useShallow(state => state.elements));
  const setElements = useCanvasStore(state => state.setElements);
  const selectedIds = useCanvasStore(state => state.selectedIds);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('png');
  const [scale, setScale] = useState<ExportScale>(2);
  const [customWidth, setCustomWidth] = useState<string>('');
  const [customHeight, setCustomHeight] = useState<string>('');
  const [useCustomSize, setUseCustomSize] = useState(false);
  const [exportSelectionOnly, setExportSelectionOnly] = useState(false);

  const [animState, setAnimState] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed');
  const prevOpen = useRef(false);
  const successRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && !prevOpen.current) {
      prevOpen.current = true;
      setAnimState('opening');
    } else if (!isOpen && prevOpen.current) {
      prevOpen.current = false;
      setAnimState('closing');
    }
  }, [isOpen]);

  useEffect(() => {
    if (animState === 'opening') {
      const raf = requestAnimationFrame(() => setAnimState('open'));
      return () => cancelAnimationFrame(raf);
    }
    if (animState === 'closing') {
      const ms = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--modal-close-dur')
      ) || 150;
      const timer = setTimeout(() => setAnimState('closed'), ms);
      return () => clearTimeout(timer);
    }
  }, [animState]);

  useEffect(() => {
    if (!exportSuccess || !successRef.current) return;
    const path = successRef.current.querySelector<SVGPathElement>('svg path');
    if (path) {
      const len = Math.ceil(path.getTotalLength());
      path.style.strokeDasharray = String(len);
      path.style.strokeDashoffset = String(len);
    }
  }, [exportSuccess]);

  if (animState === 'closed') return null;

  const modalState = animState === 'open' ? 'is-open' : animState === 'closing' ? 'is-closing' : '';

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
    setExportError(null);
    setExportSuccess(null);
    try {
      const dims = calculateDimensions();
      const exportElements =
        exportSelectionOnly && selectedIds.size > 0
          ? elements.filter(el => selectedIds.has(el.id))
          : elements;

      if (exportElements.length === 0) {
        setExportError('No elements to export');
        return;
      }

      if (format === 'pdf') {
        const pngBlob = await Promise.resolve(
          exportCanvas('png', exportElements, { scale: 2, background: '#ffffff', padding: 16 })
        );
        const url = URL.createObjectURL(pngBlob);
        const img = new window.Image();
        img.src = url;
        await new Promise(resolve => {
          img.onload = resolve;
        });

        const pdf = new jsPDF({
          orientation: img.width > img.height ? 'landscape' : 'portrait',
          unit: 'px',
          format: [img.width, img.height],
        });
        const base64 = await new Promise<string>(resolve => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(pngBlob);
        });
        pdf.addImage(base64, 'PNG', 0, 0, img.width, img.height);
        pdf.save(`canvas-${Date.now()}.pdf`);
        URL.revokeObjectURL(url);
        setExportSuccess('PDF exported successfully');
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
      setExportSuccess(`${format.toUpperCase()} exported successfully`);
    } catch (err) {
      console.error('Export failed:', err);
      setExportError('Export failed. Please try again.');
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
      setExportError('No elements to copy');
      return;
    }

    setExporting(true);
    setExportError(null);
    try {
      const blob = await Promise.resolve(
        exportCanvas('png', exportElements, { scale: 2, background: '#ffffff', padding: 16 })
      );
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setExportSuccess('Copied to clipboard');
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      setExportError('Failed to copy to clipboard. Try downloading instead.');
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
      try {
        const raw = await file.text();
        const replace = window.confirm(
          'Replace current canvas?\nPress Cancel to merge imported elements.'
        );
        const imported = importFromJson(raw, elements, replace ? 'replace' : 'merge');
        setElements(imported);
        setExportSuccess('Canvas imported successfully');
      } catch (err) {
        console.error('Import failed:', err);
        setExportError('Failed to import canvas. Please check the file format.');
      }
    };
    input.click();
  };

  const getFormatIcon = (format: ExportFormat) => {
    switch (format) {
      case 'png':
        return <ImageIcon className="w-4 h-4" />;
      case 'svg':
        return <FileCode className="w-4 h-4" />;
      case 'json':
        return <FileJson className="w-4 h-4" />;
      case 'pdf':
        return <FileText className="w-4 h-4" />;
    }
  };

  const inputClass =
    'flex-1 px-3 py-1.5 rounded-md border border-border bg-card text-[13px] text-foreground outline-none focus:border-primary';

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm pointer-events-auto t-modal ${modalState}`}
      onClick={onClose}
    >
      <div
        className="bg-card border border-panel-border rounded-xl shadow-lg p-5 w-[440px]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[15px] font-semibold text-foreground">Export Canvas</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-secondary rounded-md transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Format Selection */}
          <div>
            <label className="text-[12px] font-medium text-muted-foreground mb-2 block">Format</label>
            <div className="grid grid-cols-4 gap-2">
              {(['png', 'svg', 'json', 'pdf'] as ExportFormat[]).map(format => (
                <button
                  key={format}
                  onClick={() => setSelectedFormat(format)}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-md border text-[12px] font-medium transition-colors ${
                    selectedFormat === format
                      ? 'bg-accent border-primary text-primary'
                      : 'border-border hover:bg-secondary text-muted-foreground'
                  }`}
                >
                  {getFormatIcon(format)}
                  <span className="uppercase">{format}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Scale */}
          {selectedFormat !== 'json' && selectedFormat !== 'pdf' && (
            <div>
              <label className="text-[12px] font-medium text-muted-foreground mb-2 block">Scale</label>
              <div className="space-y-2">
                <div className="flex gap-1.5">
                  {([1, 2, 3, 4] as ExportScale[]).map(s => (
                    <button
                      key={s}
                      onClick={() => {
                        setScale(s);
                        setUseCustomSize(false);
                      }}
                      className={`flex-1 py-1.5 rounded-md border text-[12px] font-medium transition-colors ${
                        scale === s && !useCustomSize
                          ? 'bg-accent border-primary text-primary'
                          : 'border-border hover:bg-secondary text-muted-foreground'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-[12px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useCustomSize}
                    onChange={e => setUseCustomSize(e.target.checked)}
                    className="rounded border-border w-3.5 h-3.5 accent-primary"
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
                      className={inputClass}
                      min={100}
                      max={10000}
                    />
                    <span className="text-muted-foreground">×</span>
                    <input
                      type="number"
                      placeholder="Height"
                      value={customHeight}
                      onChange={e => setCustomHeight(e.target.value)}
                      className={inputClass}
                      min={100}
                      max={10000}
                    />
                    <span className="text-[11px] text-muted-foreground">px</span>
                  </div>
                )}
                {selectedIds.size > 0 && (
                  <label className="flex items-center gap-2 text-[12px] text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={exportSelectionOnly}
                      onChange={e => setExportSelectionOnly(e.target.checked)}
                      className="rounded border-border w-3.5 h-3.5 accent-primary"
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
              className="w-full flex items-center gap-3 px-3 py-2.5 border border-panel-border rounded-md bg-card hover:bg-secondary transition-colors"
            >
              <FileJson className="w-4 h-4 text-primary" />
              <div className="text-left">
                <div className="text-[13px] font-medium text-foreground">Export as JSON</div>
                <div className="text-[11px] text-muted-foreground">Save all elements as JSON data</div>
              </div>
            </button>

            <button
              onClick={() => handleExport('png')}
              disabled={exporting}
              className="w-full flex items-center gap-3 px-3 py-2.5 border border-panel-border rounded-md bg-card hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ImageIcon className="w-4 h-4 text-primary" />
              <div className="text-left">
                <div className="text-[13px] font-medium text-foreground">
                  {exporting ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Exporting...
                    </span>
                  ) : (
                    'Export as PNG'
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {useCustomSize
                    ? `${customWidth || '?'} × ${customHeight || '?'} px`
                    : `${scale}x scale`}
                </div>
              </div>
            </button>

            <button
              onClick={() => handleExport('svg')}
              disabled={exporting}
              className="w-full flex items-center gap-3 px-3 py-2.5 border border-panel-border rounded-md bg-card hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileCode className="w-4 h-4 text-primary" />
              <div className="text-left">
                <div className="text-[13px] font-medium text-foreground">
                  {exporting ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Exporting...
                    </span>
                  ) : (
                    'Export as SVG'
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">Vector graphics (scalable)</div>
              </div>
            </button>

            <button
              onClick={() => handleExport('pdf')}
              disabled={exporting}
              className="w-full flex items-center gap-3 px-3 py-2.5 border border-panel-border rounded-md bg-card hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileText className="w-4 h-4 text-primary" />
              <div className="text-left">
                <div className="text-[13px] font-medium text-foreground">
                  {exporting ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Exporting...
                    </span>
                  ) : (
                    'Export as PDF'
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">Document format</div>
              </div>
            </button>

            <button
              onClick={handleCopyToClipboard}
              disabled={exporting}
              className="w-full flex items-center gap-3 px-3 py-2.5 border border-panel-border rounded-md bg-card hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Clipboard className="w-4 h-4 text-primary" />
              <div className="text-left">
                <div className="text-[13px] font-medium text-foreground">
                  {exporting ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Copying...
                    </span>
                  ) : (
                    'Copy to Clipboard'
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">Copy as PNG image</div>
              </div>
            </button>

            <button
              onClick={handleImport}
              className="w-full flex items-center gap-3 px-3 py-2.5 border border-panel-border rounded-md bg-card hover:bg-secondary transition-colors"
            >
              <Download className="w-4 h-4 text-primary" />
              <div className="text-left">
                <div className="text-[13px] font-medium text-foreground">Import JSON</div>
                <div className="text-[11px] text-muted-foreground">
                  Merge or replace from exported JSON
                </div>
              </div>
            </button>
          </div>
        </div>

        {exportError && (
          <InlineError
            message={exportError}
            onRetry={() => setExportError(null)}
            className="mt-4"
          />
        )}

        {exportSuccess && (
          <div className="flex items-center gap-2 mt-4 px-3 py-2 bg-success-bg border border-success-border rounded-md">
            <span className="t-success-check" data-state="in" aria-hidden="true" ref={successRef}>
              <svg viewBox="0 0 48 48" fill="none" width="20" height="20">
                <circle cx="24" cy="24" r="22" stroke="#22c55e" strokeWidth="4" />
                <path d="M16 24l6 6 10-10" stroke="#22c55e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="text-[13px] text-success font-medium">{exportSuccess}</span>
          </div>
        )}
      </div>
    </div>
  );
}
