'use client';

import { useTheme } from 'next-themes';
import { applyDarkModeFilter, needsSwatchOutline } from '@dripl/element/theme';
import { useCanvasStore } from '@/lib/store';
import {
  BACKGROUND_COLORS,
  STROKE_COLORS,
  SectionLabel,
  type PanelSectionProps,
} from './PanelPrimitives';

/**
 * Colors are stored theme-neutrally (the same value a saved file carries) and
 * transformed only for display. The picker therefore shows exactly what the
 * canvas will paint in the current theme instead of the stored light-mode
 * value — a white stroke in dark mode previews as the near-black it becomes.
 */
function useDisplayTheme(): 'light' | 'dark' {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === 'dark' ? 'dark' : 'light';
}

export function StrokeSection({ selectedElement, updateProp }: PanelSectionProps) {
  const currentStrokeColor = useCanvasStore(s => s.currentStrokeColor);
  const setCurrentStrokeColor = useCanvasStore(s => s.setCurrentStrokeColor);
  const theme = useDisplayTheme();
  const strokeColor = selectedElement?.strokeColor ?? currentStrokeColor;

  return (
    <div className="space-y-1.5">
      <SectionLabel>Stroke</SectionLabel>
      <div className="flex flex-wrap gap-1.5">
        {STROKE_COLORS.map(({ value, label }) => {
          const displayValue = applyDarkModeFilter(value, theme) ?? value;
          const isActive = strokeColor === value;
          return (
            <button
              key={value}
              onClick={() =>
                selectedElement ? updateProp('strokeColor', value) : setCurrentStrokeColor(value)
              }
              title={label}
              aria-label={label}
              className="w-5 h-5 rounded t-theme duration-120"
              style={{
                backgroundColor: displayValue,
                border: isActive
                  ? '2px solid var(--color-panel-text)'
                  : needsSwatchOutline(displayValue)
                    ? '1.5px solid var(--color-panel-border)'
                    : '2px solid transparent',
                transform: isActive ? 'scale(1.18)' : 'scale(1)',
                boxShadow: isActive ? '0 0 0 1px var(--color-panel-bg)' : 'none',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

export function BackgroundSection({ selectedElement, updateProp }: PanelSectionProps) {
  const currentBackgroundColor = useCanvasStore(s => s.currentBackgroundColor);
  const setCurrentBackgroundColor = useCanvasStore(s => s.setCurrentBackgroundColor);
  const theme = useDisplayTheme();
  const backgroundColor = selectedElement?.backgroundColor ?? currentBackgroundColor;

  return (
    <div className="space-y-1.5">
      <SectionLabel>Background</SectionLabel>
      <div className="flex flex-wrap gap-1.5">
        {BACKGROUND_COLORS.map(({ value, label }) => {
          const isTransparent = value === 'transparent';
          const displayValue = isTransparent
            ? undefined
            : (applyDarkModeFilter(value, theme) ?? value);
          const isActive = backgroundColor === value;
          return (
            <button
              key={value}
              onClick={() =>
                selectedElement
                  ? updateProp('backgroundColor', value)
                  : setCurrentBackgroundColor(value)
              }
              title={label}
              aria-label={label}
              className={`w-5 h-5 rounded t-theme duration-120${
                isTransparent
                  ? " bg-[url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%228%22 height=%228%22%3E%3Crect width=%224%22 height=%224%22 fill=%22%23ddd%22/%3E%3Crect x=%224%22 y=%224%22 width=%224%22 height=%224%22 fill=%22%23ddd%22/%3E%3C/svg%3E')]"
                  : ''
              }`}
              style={{
                backgroundColor: displayValue,
                border: isActive
                  ? '2px solid var(--color-panel-text)'
                  : needsSwatchOutline(displayValue)
                    ? '1.5px solid var(--color-panel-border)'
                    : '2px solid transparent',
                transform: isActive ? 'scale(1.18)' : 'scale(1)',
                boxShadow: isActive ? '0 0 0 1px var(--color-panel-bg)' : 'none',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
