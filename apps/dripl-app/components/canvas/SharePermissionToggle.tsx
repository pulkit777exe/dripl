'use client';

import { Eye, Pencil } from 'lucide-react';
import type { SharePermission } from '@/hooks/useShareLink';

interface SharePermissionToggleProps {
  value: SharePermission;
  onChange: (next: SharePermission) => void;
  disabled?: boolean;
}

const OPTIONS: ReadonlyArray<{ value: SharePermission; label: string; description: string; Icon: typeof Eye }> = [
  { value: 'view', label: 'View only', description: 'Anyone with the link can open and view.', Icon: Eye },
  { value: 'edit', label: 'Can edit', description: 'Anyone with the link can make changes.', Icon: Pencil },
];

/**
 * Segmented radio group that lets the user pick who can open a share
 * link. Two states, view or edit. The component is the test surface
 * for the permission chooser; behavior is asserted through
 * `getByRole('radio', …)` so it survives styling changes.
 */
export function SharePermissionToggle({ value, onChange, disabled }: SharePermissionToggleProps) {
  return (
    <div role="radiogroup" aria-label="Who can open this link" className="grid grid-cols-2 gap-2">
      {OPTIONS.map(opt => {
        const checked = value === opt.value;
        return (
          <label
            key={opt.value}
            className="flex items-start gap-2 rounded-md px-3 py-2.5 cursor-pointer transition-colors"
            style={{
              border: `1px solid ${checked ? '#E8462A' : '#D4D0C9'}`,
              backgroundColor: checked ? '#FAE8E5' : '#FAFAF7',
            }}
          >
            <input
              type="radio"
              name="share-permission"
              value={opt.value}
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(opt.value)}
              aria-checked={checked}
              className="sr-only"
            />
            <opt.Icon
              className="h-4 w-4 mt-0.5 shrink-0"
              style={{ color: checked ? '#E8462A' : '#6B6860' }}
              aria-hidden="true"
            />
            <div className="flex flex-col">
              <span className="text-[13px] font-medium" style={{ color: '#1A1917' }}>
                {opt.label}
              </span>
              <span className="text-[11px]" style={{ color: '#6B6860' }}>
                {opt.description}
              </span>
            </div>
          </label>
        );
      })}
    </div>
  );
}
