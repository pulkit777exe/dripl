'use client';

import { useCanvasStore } from '@/lib/store';
import {
  BACKGROUND_COLORS,
  STROKE_COLORS,
  SectionLabel,
  type PanelSectionProps,
} from './PanelPrimitives';

export function StrokeSection({ selectedElement, updateProp }: PanelSectionProps) {
  const currentStrokeColor = useCanvasStore(s => s.currentStrokeColor);
  const setCurrentStrokeColor = useCanvasStore(s => s.setCurrentStrokeColor);
  const strokeColor = selectedElement?.strokeColor ?? currentStrokeColor;

  return (
    <div className="space-y-1.5">
      <SectionLabel>Stroke</SectionLabel>
      <div className="flex flex-wrap gap-1.5">
        {STROKE_COLORS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() =>
              selectedElement ? updateProp('strokeColor', value) : setCurrentStrokeColor(value)
            }
            title={label}
            aria-label={label}
            className="w-5 h-5 rounded transition-all duration-120"
            style={{
              backgroundColor: value,
              border:
                strokeColor === value
                  ? '2px solid var(--color-panel-text)'
                  : value === '#ffffff'
                    ? '1.5px solid var(--color-panel-border)'
                    : '2px solid transparent',
              transform: strokeColor === value ? 'scale(1.18)' : 'scale(1)',
              boxShadow: strokeColor === value ? '0 0 0 1px var(--color-panel-bg)' : 'none',
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function BackgroundSection({ selectedElement, updateProp }: PanelSectionProps) {
  const currentBackgroundColor = useCanvasStore(s => s.currentBackgroundColor);
  const setCurrentBackgroundColor = useCanvasStore(s => s.setCurrentBackgroundColor);
  const backgroundColor = selectedElement?.backgroundColor ?? currentBackgroundColor;

  return (
    <div className="space-y-1.5">
      <SectionLabel>Background</SectionLabel>
      <div className="flex flex-wrap gap-1.5">
        {BACKGROUND_COLORS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() =>
              selectedElement
                ? updateProp('backgroundColor', value)
                : setCurrentBackgroundColor(value)
            }
            title={label}
            aria-label={label}
            className={`w-5 h-5 rounded transition-all duration-120${
              value === 'transparent'
                ? " bg-[url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%228%22 height=%228%22%3E%3Crect width=%224%22 height=%224%22 fill=%22%23ddd%22/%3E%3Crect x=%224%22 y=%224%22 width=%224%22 height=%224%22 fill=%22%23ddd%22/%3E%3C/svg%3E')]"
                : ''
            }`}
            style={{
              backgroundColor: value === 'transparent' ? undefined : value,
              border:
                backgroundColor === value
                  ? '2px solid var(--color-panel-text)'
                  : '2px solid transparent',
              transform: backgroundColor === value ? 'scale(1.18)' : 'scale(1)',
              boxShadow: backgroundColor === value ? '0 0 0 1px var(--color-panel-bg)' : 'none',
            }}
          />
        ))}
      </div>
    </div>
  );
}
