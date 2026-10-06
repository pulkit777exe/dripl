'use client';

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Download,
  Trash2,
} from 'lucide-react';
import { useCanvasStore } from '@/lib/store';
import { ActionBtn, SectionLabel, type PanelSectionProps } from './PanelPrimitives';

export function OpacitySection({ selectedElement, updateProp }: PanelSectionProps) {
  const currentOpacity = 1;
  const opacity = selectedElement?.opacity ?? currentOpacity;

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center">
        <SectionLabel>Opacity</SectionLabel>
        <span className="text-xs tabular-nums" style={{ color: 'var(--color-panel-label)' }}>
          {Math.round(opacity * 100)}
        </span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={Math.round(opacity * 100)}
        onChange={e =>
          selectedElement ? updateProp('opacity', Number(e.target.value) / 100) : undefined
        }
        className="w-full"
      />
    </div>
  );
}

export function LayersSection({ selectedElement }: PanelSectionProps) {
  const sendToBack = useCanvasStore(s => s.sendToBack);
  const sendBackward = useCanvasStore(s => s.sendBackward);
  const bringForward = useCanvasStore(s => s.bringForward);
  const bringToFront = useCanvasStore(s => s.bringToFront);

  return (
    <div className="space-y-1.5">
      <SectionLabel>Layers</SectionLabel>
      <div className="flex gap-1">
        <ActionBtn
          onClick={() => selectedElement && sendToBack([selectedElement.id])}
          title="Send to back"
        >
          <ChevronsDown size={13} />
        </ActionBtn>
        <ActionBtn
          onClick={() => selectedElement && sendBackward([selectedElement.id])}
          title="Send backward"
        >
          <ChevronDown size={13} />
        </ActionBtn>
        <ActionBtn
          onClick={() => selectedElement && bringForward([selectedElement.id])}
          title="Bring forward"
        >
          <ChevronUp size={13} />
        </ActionBtn>
        <ActionBtn
          onClick={() => selectedElement && bringToFront([selectedElement.id])}
          title="Bring to front"
        >
          <ChevronsUp size={13} />
        </ActionBtn>
      </div>
    </div>
  );
}

export function AlignSection() {
  const alignElements = useCanvasStore(s => s.alignElements);

  return (
    <div className="space-y-1.5">
      <SectionLabel>Align</SectionLabel>
      <div className="flex gap-1 flex-wrap">
        <ActionBtn title="Align left" onClick={() => alignElements('left')}>
          <AlignLeft size={13} />
        </ActionBtn>
        <ActionBtn title="Align center" onClick={() => alignElements('center')}>
          <AlignCenter size={13} />
        </ActionBtn>
        <ActionBtn title="Align right" onClick={() => alignElements('right')}>
          <AlignRight size={13} />
        </ActionBtn>
        <ActionBtn title="Align middle" onClick={() => alignElements('middle')}>
          <AlignVerticalJustifyCenter size={13} />
        </ActionBtn>
      </div>
    </div>
  );
}

export function ActionsSection({
  onDuplicate,
  onDelete,
  onExport,
}: {
  onDuplicate?: () => void;
  onDelete?: () => void;
  onExport: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="h-px" style={{ backgroundColor: 'var(--color-panel-divider)' }} />
      <div className="flex gap-1">
        <ActionBtn onClick={onDuplicate} title="Duplicate">
          <Copy size={13} />
        </ActionBtn>
        <ActionBtn onClick={onDelete} title="Delete" danger>
          <Trash2 size={13} />
        </ActionBtn>
        <ActionBtn onClick={onExport} title="Export">
          <Download size={13} />
        </ActionBtn>
      </div>
    </div>
  );
}

export function GlobalExportSection({ onExport }: { onExport: () => void }) {
  return (
    <div className="pt-2" style={{ borderTop: '1px solid var(--color-panel-divider)' }}>
      <button
        onClick={onExport}
        className="w-full flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs t-theme duration-120"
        style={{
          backgroundColor: 'var(--color-panel-btn-bg)',
          color: 'var(--color-panel-label)',
          border: '1px solid var(--color-panel-border)',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
            'var(--color-panel-btn-hover)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
            'var(--color-panel-btn-bg)';
        }}
      >
        <Download className="w-3.5 h-3.5" />
        Export
      </button>
    </div>
  );
}
