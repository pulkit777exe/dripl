'use client';

import type { RefObject } from 'react';
import { InlineError } from '@/components/ui/ErrorState';

/** Error + success status blocks for the export modal. */
export function ExportStatus({
  exportError,
  exportSuccess,
  successRef,
  onDismissError,
}: {
  exportError: string | null;
  exportSuccess: string | null;
  successRef: RefObject<HTMLDivElement | null>;
  onDismissError: () => void;
}) {
  return (
    <>
      {exportError && (
        <div className="px-5 pb-5">
          <InlineError message={exportError} onRetry={onDismissError} />
        </div>
      )}

      {exportSuccess && (
        <div className="px-5 pb-5">
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-md"
            style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }}
          >
            <span className="t-success-check" data-state="in" aria-hidden="true" ref={successRef}>
              <svg viewBox="0 0 48 48" fill="none" width="20" height="20">
                <circle cx="24" cy="24" r="22" stroke="#22c55e" strokeWidth="4" />
                <path
                  d="M16 24l6 6 10-10"
                  stroke="#22c55e"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="text-[13px] font-medium" style={{ color: '#16A34A' }}>
              {exportSuccess}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
