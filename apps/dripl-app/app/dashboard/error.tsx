'use client';

import { useEffect } from 'react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      className="flex-1 flex items-center justify-center"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      <div className="text-center">
        <h2 className="text-xl font-semibold text-[#1A1917] mb-2">Something went wrong!</h2>
        <p className="text-[#6B6860] mb-4">{error.message}</p>
        <button
          onClick={reset}
          className="px-4 py-2 text-white rounded-md transition-colors"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
