'use client';

import {
  Clipboard,
  Download,
  FileCode,
  FileJson,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
} from 'lucide-react';
import type { ExportFormat } from './exportTypes';

/**
 * Export action rows: one download button per document format plus
 * copy-to-clipboard and JSON import. Rows share the same chrome; only the
 * icon, copy, subtitle, handler, and busy state differ.
 */

interface ExportActionRowProps {
  icon: React.ReactNode;
  title: React.ReactNode;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
}

function ExportActionRow({ icon, title, subtitle, onClick, disabled }: ExportActionRowProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      style={{ border: '1px solid #E4E0D9', backgroundColor: '#FAFAF7' }}
    >
      <span style={{ color: '#E8462A', display: 'inline-flex' }}>{icon}</span>
      <div className="text-left">
        <div className="text-[13px] font-medium" style={{ color: '#1A1917' }}>
          {title}
        </div>
        <div className="text-[11px]" style={{ color: '#6B6860' }}>
          {subtitle}
        </div>
      </div>
    </button>
  );
}

function BusyLabel({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-2">
      <Loader2 className="w-3.5 h-3.5 animate-spin" />
      {label}
    </span>
  );
}

export interface ExportActionListProps {
  exporting: boolean;
  useCustomSize: boolean;
  customWidth: string;
  customHeight: string;
  scale: number;
  onExport: (format: ExportFormat) => void;
  onCopy: () => void;
  onImport: () => void;
}

export function ExportActionList({
  exporting,
  useCustomSize,
  customWidth,
  customHeight,
  scale,
  onExport,
  onCopy,
  onImport,
}: ExportActionListProps) {
  return (
    <div className="space-y-1.5 pt-1">
      <ExportActionRow
        icon={<FileJson className="w-4 h-4" />}
        title="Export as JSON"
        subtitle="Save all elements as JSON data"
        onClick={() => onExport('json')}
      />
      <ExportActionRow
        icon={<ImageIcon className="w-4 h-4" />}
        title={exporting ? <BusyLabel label="Exporting..." /> : 'Export as PNG'}
        subtitle={
          useCustomSize ? `${customWidth || '?'} × ${customHeight || '?'} px` : `${scale}x scale`
        }
        onClick={() => onExport('png')}
        disabled={exporting}
      />
      <ExportActionRow
        icon={<FileCode className="w-4 h-4" />}
        title={exporting ? <BusyLabel label="Exporting..." /> : 'Export as SVG'}
        subtitle="Vector graphics (scalable)"
        onClick={() => onExport('svg')}
        disabled={exporting}
      />
      <ExportActionRow
        icon={<FileText className="w-4 h-4" />}
        title={exporting ? <BusyLabel label="Exporting..." /> : 'Export as PDF'}
        subtitle="Document format"
        onClick={() => onExport('pdf')}
        disabled={exporting}
      />
      <ExportActionRow
        icon={<FileSpreadsheet className="w-4 h-4" />}
        title={exporting ? <BusyLabel label="Exporting..." /> : 'Export as CSV'}
        subtitle="One row per element, for spreadsheets"
        onClick={() => onExport('csv')}
        disabled={exporting}
      />
      <ExportActionRow
        icon={<Clipboard className="w-4 h-4" />}
        title={exporting ? <BusyLabel label="Copying..." /> : 'Copy to Clipboard'}
        subtitle="Copy as PNG image"
        onClick={onCopy}
        disabled={exporting}
      />
      <ExportActionRow
        icon={<Download className="w-4 h-4" />}
        title="Import JSON"
        subtitle="Merge or replace from exported JSON"
        onClick={onImport}
      />
    </div>
  );
}
