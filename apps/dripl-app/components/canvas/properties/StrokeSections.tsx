'use client';

import { useCanvasStore } from '@/lib/store';
import { RowBtn, SectionLabel, type PanelSectionProps } from './PanelPrimitives';

export function StrokeWidthSection({ selectedElement, updateProp }: PanelSectionProps) {
  const currentStrokeWidth = useCanvasStore(s => s.currentStrokeWidth);
  const setCurrentStrokeWidth = useCanvasStore(s => s.setCurrentStrokeWidth);
  const strokeWidth = selectedElement?.strokeWidth ?? currentStrokeWidth;

  return (
    <div className="space-y-1.5">
      <SectionLabel>Stroke width</SectionLabel>
      <div className="flex gap-1">
        {[1, 2, 4].map(w => (
          <RowBtn
            key={w}
            active={strokeWidth === w}
            onClick={() =>
              selectedElement ? updateProp('strokeWidth', w) : setCurrentStrokeWidth(w)
            }
            title={`Width ${w}`}
          >
            <div
              className="rounded-full"
              style={{
                width: w * 5 + 4,
                height: w + 1,
                backgroundColor: 'currentColor',
              }}
            />
          </RowBtn>
        ))}
      </div>
    </div>
  );
}

export function StrokeStyleSection({ selectedElement, updateProp }: PanelSectionProps) {
  const currentStrokeStyle = useCanvasStore(s => s.currentStrokeStyle);
  const setCurrentStrokeStyle = useCanvasStore(s => s.setCurrentStrokeStyle);
  const strokeStyle = selectedElement?.strokeStyle ?? currentStrokeStyle;

  return (
    <div className="space-y-1.5">
      <SectionLabel>Stroke style</SectionLabel>
      <div className="flex gap-1">
        {(['solid', 'dashed', 'dotted'] as const).map(s => (
          <RowBtn
            key={s}
            active={strokeStyle === s}
            onClick={() =>
              selectedElement ? updateProp('strokeStyle', s) : setCurrentStrokeStyle(s)
            }
            title={s}
          >
            <div
              className="w-5 border-t-2"
              style={{
                borderStyle: s,
                borderColor: 'currentColor',
              }}
            />
          </RowBtn>
        ))}
      </div>
    </div>
  );
}

const SLOPPINESS_TITLES = ['Architect', 'Artist', 'Cartoonist'];

export function SloppinessSection({ selectedElement, updateProp }: PanelSectionProps) {
  const currentRoughness = useCanvasStore(s => s.currentRoughness);
  const setCurrentRoughness = useCanvasStore(s => s.setCurrentRoughness);
  const roughness = selectedElement?.roughness ?? currentRoughness;

  return (
    <div className="space-y-1.5">
      <SectionLabel>Sloppiness</SectionLabel>
      <div className="flex gap-1">
        {[0, 1, 2].map(level => (
          <RowBtn
            key={level}
            active={roughness === level}
            onClick={() =>
              selectedElement ? updateProp('roughness', level) : setCurrentRoughness(level)
            }
            title={SLOPPINESS_TITLES[level]}
          >
            <svg
              width="16"
              height="14"
              viewBox="0 0 24 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              {level === 0 && <path d="M4 9h16" />}
              {level === 1 && <path d="M4 9c3-2 5 2 8 0s5-2 8 0" />}
              {level === 2 && <path d="M4 9c1-3 2 3 4 0s2 3 4 0 2 3 4 0 2 3 4 0" />}
            </svg>
          </RowBtn>
        ))}
      </div>
    </div>
  );
}

export function EdgesSection({ selectedElement, updateProp }: PanelSectionProps) {
  return (
    <div className="space-y-1.5">
      <SectionLabel>Edges</SectionLabel>
      <div className="flex gap-1">
        {(['sharp', 'round'] as const).map(edge => (
          <RowBtn
            key={edge}
            active={(selectedElement as Record<string, unknown>)?.edges === edge}
            onClick={() => updateProp('edges', edge)}
            title={edge}
          >
            <div
              className={`w-4 h-4 border-2 ${edge === 'round' ? 'rounded' : ''}`}
              style={{ borderColor: 'currentColor' }}
            />
          </RowBtn>
        ))}
      </div>
    </div>
  );
}
