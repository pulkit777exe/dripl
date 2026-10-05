'use client';

import { FileCode, FileJson, FileSpreadsheet, FileText, Image as ImageIcon } from 'lucide-react';
import type { ExportFormat } from './exportTypes';

/** Format grid (PNG/SVG/JSON/Dripl/CSV/PDF) with the active highlight. */
export function ExportFormatPicker({
  selectedFormat,
  onSelect,
}: {
  selectedFormat: ExportFormat;
  onSelect: (format: ExportFormat) => void;
}) {
  return (
    <div>
      <label className="text-[12px] font-medium mb-2 block" style={{ color: '#6B6860' }}>
        Format
      </label>
      <div className="grid grid-cols-6 gap-2">
        {(['png', 'svg', 'json', 'dripl', 'csv', 'pdf'] as ExportFormat[]).map(format => (
          <button
            key={format}
            onClick={() => onSelect(format)}
            className="flex items-center justify-center gap-1.5 py-2 rounded-md text-[12px] font-medium transition-colors"
            style={{
              border: selectedFormat === format ? '1px solid #E8462A' : '1px solid #D4D0C9',
              backgroundColor: selectedFormat === format ? '#FAE8E5' : '#FAFAF7',
              color: selectedFormat === format ? '#E8462A' : '#6B6860',
            }}
          >
            {getFormatIcon(format)}
            <span className="uppercase">{FORMAT_LABELS[format]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Button labels double as the file extension the user gets on download, so
 * `.dripl` (the native, reopenable scene) stays distinguishable from `.json`
 * (a bare element array with no app state).
 */
const FORMAT_LABELS: Record<ExportFormat, string> = {
  png: 'PNG',
  svg: 'SVG',
  json: 'JSON',
  dripl: 'DRIPL',
  csv: 'CSV',
  pdf: 'PDF',
};

function getFormatIcon(format: ExportFormat) {
  switch (format) {
    case 'png':
      return <ImageIcon className="w-4 h-4" />;
    case 'svg':
      return <FileCode className="w-4 h-4" />;
    case 'json':
    case 'dripl':
      return <FileJson className="w-4 h-4" />;
    case 'csv':
      return <FileSpreadsheet className="w-4 h-4" />;
    case 'pdf':
      return <FileText className="w-4 h-4" />;
  }
}
