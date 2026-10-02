'use client';

import { FONT_PREFERENCES } from '@/utils/fontPreferences';
import { SectionLabel, type PanelSectionProps } from './PanelPrimitives';

export function FontSizeSection({ selectedElement, updateProp }: PanelSectionProps) {
  return (
    <div className="space-y-1.5">
      <SectionLabel>Font size</SectionLabel>
      <div className="flex gap-1">
        {[12, 16, 20, 24, 32, 48].map(size => (
          <button
            key={size}
            onClick={() => updateProp('fontSize', size)}
            className={`flex-1 py-1.5 rounded-md text-[11px] font-medium transition-all duration-150 ${
              selectedElement?.fontSize === size
                ? 'bg-[#E8462A] text-white shadow-sm'
                : 'bg-[#D4D0C9] text-[#5A5750] hover:bg-[#C8C4BC]'
            }`}
          >
            {size}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FontFamilySection({ selectedElement, updateProp }: PanelSectionProps) {
  return (
    <div className="space-y-1.5">
      <SectionLabel>Font</SectionLabel>
      <div className="flex gap-1 flex-wrap">
        {Object.entries(FONT_PREFERENCES).map(([key, value]) => (
          <button
            key={key}
            onClick={() => updateProp('fontFamily', value)}
            className={`px-2.5 py-1.5 rounded-md text-[10px] font-medium transition-all duration-150 ${
              selectedElement?.fontFamily === value
                ? 'bg-[#E8462A] text-white shadow-sm'
                : 'bg-[#D4D0C9] text-[#5A5750] hover:bg-[#C8C4BC]'
            }`}
            style={{ fontFamily: value }}
          >
            {key}
          </button>
        ))}
      </div>
    </div>
  );
}
