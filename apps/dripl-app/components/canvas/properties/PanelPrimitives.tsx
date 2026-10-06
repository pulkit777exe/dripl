'use client';

import type { DriplElement } from '@dripl/common';

/**
 * Shared panel primitives — extracted from `PropertiesPanel`.
 *
 * Presentational buttons/labels plus the swatch palettes and the section
 * prop contract. Sections live in sibling files and subscribe to only the
 * store values they render, so a style change re-renders one section
 * instead of the whole panel.
 */

export interface PanelSectionProps {
  selectedElement: DriplElement | null | undefined;
  updateProp: (property: string, value: unknown) => void;
}

export const STROKE_COLORS = [
  { value: '#1e1e1e', label: 'Black' },
  { value: '#e03131', label: 'Red' },
  { value: '#2f9e44', label: 'Green' },
  { value: '#1971c2', label: 'Blue' },
  { value: '#f08c00', label: 'Orange' },
  { value: '#6965db', label: 'Purple' },
  { value: '#c2255c', label: 'Pink' },
  { value: '#ffffff', label: 'White' },
];

export const BACKGROUND_COLORS = [
  { value: 'transparent', label: 'None' },
  { value: '#ffc9c9', label: 'Light Red' },
  { value: '#b2f2bb', label: 'Light Green' },
  { value: '#a5d8ff', label: 'Light Blue' },
  { value: '#ffec99', label: 'Light Yellow' },
  { value: '#e0dcff', label: 'Light Purple' },
];

export const ARRANGE_BUTTON_CLASS = 'h-7 rounded text-[11px] transition-colors hover:opacity-80';

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      className="text-[11px] font-semibold uppercase tracking-wider select-none"
      style={{ color: 'var(--color-panel-label)' }}
    >
      {children}
    </label>
  );
}

interface RowBtnProps {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}

export function RowBtn({ active, onClick, title, children }: RowBtnProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex-1 h-7 rounded flex items-center justify-center t-theme duration-120"
      style={
        active
          ? {
              backgroundColor: 'var(--color-panel-btn-active)',
              color: 'var(--color-panel-btn-active-text, #fff)',
              boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.15)',
            }
          : {
              backgroundColor: 'var(--color-panel-btn-bg)',
              color: 'var(--color-panel-text)',
            }
      }
      onMouseEnter={e => {
        if (!active)
          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
            'var(--color-panel-btn-hover)';
      }}
      onMouseLeave={e => {
        if (!active)
          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
            'var(--color-panel-btn-bg)';
      }}
    >
      {children}
    </button>
  );
}

export function ActionBtn({
  onClick,
  title,
  danger,
  children,
}: {
  onClick?: () => void;
  title?: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex-1 h-7 rounded flex items-center justify-center t-theme duration-120"
      style={{
        backgroundColor: 'var(--color-panel-btn-bg)',
        color: 'var(--color-panel-text)',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor = danger
          ? 'rgba(224,49,49,0.15)'
          : 'var(--color-panel-btn-hover)';
        if (danger) (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-destructive)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--color-panel-btn-bg)';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-panel-text)';
      }}
    >
      {children}
    </button>
  );
}
