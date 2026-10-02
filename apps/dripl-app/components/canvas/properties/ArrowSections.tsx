'use client';

import { useCanvasStore } from '@/lib/store';
import type { ArrowheadType, LinearElement } from '@dripl/common';
import { RowBtn, SectionLabel, type PanelSectionProps } from './PanelPrimitives';

const HEAD_TYPES = ['none', 'triangle', 'dot', 'bar', 'diamond'] as const;
const HEAD_GLYPHS: Record<(typeof HEAD_TYPES)[number], string> = {
  none: '✕',
  triangle: '◀',
  dot: '●',
  bar: '|',
  diamond: '◆',
};
const END_GLYPHS: Record<(typeof HEAD_TYPES)[number], string> = {
  ...HEAD_GLYPHS,
  triangle: '▶',
};

function arrowHeadsOf(selectedElement: PanelSectionProps['selectedElement']) {
  return selectedElement && 'arrowHeads' in selectedElement
    ? ((selectedElement as LinearElement).arrowHeads ?? {})
    : {};
}

export function ArrowTypeSection({ selectedElement, updateProp }: PanelSectionProps) {
  const currentArrowStyle = useCanvasStore(s => s.currentArrowStyle);
  const setCurrentArrowStyle = useCanvasStore(s => s.setCurrentArrowStyle);

  return (
    <div className="space-y-1.5">
      <SectionLabel>Arrow type</SectionLabel>
      <div className="flex gap-1">
        {(['straight', 'curved', 'elbow'] as const).map(type => (
          <RowBtn
            key={type}
            active={
              (selectedElement && 'arrowStyle' in selectedElement
                ? (selectedElement as LinearElement).arrowStyle
                : currentArrowStyle) === type
            }
            onClick={() =>
              selectedElement ? updateProp('arrowStyle', type) : setCurrentArrowStyle(type)
            }
            title={type}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {type === 'straight' && <path d="M5 12h14M15 6l6 6-6 6" />}
              {type === 'curved' && <path d="M5 19c4-8 11-12 14-7M15 6l6 6-6 6" />}
              {type === 'elbow' && <path d="M5 19v-7h14M15 6l6 6-6 6" />}
            </svg>
          </RowBtn>
        ))}
      </div>
    </div>
  );
}

function ArrowheadRow({
  position,
  glyphs,
  selectedElement,
  updateProp,
}: PanelSectionProps & {
  position: 'start' | 'end';
  glyphs: Record<(typeof HEAD_TYPES)[number], string>;
}) {
  const heads = arrowHeadsOf(selectedElement);
  const current: ArrowheadType | undefined =
    position === 'start' ? heads.start : (heads.end ?? 'triangle');

  return (
    <div className="flex gap-1">
      {HEAD_TYPES.map(type => (
        <RowBtn
          key={`${position}-${type}`}
          active={current === type}
          onClick={() => {
            updateProp('arrowHeads', {
              ...heads,
              [position]: type,
            });
          }}
          title={type}
        >
          <span className="text-xs">{glyphs[type]}</span>
        </RowBtn>
      ))}
    </div>
  );
}

export function ArrowheadsSection({ selectedElement, updateProp }: PanelSectionProps) {
  return (
    <div className="space-y-1.5">
      <SectionLabel>Start arrowhead</SectionLabel>
      <ArrowheadRow
        position="start"
        glyphs={HEAD_GLYPHS}
        selectedElement={selectedElement}
        updateProp={updateProp}
      />
      <SectionLabel>End arrowhead</SectionLabel>
      <ArrowheadRow
        position="end"
        glyphs={END_GLYPHS}
        selectedElement={selectedElement}
        updateProp={updateProp}
      />
    </div>
  );
}
