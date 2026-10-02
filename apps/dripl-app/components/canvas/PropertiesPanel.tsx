'use client';

import dynamic from 'next/dynamic';
import { useCanvasStore } from '@/lib/store';
import { useState } from 'react';
import type { DriplElement } from '@dripl/common';
import { ArrangeSection } from './properties/ArrangeSection';
import { BackgroundSection, StrokeSection } from './properties/ColorSections';
import { FontFamilySection, FontSizeSection } from './properties/TypographySection';
import {
  EdgesSection,
  SloppinessSection,
  StrokeStyleSection,
  StrokeWidthSection,
} from './properties/StrokeSections';
import { ArrowTypeSection, ArrowheadsSection } from './properties/ArrowSections';
import {
  ActionsSection,
  AlignSection,
  GlobalExportSection,
  LayersSection,
  OpacitySection,
} from './properties/EffectSections';

const ExportModal = dynamic(() => import('./ExportModal').then(m => m.ExportModal), { ssr: false });

interface ElementPropertiesProps {
  selectedElement: DriplElement | null;
  onUpdateElement: (element: DriplElement) => void;
  onDeleteElement?: () => void;
  onDuplicateElement?: () => void;
}

const SHAPE_PROPERTIES: Record<string, string[]> = {
  rectangle: [
    'strokeColor',
    'background',
    'strokeWidth',
    'strokeStyle',
    'sloppiness',
    'edges',
    'opacity',
    'layers',
    'align',
    'actions',
  ],
  diamond: [
    'strokeColor',
    'background',
    'strokeWidth',
    'strokeStyle',
    'sloppiness',
    'edges',
    'opacity',
    'layers',
    'align',
    'actions',
  ],
  ellipse: [
    'strokeColor',
    'background',
    'strokeWidth',
    'strokeStyle',
    'sloppiness',
    'opacity',
    'layers',
    'align',
    'actions',
  ],
  arrow: [
    'strokeColor',
    'strokeWidth',
    'strokeStyle',
    'sloppiness',
    'arrowType',
    'arrowheads',
    'opacity',
    'layers',
    'actions',
  ],
  line: ['strokeColor', 'strokeWidth', 'strokeStyle', 'sloppiness', 'opacity', 'layers', 'actions'],
  freedraw: ['strokeColor', 'strokeWidth', 'opacity', 'layers', 'actions'],
  text: ['strokeColor', 'fontSize', 'fontFamily', 'opacity', 'layers', 'align', 'actions'],
  image: ['opacity', 'layers', 'align', 'actions'],
  frame: ['strokeColor', 'opacity', 'layers', 'actions'],
  embed: ['strokeColor', 'opacity', 'layers', 'actions'],
};

export function PropertiesPanel({
  selectedElement,
  onUpdateElement,
  onDeleteElement,
  onDuplicateElement,
}: Partial<ElementPropertiesProps> = {}) {
  const [showExportModal, setShowExportModal] = useState(false);

  const selectedIds = useCanvasStore(s => s.selectedIds);

  const updateProp = (property: string, value: unknown) => {
    if (!selectedElement || !onUpdateElement) return;
    onUpdateElement({ ...selectedElement, [property]: value } as DriplElement);
  };

  const visibleProps = selectedElement ? (SHAPE_PROPERTIES[selectedElement.type] ?? []) : [];
  const showProp = (p: string) => !selectedElement || visibleProps.includes(p);

  const panelClass = 't-panel-slide';

  return (
    <div
      className={`flex flex-col gap-2 z-50 ${panelClass}`}
      data-open={selectedElement ? 'true' : 'false'}
    >
      <div
        className="p-4 rounded-xl shadow-2xl w-48 space-y-3"
        style={{
          backgroundColor: 'var(--color-panel-bg)',
          border: '1px solid var(--color-panel-border)',
        }}
      >
        {selectedIds.size > 1 && <ArrangeSection />}

        {/* ── Stroke colour ─────────────────────────────────────────────── */}
        {showProp('strokeColor') && (
          <StrokeSection selectedElement={selectedElement} updateProp={updateProp} />
        )}

        {/* Section divider */}
        {showProp('strokeColor') && showProp('background') && (
          <div className="h-px my-2" style={{ backgroundColor: 'var(--color-panel-divider)' }} />
        )}

        {/* ── Background colour ─────────────────────────────────────────── */}
        {showProp('background') && (
          <BackgroundSection selectedElement={selectedElement} updateProp={updateProp} />
        )}

        {/* Divider when both stroke and bg are visible */}
        {showProp('strokeColor') && showProp('background') && (
          <div className="h-px" style={{ backgroundColor: 'var(--color-panel-divider)' }} />
        )}

        {/* ── Font Size ───────────────────────────────────────────────── */}
        {showProp('fontSize') && (
          <>
            <div className="h-px my-2" style={{ backgroundColor: 'var(--color-panel-divider)' }} />
            <FontSizeSection selectedElement={selectedElement} updateProp={updateProp} />
          </>
        )}

        {/* ── Font Family ──────────────────────────────────────────────── */}
        {showProp('fontFamily') && (
          <>
            <div className="h-px my-2" style={{ backgroundColor: 'var(--color-panel-divider)' }} />
            <FontFamilySection selectedElement={selectedElement} updateProp={updateProp} />
          </>
        )}

        {/* ── Stroke width ──────────────────────────────────────────────── */}
        {showProp('strokeWidth') && (
          <StrokeWidthSection selectedElement={selectedElement} updateProp={updateProp} />
        )}

        {/* ── Stroke style ──────────────────────────────────────────────── */}
        {showProp('strokeStyle') && (
          <StrokeStyleSection selectedElement={selectedElement} updateProp={updateProp} />
        )}

        {/* ── Sloppiness ────────────────────────────────────────────────── */}
        {showProp('sloppiness') && (
          <SloppinessSection selectedElement={selectedElement} updateProp={updateProp} />
        )}

        {/* ── Edges ─────────────────────────────────────────────────────── */}
        {showProp('edges') && (
          <EdgesSection selectedElement={selectedElement} updateProp={updateProp} />
        )}

        {/* ── Arrow type ────────────────────────────────────────────────── */}
        {showProp('arrowType') && (
          <ArrowTypeSection selectedElement={selectedElement} updateProp={updateProp} />
        )}

        {/* ── Arrowheads ────────────────────────────────────────────────── */}
        {showProp('arrowheads') && (
          <ArrowheadsSection selectedElement={selectedElement} updateProp={updateProp} />
        )}

        {/* ── Opacity ───────────────────────────────────────────────────── */}
        {showProp('opacity') && (
          <OpacitySection selectedElement={selectedElement} updateProp={updateProp} />
        )}

        {/* ── Layers ────────────────────────────────────────────────────── */}
        {showProp('layers') && (
          <LayersSection selectedElement={selectedElement} updateProp={updateProp} />
        )}

        {/* ── Align ─────────────────────────────────────────────────────── */}
        {showProp('align') && selectedIds.size > 1 && <AlignSection />}

        {/* ── Actions ───────────────────────────────────────────────────── */}
        {showProp('actions') && (
          <ActionsSection
            onDuplicate={onDuplicateElement}
            onDelete={onDeleteElement}
            onExport={() => setShowExportModal(true)}
          />
        )}

        {/* ── Global export (no selection) ──────────────────────────────── */}
        {!selectedElement && <GlobalExportSection onExport={() => setShowExportModal(true)} />}
      </div>

      <ExportModal isOpen={showExportModal} onClose={() => setShowExportModal(false)} />
    </div>
  );
}
