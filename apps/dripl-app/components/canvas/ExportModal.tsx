'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { useShallow } from 'zustand/shallow';
import { logError } from '@dripl/common';
import { useCanvasStore } from '@/lib/store';
import { exportCanvas, downloadBlob, importFromJson } from '@/utils/export';
import { useModalAnimation } from '@/hooks/useModalAnimation';
import {
  buildDocumentExportOptions,
  buildRasterExportOptions,
  exportFileName,
  parseExportDimensions,
  resolveExportScope,
} from '@/lib/export-options';
import { ExportActionList } from './export/ExportActionList';
import { ExportFormatPicker } from './export/ExportFormatPicker';
import { ExportScaleOptions } from './export/ExportScaleOptions';
import { ExportStatus } from './export/ExportStatus';
import type { ExportFormat, ExportScale } from './export/exportTypes';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExportModal({ isOpen, onClose }: ExportModalProps) {
  const elements = useCanvasStore(useShallow(state => state.elements));
  const editorState = useCanvasStore(
    useShallow(state => ({
      zoom: state.zoom,
      panX: state.panX,
      panY: state.panY,
      currentStrokeColor: state.currentStrokeColor,
      currentBackgroundColor: state.currentBackgroundColor,
      currentStrokeWidth: state.currentStrokeWidth,
      currentRoughness: state.currentRoughness,
      currentStrokeStyle: state.currentStrokeStyle,
      currentFillStyle: state.currentFillStyle,
      activeTool: state.activeTool,
    }))
  );
  const setElements = useCanvasStore(state => state.setElements);
  const selectedIds = useCanvasStore(state => state.selectedIds);
  const canvasBackground = useCanvasStore(state => state.canvasBackground);
  const exportBackground = canvasBackground ?? '#ffffff';
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('png');
  const [scale, setScale] = useState<ExportScale>(2);
  const [customWidth, setCustomWidth] = useState<string>('');
  const [customHeight, setCustomHeight] = useState<string>('');
  const [useCustomSize, setUseCustomSize] = useState(false);
  const [exportSelectionOnly, setExportSelectionOnly] = useState(false);

  const { isVisible, modalState } = useModalAnimation(isOpen);
  const successRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportSuccess || !successRef.current) return;
    const path = successRef.current.querySelector<SVGPathElement>('svg path');
    if (path) {
      const len = Math.ceil(path.getTotalLength());
      path.style.strokeDasharray = String(len);
      path.style.strokeDashoffset = String(len);
    }
  }, [exportSuccess]);

  if (!isVisible) return null;

  const dims = parseExportDimensions(useCustomSize, customWidth, customHeight);

  const handleExport = async (format: ExportFormat) => {
    setExporting(true);
    setExportError(null);
    setExportSuccess(null);
    try {
      const exportElements = resolveExportScope(elements, selectedIds, exportSelectionOnly);

      if (exportElements.length === 0) {
        setExportError('No elements to export');
        return;
      }

      if (format === 'pdf') {
        const pngBlob = await Promise.resolve(
          exportCanvas('png', exportElements, buildRasterExportOptions(dims, exportBackground))
        );
        const url = URL.createObjectURL(pngBlob);
        const img = new window.Image();
        img.src = url;
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to load image for PDF'));
          setTimeout(() => reject(new Error('PDF image load timed out')), 10000);
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
        pdf.save(exportFileName('pdf'));
        URL.revokeObjectURL(url);
        setExportSuccess('PDF exported successfully');
        return;
      }

      const options = buildDocumentExportOptions(scale, dims, editorState, exportBackground);
      const blob = await Promise.resolve(exportCanvas(format, exportElements, options));
      downloadBlob(blob, exportFileName(format));
      setExportSuccess(`${format.toUpperCase()} exported successfully`);
    } catch (err) {
      logError('Export failed:', err);
      setExportError('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleCopyToClipboard = async () => {
    const exportElements = resolveExportScope(elements, selectedIds, exportSelectionOnly);

    if (exportElements.length === 0) {
      setExportError('No elements to copy');
      return;
    }

    setExporting(true);
    setExportError(null);
    try {
      const blob = await Promise.resolve(
        exportCanvas('png', exportElements, buildRasterExportOptions(dims, exportBackground))
      );
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setExportSuccess('Copied to clipboard');
    } catch (err) {
      logError('Failed to copy to clipboard:', err);
      setExportError('Failed to copy to clipboard. Try downloading instead.');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.excalidraw,application/json';
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
        logError('Import failed:', err);
        setExportError('Failed to import canvas. Please check the file format.');
      }
    };
    input.click();
  };

  const modal = (
    <div
      className={`fixed inset-0 z-400 flex items-center justify-center p-4 box-content backdrop-blur-sm pointer-events-auto t-modal ${modalState}`}
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl shadow-lg w-[440px] max-h-[85vh] overflow-y-auto"
        style={{ backgroundColor: '#FAFAF7', border: '1px solid #E4E0D9' }}
        onClick={e => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-3.5"
          style={{ borderBottom: '1px solid #E4E0D9' }}
        >
          <h2 className="text-[15px] font-semibold" style={{ color: '#1A1917' }}>
            Export Canvas
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md transition-colors"
            style={{ color: '#6B6860' }}
            onMouseEnter={e => {
              e.currentTarget.style.color = '#1A1917';
              e.currentTarget.style.backgroundColor = '#E8E5DE';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = '#6B6860';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <ExportFormatPicker selectedFormat={selectedFormat} onSelect={setSelectedFormat} />

          <ExportScaleOptions
            selectedFormat={selectedFormat}
            scale={scale}
            useCustomSize={useCustomSize}
            customWidth={customWidth}
            customHeight={customHeight}
            selectedCount={selectedIds.size}
            exportSelectionOnly={exportSelectionOnly}
            onScale={setScale}
            onCustomSize={setUseCustomSize}
            onCustomWidth={setCustomWidth}
            onCustomHeight={setCustomHeight}
            onSelectionOnly={setExportSelectionOnly}
          />

          <ExportActionList
            exporting={exporting}
            useCustomSize={useCustomSize}
            customWidth={customWidth}
            customHeight={customHeight}
            scale={scale}
            onExport={handleExport}
            onCopy={handleCopyToClipboard}
            onImport={handleImport}
          />
        </div>

        <ExportStatus
          exportError={exportError}
          exportSuccess={exportSuccess}
          successRef={successRef}
          onDismissError={() => setExportError(null)}
        />
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
