'use client';

import { Square } from 'lucide-react';
import type { ExportFormat, ExportScale } from './exportTypes';

/**
 * Scale picker: fixed 1–4x buttons, custom dimensions toggle, and the
 * selection-only toggle. Hidden for document formats (JSON/Dripl/PDF),
 * which ignore raster scale.
 */
export function ExportScaleOptions({
  selectedFormat,
  scale,
  useCustomSize,
  customWidth,
  customHeight,
  selectedCount,
  exportSelectionOnly,
  onScale,
  onCustomSize,
  onCustomWidth,
  onCustomHeight,
  onSelectionOnly,
}: {
  selectedFormat: ExportFormat;
  scale: ExportScale;
  useCustomSize: boolean;
  customWidth: string;
  customHeight: string;
  selectedCount: number;
  exportSelectionOnly: boolean;
  onScale: (scale: ExportScale) => void;
  onCustomSize: (enabled: boolean) => void;
  onCustomWidth: (width: string) => void;
  onCustomHeight: (height: string) => void;
  onSelectionOnly: (enabled: boolean) => void;
}) {
  if (selectedFormat === 'json' || selectedFormat === 'dripl' || selectedFormat === 'pdf') {
    return null;
  }

  const inputClass = 'flex-1 px-3 py-1.5 rounded-md text-[13px] outline-none';

  return (
    <div>
      <label className="text-[12px] font-medium mb-2 block" style={{ color: '#6B6860' }}>
        Scale
      </label>
      <div className="space-y-2">
        <div className="flex gap-1.5">
          {([1, 2, 3, 4] as ExportScale[]).map(s => (
            <button
              key={s}
              onClick={() => {
                onScale(s);
                onCustomSize(false);
              }}
              className="flex-1 py-1.5 rounded-md text-[12px] font-medium transition-colors"
              style={{
                border: scale === s && !useCustomSize ? '1px solid #E8462A' : '1px solid #D4D0C9',
                backgroundColor: scale === s && !useCustomSize ? '#FAE8E5' : '#FAFAF7',
                color: scale === s && !useCustomSize ? '#E8462A' : '#6B6860',
              }}
            >
              {s}x
            </button>
          ))}
        </div>
        <label
          className="flex items-center gap-2 text-[12px] cursor-pointer"
          style={{ color: '#6B6860' }}
        >
          <input
            type="checkbox"
            checked={useCustomSize}
            onChange={e => onCustomSize(e.target.checked)}
            className="rounded w-3.5 h-3.5"
            style={{ accentColor: '#E8462A' }}
          />
          Custom dimensions
        </label>
        {useCustomSize && (
          <div className="flex gap-2 items-center">
            <input
              type="number"
              placeholder="Width"
              value={customWidth}
              onChange={e => onCustomWidth(e.target.value)}
              className={inputClass}
              min={100}
              max={8192}
            />
            <span style={{ color: '#6B6860' }}>×</span>
            <input
              type="number"
              placeholder="Height"
              value={customHeight}
              onChange={e => onCustomHeight(e.target.value)}
              className={inputClass}
              min={100}
              max={8192}
            />
            <span className="text-[11px]" style={{ color: '#6B6860' }}>
              px
            </span>
          </div>
        )}
        {selectedCount > 0 && (
          <label
            className="flex items-center gap-2 text-[12px] cursor-pointer"
            style={{ color: '#6B6860' }}
          >
            <input
              type="checkbox"
              checked={exportSelectionOnly}
              onChange={e => onSelectionOnly(e.target.checked)}
              className="rounded w-3.5 h-3.5"
              style={{ accentColor: '#E8462A' }}
            />
            <Square size={12} />
            Export selected only ({selectedCount})
          </label>
        )}
      </div>
    </div>
  );
}
